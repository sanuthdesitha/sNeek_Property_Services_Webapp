/**
 * Per-kind rollout flags for template engine v2 (rebrand doc 03 §5.1 phase 3).
 * Each template kind flips independently; when OFF the legacy renderer runs.
 * Stored in the generic AppSetting key/value table (same pattern as
 * lib/job-templates.ts) so it needs no AppSettings schema change and can be
 * toggled without a deploy. Instant, per-kind rollback (§5.3).
 */

import { db } from "@/lib/db";

const SETTING_KEY = "templateEngineV2";

export interface TemplateEngineFlags {
  /** kind → enabled. Absent/false = use the legacy renderer for that kind. */
  kinds: Record<string, boolean>;
}

const EMPTY: TemplateEngineFlags = { kinds: {} };

export async function getTemplateEngineFlags(): Promise<TemplateEngineFlags> {
  try {
    const row = await db.appSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!row?.value || typeof row.value !== "object") return EMPTY;
    const value = row.value as { kinds?: Record<string, unknown> };
    const kinds: Record<string, boolean> = {};
    for (const [kind, on] of Object.entries(value.kinds ?? {})) {
      if (on === true) kinds[kind] = true;
    }
    return { kinds };
  } catch {
    return EMPTY;
  }
}

/** True when this kind should render through the v2 engine. */
export async function isKindV2Enabled(kind: string): Promise<boolean> {
  const flags = await getTemplateEngineFlags();
  return flags.kinds[kind] === true;
}

export async function setKindV2Enabled(kind: string, enabled: boolean): Promise<void> {
  const current = await getTemplateEngineFlags();
  const kinds = { ...current.kinds };
  if (enabled) kinds[kind] = true;
  else delete kinds[kind];
  await db.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: { kinds } },
    update: { value: { kinds } },
  });
}
