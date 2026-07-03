import { JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_CHECKLISTS } from "@/lib/checklists/catalog";
import { FEATURE_DEFS, type AppliesWhenRule } from "@/lib/checklists/features";

/**
 * Checklist library service — the DB-backed catalog of checklist modules
 * (rooms / appliances / outdoor areas / extras) and their items, from which
 * per-property cleaner forms are composed.
 */

export interface LibraryItem {
  id: string;
  key: string;
  label: string;
  instructions: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  fieldType: string;
  required: boolean;
  minPhotos: number | null;
  stampTag: string | null;
  defaultOn: boolean;
  jobTypes: JobType[];
  appliesWhen: unknown;
  sortOrder: number;
  isActive: boolean;
}

export interface LibraryModule {
  id: string;
  key: string;
  title: string;
  category: string;
  description: string | null;
  appliesWhen: unknown;
  repeatBy: string | null;
  sortOrder: number;
  isActive: boolean;
  items: LibraryItem[];
}

export async function getChecklistLibrary(opts?: { includeInactive?: boolean }): Promise<LibraryModule[]> {
  const modules = await db.checklistModule.findMany({
    where: opts?.includeInactive ? {} : { isActive: true },
    include: {
      items: {
        where: opts?.includeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return modules as unknown as LibraryModule[];
}

// ─────────────────────────────────────────────────────────────────────────
// One-time seed: convert the in-code DEFAULT_CHECKLISTS catalog into library
// rows. Idempotent — upserts by (module key, item key); safe to re-run.
// ─────────────────────────────────────────────────────────────────────────

/** Sections that represent the same physical area across job types. */
const MODULE_META: Record<string, { title: string; category: string; sortOrder: number; appliesWhen?: AppliesWhenRule }> = {
  kitchen: { title: "Kitchen", category: "ROOM", sortOrder: 10 },
  bathrooms: { title: "Bathrooms", category: "ROOM", sortOrder: 20 },
  bedrooms: { title: "Bedrooms", category: "ROOM", sortOrder: 30 },
  living: { title: "Living areas", category: "ROOM", sortOrder: 40 },
  general: { title: "General / whole home", category: "ROOM", sortOrder: 50 },
  finish: { title: "Finishing touches", category: "EXTRA", sortOrder: 900 },
};

/** Infer a feature rule for an item from its key/label text. */
function inferItemRule(key: string, label: string): AppliesWhenRule | null {
  const text = `${key} ${label}`.toLowerCase();
  if (text.includes("balcony")) return { propertyField: "hasBalcony", equals: true };
  for (const def of FEATURE_DEFS) {
    if (!def.keywords) continue;
    if (def.keywords.some((kw) => text.includes(kw))) return { feature: def.key };
  }
  return null;
}

export async function seedChecklistLibraryFromCatalog(opts?: { force?: boolean }): Promise<{
  modules: number;
  items: number;
  skipped: boolean;
}> {
  const existing = await db.checklistModule.count();
  if (existing > 0 && !opts?.force) {
    return { modules: 0, items: 0, skipped: true };
  }

  // Aggregate across all job types: module key = section id; item key = item id.
  // The same item appearing in several job types merges into one row with the
  // union of jobTypes (longest instructions wins as the canonical how-to).
  type Agg = {
    label: string;
    instructions?: string;
    imageUrl?: string;
    videoUrl?: string;
    jobTypes: Set<JobType>;
    sortOrder: number;
  };
  const moduleTitles = new Map<string, string>();
  const itemsByModule = new Map<string, Map<string, Agg>>();
  const moduleOrder = new Map<string, number>();
  let nextModuleOrder = 100;

  const validJobTypes = new Set(Object.values(JobType));
  for (const checklist of Object.values(DEFAULT_CHECKLISTS)) {
    const jobType = checklist.jobType as JobType;
    if (!validJobTypes.has(jobType)) continue;
    for (const section of checklist.sections) {
      const moduleKey = section.id;
      if (!moduleTitles.has(moduleKey)) moduleTitles.set(moduleKey, section.title);
      if (!moduleOrder.has(moduleKey)) {
        moduleOrder.set(moduleKey, MODULE_META[moduleKey]?.sortOrder ?? (nextModuleOrder += 10));
      }
      const bucket = itemsByModule.get(moduleKey) ?? new Map<string, Agg>();
      itemsByModule.set(moduleKey, bucket);
      let sortIndex = 0;
      for (const item of section.items) {
        sortIndex += 10;
        if (item.covered === false) continue; // exclusions stay client-copy only
        const agg = bucket.get(item.id) ?? {
          label: item.label,
          instructions: item.instructions,
          imageUrl: item.imageUrl,
          videoUrl: item.videoUrl,
          jobTypes: new Set<JobType>(),
          sortOrder: sortIndex,
        };
        agg.jobTypes.add(jobType);
        if ((item.instructions?.length ?? 0) > (agg.instructions?.length ?? 0)) {
          agg.instructions = item.instructions;
        }
        agg.imageUrl = agg.imageUrl ?? item.imageUrl;
        agg.videoUrl = agg.videoUrl ?? item.videoUrl;
        bucket.set(item.id, agg);
      }
    }
  }

  let moduleCount = 0;
  let itemCount = 0;
  for (const [moduleKey, itemMap] of Array.from(itemsByModule.entries())) {
    const meta = MODULE_META[moduleKey];
    const moduleRow = await db.checklistModule.upsert({
      where: { key: moduleKey },
      create: {
        key: moduleKey,
        title: meta?.title ?? moduleTitles.get(moduleKey) ?? moduleKey,
        category: meta?.category ?? "ROOM",
        appliesWhen: (meta?.appliesWhen ?? null) as any,
        sortOrder: moduleOrder.get(moduleKey) ?? 500,
      },
      update: {},
      select: { id: true },
    });
    moduleCount += 1;

    for (const [itemKey, agg] of Array.from(itemMap.entries())) {
      const rule = inferItemRule(itemKey, agg.label);
      await db.checklistModuleItem.upsert({
        where: { moduleId_key: { moduleId: moduleRow.id, key: itemKey } },
        create: {
          moduleId: moduleRow.id,
          key: itemKey,
          label: agg.label,
          instructions: agg.instructions ?? null,
          imageUrl: agg.imageUrl ?? null,
          videoUrl: agg.videoUrl ?? null,
          jobTypes: Array.from(agg.jobTypes),
          appliesWhen: (rule ?? null) as any,
          sortOrder: agg.sortOrder,
        },
        update: {
          // Re-running with force keeps admin edits to label/instructions but
          // unions in any newly-covered job types from the catalog.
          jobTypes: Array.from(agg.jobTypes),
        },
      });
      itemCount += 1;
    }
  }

  return { modules: moduleCount, items: itemCount, skipped: false };
}
