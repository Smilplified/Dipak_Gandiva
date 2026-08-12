"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Empty, Popover, Tag, Typography } from "antd";
import { NotificationOutlined, RightOutlined } from "@ant-design/icons";
import { useAuth } from "@/context/AuthContext";
import { useAnnouncementCounts } from "@/hooks/useAnnouncementCounts";
import { resolveAnnouncementsPath } from "@/lib/announcements/nav";

const { Text } = Typography;

const TYPE_COLORS: Record<string, string> = {
  note: "blue",
  warning: "orange",
  alert: "red",
  poll: "purple",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Compact announcements dropdown for the app header (unread count + top 5). */
export default function AnnouncementHeaderBell() {
  const router = useRouter();
  const { user, hasRole, isInitialized } = useAuth();
  const { data } = useAnnouncementCounts(Boolean(user) && isInitialized);
  const [open, setOpen] = useState(false);

  const unread = data?.unread ?? [];
  const unreadCount = data?.unread_count ?? 0;

  const goToInbox = () => {
    setOpen(false);
    router.push(resolveAnnouncementsPath(hasRole));
  };

  const content = (
    <div style={{ width: 300 }}>
      {unread.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No new announcements"
          style={{ margin: "12px 0" }}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {unread.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={goToInbox}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "8px 4px",
                border: "none",
                borderBottom: "1px solid #f0f0f0",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <Tag
                  color={TYPE_COLORS[item.type] ?? "blue"}
                  style={{ fontSize: 10, lineHeight: "16px", margin: 0, flexShrink: 0 }}
                >
                  {item.type.toUpperCase()}
                </Tag>
                <Text strong ellipsis style={{ fontSize: 13, flex: 1 }}>
                  {item.title}
                </Text>
              </div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {item.sender_name ?? "—"} · {timeAgo(item.created_at)}
              </Text>
            </button>
          ))}
        </div>
      )}
      <Button type="link" block onClick={goToInbox} style={{ marginTop: 4 }}>
        View all announcements <RightOutlined style={{ fontSize: 10 }} />
      </Button>
    </div>
  );

  return (
    <Popover
      content={content}
      title={<Text strong>Announcements</Text>}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
    >
      <Badge count={unreadCount} size="small" overflowCount={99}>
        <Button
          type="text"
          shape="circle"
          icon={<NotificationOutlined style={{ fontSize: 18 }} />}
          aria-label="Announcements"
        />
      </Badge>
    </Popover>
  );
}
