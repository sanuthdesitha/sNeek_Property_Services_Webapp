import { db } from "@/lib/db";
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

function sanitizeClientVisibilityOverride(input: unknown): ClientVisibilityOverride | null {
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
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      clientId: true,
      client: {
        select: {
          id: true,
          name: true,
          portalVisibilityOverrides: true,
        },
      },
    },
  });

  const overrides = sanitizeClientVisibilityOverride(user?.client?.portalVisibilityOverrides);
  const visibility = mergeClientPortalVisibility(appSettings.clientPortalVisibility, overrides);

  return {
    clientId: user?.clientId ?? null,
    client: user?.client ?? null,
    visibility,
    overrides,
    settings: appSettings,
  };
}
