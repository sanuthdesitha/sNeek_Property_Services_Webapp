import { db } from "@/lib/db";
import { resolvePortalScopeForUser } from "@/lib/auth/client-portal";
import { getAppSettings, type AppSettings, type ClientPortalVisibility } from "@/lib/settings";

type ClientVisibilityOverride = Partial<Record<keyof ClientPortalVisibility, boolean>>;

export function mergeClientPortalVisibility(
  base: ClientPortalVisibility,
  override: ClientVisibilityOverride | null | undefined
): ClientPortalVisibility {
  if (!override) return base;
  const next: ClientPortalVisibility = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (typeof value === "boolean" && key in next) {
      (next as unknown as Record<string, boolean>)[key] = value;
    }
  }
  return next;
}

/**
 * Exported so lib/auth/client-portal.ts can reuse it. The VA chokepoint has to
 * merge the same per-client overrides this context does; a second sanitiser
 * would be a second place for the two to disagree.
 */
export function sanitizeClientVisibilityOverride(input: unknown): ClientVisibilityOverride | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const out: ClientVisibilityOverride = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "boolean") {
      out[key as keyof ClientPortalVisibility] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function getClientPortalContext(userId: string, settings?: AppSettings) {
  const appSettings = settings ?? (await getAppSettings());
  // Resolve the client THROUGH the portal-scope resolver, never user.clientId
  // directly: a VA has clientId null and resolves to their team's client
  // (fail-closed — no team means no client). Reading user.clientId here was
  // exactly the fail-open pattern B15 flagged: a VA got clientId null and the
  // app-default visibility, silently dropping the client's own overrides.
  const scope = await resolvePortalScopeForUser(userId);
  const client = scope
    ? await db.client.findUnique({
        where: { id: scope.clientId },
        select: { id: true, name: true, portalVisibilityOverrides: true },
      })
    : null;

  const overrides = sanitizeClientVisibilityOverride(client?.portalVisibilityOverrides);
  const visibility = mergeClientPortalVisibility(appSettings.clientPortalVisibility, overrides);

  return {
    clientId: client?.id ?? null,
    client: client ? { id: client.id, name: client.name, portalVisibilityOverrides: client.portalVisibilityOverrides } : null,
    visibility,
    overrides,
    settings: appSettings,
  };
}
