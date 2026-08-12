import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClientSafe, ADMIN_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/admin";
import {
  hasOperationsManagerAccess,
  hasTLAccess,
  isCampaignTeamLeaderRole,
} from "@/lib/auth/tl-access";
import { fetchUserRoleNames } from "@/lib/auth/server-roles";
import { buildTeamHierarchy } from "@/lib/tl/team-hierarchy";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const roleNames = await fetchUserRoleNames(supabase, user.id);
    const isOrgWide = hasOperationsManagerAccess(roleNames) || roleNames.includes("admin");
    const isTeamLeader = roleNames.some((n) => isCampaignTeamLeaderRole(n));

    if (!hasTLAccess(roleNames) && !roleNames.includes("admin")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    const { data: usersWithRoles, error: usersError } = await admin
      .from("users")
      .select(
        "id, full_name, email, agent_code, status, reporting_manager_id, user_roles(roles(name))"
      )
      .eq("organization_id", orgId)
      .order("full_name");

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    const { data: campaigns, error: campaignsError } = await admin
      .from("campaigns")
      .select("id, assigned_team_leader_id")
      .eq("organization_id", orgId);

    if (campaignsError) {
      return NextResponse.json({ error: campaignsError.message }, { status: 500 });
    }

    const campaignList = (campaigns ?? []) as {
      id: string;
      assigned_team_leader_id: string | null;
    }[];
    const campaignIds = campaignList.map((c) => c.id);

    let assignments: { campaign_id: string; agent_id: string }[] = [];
    if (campaignIds.length > 0) {
      const { data: assignmentRows, error: assignError } = await admin
        .from("campaign_assignments")
        .select("campaign_id, agent_id")
        .in("campaign_id", campaignIds)
        .eq("is_active", true);

      if (assignError) {
        return NextResponse.json({ error: assignError.message }, { status: 500 });
      }
      assignments = (assignmentRows ?? []) as { campaign_id: string; agent_id: string }[];
    }

    let hierarchy = buildTeamHierarchy(
      (usersWithRoles ?? []) as Parameters<typeof buildTeamHierarchy>[0],
      campaignList,
      assignments
    );

    if (!isOrgWide && isTeamLeader) {
      hierarchy = {
        ...hierarchy,
        team_leaders: hierarchy.team_leaders.filter((tl) => tl.id === user.id),
        unassigned_agents: [],
        stats: {
          team_leader_count: hierarchy.team_leaders.filter((tl) => tl.id === user.id).length,
          total_agents: hierarchy.team_leaders.find((tl) => tl.id === user.id)?.agent_count ?? 0,
          assigned_agents:
            hierarchy.team_leaders.find((tl) => tl.id === user.id)?.agent_count ?? 0,
          unassigned_agents: 0,
        },
      };
    }

    return NextResponse.json({
      ...hierarchy,
      scope: isOrgWide ? "organization" : "team",
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Team hierarchy fetch error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
