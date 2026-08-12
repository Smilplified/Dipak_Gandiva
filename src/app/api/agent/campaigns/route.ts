import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getAdminClientSafe, ADMIN_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/admin";
import { buildPaginationMeta, parseListPagination } from "@/lib/api-pagination";
import { isLeadDisqualified, isLeadPendingAudit, isLeadQualified } from "@/lib/qa-lead-audit";
import {
  isValidTimeZone,
  utcEndOfDayInTz,
  utcStartOfDayInTz,
} from "@/lib/date-range-tz";

export const dynamic = "force-dynamic";

const LEADS_PAGE_SIZE = 1000;
const MAX_LEAD_PAGES = 15;
const ID_CHUNK = 80;

type LeadAgg = {
  total: number;
  active: number;
  won: number;
  qualified: number;
  pending: number;
  disqualified: number;
  billable: number;
};

function emptyAgg(): LeadAgg {
  return {
    total: 0,
    active: 0,
    won: 0,
    qualified: 0,
    pending: 0,
    disqualified: 0,
    billable: 0,
  };
}

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Fast SQL counts for assigned campaigns. */
async function aggregateViaRpc(
  admin: SupabaseClient,
  orgId: string,
  campaignIds: string[]
): Promise<Record<string, LeadAgg> | null> {
  const out: Record<string, LeadAgg> = {};
  for (const id of campaignIds) out[id] = emptyAgg();
  if (campaignIds.length === 0) return out;

  try {
    for (const chunk of chunkIds(campaignIds, ID_CHUNK)) {
      const { data, error } = await admin.rpc("tl_campaign_lead_counts", {
        p_org_id: orgId,
        p_campaign_ids: chunk,
      });
      if (error) {
        console.warn("agent/campaigns RPC failed:", error.message);
        return null;
      }
      for (const row of (data ?? []) as {
        campaign_id: string;
        total_leads: number | string;
        qualified_leads: number | string;
        disqualified_leads?: number | string | null;
        delivered_leads: number | string;
      }[]) {
        if (!row.campaign_id) continue;
        const total = Number(row.total_leads) || 0;
        const qualified = Number(row.qualified_leads) || 0;
        const disqualified = Number(row.disqualified_leads) || 0;
        const delivered = Number(row.delivered_leads) || 0;
        out[row.campaign_id] = {
          total,
          active: 0,
          won: 0,
          qualified,
          pending: Math.max(0, total - qualified - disqualified),
          disqualified,
          billable: delivered > 0 ? delivered : qualified,
        };
      }
    }
    return out;
  } catch (err) {
    console.warn("agent/campaigns RPC exception:", err);
    return null;
  }
}

/** Date-filtered lead counts on assigned campaigns (created_at). */
async function aggregateWithDateFilter(
  admin: SupabaseClient,
  orgId: string,
  campaignIds: string[],
  startUtc: string,
  endUtc: string
): Promise<Record<string, LeadAgg>> {
  const out: Record<string, LeadAgg> = {};
  for (const id of campaignIds) out[id] = emptyAgg();
  if (campaignIds.length === 0) return out;

  let selectCols = "campaign_id, status, qa_status, delivery_status";
  let pagesUsed = 0;

  for (const idChunk of chunkIds(campaignIds, ID_CHUNK)) {
    let offset = 0;
    for (;;) {
      if (pagesUsed >= MAX_LEAD_PAGES) break;

      const { data, error } = await admin
        .from("leads")
        .select(selectCols)
        .eq("organization_id", orgId)
        .in("campaign_id", idChunk)
        .gte("created_at", startUtc)
        .lte("created_at", endUtc)
        .order("created_at", { ascending: false })
        .range(offset, offset + LEADS_PAGE_SIZE - 1);

      if (error) {
        const msg = error.message?.toLowerCase() ?? "";
        if (msg.includes("delivery_status") && selectCols.includes("delivery_status")) {
          selectCols = "campaign_id, status, qa_status";
          offset = 0;
          for (const id of campaignIds) out[id] = emptyAgg();
          pagesUsed = 0;
          continue;
        }
        throw new Error(error.message);
      }

      const chunk =
        (data ?? []) as unknown as {
          campaign_id: string;
          status: string | null;
          qa_status: string | null;
          delivery_status?: string | null;
        }[];

      for (const l of chunk) {
        const bucket = out[l.campaign_id];
        if (!bucket) continue;
        bucket.total += 1;
        const st = String(l.status ?? "").trim().toLowerCase();
        if (st === "interested" || st === "followup") bucket.active += 1;
        if (st === "closed_won") bucket.won += 1;
        if (isLeadPendingAudit(l.qa_status)) bucket.pending += 1;
        else if (isLeadQualified(l.qa_status)) bucket.qualified += 1;
        else if (isLeadDisqualified(l.qa_status)) bucket.disqualified += 1;
        const ds = String(l.delivery_status ?? "").trim().toLowerCase();
        if (ds === "delivered" || ds === "delivered_by_mis" || isLeadQualified(l.qa_status)) {
          bucket.billable += 1;
        }
      }

      pagesUsed += 1;
      if (chunk.length < LEADS_PAGE_SIZE) break;
      offset += LEADS_PAGE_SIZE;
    }
    if (pagesUsed >= MAX_LEAD_PAGES) break;
  }

  return out;
}

/**
 * Agent campaigns list: assigned campaigns only + lead totals for those campaigns.
 * When date_from/date_to are set, Leads/Qualified count only leads with created_at in that range
 * (0 if none — no all-time fallback).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("users")
      .select("organization_id")
      .eq("id", user.id)
      .single();

    const orgId = (profile as { organization_id: string | null } | null)?.organization_id;
    if (!orgId) {
      return NextResponse.json({ error: "No organization" }, { status: 400 });
    }

    const admin = getAdminClientSafe();
    if (!admin) {
      return NextResponse.json({ error: ADMIN_NOT_CONFIGURED_MESSAGE }, { status: 503 });
    }

    const { page, limit, offset } = parseListPagination(request.nextUrl.searchParams);
    const statusFilter = request.nextUrl.searchParams.get("status")?.trim() || null;
    const searchRaw = request.nextUrl.searchParams.get("q")?.trim() || "";
    const dateFrom = request.nextUrl.searchParams.get("date_from")?.trim() || null;
    const dateTo = request.nextUrl.searchParams.get("date_to")?.trim() || null;
    const tzParam = request.nextUrl.searchParams.get("tz");
    const appTz = isValidTimeZone(tzParam) ? tzParam : "Asia/Kolkata";
    const hasDateFilter = Boolean(
      dateFrom &&
        dateTo &&
        /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) &&
        /^\d{4}-\d{2}-\d{2}$/.test(dateTo) &&
        dateFrom <= dateTo
    );

    // Assignments: try admin with org scope; fall back without org column / user client.
    let assignedIds: string[] = [];
    {
      const { data, error } = await admin
        .from("campaign_assignments")
        .select("campaign_id")
        .eq("organization_id", orgId)
        .eq("agent_id", user.id)
        .eq("is_active", true);

      if (!error && data) {
        assignedIds = [
          ...new Set(
            (data as { campaign_id: string }[]).map((r) => r.campaign_id).filter(Boolean)
          ),
        ];
      } else {
        const retry = await supabase
          .from("campaign_assignments")
          .select("campaign_id")
          .eq("agent_id", user.id)
          .eq("is_active", true);
        if (retry.error) {
          return NextResponse.json(
            { error: error?.message || retry.error.message },
            { status: 500 }
          );
        }
        assignedIds = [
          ...new Set(
            ((retry.data ?? []) as { campaign_id: string }[])
              .map((r) => r.campaign_id)
              .filter(Boolean)
          ),
        ];
      }
    }

    if (assignedIds.length === 0) {
      return NextResponse.json({
        campaigns: [],
        pagination: buildPaginationMeta(page, limit, 0),
      });
    }

    let campaignsQuery = admin
      .from("campaigns")
      .select(
        "id, campaign_id, campaign_code, name, client_name, description, industry, geography, lead_type, status, start_date, end_date, created_at",
        { count: "exact" }
      )
      .eq("organization_id", orgId)
      .in("id", assignedIds);

    if (statusFilter) {
      campaignsQuery = campaignsQuery.eq("status", statusFilter);
    }
    if (searchRaw.length > 0) {
      const safe = searchRaw.replace(/%/g, "").replace(/_/g, "");
      if (safe.length > 0) {
        campaignsQuery = campaignsQuery.or(
          `name.ilike.%${safe}%,campaign_code.ilike.%${safe}%,industry.ilike.%${safe}%`
        );
      }
    }

    const { data: campaigns, error: campaignsError, count } = await campaignsQuery
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (campaignsError) {
      // User-scoped fallback if admin read fails
      const fallback = await supabase
        .from("campaigns")
        .select(
          "id, campaign_id, campaign_code, name, client_name, description, industry, geography, lead_type, status, start_date, end_date, created_at",
          { count: "exact" }
        )
        .eq("organization_id", orgId)
        .in("id", assignedIds)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (fallback.error) {
        return NextResponse.json({ error: campaignsError.message }, { status: 500 });
      }

      const list = (fallback.data ?? []) as {
        id: string;
        campaign_id: string | null;
        campaign_code: string | null;
        name: string;
        client_name: string | null;
        description: string | null;
        industry: string | null;
        geography: string | null;
        lead_type: string | null;
        status: string;
        start_date: string | null;
        end_date: string | null;
        created_at: string;
      }[];

      const pageIds = list.map((c) => c.id);
      let leadsByCampaign: Record<string, LeadAgg>;
      if (hasDateFilter && dateFrom && dateTo) {
        const startUtc = utcStartOfDayInTz(dateFrom, appTz);
        const endUtc = utcEndOfDayInTz(dateTo, appTz);
        leadsByCampaign = await aggregateWithDateFilter(
          admin,
          orgId,
          pageIds,
          startUtc,
          endUtc
        );
      } else {
        leadsByCampaign =
          (await aggregateViaRpc(admin, orgId, pageIds)) ??
          Object.fromEntries(pageIds.map((id) => [id, emptyAgg()]));
      }

      return NextResponse.json({
        campaigns: list.map((c) => ({
          ...c,
          total_leads: leadsByCampaign[c.id]?.total ?? 0,
          active_leads: leadsByCampaign[c.id]?.active ?? 0,
          won_leads: leadsByCampaign[c.id]?.won ?? 0,
          qualified_leads: leadsByCampaign[c.id]?.qualified ?? 0,
          pending_leads: leadsByCampaign[c.id]?.pending ?? 0,
          disqualified_leads: leadsByCampaign[c.id]?.disqualified ?? 0,
          billable_leads: leadsByCampaign[c.id]?.billable ?? 0,
        })),
        pagination: buildPaginationMeta(page, limit, fallback.count ?? list.length),
      });
    }

    type CampaignRow = {
      id: string;
      campaign_id: string | null;
      campaign_code: string | null;
      name: string;
      client_name: string | null;
      description: string | null;
      industry: string | null;
      geography: string | null;
      lead_type: string | null;
      status: string;
      start_date: string | null;
      end_date: string | null;
      created_at: string;
    };
    const campaignsList = (campaigns ?? []) as CampaignRow[];
    const pageCampaignIds = campaignsList.map((c) => c.id);
    const total = count ?? campaignsList.length;

    let leadsByCampaign: Record<string, LeadAgg>;

    if (hasDateFilter && dateFrom && dateTo) {
      // Strict created_at window — show 0 when no leads in selected dates (no all-time fallback).
      const startUtc = utcStartOfDayInTz(dateFrom, appTz);
      const endUtc = utcEndOfDayInTz(dateTo, appTz);
      leadsByCampaign = await aggregateWithDateFilter(
        admin,
        orgId,
        pageCampaignIds,
        startUtc,
        endUtc
      );
    } else {
      leadsByCampaign =
        (await aggregateViaRpc(admin, orgId, pageCampaignIds)) ??
        Object.fromEntries(pageCampaignIds.map((id) => [id, emptyAgg()]));
    }

    const campaignsWithStats = campaignsList.map((c) => ({
      ...c,
      total_leads: leadsByCampaign[c.id]?.total ?? 0,
      active_leads: leadsByCampaign[c.id]?.active ?? 0,
      won_leads: leadsByCampaign[c.id]?.won ?? 0,
      qualified_leads: leadsByCampaign[c.id]?.qualified ?? 0,
      pending_leads: leadsByCampaign[c.id]?.pending ?? 0,
      disqualified_leads: leadsByCampaign[c.id]?.disqualified ?? 0,
      billable_leads: leadsByCampaign[c.id]?.billable ?? 0,
    }));

    return NextResponse.json({
      campaigns: campaignsWithStats,
      pagination: buildPaginationMeta(page, limit, total),
    });
  } catch (err) {
    console.error("Agent campaigns error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
