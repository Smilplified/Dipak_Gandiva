import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignCampaignTeamLeader } from "@/lib/auth/tl-access";
import { fetchUserRoleNames } from "@/lib/auth/server-roles";
import { syncCampaignTeamLeaderAssignments } from "@/lib/campaign/team-leader-assignments";
import { createNotifications } from "@/lib/notifications";
import { logAudit } from "@/lib/audit/log";
import { resolvePrimaryAuditRole } from "@/lib/audit/actor-role";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
    if (!canAssignCampaignTeamLeader(roleNames)) {
      return NextResponse.json(
        { error: "You do not have permission to assign Team Leaders" },
        { status: 403 }
      );
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

    const { id: campaignId } = await params;
    if (!campaignId) {
      return NextResponse.json({ error: "Campaign ID required" }, { status: 400 });
    }

    const body = await request.json();
    const team_leader_ids = Array.isArray(body?.team_leader_ids)
      ? (body.team_leader_ids as string[]).filter(Boolean)
      : [];

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, name, assigned_team_leader_id")
      .eq("id", campaignId)
      .eq("organization_id", orgId)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const camp = campaign as {
      id: string;
      name: string;
      assigned_team_leader_id: string | null;
    };

    const previousIds = await supabase
      .from("campaign_team_leader_assignments")
      .select("team_leader_id")
      .eq("campaign_id", campaignId)
      .eq("is_active", true);

    const prevSet = new Set(
      ((previousIds.data ?? []) as { team_leader_id: string }[]).map((r) => r.team_leader_id)
    );
    if (camp.assigned_team_leader_id) prevSet.add(camp.assigned_team_leader_id);

    const { primaryTeamLeaderId, error: syncError } = await syncCampaignTeamLeaderAssignments(
      supabase,
      {
        organizationId: orgId,
        campaignId,
        teamLeaderIds: team_leader_ids,
        assignedBy: user.id,
      }
    );

    if (syncError) {
      return NextResponse.json({ error: syncError }, { status: 500 });
    }

    const newlyAssigned = team_leader_ids.filter((id) => !prevSet.has(id));
    if (newlyAssigned.length > 0) {
      void createNotifications(
        newlyAssigned.map((receiverId) => ({
          title: "Campaign Assigned",
          message: `Campaign "${camp.name}" has been assigned to you.`,
          type: "campaign" as const,
          sender_id: user.id,
          receiver_id: receiverId,
          reference_type: "campaign" as const,
          reference_id: campaignId,
          organization_id: orgId,
        }))
      );
    }

    const removedIds = [...prevSet].filter((id) => !team_leader_ids.includes(id));
    void logAudit({
      organizationId: orgId,
      actorId: user.id,
      actorRole: resolvePrimaryAuditRole(roleNames),
      category: "campaigns",
      eventType: "campaign_team_leaders_assigned",
      description: `Updated team leader assignments on campaign "${camp.name}" (${team_leader_ids.length} assigned)`,
      targetType: "campaign",
      targetId: campaignId,
      targetLabel: camp.name,
      metadata: {
        assigned_count: team_leader_ids.length,
        added_count: newlyAssigned.length,
        removed_count: removedIds.length,
        team_leader_ids,
        primary_team_leader_id: primaryTeamLeaderId,
        source: "tl_assign_team_leaders",
      },
      request,
    });

    return NextResponse.json({
      success: true,
      assigned_team_leader_id: primaryTeamLeaderId,
    });
  } catch (err) {
    console.error("Assign team leaders error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
