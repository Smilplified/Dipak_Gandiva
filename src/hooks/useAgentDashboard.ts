"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  AgentCampaignLeadBar,
  AgentCompletionPrediction,
  AgentLeadTrendDay,
} from "@/lib/agent-dashboard-metrics";

export type AgentDashboardSummary = {
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

export type AgentDashboardCampaignRow = {
  id: string;
  campaign_id?: string | null;
  campaign_code?: string | null;
  name: string;
  client_name: string | null;
  industry: string | null;
  geography: string | null;
  lead_type: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  total_leads: number;
  active_leads: number;
  won_leads: number;
  qualified_leads?: number;
  pending_leads?: number;
  disqualified_leads?: number;
  billable_leads?: number;
};

export type AgentDashboardResponse = {
  summary: AgentDashboardSummary;
  leadTrend: AgentLeadTrendDay[];
  campaignLeads: AgentCampaignLeadBar[];
  completionPredictions: AgentCompletionPrediction[];
  recentCampaigns: AgentDashboardCampaignRow[];
  /** All assigned campaigns with date-filtered lead stats (dashboard table). */
  assignedCampaigns?: AgentDashboardCampaignRow[];
  campaignLeadStats?: Record<
    string,
    {
      total_leads: number;
      active_leads: number;
      won_leads: number;
      qualified_leads: number;
      pending_leads?: number;
      disqualified_leads?: number;
      billable_leads?: number;
    }
  >;
  dateFilter?: { date_from: string; date_to: string; tz: string; field?: string } | null;
};

export type AgentDashboardDateRange = {
  dateFrom: string;
  dateTo: string;
  tz?: string;
};

async function fetchAgentDashboard(range?: AgentDashboardDateRange): Promise<AgentDashboardResponse> {
  const params = new URLSearchParams({ limit: "10" });
  if (range?.dateFrom) params.set("date_from", range.dateFrom);
  if (range?.dateTo) params.set("date_to", range.dateTo);
  if (range?.tz) params.set("tz", range.tz);
  const res = await fetch(`/api/agent/dashboard?${params.toString()}`, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load dashboard");
  return data;
}

async function fetchAgentCampaigns(): Promise<{ campaigns: AgentDashboardCampaignRow[] }> {
  const res = await fetch("/api/agent/campaigns", { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to load campaigns");
  return data;
}

export function useAgentDashboard(enabled: boolean, range?: AgentDashboardDateRange) {
  const dashboardQuery = useQuery({
    queryKey: [
      "agent",
      "dashboard",
      range?.dateFrom ?? null,
      range?.dateTo ?? null,
      range?.tz ?? null,
    ],
    queryFn: () => fetchAgentDashboard(range),
    enabled: Boolean(enabled && range?.dateFrom && range?.dateTo),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Dashboard already returns assignedCampaigns — skip extra campaigns list fetch.
  const campaignsQuery = useQuery({
    queryKey: ["agent", "campaigns", "unused-on-dashboard"],
    queryFn: fetchAgentCampaigns,
    enabled: false,
    staleTime: 60 * 1000,
  });

  return {
    dashboard: dashboardQuery,
    campaigns: campaignsQuery,
    isLoading: dashboardQuery.isLoading,
    isFetching: dashboardQuery.isFetching,
    error: dashboardQuery.error,
    refetch: () => {
      void dashboardQuery.refetch();
    },
  };
}
