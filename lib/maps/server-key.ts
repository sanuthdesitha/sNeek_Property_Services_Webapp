import { db } from "@/lib/db";

const CREDENTIAL_KEY = "integrationCredentials";

let _cache: { key: string; at: number } | null = null;
const TTL_MS = 60_000;

/**
 * Resolve the Google Maps API key for SERVER-SIDE use (maps-config endpoint,
 * geocode lookup, ETA/route helpers).
 *
 * Resolution order — the in-app Settings value wins so the key can be changed
 * at runtime (Dokploy) without a rebuild:
 *   1. integrationCredentials.googleMapsApiKey  (set in Admin → Settings)
 *   2. GOOGLE_MAPS_API_KEY                       (runtime server env)
 *   3. NEXT_PUBLIC_GOOGLE_MAPS_API_KEY           (build-time; usually empty in prod Docker)
 *
 * IMPORTANT: NEXT_PUBLIC_* vars are inlined at BUILD time and are NOT present at
 * runtime in a Docker/Dokploy container unless passed as build args — which is
 * why relying on them broke maps + address lookup on the live server. This
 * helper reads the DB-stored credential first, so setting the key in Settings
 * is enough.
 */
export async function getServerMapsKey(): Promise<string> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.key;

  let stored = "";
  try {
    const row = await db.appSetting.findUnique({ where: { key: CREDENTIAL_KEY } });
    const value = (row?.value ?? null) as { googleMapsApiKey?: unknown } | null;
    if (value && typeof value.googleMapsApiKey === "string") {
      stored = value.googleMapsApiKey.trim();
    }
  } catch {
    // DB unavailable — fall through to env.
  }

  const key =
    stored ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    "";

  _cache = { key, at: Date.now() };
  return key;
}

/** Clear the cached key (call after the credential is updated in Settings). */
export function clearServerMapsKeyCache() {
  _cache = null;
}
