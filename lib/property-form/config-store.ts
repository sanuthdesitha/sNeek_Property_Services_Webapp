import "server-only";
import { db } from "@/lib/db";
import {
  EMPTY_PROPERTY_FORM_CONFIG,
  PROPERTY_FORM_CONFIG_KEY,
  sanitizePropertyFormConfig,
  type PropertyFormConfig,
} from "./config";

// DB read/write for the propertyFormConfig AppSetting. Split out of ./config so
// that module stays client-bundle-safe (it's imported by client components).
//
// Stale-write guard (2026-11-17): the editor sends the revision it loaded
// (the setting's updatedAt, or null when nothing was ever saved). A save made
// on an older revision is refused with the current config, so two people
// editing the form at once cannot silently overwrite each other.

export type PropertyFormConfigWithRevision = { config: PropertyFormConfig; revision: string | null };

export class PropertyFormConflictError extends Error {
  constructor(readonly current: PropertyFormConfigWithRevision) {
    super("Someone else saved the property form after you opened it. Your changes are kept; load theirs to continue.");
  }
}

export async function getPropertyFormConfig(): Promise<PropertyFormConfig> {
  return (await getPropertyFormConfigWithRevision()).config;
}

export async function getPropertyFormConfigWithRevision(): Promise<PropertyFormConfigWithRevision> {
  const row = await db.appSetting.findUnique({ where: { key: PROPERTY_FORM_CONFIG_KEY } });
  if (!row?.value) return { config: EMPTY_PROPERTY_FORM_CONFIG, revision: row ? row.updatedAt.toISOString() : null };
  return { config: sanitizePropertyFormConfig(row.value), revision: row.updatedAt.toISOString() };
}

/**
 * Saves the config. `expectedRevision` undefined keeps the old unguarded
 * behaviour for older callers; a string or null must match what is stored.
 */
export async function savePropertyFormConfig(input: unknown, expectedRevision?: string | null): Promise<PropertyFormConfig> {
  return (await savePropertyFormConfigWithRevision(input, expectedRevision)).config;
}

export async function savePropertyFormConfigWithRevision(input: unknown, expectedRevision?: string | null): Promise<PropertyFormConfigWithRevision> {
  const config = sanitizePropertyFormConfig(input);
  return db.$transaction(async (tx) => {
    // Lock the row (when it exists) so two saves cannot both pass the check.
    await tx.$queryRaw`SELECT "key" FROM "AppSetting" WHERE "key" = ${PROPERTY_FORM_CONFIG_KEY} FOR UPDATE`;
    const current = await tx.appSetting.findUnique({ where: { key: PROPERTY_FORM_CONFIG_KEY } });
    if (expectedRevision !== undefined) {
      const stored = current ? current.updatedAt.toISOString() : null;
      if (stored !== expectedRevision) {
        throw new PropertyFormConflictError({ config: current?.value ? sanitizePropertyFormConfig(current.value) : EMPTY_PROPERTY_FORM_CONFIG, revision: stored });
      }
    }
    const row = await tx.appSetting.upsert({
      where: { key: PROPERTY_FORM_CONFIG_KEY },
      create: { key: PROPERTY_FORM_CONFIG_KEY, value: config as any },
      update: { value: config as any },
    });
    return { config, revision: row.updatedAt.toISOString() };
  });
}
