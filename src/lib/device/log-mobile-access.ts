import type { NextRequest } from "next/server";

export type MobileAccessLogEntry = {
  timestamp: string;
  ip: string | null;
  userAgent: string;
  pathname: string;
  method: string;
};

function getClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  if (request.ip) {
    return request.ip;
  }

  return null;
}

export function logMobileAccessAttempt(request: NextRequest): MobileAccessLogEntry {
  const entry: MobileAccessLogEntry = {
    timestamp: new Date().toISOString(),
    ip: getClientIp(request),
    userAgent: request.headers.get("user-agent") ?? "unknown",
    pathname: request.nextUrl.pathname,
    method: request.method,
  };

  console.warn("[mobile-access-blocked]", JSON.stringify(entry));

  return entry;
}
