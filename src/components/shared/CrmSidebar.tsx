"use client";

import { Fragment } from "react";
import { Badge, Layout, Tooltip } from "antd";
import Link from "next/link";
import Image from "next/image";

const { Sider } = Layout;

export type CrmSidebarAccent = "default" | "emerald" | "purple";

export type CrmSidebarItem = {
  key: string;
  icon: React.ReactNode;
  label: string;
  href: string;
  accent?: CrmSidebarAccent;
  prefetch?: boolean;
  dataTourId?: string;
  /** Optional numeric badge (e.g. pending device requests). */
  badge?: number;
};

type CrmSidebarProps = {
  sections: CrmSidebarItem[][];
  selectedKey: string;
  /** Role-wide active accent when item has no per-item accent (e.g. QA purple). */
  activeAccent?: CrmSidebarAccent;
  siderClassName?: string;
  navClassName?: string;
};

function accentStyles(active: boolean, accent: CrmSidebarAccent) {
  if (!active) {
    return {
      linkBg: "transparent",
      circleBg: "#f3f4f6",
      circleColor: "#4b5563",
      shadow: "none",
      labelColor: "#6b7280",
    };
  }

  if (accent === "emerald") {
    return {
      linkBg: "#ecfdf5",
      circleBg: "#16a34a",
      circleColor: "#ffffff",
      shadow: "0 6px 14px rgba(29,158,117,0.28)",
      labelColor: "#065f46",
    };
  }

  if (accent === "purple") {
    return {
      linkBg: "#eff6ff",
      circleBg: "#722ed1",
      circleColor: "#ffffff",
      shadow: "0 6px 14px rgba(114,46,209,0.28)",
      labelColor: "#0f172a",
    };
  }

  return {
    linkBg: "#eff6ff",
    circleBg: "#4f46e5",
    circleColor: "#ffffff",
    shadow: "0 6px 14px rgba(79,70,229,0.28)",
    labelColor: "#0f172a",
  };
}

export default function CrmSidebar({
  sections,
  selectedKey,
  activeAccent = "default",
  siderClassName,
  navClassName,
}: CrmSidebarProps) {
  return (
    <Sider
      width={92}
      theme="light"
      className={["crm-sidebar-sider", siderClassName].filter(Boolean).join(" ")}
      style={{
        position: "fixed",
        insetInlineStart: 0,
        top: 0,
        bottom: 0,
        height: "100vh",
        zIndex: 100,
        overflow: "hidden",
        background: "#ffffff",
        borderRight: "1px solid rgba(0,0,0,0.06)",
      }}
    >
      <div className="crm-sidebar-shell">
        <div className="crm-sidebar-logo">
          <Image
            src="/projects/sidebar_logo.png"
            alt="Gandiv"
            width={50}
            height={50}
            style={{ objectFit: "contain" }}
            priority
          />
        </div>

        <div className={["crm-sidebar-nav", navClassName].filter(Boolean).join(" ")}>
          {sections.map((section, sectionIndex) => (
            <Fragment key={sectionIndex}>
              {sectionIndex > 0 && <div className="crm-sidebar-divider" aria-hidden />}
              {section.map((item) => {
                const active = selectedKey === item.key;
                const accent = item.accent ?? activeAccent;
                const styles = accentStyles(active, accent);

                return (
                  <Tooltip key={item.key} title={item.label} placement="right">
                    <Link
                      href={item.href}
                      prefetch={item.prefetch ?? true}
                      className="rail-item"
                      data-tour={item.dataTourId}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        width: 72,
                        padding: "6px 4px",
                        borderRadius: 14,
                        textDecoration: "none",
                        background: styles.linkBg,
                        transition: "all 0.18s ease",
                        cursor: "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <div
                        className="rail-icon"
                        style={{
                          background: styles.circleBg,
                          color: styles.circleColor,
                          boxShadow: styles.shadow,
                          position: "relative",
                        }}
                      >
                        {typeof item.badge === "number" && item.badge > 0 ? (
                          <Badge count={item.badge} size="small" offset={[4, -2]}>
                            <span style={{ display: "inline-flex" }}>{item.icon}</span>
                          </Badge>
                        ) : (
                          item.icon
                        )}
                      </div>
                      <span
                        className="rail-label"
                        style={{
                          color: styles.labelColor,
                          fontWeight: active ? 600 : 500,
                        }}
                      >
                        {item.label}
                      </span>
                    </Link>
                  </Tooltip>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </Sider>
  );
}
