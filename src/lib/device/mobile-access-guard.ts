import { NextResponse, type NextRequest } from "next/server";
import { isMobileAccessAllowed, MOBILE_NOT_SUPPORTED_PATH } from "@/lib/device/config";
import { isMobileUserAgent } from "@/lib/device/is-mobile-user-agent";
import { logMobileAccessAttempt } from "@/lib/device/log-mobile-access";

export function maybeBlockMobileAccess(request: NextRequest): NextResponse | null {
  if (isMobileAccessAllowed()) {
    return null;
  }

  const pathname = request.nextUrl.pathname;
  if (pathname === MOBILE_NOT_SUPPORTED_PATH) {
    return null;
  }

  const userAgent = request.headers.get("user-agent");
  if (!isMobileUserAgent(userAgent, request.headers)) {
    return null;
  }

  logMobileAccessAttempt(request);

  const redirectUrl = new URL(MOBILE_NOT_SUPPORTED_PATH, request.url);
  return NextResponse.redirect(redirectUrl);
}
