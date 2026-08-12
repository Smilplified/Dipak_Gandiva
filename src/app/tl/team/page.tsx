"use client";

import { Typography } from "antd";
import { useAuth } from "@/context/AuthContext";
import TeamHierarchyView from "@/components/TL/TeamHierarchyView";
import TeamBuilderDnDView from "@/components/TL/TeamBuilderDnDView";
import InactiveAgentsTransferSection from "@/components/TL/InactiveAgentsTransferSection";
import { isCampaignTeamLeaderRole } from "@/lib/auth/tl-access";

const { Text } = Typography;

export default function TLTeamPage() {
  const { hasRole, roles } = useAuth();
  const canBuildTeams = hasRole("operations_manager") || hasRole("admin");
  const isCampaignTl = roles.some((r) =>
    isCampaignTeamLeaderRole(r.role_name ?? r.name)
  );

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Team</h1>
        <Text type="secondary" style={{ fontSize: 14 }}>
          {canBuildTeams
            ? "Drag agents into a Team Leader card to build or reorganize teams."
            : "Your team — agents assigned to you via campaigns or reporting line."}
        </Text>
      </div>
      {isCampaignTl && <InactiveAgentsTransferSection />}
      {canBuildTeams ? <TeamBuilderDnDView /> : <TeamHierarchyView />}
    </>
  );
}
