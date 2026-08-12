import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import dayjs from "dayjs";
import { createClient } from "@/lib/supabase/server";
import { getAdminClientSafe, ADMIN_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/admin";
import {
  buildAgentCampaignLeadBars,
  buildAgentCompletionPredictions,
  buildAgentLeadTrend,
  buildAgentMetricsByCampaign,
  type AgentLeadRow,
  type CampaignLeadStats,
} from "@/lib/agent-dashboard-metrics";
import {
  isValidTimeZone,
  utcEndOfDayInTz,
  utcStartOfDayInTz,
} from "@/lib/date-range-tz";

export const dynamic = "force-dynamic";

const LEADS_PAGE_SIZE = 1000;
const MAX_LEAD_PAGES = 20;
const ID_CHUNK = 80;
/** Short ranges → dated lead scan. Longer → fast SQL RPC (all-time on those campaigns). */
const MAX_DATE_FILTER_DAYS = 93;

type CampaignRow = {
  id: string;
  campaign_id: string | null;
  campaign_code: string | null;
  name: string;
  client_name: string | null;
  industry: string | null;
  geography: string | null;
  lead_type: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  total_allocation: number | null;
  created_at: string;
};

function chunkIds(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * All leads on the agent's assigned campaigns (org-scoped), optional created_at window.
 * Not filtered by assigned_agent_id — agents see campaign lead totals for campaigns they work on.
 */
async function fetchCampaignLeads(
  admin: SupabaseClient,
  orgId: string,
  campaignIds: string[],
  startUtc: string | null,
  endUtc: string | null
): Promise<AgentLeadRow[]> {
  const all: AgentLeadRow[] = [];
  if (campaignIds.length === 0) return all;

  let selectCols = "campaign_id, status, qa_status, delivery_status, created_at";
  let pagesUsed = 0;

  for (const idChunk of chunkIds(campaignIds, ID_CHUNK)) {
    let offset = 0;
    for (;;) {
      if (pagesUsed >= MAX_LEAD_PAGES) break;

      let query = admin
        .from("leads")
        .select(selectCols)
        .eq("organization_id", orgId)
        .in("campaign_id", idChunk)
        .order("created_at", { ascending: false })
        .range(offset, offset + LEADS_PAGE_SIZE - 1);

      if (startUtc) query = query.gte("created_at", startUtc);
      if (endUtc) query = query.lte("created_at", endUtc);

      const { data, error } = await query;

      if (error) {
        const msg = error.message?.toLowerCase() ?? "";
        if (msg.includes("delivery_status") && selectCols.includes("delivery_status")) {
          selectCols = "campaign_id, status, qa_status, created_at";
          offset = 0;
          all.length = 0;
          pagesUsed = 0;
          continue;
        }
        throw new Error(error.message);
      }

      const chunk = (data ?? []) as unknown as AgentLeadRow[];
      all.push(...chunk);
      pagesUsed += 1;
      if (chunk.length < LEADS_PAGE_SIZE) break;
      offset += LEADS_PAGE_SIZE;
    }
    if (pagesUsed >= MAX_LEAD_PAGES) break;
  }

  return all;
}

async function fetchCountsViaRpc(
  admin: SupabaseClient,
  orgId: string,
  campaignIds: string[]
): Promise<Record<string, CampaignLeadStats & { disqualified: number; delivered: number }> | null> {
  type Row = {
    campaign_id: string;
    total_leads: number | string;
    qualified_leads: number | string;
    disqualified_leads?: number | string | null;
    delivered_leads: number | string;
  };
  const out: Record<string, CampaignLeadStats & { disqualified: number; delivered: number }> = {};
  for (const id of campaignIds) {
    out[id] = { total_uploaded: 0, qualified: 0, disqualified: 0, delivered: 0 };
  }
  if (campaignIds.length === 0) return out;

  try {
    for (const chunk of chunkIds(campaignIds, ID_CHUNK)) {
      const { data, error } = await admin.rpc("tl_campaign_lead_counts", {
        p_org_id: orgId,
        p_campaign_ids: chunk,
      });
      if (error) return null;
      for (const row of (data ?? []) as Row[]) {
        if (!row.campaign_id) continue;
        out[row.campaign_id] = {
          total_uploaded: Number(row.total_leads) || 0,
          qualified: Number(row.qualified_leads) || 0,
          disqualified: Number(row.disqualified_leads) || 0,
          delivered: Number(row.delivered_leads) || 0,
        };
      }
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Agent dashboard: assigned campaigns only + lead totals for those campaigns.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "10", 10), 1), 50);

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

    const dateFrom = searchParams.get("date_from")?.trim() || null;
    const dateTo = searchParams.get("date_to")?.trim() || null;
    const tzParam = searchParams.get("tz");
    const appTz = isValidTimeZone(tzParam) ? tzParam : "Asia/Kolkata";
    const hasDateFilter = Boolean(
      dateFrom &&
        dateTo &&
        /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) &&
        /^\d{4}-\d{2}-\d{2}$/.test(dateTo) &&
        dateFrom <= dateTo
    );
    const spanDays =
      hasDateFilter && dateFrom && dateTo
        ? dayjs(dateTo).startOf("day").diff(dayjs(dateFrom).startOf("day"), "day") + 1
        : 0;
    const useDateScan = hasDateFilter && spanDays > 0 && spanDays <= MAX_DATE_FILTER_DAYS;
    const startUtc =
      hasDateFilter && dateFrom ? utcStartOfDayInTz(dateFrom, appTz) : null;
    const endUtc = hasDateFilter && dateTo ? utcEndOfDayInTz(dateTo, appTz) : null;

    // 1) Only campaigns assigned to this agent
    const { data: assignmentRows, error: assignError } = await admin
      .from("campaign_assignments")
      .select("campaign_id")
      .eq("organization_id", orgId)
      .eq("agent_id", user.id)
      .eq("is_active", true);

    if (assignError) {
      return NextResponse.json({ error: assignError.message }, { status: 500 });
    }

    const assignedIds = [
      ...new Set(
        ((assignmentRows ?? []) as { campaign_id: string }[])
          .map((r) => r.campaign_id)
          .filter(Boolean)
      ),
    ];

    if (assignedIds.length === 0) {
      return NextResponse.json({
        summary: {
          totalCampaigns: 0,
          activeCampaigns: 0,
          totalLeads: 0,
          activeLeads: 0,
          pendingLeads: 0,
          qualifiedLeads: 0,
          disqualifiedLeads: 0,
          billableLeads: 0,
          qualifiedRatePct: 0,
        },
        leadTrend: [],
        campaignLeads: [],
        completionPredictions: [],
        recentCampaigns: [],
        assignedCampaigns: [],
        campaignLeadStats: {},
        dateFilter: null,
      });
    }

    const { data: campaignsData, error: campaignsError } = await admin
      .from("campaigns")
      .select(
        "id, campaign_id, campaign_code, name, client_name, industry, geography, lead_type, status, start_date, end_date, total_allocation, created_at"
      )
      .eq("organization_id", orgId)
      .in("id", assignedIds)
      .order("created_at", { ascending: false });

    if (campaignsError) {
      return NextResponse.json({ error: campaignsError.message }, { status: 500 });
    }

    const campaigns = (campaignsData ?? []) as CampaignRow[];
    const campaignIds = campaigns.map((c) => c.id);

    // 2) Lead totals for those campaigns (not org-wide)
    let campaignLeads: AgentLeadRow[] = [];
    let teamCampaignStats: Record<string, CampaignLeadStats> = {};
    let byCampaign: ReturnType<typeof buildAgentMetricsByCampaign>["byCampaign"];
    let summary: ReturnType<typeof buildAgentMetricsByCampaign>["summary"];

    if (useDateScan) {
      campaignLeads = await fetchCampaignLeads(admin, orgId, campaignIds, startUtc, endUtc);
      const metrics = buildAgentMetricsByCampaign(campaignIds, campaigns, campaignLeads);
      byCampaign = metrics.byCampaign;
      summary = metrics.summary;
      for (const id of campaignIds) {
        const m = byCampaign[id];
        teamCampaignStats[id] = {
          total_uploaded: m?.total_leads ?? 0,
          qualified: m?.qualified_leads ?? 0,
        };
      }
    } else {
      // Year / long range: fast RPC for assigned campaign IDs only
      const rpc = await fetchCountsViaRpc(admin, orgId, campaignIds);
      if (rpc) {
        byCampaign = {};
        for (const id of campaignIds) {
          const r = rpc[id] ?? {
            total_uploaded: 0,
            qualified: 0,
            disqualified: 0,
            delivered: 0,
          };
          byCampaign[id] = {
            campaign_id: id,
            total_leads: r.total_uploaded,
            active_leads: 0,
            won_leads: 0,
            pending_leads: Math.max(0, r.total_uploaded - r.qualified - r.disqualified),
            qualified_leads: r.qualified,
            disqualified_leads: r.disqualified,
            billable_leads: r.delivered > 0 ? r.delivered : r.qualified,
          };
          teamCampaignStats[id] = {
            total_uploaded: r.total_uploaded,
            qualified: r.qualified,
          };
        }
        let totalLeads = 0;
        let pendingLeads = 0;
        let qualifiedLeads = 0;
        let disqualifiedLeads = 0;
        let billableLeads = 0;
        for (const id of campaignIds) {
          const m = byCampaign[id];
          totalLeads += m.total_leads;
          pendingLeads += m.pending_leads;
          qualifiedLeads += m.qualified_leads;
          disqualifiedLeads += m.disqualified_leads;
          billableLeads += m.billable_leads;
        }
        summary = {
          totalCampaigns: campaigns.length,
          activeCampaigns: campaigns.filter((c) => c.status === "active").length,
          totalLeads,
          activeLeads: 0,
          pendingLeads,
          qualifiedLeads,
          disqualifiedLeads,
          billableLeads,
          qualifiedRatePct:
            totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 100) : 0,
        };
        // Light sample for trend/charts (capped) — month window of the selected range end
        const sampleFrom = dateTo
          ? utcStartOfDayInTz(
              dayjs(dateTo).subtract(30, "day").format("YYYY-MM-DD"),
              appTz
            )
          : null;
        campaignLeads = await fetchCampaignLeads(
          admin,
          orgId,
          campaignIds,
          sampleFrom,
          endUtc
        );
      } else {
        campaignLeads = await fetchCampaignLeads(admin, orgId, campaignIds, startUtc, endUtc);
        const metrics = buildAgentMetricsByCampaign(campaignIds, campaigns, campaignLeads);
        byCampaign = metrics.byCampaign;
        summary = metrics.summary;
        for (const id of campaignIds) {
          const m = byCampaign[id];
          teamCampaignStats[id] = {
            total_uploaded: m?.total_leads ?? 0,
            qualified: m?.qualified_leads ?? 0,
          };
        }
      }
    }

    const assignedCampaigns = campaigns.map((c) => {
      const m = byCampaign[c.id];
      return {
        ...c,
        total_leads: m?.total_leads ?? 0,
        active_leads: m?.active_leads ?? 0,
        won_leads: m?.won_leads ?? 0,
        qualified_leads: m?.qualified_leads ?? 0,
        pending_leads: m?.pending_leads ?? 0,
        disqualified_leads: m?.disqualified_leads ?? 0,
        billable_leads: m?.billable_leads ?? 0,
      };
    });

    const campaignLeadBars = buildAgentCampaignLeadBars(campaigns, campaignLeads);
    const chartBars =
      campaignLeadBars.length > 0
        ? campaignLeadBars
        : assignedCampaigns
            .filter((c) => c.total_leads > 0)
            .sort((a, b) => b.total_leads - a.total_leads)
            .slice(0, 10)
            .map((c) => ({
              id: c.id,
              name: (c.campaign_code?.trim() || c.name).slice(0, 18),
              uploads: c.total_leads,
              qualified: c.qualified_leads,
              pending: c.pending_leads,
              disqualified: c.disqualified_leads,
            }));

    return NextResponse.json({
      summary: {
        ...summary,
        totalCampaigns: campaigns.length,
      },
      leadTrend: buildAgentLeadTrend(campaignLeads, {
        days: 31,
        tz: appTz,
        dateFrom: useDateScan ? dateFrom : null,
        dateTo: hasDateFilter ? dateTo : null,
      }),
      campaignLeads: chartBars,
      completionPredictions: buildAgentCompletionPredictions(
        campaigns,
        campaignLeads,
        teamCampaignStats
      ),
      recentCampaigns: assignedCampaigns.slice(0, limit),
      assignedCampaigns,
      campaignLeadStats: Object.fromEntries(
        assignedCampaigns.map((c) => [
          c.id,
          {
            total_leads: c.total_leads,
            active_leads: c.active_leads,
            won_leads: c.won_leads,
            qualified_leads: c.qualified_leads,
            pending_leads: c.pending_leads,
            disqualified_leads: c.disqualified_leads,
            billable_leads: c.billable_leads,
          },
        ])
      ),
      dateFilter: hasDateFilter
        ? {
            date_from: dateFrom,
            date_to: dateTo,
            tz: appTz,
            field: useDateScan ? "created_at" : "all_time",
          }
        : null,
    });
  } catch (err) {
    console.error("Agent dashboard error:", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
