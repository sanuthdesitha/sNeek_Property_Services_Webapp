/**
 * v1 (classic) ↔ v2 (Estate) portal routing.
 *
 * Both versions stay fully routable forever. The house default only decides
 * where ENTRY POINTS send people — signing in, hitting `/`, or opening a
 * portal's root. Deep links are never rewritten, for two reasons: a bookmarked
 * or emailed URL must keep working, and a page that exists in one version but
 * not the other must not become unreachable because of a global switch.
 *
 * Must stay importable from middleware (edge runtime): pure functions, no
 * Prisma, no `server-only`. The stored value lives in
 * `portal-version-store.ts`.
 */

export type PortalVersion = "v1" | "v2";

export const PORTAL_VERSION_COOKIE = "sneek.portal-version";

/** How long a personal "stay in the other look" choice sticks. */
export const PORTAL_VERSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

/**
 * The portal roots, v1 path → v2 path. Both admin and ops-manager land on the
 * same admin root, matching the existing portalHome/v2PortalHome maps.
 */
const ROOTS: { v1: string; v2: string }[] = [
  { v1: "/admin", v2: "/v2/admin" },
  { v1: "/cleaner", v2: "/v2/cleaner" },
  { v1: "/client", v2: "/v2/client" },
  { v1: "/laundry", v2: "/v2/laundry" },
  { v1: "/qa", v2: "/v2/qa" },
  { v1: "/maintenance", v2: "/v2/maintenance" },
];

export function parsePortalVersion(value: unknown): PortalVersion | null {
  return value === "v1" || value === "v2" ? value : null;
}

/** True when the path is exactly a portal root (not a page inside it). */
export function isPortalRoot(pathname: string): boolean {
  const p = normalize(pathname);
  return ROOTS.some((r) => r.v1 === p || r.v2 === p);
}

/**
 * The same portal root expressed in `version`, or null when the path is not a
 * portal root or is already in the requested version.
 *
 * Returning null for "already correct" is what keeps the middleware from
 * issuing a redirect to the URL it is already on — an infinite loop.
 */
export function portalRootIn(pathname: string, version: PortalVersion): string | null {
  const p = normalize(pathname);
  for (const r of ROOTS) {
    if (p === r.v1) return version === "v2" ? r.v2 : null;
    if (p === r.v2) return version === "v1" ? r.v1 : null;
  }
  return null;
}

/** Which version a path belongs to. Everything under /v2 is v2. */
export function versionOfPath(pathname: string): PortalVersion {
  return pathname === "/v2" || pathname.startsWith("/v2/") ? "v2" : "v1";
}

/**
 * The version to actually use: a personal override always beats the house
 * default, so an admin can work in one look while the team is on the other,
 * and so anyone who deliberately switched is not yanked back on next login.
 */
export function effectivePortalVersion(
  houseDefault: PortalVersion | undefined,
  override: PortalVersion | null,
): PortalVersion {
  return override ?? houseDefault ?? "v1";
}

function normalize(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
