"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import DashboardGreeting from "@/components/Dashboard/DashboardGreeting";
import {
  Card,
  Row,
  Col,
  Typography,
  Tag,
  Table,
  Button,
  Empty,
  message,
  Skeleton,
} from "antd";
import {
  FundProjectionScreenOutlined,
  TeamOutlined,
  AuditOutlined,
  CheckCircleOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useQADashboard } from "@/hooks/useQADashboard";
import {
  StatCardsRowSkeleton,
  TableSkeleton,
} from "@/components/Dashboard/DashboardSkeletons";
import {
  QAPipelineChart,
  QACampaignStatusChart,
  QATopPendingCampaignsChart,
  QAUploadAuditTrendChart,
} from "@/components/Dashboard/QADashboardCharts";
import { useRoleGuard } from "@/hooks/useRoleGuard";
import { computeQaDashboardMetrics } from "@/lib/qa-dashboard-metrics";
import { tableSerialNumber } from "@/lib/table-pagination";
import dayjs from "dayjs";

const { Text } = Typography;

type CampaignPendingRow = {
  id: string;
  name: string;
  campaign_code: string | null;
  pending: number;
  todayLeads: number;
  total: number;
};

function isLeadCreatedToday(createdAt: string | null | undefined, todayKey: string): boolean {
  if (!createdAt) return false;
  return dayjs(createdAt).format("YYYY-MM-DD") === todayKey;
}

const cardStyle = {
  borderRadius: 16,
  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
  border: "1px solid #f0f0f0",
  transition: "all 0.3s ease",
};

const statCardHover = (e: React.MouseEvent<HTMLDivElement>, enter: boolean) => {
  const el = e.currentTarget;
  el.style.boxShadow = enter ? "0 4px 16px rgba(0,0,0,0.08)" : "0 2px 8px rgba(0,0,0,0.04)";
  el.style.transform = enter ? "translateY(-2px)" : "translateY(0)";
};

function ChartsRowSkeleton() {
  return (
    <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <Col xs={24} lg={12} key={i}>
          <Card bordered={false} style={cardStyle}>
            <Skeleton active paragraph={{ rows: 6 }} />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

export default function QADashboardPage() {
  const { status } = useRoleGuard(["qa", "admin"]);
  const [isOffline, setIsOffline] = useState(false);

  const enabled = status === "authorized";
  const { dashboard, refetch } = useQADashboard(enabled);
  const [pendingTablePage, setPendingTablePage] = useState(1);
  const [pendingTablePageSize, setPendingTablePageSize] = useState(10);

  useEffect(() => {
    if (dashboard.error) {
      message.error("Failed to load dashboard");
    }
  }, [dashboard.error]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => {
      setIsOffline(false);
      refetch();
    };
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [refetch]);

  const campaigns = useMemo(() => dashboard.data?.campaigns ?? [], [dashboard.data?.campaigns]);

  const metrics = useMemo(
    () => computeQaDashboardMetrics(campaigns, dashboard.data?.summary),
    [campaigns, dashboard.data?.summary]
  );

  const campaignsWithPending = useMemo((): CampaignPendingRow[] => {
    const todayKey = dayjs().format("YYYY-MM-DD");
    return campaigns
      .map((c) => {
        const leads = c.leads ?? [];
        const pending = leads.filter((l) => !l.qa_status || String(l.qa_status).trim() === "").length;
        const todayLeads = leads.filter((l) => isLeadCreatedToday(l.created_at, todayKey)).length;
        return {
          id: c.id,
          name: c.name ?? `Campaign ${c.id.slice(0, 8)}`,
          campaign_code: c.campaign_code ?? null,
          pending,
          todayLeads,
          total: leads.length,
        };
      })
      .filter((c) => c.pending > 0)
      .sort((a, b) => {
        if (b.todayLeads !== a.todayLeads) return b.todayLeads - a.todayLeads;
        if (b.pending !== a.pending) return b.pending - a.pending;
        return a.name.localeCompare(b.name);
      });
  }, [campaigns]);

  const statsCards = useMemo(
    () => [
      {
        title: "Total Campaigns",
        value: metrics.totalCampaigns.toLocaleString(),
        change: `${metrics.activeCampaigns} active`,
        icon: <FundProjectionScreenOutlined />,
        color: "#4f46e5",
        bgColor: "#eef2ff",
      },
      {
        title: "Total Leads",
        value: metrics.totalLeads.toLocaleString(),
        change: `${metrics.totalAudited.toLocaleString()} audited (${metrics.auditRatePct}%)`,
        icon: <TeamOutlined />,
        color: "#722ed1",
        bgColor: "#f9f0ff",
      },
      {
        title: "Qualified",
        value: metrics.totalQualified.toLocaleString(),
        change: `${metrics.qualifiedRatePct}% of audited leads`,
        icon: <CheckCircleOutlined />,
        color: "#52c41a",
        bgColor: "#f6ffed",
      },
      {
        title: "Pending QA",
        value: metrics.pendingAudit.toLocaleString(),
        change: `${metrics.totalDisqualified.toLocaleString()} disqualified`,
        icon: <AuditOutlined />,
        color: "#eb2f96",
        bgColor: "#fff0f6",
      },
    ],
    [metrics]
  );

  if (status !== "authorized") {
    return null;
  }

  const dashboardReady = dashboard.isSuccess;

  return (
    <div style={{ padding: "0 4px", maxWidth: 1600, margin: "0 auto" }}>
      <DashboardGreeting />

      {isOffline && (
        <div style={{ marginBottom: 24 }}>
          <Text type="danger" style={{ fontSize: 14 }}>
            You appear to be offline. Data will reload when back online, or{" "}
            <a onClick={(e) => { e.preventDefault(); refetch(); }}>retry now</a>.
          </Text>
        </div>
      )}

      {!dashboardReady ? (
        <StatCardsRowSkeleton />
      ) : (
        <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
          {statsCards.map((stat, index) => (
            <Col xs={24} sm={12} xl={6} key={index}>
              <Card
                bordered={false}
                style={{ ...cardStyle, height: "100%" }}
                styles={{ body: { padding: "24px" } }}
                onMouseEnter={(e) => statCardHover(e, true)}
                onMouseLeave={(e) => statCardHover(e, false)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <Text type="secondary" style={{ fontSize: 13, display: "block", marginBottom: 8 }}>
                      {stat.title}
                    </Text>
                    <div style={{ fontSize: 32, fontWeight: 700, color: "#1f1f1f", lineHeight: 1, marginBottom: 12 }}>
                      {stat.value}
                    </div>
                    <Text style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>{stat.change}</Text>
                  </div>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      backgroundColor: stat.bgColor,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 22,
                      color: stat.color,
                    }}
                  >
                    {stat.icon}
                  </div>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {!dashboardReady ? (
        <ChartsRowSkeleton />
      ) : (
        <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
          <Col xs={24} lg={12}>
            <QAPipelineChart data={metrics.pipelineSlices} />
          </Col>
          <Col xs={24} lg={12}>
            <QACampaignStatusChart data={metrics.campaignStatusBars} />
          </Col>
          <Col xs={24} lg={12}>
            <QATopPendingCampaignsChart data={metrics.topPendingCampaigns} />
          </Col>
          <Col xs={24} lg={12}>
            <QAUploadAuditTrendChart data={metrics.activityTrend} />
          </Col>
        </Row>
      )}

      {!dashboardReady ? (
        <TableSkeleton rows={5} />
      ) : (
        <Row gutter={[20, 20]}>
          <Col xs={24}>
            <Card
              title={
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Text strong style={{ fontSize: 16 }}>
                    Campaigns with Pending QA
                  </Text>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    Review these leads
                  </Text>
                </div>
              }
              bordered={false}
              style={cardStyle}
            >
              {campaignsWithPending.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No pending QA reviews. All leads are up to date."
                />
              ) : (
                <Table
                  className="table-single-line"
                  dataSource={campaignsWithPending}
                  rowKey="id"
                  pagination={{
                    current: pendingTablePage,
                    pageSize: pendingTablePageSize,
                    showSizeChanger: true,
                    showTotal: (total) => `Total ${total} campaigns`,
                    onChange: (page, pageSize) => {
                      setPendingTablePage(page);
                      setPendingTablePageSize(pageSize);
                    },
                  }}
                  size="middle"
                  scroll={{ x: "max-content" }}
                  columns={[
                    {
                      title: "Sr. No",
                      key: "index",
                      width: 72,
                      align: "center" as const,
                      render: (_: unknown, __: CampaignPendingRow, index: number) =>
                        tableSerialNumber(pendingTablePage, pendingTablePageSize, index),
                    },
                    {
                      title: "Campaign Code",
                      dataIndex: "campaign_code",
                      key: "campaign_code",
                      width: 130,
                      render: (val: string | null) => (
                        <Tag color="blue" style={{ fontFamily: "monospace", fontSize: 12 }}>
                          {val || "—"}
                        </Tag>
                      ),
                    },
                    {
                      title: "Campaign",
                      key: "name",
                      render: (_, r) => (
                        <Link href={`/qa/campaigns/${r.id}`} style={{ fontWeight: 600, fontSize: 14 }}>
                          {r.name}
                        </Link>
                      ),
                    },
                    {
                      title: "Pending",
                      dataIndex: "pending",
                      key: "pending",
                      width: 100,
                      sorter: (a: CampaignPendingRow, b: CampaignPendingRow) => a.pending - b.pending,
                      render: (v: number) => <Tag color="orange">{v} leads</Tag>,
                    },
                    {
                      title: <span style={{ whiteSpace: "nowrap" }}>Today&apos;s Leads</span>,
                      dataIndex: "todayLeads",
                      key: "todayLeads",
                      width: 132,
                      className: "table-col-todays-leads",
                      defaultSortOrder: "descend",
                      sorter: (a: CampaignPendingRow, b: CampaignPendingRow) =>
                        a.todayLeads - b.todayLeads,
                      render: (v: number) =>
                        v > 0 ? <Tag color="green">{v}</Tag> : <Text type="secondary">0</Text>,
                    },
                    {
                      title: "Total Leads",
                      dataIndex: "total",
                      key: "total",
                      width: 110,
                      sorter: (a: CampaignPendingRow, b: CampaignPendingRow) => a.total - b.total,
                    },
                    {
                      title: "",
                      key: "action",
                      render: (_, r) => (
                        <Link href={`/qa/campaigns/${r.id}`}>
                          <Button type="primary" size="small" icon={<RightOutlined />}>
                            Review
                          </Button>
                        </Link>
                      ),
                    },
                  ]}
                />
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
}
