import { db } from "@/lib/db";
import { DEFAULT_CHECKLISTS } from "./catalog";
import type { ChecklistMap, ServiceChecklist } from "./types";

const KEY = "serviceChecklists";

/** Preset catalog checklists with any admin overrides applied (per job type). */
export async function getChecklists(): Promise<ChecklistMap> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  const overrides = (row?.value as ChecklistMap | undefined) ?? {};
  const merged: ChecklistMap = { ...DEFAULT_CHECKLISTS };
  for (const [jobType, checklist] of Object.entries(overrides)) {
    if (checklist && typeof checklist === "object") merged[jobType] = checklist as ServiceChecklist;
  }
  return merged;
}

export async function getChecklist(jobType: string): Promise<ServiceChecklist | null> {
  const all = await getChecklists();
  return all[jobType] ?? null;
}

/** Save (override) the checklist for a single job type. */
export async function saveChecklist(jobType: string, checklist: ServiceChecklist): Promise<void> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  const current = (row?.value as ChecklistMap | undefined) ?? {};
  current[jobType] = checklist;
  await db.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: current as any },
    update: { value: current as any },
  });
}
