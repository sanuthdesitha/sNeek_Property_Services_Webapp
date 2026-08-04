import "server-only";
import { getAppSettings } from "@/lib/settings";
import type { PortalVersion } from "./portal-version";

/**
 * Reads the house default look from AppSettings, with a short in-process cache.
 *
 * The cache exists because middleware asks for this on EVERY authenticated
 * navigation (via /api/auth/validate-session) and `getAppSettings()` is an
 * uncached database read — without it, switching look would tax every page
 * load in the app. The window is deliberately small so flipping the switch is
 * felt almost immediately; `invalidateDefaultPortalVersion()` is called on save
 * so the admin who flipped it sees the change at once in their own process.
 */
const CACHE_TTL_MS = 10_000;

let cached: { value: PortalVersion; at: number } | null = null;

export async function getDefaultPortalVersion(): Promise<PortalVersion> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  try {
    const settings = await getAppSettings();
    // Only an explicit "v1" opts out of Estate — see the 2026-08 cutover note in
    // portal-version.ts. Anything else, including a missing value, is v2.
    const value: PortalVersion = settings.defaultPortalVersion === "v1" ? "v1" : "v2";
    cached = { value, at: now };
    return value;
  } catch {
    // Never let a settings read failure decide routing — fall back to whatever
    // we last knew, else Estate.
    return cached?.value ?? "v2";
  }
}

export function invalidateDefaultPortalVersion() {
  cached = null;
}
