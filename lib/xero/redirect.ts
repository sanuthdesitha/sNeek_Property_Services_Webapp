import type { NextRequest } from "next/server";

/**
 * Resolve this deployment's public base URL for the Xero OAuth redirect URI.
 *
 * Order of preference (first non-empty wins):
 *   1. NEXT_PUBLIC_APP_URL / APP_URL — explicit config, if the operator set it.
 *   2. x-forwarded-host + x-forwarded-proto — what a reverse proxy reports the
 *      browser actually requested (the real public domain).
 *   3. host header — the Host the request came in on.
 *   4. req.nextUrl origin — last resort.
 *
 * The server's own bind address 0.0.0.0 is never a valid public/redirect host,
 * so it's normalised to localhost. Both /connect and /callback MUST call this so
 * the redirect URI is byte-for-byte identical on each leg of the flow.
 */
export function resolveAppBaseUrl(req: NextRequest): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");

  const first = (v: string | null | undefined) => v?.split(",")[0]?.trim() || "";

  const host =
    first(req.headers.get("x-forwarded-host")) ||
    first(req.headers.get("host")) ||
    req.nextUrl.host ||
    "localhost:3000";

  const proto =
    first(req.headers.get("x-forwarded-proto")) ||
    req.nextUrl.protocol.replace(":", "") ||
    "https";

  // 0.0.0.0 (the bind address) is never reachable from a browser.
  const safeHost = host.replace(/^0\.0\.0\.0/, "localhost");

  return `${proto}://${safeHost}`.replace(/\/+$/, "");
}
