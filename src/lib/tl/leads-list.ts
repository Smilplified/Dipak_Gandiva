import type { SupabaseClient } from "@supabase/supabase-js";

const LEADS_PAGE_SIZE = 1000;

const LEADS_SELECT_BASE =
  "id, lead_id, campaign_id, name, company_name, phone, email, city, status, followup_date, notes, assigned_agent_id, created_by, creator_display_name, created_at, updated_at, lead_type, job_title, job_function, job_level, direct_number, industry, company_number, employee_size, address, state, country, zip_code, founded_years, founded_years_link, revenue_range, revenue_link, contact_linkedin_url, company_linkedin_url, scored, scored_timezone, appointment, appointment_timezone, lead_tagging, lead_disposition, delivery_status, delivered_at, delivered_by";

const LEADS_SELECT_EXTENDED =
  LEADS_SELECT_BASE +
  ", salutation, first_name, last_name, domain, phone_number_link, department, job_title_link, tenurity, vv_status, email_status, ev_tool, see_all_employees, employee_size_link, company_website_link, sic_code, sic_code_link, naics_code, naics_code_link, ra_comment, special_comments, call_back, call_notes, primary_reason, secondary_reason, qa_comments, cq1, cq2, cq3, cq4, cq5, extra_cq, audit_date, qa_name, qa_audited_by_id, qa_audited_at, asset_title, asset_title2, address2, address_link, actual_employee_size, industry_type_link, delivery_remark, rectification_status, rectification_qa_name, rectification_date, channel";

const QA_EXTRA =
  ", qa_status, disqualification_reasons, disqualification_reason, rectified_reason";

export const TL_LEADS_LIST_SELECT = LEADS_SELECT_EXTENDED + QA_EXTRA;

function isMissingColumnError(message: string | undefined): boolean {
  return Boolean(
    message?.includes("column") || message?.includes("qa_status")
  );
}

/** Server-side QA filter for TL leads list (`pending` = empty/null qa_status). */
export function applyTlLeadsQaStatusFilter<TQuery extends { or: (filter: string) => TQuery; eq: (column: string, value: string) => TQuery }>(
  query: TQuery,
  qaStatus?: string
): TQuery {
  if (!qaStatus?.trim()) return query;
  const normalized = qaStatus.trim().toLowerCase();
  if (normalized === "pending" || normalized === "pending_audit") {
    return query.or("qa_status.is.null,qa_status.eq.");
  }
  return query.eq("qa_status", normalized);
}

/** Paginated fetch — Supabase returns at most 1000 rows per request. */
export async function fetchTlLeadsForCampaigns(
  supabase: SupabaseClient,
  campaignIds: string[]
): Promise<Record<string, unknown>[]> {
  if (campaignIds.length === 0) return [];

  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let useExtendedSelect = true;

  for (;;) {
    const select = (useExtendedSelect ? LEADS_SELECT_EXTENDED : LEADS_SELECT_BASE) + QA_EXTRA;

    const { data, error } = await supabase
      .from("leads")
      .select(select)
      .in("campaign_id", campaignIds)
      .order("created_at", { ascending: false })
      .range(offset, offset + LEADS_PAGE_SIZE - 1);

    if (error && useExtendedSelect && isMissingColumnError(error.message)) {
      useExtendedSelect = false;
      offset = 0;
      all.length = 0;
      continue;
    }

    if (error) throw new Error(error.message);

    const chunk = (data ?? []) as unknown as Record<string, unknown>[];
    all.push(...chunk);
    if (chunk.length < LEADS_PAGE_SIZE) break;
    offset += LEADS_PAGE_SIZE;
  }

  return all;
}

/** Single-page fetch with total count for TL org leads list API. */
export async function fetchTlLeadsPageForCampaigns(
  supabase: SupabaseClient,
  opts: {
    campaignIds: string[];
    offset: number;
    limit: number;
    search?: string;
    select?: string;
    organizationId?: string;
    agentIds?: string[];
    includeUnassigned?: boolean;
    dateFrom?: string;
    dateTo?: string;
    qaStatus?: string;
  }
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const { campaignIds, offset, limit, search, agentIds, includeUnassigned, dateFrom, dateTo, qaStatus, organizationId } =
    opts;
  if (campaignIds.length === 0) return { rows: [], total: 0 };

  let useExtendedSelect = true;
  let select = opts.select ?? TL_LEADS_LIST_SELECT;

  for (let attempt = 0; attempt < 2; attempt++) {
    let query = supabase
      .from("leads")
      .select(select, { count: "exact" })
      .in("campaign_id", campaignIds)
      .order("created_at", { ascending: false });

    if (organizationId) {
      query = query.eq("organization_id", organizationId);
    }

    if (search) {
      const safe = search.replace(/%/g, "").replace(/_/g, "");
      if (safe.length > 0) {
        query = query.or(
          `name.ilike.%${safe}%,company_name.ilike.%${safe}%,email.ilike.%${safe}%,phone.ilike.%${safe}%,lead_id.ilike.%${safe}%`
        );
      }
    }

    const realAgentIds = (agentIds ?? []).filter(Boolean);
    if (realAgentIds.length > 0 && includeUnassigned) {
      const idList = realAgentIds.map((id) => `"${id}"`).join(",");
      query = query.or(`assigned_agent_id.is.null,assigned_agent_id.in.(${idList})`);
    } else if (realAgentIds.length > 0) {
      query = query.in("assigned_agent_id", realAgentIds);
    } else if (includeUnassigned) {
      query = query.is("assigned_agent_id", null);
    }

    if (dateFrom) {
      query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    }
    if (dateTo) {
      query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    }

    query = applyTlLeadsQaStatusFilter(query, qaStatus);

    const { data, error, count } = await query.range(offset, offset + limit - 1);

    if (error && useExtendedSelect && isMissingColumnError(error.message)) {
      useExtendedSelect = false;
      select = LEADS_SELECT_BASE + QA_EXTRA;
      continue;
    }

    if (error) throw new Error(error.message);

    return {
      rows: (data ?? []) as unknown as Record<string, unknown>[],
      total: count ?? 0,
    };
  }

  return { rows: [], total: 0 };
}

type TlLeadsListQueryOpts = Omit<
  Parameters<typeof fetchTlLeadsPageForCampaigns>[1],
  "offset" | "limit"
>;

/** All matching leads (paginated internally) — for export. */
export async function fetchAllTlLeadsForCampaigns(
  supabase: SupabaseClient,
  opts: TlLeadsListQueryOpts
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let total = 0;

  for (;;) {
    const chunk = await fetchTlLeadsPageForCampaigns(supabase, {
      ...opts,
      offset,
      limit: LEADS_PAGE_SIZE,
    });
    total = chunk.total;
    all.push(...chunk.rows);
    if (chunk.rows.length < LEADS_PAGE_SIZE || all.length >= total) break;
    offset += LEADS_PAGE_SIZE;
  }

  return { rows: all, total };
}
