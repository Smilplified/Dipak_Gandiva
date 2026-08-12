const MOBILE_UA_PATTERNS: RegExp[] = [
  /android/i,
  /iphone/i,
  /ipod/i,
  /blackberry/i,
  /bb10/i,
  /windows phone/i,
  /iemobile/i,
  /opera mini/i,
  /crios/i, // Chrome on iOS (iPhone)
  /fxios/i, // Firefox on iOS (iPhone)
  /edgios/i, // Edge on iOS (iPhone)
  /edga/i, // Edge on Android
  /samsungbrowser/i,
  /ucbrowser/i,
  /opios/i, // Opera on iOS (iPhone)
  /opr\/[\d.]+.*mobile/i,
  /mobile.*firefox/i,
  /firefox.*mobile/i,
  /mobile.*safari/i,
  /webos/i,
  /kindle/i,
  /silk\//i,
  /playbook/i,
];

/** Platforms that are phones / phones-only — iPadOS is intentionally excluded. */
const MOBILE_CLIENT_HINT_PLATFORMS = ["android", "ios", "chrome os"];

/**
 * iPad is allowed. Detect classic "iPad" UA and modern iPadOS client hints
 * (iPadOS 13+ often reports as Macintosh in the UA).
 */
function isIPad(userAgent: string, headers?: Headers): boolean {
  if (/ipad/i.test(userAgent)) {
    return true;
  }

  if (!headers) {
    return false;
  }

  const platformHint = headers.get("sec-ch-ua-platform")?.replace(/"/g, "").toLowerCase() ?? "";
  if (platformHint === "ipados") {
    return true;
  }

  return false;
}

function hasMobileClientHints(headers: Headers): boolean {
  const platformHint = headers.get("sec-ch-ua-platform")?.replace(/"/g, "").toLowerCase() ?? "";
  if (platformHint === "ipados") {
    return false;
  }

  const mobileHint = headers.get("sec-ch-ua-mobile");
  if (mobileHint === "?1") {
    return true;
  }

  if (platformHint && MOBILE_CLIENT_HINT_PLATFORMS.includes(platformHint)) {
    return true;
  }

  const deviceType = headers.get("cf-device-type")?.toLowerCase();
  // Tablets: allow iPad; still treat other tablets (e.g. Android) as restricted.
  if (deviceType === "mobile") {
    return true;
  }
  if (deviceType === "tablet") {
    return true;
  }

  return false;
}

function matchesMobileUserAgent(userAgent: string): boolean {
  if (!userAgent.trim()) {
    return false;
  }

  if (MOBILE_UA_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    return true;
  }

  // Generic "Mobile" token — reliable for most mobile browsers.
  if (/\bmobile\b/i.test(userAgent)) {
    return true;
  }

  return false;
}

/**
 * Detects phone / phone-browser traffic from User-Agent and optional client hints.
 * Desktop Windows, macOS, Linux, and iPad are allowed through.
 */
export function isMobileUserAgent(userAgent: string | null | undefined, headers?: Headers): boolean {
  const ua = userAgent ?? "";

  // iPad is explicitly allowed (phones remain blocked).
  if (isIPad(ua, headers)) {
    return false;
  }

  if (headers && hasMobileClientHints(headers)) {
    return true;
  }

  return matchesMobileUserAgent(ua);
}
