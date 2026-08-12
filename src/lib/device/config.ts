/**
 * When ALLOW_MOBILE_ACCESS is "true", mobile browsers may access the app.
 * Default (unset or "false"): mobile access is blocked at the middleware layer.
 */
export function isMobileAccessAllowed(): boolean {
  return process.env.ALLOW_MOBILE_ACCESS === "true";
}

export const MOBILE_NOT_SUPPORTED_PATH = "/mobile-not-supported" as const;
