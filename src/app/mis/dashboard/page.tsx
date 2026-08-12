"use client";

import { useEffect, useState, useMemo } from "react";
import DashboardGreeting from "@/components/Dashboard/DashboardGreeting";
import {
  Card,
  Row,
  Col,
  Typography,
  Spin,
  Tag,
  Table,
  Button,
  message,
} from "antd";
import {
  FundProjectionScreenOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  PieChartOutlined,
  BarChartOutlined,
  DownloadOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  CloudUploadOutlined,
  ClockCircleOutlined,
  ArrowUpOutlined,
} from "@ant-design/icons";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useAuth } from "@/context/AuthContext";
import { useCachedApiQuery } from "@/hooks/useCachedApiQuery";

const { Text, Title } = Typography;

type MisStats = {
  totalCampaigns: number;
  totalLeadsUploaded: number;
  leadsAssignedToAgents: number;
  pendingLeads: number;
  completedLeads: number;
  qaApprovedLeads: number;
  qaRejectedLeads: number;
  callBackLeads: number;
};

type DailyUploadPoint = {
  date: string;
  count: number;
};

type CampaignPerformanceRow = {
  id: string;
  name: string;
  campaign_code: string | null;
  totalLeads: number;
  qualifiedLeads: number;
};

type LeadStatusSlice = {
  status: string;
  count: number;
};

type AgentDistributionRow = {
  agent_id: string | null;
  agent_name: string;
  totalLeads: number;
  assignedLeads: number;
  pendingLeads: number;
  completedLeads: number;
  qaApprovedLeads: number;
  qaRejectedLeads: number;
  callBackLeads: number;
};

type MisDashboardResponse = {
  stats: MisStats;
  dailyUploads: DailyUploadPoint[];
  campaignPerformance: CampaignPerformanceRow[];
  leadStatus: LeadStatusSlice[];
  agentDistribution: AgentDistributionRow[];
};

const cardStyle = {
  borderRadius: 16,
  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
  border: "1px solid #f0f0f0",
  transition: "all 0.3s ease",
  cursor: "pointer" as const,
};

const statCardHover = (e: React.MouseEvent<HTMLDivElement>, enter: boolean) => {
  const el = e.currentTarget;
  el.style.boxShadow = enter ? "0 4px 16px rgba(0,0,0,0.08)" : "0 2px 8px rgba(0,0,0,0.04)";
  el.style.transform = enter ? "translateY(-2px)" : "translateY(0)";
};

const STATUS_COLORS: Record<string, string> = {
  new: "blue",
  open: "cyan",
  interested: "green",
  followup: "gold",
  closed_won: "success",
  closed_lost: "volcano",
};

export default function MISDashboardPage() {
  const { hasRole, isInitialized, profile } = useAuth();
  const [isOffline, setIsOffline] = useState(false);

  // Stable boolean — avoids re-triggering fetchData when the `hasRole` function
  // reference is replaced (which happens on any roles state update, even silent ones).
  const isMisAuthorized = isInitialized && (hasRole("mis") || hasRole("admin"));

  const listEnabled =
    isMisAuthorized &&
    !isOffline &&
    typeof navigator !== "undefined" &&
    navigator.onLine;

  const {
    data,
    isLoading,
    error: queryError,
    refetch,
  } = useCachedApiQuery<MisDashboardResponse>(
    ["mis", "dashboard"],
    "/api/mis/dashboard",
    { enabled: listEnabled }
  );

  const loading = isLoading && !data;

  useEffect(() => {
    if (queryError) {
      message.error(
        queryError instanceof Error ? queryError.message : "Failed to load MIS dashboard"
      );
    }
  }, [queryError]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      void refetch();
    };
    const handleOffline = () => setIsOffline(true);
    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      }
    };
  }, [refetch]);

  const statsCards = useMemo(() => {
    const s = data?.stats;
    return [
      {
        title: "Total Campaigns",
        value: (s?.totalCampaigns ?? 0).toLocaleString(),
        change: "All active & closed",
        icon: <FundProjectionScreenOutlined />,
        color: "#4f46e5",
        bgColor: "#eef2ff",
      },
      {
        title: "Total Leads Uploaded",
        value: (s?.totalLeadsUploaded ?? 0).toLocaleString(),
        change: "All time",
        icon: <DatabaseOutlined />,
        color: "#722ed1",
        bgColor: "#f9f0ff",
      },
      {
        title: "Leads Assigned to Agents",
        value: (s?.leadsAssignedToAgents ?? 0).toLocaleString(),
        change: "Currently assigned",
        icon: <TeamOutlined />,
        color: "#52c41a",
        bgColor: "#f6ffed",
      },
      {
        title: "Pending Leads",
        value: (s?.pendingLeads ?? 0).toLocaleString(),
        change: "Awaiting QA qualification",
        icon: <ClockCircleOutlined />,
        color: "#f59e0b",
        bgColor: "#fffbe6",
      },
    ];
  }, [data]);

  const secondaryCards = useMemo(() => {
    const s = data?.stats;
    return [
      {
        title: "Completed Leads",
        value: (s?.completedLeads ?? 0).toLocaleString(),
        subtitle: "Closed / completed",
        color: "#389e0d",
      },
      {
        title: "QA Approved Leads",
        value: (s?.qaApprovedLeads ?? 0).toLocaleString(),
        subtitle: "Pass / approved",
        color: "#52c41a",
      },
      {
        title: "QA Rejected Leads",
        value: (s?.qaRejectedLeads ?? 0).toLocaleString(),
        subtitle: "Failed QA",
        color: "#ef4444",
      },
      {
        title: "Call Back Leads",
        value: (s?.callBackLeads ?? 0).toLocaleString(),
        subtitle: "Marked for call back",
        color: "#13c2c2",
      },
    ];
  }, [data]);

  const leadStatusPieData = useMemo(() => {
    const slices = data?.leadStatus ?? [];
    if (!slices.length) {
      return [{ name: "No data", value: 1, color: "#d1d5db" }];
    }
    const palette = ["#4f46e5", "#52c41a", "#f59e0b", "#722ed1", "#13c2c2", "#ef4444", "#6b7280"];
    return slices.map((s, idx) => ({
      name: s.status || "Unknown",
      value: s.count,
      color: palette[idx % palette.length],
    }));
  }, [data]);

  const campaignPerformanceData = useMemo(
    () => data?.campaignPerformance ?? [],
    [data]
  );

  const dailyUploadsData = useMemo(
    () => data?.dailyUploads ?? [],
    [data]
  );

  const handleExport = async (type: string, format: "csv" | "excel") => {
    try {
      const url = `/api/mis/export?type=${encodeURIComponent(type)}&format=${encodeURIComponent(format)}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || "Failed to export data");
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const ext = format === "excel" ? "xlsx" : "csv";
      a.href = href;
      a.download = `mis-${type}-${ts}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      message.success("Export started");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to export data");
    }
  };

  if (!isMisAuthorized) {
    return null;
  }

  return (
    <div style={{ padding: "0 4px", maxWidth: 1600, margin: "0 auto" }}>
      <DashboardGreeting />

      {isOffline && (
        <div style={{ marginBottom: 24 }}>
          <Text type="danger" style={{ fontSize: 14 }}>
            You appear to be offline. Data will reload when back online, or{" "}
            <Button
              type="link"
              onClick={() => void refetch()}
              style={{ padding: 0 }}
            >
              retry now
            </Button>
            .
          </Text>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
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
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <Text
                        type="secondary"
                        style={{
                          fontSize: 13,
                          display: "block",
                          marginBottom: 8,
                        }}
                      >
                        {stat.title}
                      </Text>
                      <div
                        style={{
                          fontSize: 32,
                          fontWeight: 700,
                          color: "#1f1f1f",
                          lineHeight: 1,
                          marginBottom: 12,
                        }}
                      >
                        {stat.value}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <ArrowUpOutlined
                          style={{ color: "#52c41a", fontSize: 12 }}
                        />
                        <Text
                          style={{
                            fontSize: 12,
                            color: "#6b7280",
                            fontWeight: 500,
                          }}
                        >
                          {stat.change}
                        </Text>
                      </div>
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

          <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
            {secondaryCards.map((card, index) => (
              <Col xs={24} sm={12} xl={6} key={index}>
                <Card
                  bordered={false}
                  style={{ ...cardStyle, height: "100%" }}
                  styles={{ body: { padding: "20px 22px" } }}
                >
                  <Text
                    type="secondary"
                    style={{
                      fontSize: 13,
                      display: "block",
                      marginBottom: 6,
                    }}
                  >
                    {card.title}
                  </Text>
                  <div
                    style={{
                      fontSize: 26,
                      fontWeight: 700,
                      color: "#1f1f1f",
                      lineHeight: 1,
                      marginBottom: 6,
                    }}
                  >
                    {card.value}
                  </div>
                  <Text style={{ fontSize: 12, color: card.color }}>
                    {card.subtitle}
                  </Text>
                </Card>
              </Col>
            ))}
          </Row>

          <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
            <Col xs={24} xl={8}>
              <Card
                title={
                  <Text strong style={{ fontSize: 16 }}>
                    Campaign Performance
                  </Text>
                }
                bordered={false}
                style={{ ...cardStyle, height: "100%" }}
                styles={{ body: { padding: "24px 24px 16px" } }}
              >
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart
                    data={
                      campaignPerformanceData.length
                        ? campaignPerformanceData
                        : [{ name: "—", totalLeads: 0, qualifiedLeads: 0 }]
                    }
                    margin={{ top: 5, right: 5, left: -15, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#f0f0f0"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="name"
                      stroke="#6b7280"
                      fontSize={11}
                      tickFormatter={(v) =>
                        v && v.length > 14 ? `${String(v).slice(0, 14)}…` : v
                      }
                    />
                    <YAxis stroke="#6b7280" fontSize={11} />
                    <RechartsTooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #f0f0f0",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                      }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar
                      dataKey="totalLeads"
                      fill="#4f46e5"
                      radius={[8, 8, 0, 0]}
                      name="Total Leads"
                    />
                    <Bar
                      dataKey="qualifiedLeads"
                      fill="#52c41a"
                      radius={[8, 8, 0, 0]}
                      name="Qualified leads"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </Col>
            <Col xs={24} xl={8}>
              <Card
                title={
                  <Text strong style={{ fontSize: 16 }}>
                    Lead Status Distribution
                  </Text>
                }
                bordered={false}
                style={{ ...cardStyle, height: "100%" }}
                styles={{
                  body: { padding: "24px 24px 16px", overflow: "visible" },
                }}
              >
                <div
                  style={{ overflow: "visible", minHeight: 320 }}
                  className="mis-status-pie-wrapper"
                >
                  <ResponsiveContainer width="100%" height={320}>
                    <PieChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                      <Pie
                        data={leadStatusPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent, cx, cy }) => {
                          const pct = (percent * 100).toFixed(0);
                          const isSingleSlice = percent >= 0.99;
                          if (isSingleSlice) {
                            return (
                              <text
                                x={cx}
                                y={cy}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                style={{ fontSize: 14, fontWeight: 500 }}
                              >
                                {name} {pct}%
                              </text>
                            );
                          }
                          return `${name} ${pct}%`;
                        }}
                        labelLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
                      >
                        {leadStatusPieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{
                          borderRadius: 8,
                          border: "1px solid #f0f0f0",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </Col>
            <Col xs={24} xl={8}>
              <Card
                title={
                  <Text strong style={{ fontSize: 16 }}>
                    Daily Upload Count
                  </Text>
                }
                bordered={false}
                style={{ ...cardStyle, height: "100%" }}
                styles={{ body: { padding: "24px 24px 16px" } }}
              >
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart
                    data={
                      dailyUploadsData.length
                        ? dailyUploadsData
                        : [{ date: "—", count: 0 }]
                    }
                    margin={{ top: 5, right: 5, left: -15, bottom: 5 }}
                  >
                    <defs>
                      <linearGradient id="colorUploads" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" stroke="#6b7280" fontSize={11} />
                    <YAxis stroke="#6b7280" fontSize={11} />
                    <RechartsTooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #f0f0f0",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke="#4f46e5"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorUploads)"
                      name="Leads Uploaded"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            </Col>
          </Row>

          <Row gutter={[20, 20]} style={{ marginBottom: 24 }}>
            <Col xs={24}>
              <Card
                title={
                  <Text strong style={{ fontSize: 16 }}>
                    Campaigns with Leads
                  </Text>
                }
                bordered={false}
                style={cardStyle}
              >
                <Table
                  dataSource={campaignPerformanceData}
                  rowKey={(r) => r.id}
                  size="middle"
                  scroll={{ x: 830 }}
                  pagination={{
                    defaultPageSize: 10,
                    showSizeChanger: true,
                    showTotal: (t) => `Total ${t} campaigns`,
                  }}
                  columns={[
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
                      dataIndex: "name",
                      key: "name",
                      render: (val: string) => (
                        <span style={{ fontWeight: 500 }}>{val}</span>
                      ),
                    },
                    {
                      title: "Total Leads",
                      dataIndex: "totalLeads",
                      key: "totalLeads",
                      width: 130,
                    },
                    {
                      title: "Qualified Leads",
                      dataIndex: "qualifiedLeads",
                      key: "qualifiedLeads",
                      width: 130,
                      render: (v: number) => <Tag color="green">{v}</Tag>,
                    },
                    {
                      title: "Qualified %",
                      key: "conversion",
                      width: 130,
                      render: (_: unknown, r: CampaignPerformanceRow) => {
                        const pct =
                          r.totalLeads > 0
                            ? Math.round((r.qualifiedLeads / r.totalLeads) * 100)
                            : 0;
                        return <span>{pct}%</span>;
                      },
                    },
                  ]}
                  locale={{
                    emptyText: "No campaigns with leads yet.",
                  }}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
}

