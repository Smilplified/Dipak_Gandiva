import type { SupabaseClient } from "@supabase/supabase-js";
import dayjs from "dayjs";
import {
  countDisqualifiedLeads,
  countPendingAuditLeads,
  countQualifiedLeads,
  isLeadDisqualified,
  isLeadPendingAudit,
  isLeadQualified,
} from "@/lib/qa-lead-audit";
import { isInstantInLocalDateRange, toLocalYmd } from "@/lib/date-range-tz";

const TEAM_LEADS_PAGE_SIZE = 1000;

export type AgentLeadRow = {
  campaign_id: string;
  status?: string | null;
  qa_status?: string | null;
  delivery_status?: string | null;
  created_at?: string | null;
  assigned_agent_id?: string | null;
  created_by?: string | null;
};

function isLeadBillable(qaStatus: string | null | undefined, deliveryStatus: string | null | undefined): boolean {
  const ds = String(deliveryStatus ?? "").trim().toLowerCase();
  if (ds === "delivered" || ds === "delivered_by_mis") return true;
  // Fallback: qualified leads are billable when delivery_status is not set yet.
  return isLeadQualified(qaStatus);
}

export type AgentCampaignBase = {
  id: string;
  campaign_code?: string | null;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  total_allocation?: number | null;
};

export type AgentLeadTrendDay = {
  date: string;
  label: string;
  total: number;
  pending: number;
  qualified: number;
  disqualified: number;
};

export type AgentCampaignLeadBar = {
  id: string;
  name: string;
  uploads: number;
  qualified: number;
  pending: number;
  disqualified: number;
};

export type CampaignLeadStats = {
  total_uploaded: number;
  qualified: number;
};

export type AgentCompletionPrediction = {
  id: string;
  campaign_name: string;
  campaign_code: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  total_allocation: number;
  /** Qualified leads on campaign (all agents) — drives progress vs allocation. */
  campaign_qualified: number;
  /** All uploads on campaign (all agents). */
  campaign_total_uploaded: number;
  agent_uploaded: number;
  agent_qualified: number;
  remaining_qualified: number;
  progress_pct: number;
  days_left: number | null;
  required_per_day: number | null;
  is_complete: boolean;
  is_overdue: boolean;
  is_nearing: boolean;
};

export function tallyCampaignLeadStats(leads: AgentLeadRow[]): Record<string, CampaignLeadStats> {
  const out: Record<string, CampaignLeadStats> = {};
  for (const lead of leads) {
    if (!out[lead.campaign_id]) {
      out[lead.campaign_id] = { total_uploaded: 0, qualified: 0 };
    }
    out[lead.campaign_id].total_uploaded += 1;
    if (isLeadQualified(lead.qa_status)) {
      out[lead.campaign_id].qualified += 1;
    }
  }
  return out;
}

export function tallyAgentLeadStats(leads: AgentLeadRow[]): Record<string, CampaignLeadStats> {
  return tallyCampaignLeadStats(leads);
}

/**
 * Campaign-wide upload/qualified counts (all agents). Uses service-role client because
 * agent RLS only allows SELECT on rows where assigned_agent_id = auth.uid().
 */
export async function fetchCampaignTeamLeadStats(
  admin: SupabaseClient,
  orgId: string,
  campaignIds: string[],
  options?: {
    dateFrom?: string | null;
    dateTo?: string | null;
    tz?: string;
  }
): Promise<Record<string, CampaignLeadStats>> {
  if (campaignIds.length === 0) return {};

  const all: AgentLeadRow[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await admin
      .from("leads")
      .select("campaign_id, qa_status, created_at")
      .eq("organization_id", orgId)
      .in("campaign_id", campaignIds)
      .order("created_at", { ascending: true })
      .range(offset, offset + TEAM_LEADS_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const chunk = (data ?? []) as AgentLeadRow[];
    all.push(...chunk);
    if (chunk.length < TEAM_LEADS_PAGE_SIZE) break;
    offset += TEAM_LEADS_PAGE_SIZE;
  }

  const tz = options?.tz || "Asia/Kolkata";
  const dateFrom = options?.dateFrom;
  const dateTo = options?.dateTo;
  const filtered =
    dateFrom && dateTo
      ? all.filter((l) => isInstantInLocalDateRange(l.created_at, dateFrom, dateTo, tz))
      : all;

  return tallyCampaignLeadStats(filtered);
}

function daysBetween(start: string, end: string): number {
  return Math.max(0, dayjs(end).startOf("day").diff(dayjs(start).startOf("day"), "day"));
}

export function buildAgentLeadTrend(
  leads: AgentLeadRow[],
  daysOrOptions: number | { days?: number; tz?: string; dateFrom?: string | null; dateTo?: string | null } = 14,
  tzArg = "Asia/Kolkata"
): AgentLeadTrendDay[] {
  const opts =
    typeof daysOrOptions === "number"
      ? { days: daysOrOptions, tz: tzArg, dateFrom: null as string | null, dateTo: null as string | null }
      : {
          days: daysOrOptions.days ?? 14,
          tz: daysOrOptions.tz ?? "Asia/Kolkata",
          dateFrom: daysOrOptions.dateFrom ?? null,
          dateTo: daysOrOptions.dateTo ?? null,
        };

  const tz = opts.tz;
  let end = opts.dateTo ? dayjs(opts.dateTo) : dayjs();
  let start = opts.dateFrom ? dayjs(opts.dateFrom) : end.subtract((opts.days ?? 14) - 1, "day");

  if (!start.isValid()) start = end.subtract((opts.days ?? 14) - 1, "day");
  if (!end.isValid()) end = dayjs();
  if (start.isAfter(end)) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  // Cap chart length so long ranges stay readable (last N days of the selected range).
  const maxDays = Math.max(opts.days ?? 14, 14);
  const span = end.startOf("day").diff(start.startOf("day"), "day") + 1;
  if (span > maxDays) {
    start = end.subtract(maxDays - 1, "day");
  }

  const out: AgentLeadTrendDay[] = [];
  const dayCount = end.startOf("day").diff(start.startOf("day"), "day") + 1;
  for (let i = 0; i < dayCount; i++) {
    const d = start.add(i, "day");
    const key = d.format("YYYY-MM-DD");
    let total = 0;
    let pending = 0;
    let qualified = 0;
    let disqualified = 0;

    for (const lead of leads) {
      const leadDay = lead.created_at ? toLocalYmd(lead.created_at, tz) : null;
      if (!leadDay || leadDay !== key) continue;
      total++;
      if (isLeadPendingAudit(lead.qa_status)) pending++;
      else if (isLeadQualified(lead.qa_status)) qualified++;
      else if (isLeadDisqualified(lead.qa_status)) disqualified++;
    }

    out.push({
      date: key,
      label: d.format("DD MMM"),
      total,
      pending,
      qualified,
      disqualified,
    });
  }
  return out;
}

export function buildAgentCampaignLeadBars(
  campaigns: AgentCampaignBase[],
  agentLeads: AgentLeadRow[]
): AgentCampaignLeadBar[] {
  const byCampaign = new Map<
    string,
    { uploads: number; qualified: number; pending: number; disqualified: number }
  >();

  for (const lead of agentLeads) {
    if (!byCampaign.has(lead.campaign_id)) {
      byCampaign.set(lead.campaign_id, { uploads: 0, qualified: 0, pending: 0, disqualified: 0 });
    }
    const b = byCampaign.get(lead.campaign_id)!;
    b.uploads++;
    if (isLeadPendingAudit(lead.qa_status)) b.pending++;
    else if (isLeadQualified(lead.qa_status)) b.qualified++;
    else if (isLeadDisqualified(lead.qa_status)) b.disqualified++;
  }

  return campaigns
    .map((c) => {
      const stats = byCampaign.get(c.id) ?? {
        uploads: 0,
        qualified: 0,
        pending: 0,
        disqualified: 0,
      };
      const label = c.campaign_code?.trim() || c.name?.trim() || `Campaign ${c.id.slice(0, 8)}`;
      return {
        id: c.id,
        name: label.length > 18 ? `${label.slice(0, 17)}…` : label,
        ...stats,
      };
    })
    .filter((c) => c.uploads > 0)
    .sort((a, b) => b.uploads - a.uploads)
    .slice(0, 10);
}

export function buildAgentCompletionPredictions(
  campaigns: AgentCampaignBase[],
  agentLeads: AgentLeadRow[],
  campaignStats: Record<string, CampaignLeadStats>,
  today = dayjs().format("YYYY-MM-DD")
): AgentCompletionPrediction[] {
  const agentStats = tallyAgentLeadStats(agentLeads);

  return campaigns
    .filter((c) => c.status === "active" || c.status === "draft")
    .map((c) => {
      const totalAllocation = Math.max(0, c.total_allocation ?? 0);
      const team = campaignStats[c.id] ?? { total_uploaded: 0, qualified: 0 };
      const mine = agentStats[c.id] ?? { total_uploaded: 0, qualified: 0 };
      const campaignQualified = team.qualified;
      const remainingQualified = Math.max(0, totalAllocation - campaignQualified);
      const progressPct =
        totalAllocation > 0
          ? Math.min(100, Math.round((campaignQualified / totalAllocation) * 100))
          : campaignQualified > 0
          ? 100
          : 0;

      const daysLeft =
        c.end_date && c.end_date >= today ? daysBetween(today, c.end_date) : c.end_date ? 0 : null;
      const isOverdue = Boolean(c.end_date && c.end_date < today && progressPct < 100);
      const isComplete = totalAllocation > 0 ? progressPct >= 100 : false;
      const isNearing = !isOverdue && !isComplete && daysLeft !== null && daysLeft <= 7;

      const requiredPerDay =
        !isComplete && daysLeft !== null && daysLeft > 0 && remainingQualified > 0
          ? Math.ceil(remainingQualified / daysLeft)
          : null;

      return {
        id: c.id,
        campaign_name: c.name,
        campaign_code: c.campaign_code ?? null,
        status: c.status,
        start_date: c.start_date,
        end_date: c.end_date,
        total_allocation: totalAllocation,
        campaign_qualified: campaignQualified,
        campaign_total_uploaded: team.total_uploaded,
        agent_uploaded: mine.total_uploaded,
        agent_qualified: mine.qualified,
        remaining_qualified: remainingQualified,
        progress_pct: progressPct,
        days_left: c.end_date ? (isOverdue ? 0 : daysLeft) : null,
        required_per_day: requiredPerDay,
        is_complete: isComplete,
        is_overdue: isOverdue,
        is_nearing: isNearing,
      };
    })
    .filter(
      (c) => c.total_allocation > 0 || c.campaign_total_uploaded > 0 || c.campaign_qualified > 0
    )
    .sort((a, b) => {
      if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
      if (a.is_nearing !== b.is_nearing) return a.is_nearing ? -1 : 1;
      return (b.required_per_day ?? 0) - (a.required_per_day ?? 0);
    });
}

export function summarizeAgentLeads(leads: AgentLeadRow[]) {
  const totalLeads = leads.length;
  const pendingLeads = countPendingAuditLeads(leads);
  const qualifiedLeads = countQualifiedLeads(leads);
  const disqualifiedLeads = countDisqualifiedLeads(leads);
  const billableLeads = leads.filter((l) =>
    isLeadBillable(l.qa_status, l.delivery_status)
  ).length;
  const qualifiedRatePct =
    totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 100) : 0;

  return {
    totalLeads,
    pendingLeads,
    qualifiedLeads,
    disqualifiedLeads,
    billableLeads,
    qualifiedRatePct,
  };
}

/** Per-campaign agent metrics for a date-filtered lead set. */
export type AgentCampaignMetric = {
  campaign_id: string;
  total_leads: number;
  active_leads: number;
  won_leads: number;
  pending_leads: number;
  qualified_leads: number;
  disqualified_leads: number;
  billable_leads: number;
};

export type AgentDashboardSummaryFromCampaigns = {
  totalCampaigns: number;
  activeCampaigns: number;
  totalLeads: number;
  activeLeads: number;
  pendingLeads: number;
  qualifiedLeads: number;
  disqualifiedLeads: number;
  billableLeads: number;
  qualifiedRatePct: number;
};

function emptyCampaignMetric(campaignId: string): AgentCampaignMetric {
  return {
    campaign_id: campaignId,
    total_leads: 0,
    active_leads: 0,
    won_leads: 0,
    pending_leads: 0,
    qualified_leads: 0,
    disqualified_leads: 0,
    billable_leads: 0,
  };
}

/**
 * Step 1: calculate metrics for each assigned campaign from the agent's leads.
 * Step 2: dashboard summary is the sum of those per-campaign totals.
 */
export function buildAgentMetricsByCampaign(
  campaignIds: string[],
  campaigns: { id: string; status: string }[],
  leads: AgentLeadRow[]
): {
  byCampaign: Record<string, AgentCampaignMetric>;
  summary: AgentDashboardSummaryFromCampaigns;
} {
  const byCampaign: Record<string, AgentCampaignMetric> = {};
  for (const id of campaignIds) {
    byCampaign[id] = emptyCampaignMetric(id);
  }

  for (const lead of leads) {
    const id = lead.campaign_id;
    if (!byCampaign[id]) byCampaign[id] = emptyCampaignMetric(id);
    const row = byCampaign[id];
    row.total_leads += 1;

    const st = String(lead.status ?? "").trim().toLowerCase();
    if (st === "interested" || st === "followup") row.active_leads += 1;
    if (st === "closed_won") row.won_leads += 1;

    if (isLeadPendingAudit(lead.qa_status)) row.pending_leads += 1;
    else if (isLeadQualified(lead.qa_status)) row.qualified_leads += 1;
    else if (isLeadDisqualified(lead.qa_status)) row.disqualified_leads += 1;

    if (isLeadBillable(lead.qa_status, lead.delivery_status)) row.billable_leads += 1;
  }

  let totalLeads = 0;
  let activeLeads = 0;
  let pendingLeads = 0;
  let qualifiedLeads = 0;
  let disqualifiedLeads = 0;
  let billableLeads = 0;

  for (const id of campaignIds) {
    const row = byCampaign[id] ?? emptyCampaignMetric(id);
    totalLeads += row.total_leads;
    activeLeads += row.active_leads;
    pendingLeads += row.pending_leads;
    qualifiedLeads += row.qualified_leads;
    disqualifiedLeads += row.disqualified_leads;
    billableLeads += row.billable_leads;
  }

  const activeCampaigns = campaigns.filter((c) => c.status === "active").length;
  const qualifiedRatePct =
    totalLeads > 0 ? Math.round((qualifiedLeads / totalLeads) * 100) : 0;

  return {
    byCampaign,
    summary: {
      totalCampaigns: campaignIds.length,
      activeCampaigns,
      totalLeads,
      activeLeads,
      pendingLeads,
      qualifiedLeads,
      disqualifiedLeads,
      billableLeads,
      qualifiedRatePct,
    },
  };
}
