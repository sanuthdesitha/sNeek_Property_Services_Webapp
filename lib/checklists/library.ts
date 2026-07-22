import { JobType } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_CHECKLISTS,
  FEATURE_MODULES,
  ROTATIONAL_EVIDENCE_ITEMS,
  MANDATORY_EVIDENCE_ITEMS,
  EXCEPTION_MODULE,
  STANDARD_MODULES,
  STANDARD_AIRBNB_ITEMS,
  SELF_INSPECTION_MODULE,
  SELF_INSPECTION_REMOVED_ITEM_KEYS,
  MODULE_EVIDENCE_CATEGORY,
} from "@/lib/checklists/catalog";
import { FEATURE_DEFS, type AppliesWhenRule } from "@/lib/checklists/features";

/**
 * Bump this whenever the in-code catalog / feature modules change in a way that
 * needs to reach already-seeded databases. `getChecklistLibrary` compares it to
 * the stored marker and re-runs the idempotent sync once per deploy when they
 * differ, so production libraries pick up new modules/rules without a manual
 * re-seed. (History: v1 = original catalog seed; v2 = feature modules + rule/
 * repeatBy sync onto existing rows; v3 = evidence frequency — rotational +
 * conditional evidence items, evidenceCategory backfill; v4 = final
 * self-inspection module — 14 required checkboxes composing last; v5 = prior
 * marker; v6 = granular mandatory every-clean evidence photo set homed on the
 * room / feature modules for the Airbnb turnover guest-ready flow; v7 = the
 * STANDARD Airbnb content — STANDARD_MODULES (wrap-up) + STANDARD_AIRBNB_ITEMS
 * (kitchen/bathrooms/bedrooms/living/balcony/wrap-up photo proof plus the
 * conditional mould pair).)
 */
export const CATALOG_VERSION = "7";
const LIBRARY_VERSION_KEY = "checklistLibraryVersion";

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
  // ── Evidence frequency (Accountability Phase 1a) ──────────────────────────
  evidenceCategory: string | null;
  frequency: "EVERY_CLEAN" | "CONDITIONAL" | "ROTATIONAL";
  conditionKey: string | null;
  rotationEveryNCleans: number | null;
  maxPhotos: number | null;
  severity: string | null;
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

// ── Version-gated auto-sync ─────────────────────────────────────────────────
// Callers only invoke the seed when the library is EMPTY, so an already-seeded
// production DB would never receive new catalog/feature modules. We close that
// gap here: every library read ensures the catalog is synced once per process
// (and once per DB whenever CATALOG_VERSION advances), via idempotent upserts.

let inProcessSyncedVersion: string | null = null;
let syncInFlight: Promise<void> | null = null;

async function ensureChecklistLibrarySynced(): Promise<void> {
  if (inProcessSyncedVersion === CATALOG_VERSION) return;
  if (syncInFlight) return syncInFlight;
  const run = (async () => {
    try {
      const row = await db.appSetting.findUnique({ where: { key: LIBRARY_VERSION_KEY } }).catch(() => null);
      const stored =
        typeof row?.value === "string"
          ? row.value
          : row?.value && typeof row.value === "object" && "version" in (row.value as Record<string, unknown>)
            ? String((row.value as Record<string, unknown>).version)
            : null;
      if (stored !== CATALOG_VERSION) {
        await seedChecklistLibraryFromCatalog({ force: true });
        await db.appSetting.upsert({
          where: { key: LIBRARY_VERSION_KEY },
          create: { key: LIBRARY_VERSION_KEY, value: CATALOG_VERSION as any },
          update: { value: CATALOG_VERSION as any },
        });
      }
      inProcessSyncedVersion = CATALOG_VERSION;
    } finally {
      syncInFlight = null;
    }
  })();
  syncInFlight = run;
  return run;
}

export async function getChecklistLibrary(opts?: { includeInactive?: boolean }): Promise<LibraryModule[]> {
  // Best-effort: keep the library current, but never fail a read if the sync
  // hits a transient DB error — fall through to whatever is already stored.
  await ensureChecklistLibrarySynced().catch(() => {});
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
const MODULE_META: Record<
  string,
  { title: string; category: string; sortOrder: number; appliesWhen?: AppliesWhenRule; repeatBy?: string }
> = {
  kitchen: { title: "Kitchen", category: "ROOM", sortOrder: 10 },
  bathrooms: { title: "Bathrooms", category: "ROOM", sortOrder: 20, repeatBy: "bathrooms" },
  bedrooms: { title: "Bedrooms", category: "ROOM", sortOrder: 30, repeatBy: "bedrooms" },
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

export async function seedChecklistLibraryFromCatalog(_opts?: { force?: boolean }): Promise<{
  modules: number;
  items: number;
  skipped: boolean;
}> {
  // Idempotent sync: create missing modules/items and refresh their rules /
  // labels / repeatBy / job types on existing rows (keyed by stable key/slug).
  // Admin-authored custom modules (keys not in the catalog) are never touched,
  // and admin edits to instructions/media/field types are preserved (only set
  // on create). Safe to run against an already-seeded production library.

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
    const title = meta?.title ?? moduleTitles.get(moduleKey) ?? moduleKey;
    const category = meta?.category ?? "ROOM";
    const appliesWhen = (meta?.appliesWhen ?? null) as any;
    const repeatBy = meta?.repeatBy ?? null;
    const sortOrder = moduleOrder.get(moduleKey) ?? 500;
    const moduleRow = await db.checklistModule.upsert({
      where: { key: moduleKey },
      create: { key: moduleKey, title, category, appliesWhen, repeatBy, sortOrder },
      // Refresh canonical structure/rules on existing rows; leave isActive +
      // description (admin-editable) alone. This is how already-seeded DBs pick
      // up newly-added gating (appliesWhen) and per-room repetition (repeatBy).
      update: { title, category, appliesWhen, repeatBy, sortOrder },
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
          // Refresh label, gating rule, job-type coverage and ordering from the
          // catalog; preserve admin edits to instructions/media/field settings.
          label: agg.label,
          jobTypes: Array.from(agg.jobTypes),
          appliesWhen: (rule ?? null) as any,
          sortOrder: agg.sortOrder,
        },
      });
      itemCount += 1;
    }

    // Backfill evidenceCategory on this module's items ONLY where still null, so
    // admin edits are preserved. Rooms map by module key; other modules stay null.
    const evidenceCategory = MODULE_EVIDENCE_CATEGORY[moduleKey];
    if (evidenceCategory) {
      await db.checklistModuleItem.updateMany({
        where: { moduleId: moduleRow.id, evidenceCategory: null },
        data: { evidenceCategory },
      });
    }
  }

  // ── Feature-gated add-on modules (pool, bbq, spa, balcony, pets, …) ────────
  for (const mod of FEATURE_MODULES) {
    const moduleRow = await db.checklistModule.upsert({
      where: { key: mod.key },
      create: {
        key: mod.key,
        title: mod.title,
        category: mod.category,
        appliesWhen: mod.appliesWhen as any,
        repeatBy: mod.repeatBy ?? null,
        sortOrder: mod.sortOrder,
      },
      update: {
        title: mod.title,
        category: mod.category,
        appliesWhen: mod.appliesWhen as any,
        repeatBy: mod.repeatBy ?? null,
        sortOrder: mod.sortOrder,
      },
      select: { id: true },
    });
    moduleCount += 1;

    let sortIndex = 0;
    for (const item of mod.items) {
      sortIndex += 10;
      await db.checklistModuleItem.upsert({
        where: { moduleId_key: { moduleId: moduleRow.id, key: item.key } },
        create: {
          moduleId: moduleRow.id,
          key: item.key,
          label: item.label,
          instructions: item.instructions,
          jobTypes: mod.jobTypes,
          // Module-level appliesWhen already gates these, so item rule stays null.
          appliesWhen: null as any,
          sortOrder: sortIndex,
        },
        update: {
          label: item.label,
          jobTypes: mod.jobTypes,
          sortOrder: sortIndex,
        },
      });
      itemCount += 1;
    }

    const featureEvidenceCategory = MODULE_EVIDENCE_CATEGORY[mod.key];
    if (featureEvidenceCategory) {
      await db.checklistModuleItem.updateMany({
        where: { moduleId: moduleRow.id, evidenceCategory: null },
        data: { evidenceCategory: featureEvidenceCategory },
      });
    }
  }

  // ── ROTATIONAL deep-detail items on existing room / balcony modules ────────
  // Homed on modules the catalog + feature loops above already upserted; if a
  // module is somehow missing (custom-only DB) the item is skipped rather than
  // orphaned.
  const rotationalByModule = new Map<string, typeof ROTATIONAL_EVIDENCE_ITEMS>();
  for (const item of ROTATIONAL_EVIDENCE_ITEMS) {
    const list = rotationalByModule.get(item.moduleKey) ?? [];
    list.push(item);
    rotationalByModule.set(item.moduleKey, list);
  }
  for (const [moduleKey, items] of Array.from(rotationalByModule.entries())) {
    const moduleRow = await db.checklistModule.findUnique({
      where: { key: moduleKey },
      select: { id: true },
    });
    if (!moduleRow) continue;
    // Rotational items keep the room module's own sort range but sit after the
    // every-clean items (high sortOrder).
    let sortIndex = 700;
    for (const item of items) {
      sortIndex += 10;
      await db.checklistModuleItem.upsert({
        where: { moduleId_key: { moduleId: moduleRow.id, key: item.key } },
        create: {
          moduleId: moduleRow.id,
          key: item.key,
          label: item.label,
          instructions: item.instructions,
          fieldType: item.fieldType,
          required: false,
          minPhotos: item.minPhotos,
          stampTag: item.stampTag,
          jobTypes: [],
          appliesWhen: null as any,
          sortOrder: sortIndex,
          evidenceCategory: item.evidenceCategory ?? null,
          frequency: "ROTATIONAL",
          rotationEveryNCleans: item.rotationEveryNCleans,
          severity: item.severity,
        },
        update: {
          label: item.label,
          fieldType: item.fieldType,
          minPhotos: item.minPhotos,
          stampTag: item.stampTag,
          sortOrder: sortIndex,
          frequency: "ROTATIONAL",
          rotationEveryNCleans: item.rotationEveryNCleans,
          severity: item.severity,
        },
      });
      itemCount += 1;
    }
  }

  // ── MANDATORY every-clean evidence photos on existing room / feature modules
  // Homed on modules the catalog + feature loops above already upserted; if a
  // module is missing (custom-only DB) the item is skipped rather than orphaned.
  // These sit in a distinct sort band (500+) so evidence photos render after the
  // room checkbox tasks (10-x) but before the rotational deep-detail items (700+).
  const mandatoryByModule = new Map<string, typeof MANDATORY_EVIDENCE_ITEMS>();
  for (const item of MANDATORY_EVIDENCE_ITEMS) {
    const list = mandatoryByModule.get(item.moduleKey) ?? [];
    list.push(item);
    mandatoryByModule.set(item.moduleKey, list);
  }
  for (const [moduleKey, items] of Array.from(mandatoryByModule.entries())) {
    const moduleRow = await db.checklistModule.findUnique({
      where: { key: moduleKey },
      select: { id: true },
    });
    if (!moduleRow) continue;
    let sortIndex = 500;
    for (const item of items) {
      sortIndex += 10;
      await db.checklistModuleItem.upsert({
        where: { moduleId_key: { moduleId: moduleRow.id, key: item.key } },
        create: {
          moduleId: moduleRow.id,
          key: item.key,
          label: item.label,
          instructions: item.instructions,
          fieldType: "photo",
          required: true,
          minPhotos: item.minPhotos,
          stampTag: item.stampTag,
          jobTypes: item.jobTypes ?? [],
          appliesWhen: (item.appliesWhen ?? null) as any,
          sortOrder: sortIndex,
          evidenceCategory: item.evidenceCategory ?? null,
          frequency: "EVERY_CLEAN",
          severity: item.severity,
        },
        // Refresh canonical structure/rules/gating; leave admin-editable
        // instructions + media create-only (like the other seed loops).
        update: {
          label: item.label,
          fieldType: "photo",
          minPhotos: item.minPhotos,
          required: true,
          appliesWhen: (item.appliesWhen ?? null) as any,
          jobTypes: item.jobTypes ?? [],
          sortOrder: sortIndex,
          frequency: "EVERY_CLEAN",
          evidenceCategory: item.evidenceCategory ?? null,
          severity: item.severity,
        },
      });
      itemCount += 1;
    }
  }

  // ── STANDARD Airbnb content (catalog v7) ───────────────────────────────────
  // Modules the standard set needs and the base catalog doesn't define (wrap-up),
  // then the items themselves. Unlike the mandatory loop above these carry their
  // own fieldType / required / frequency, so photo proof, a yes/no question and
  // a CONDITIONAL follow-up can coexist in one module. Homed on an existing
  // module: if it's missing (custom-only DB) the item is skipped, not orphaned.
  for (const mod of STANDARD_MODULES) {
    await db.checklistModule.upsert({
      where: { key: mod.key },
      create: {
        key: mod.key,
        title: mod.title,
        category: mod.category,
        appliesWhen: (mod.appliesWhen ?? null) as any,
        repeatBy: mod.repeatBy ?? null,
        sortOrder: mod.sortOrder,
      },
      update: {
        title: mod.title,
        category: mod.category,
        appliesWhen: (mod.appliesWhen ?? null) as any,
        repeatBy: mod.repeatBy ?? null,
        sortOrder: mod.sortOrder,
      },
      select: { id: true },
    });
    moduleCount += 1;
  }

  {
    const moduleIds = new Map<string, string>();
    for (const item of STANDARD_AIRBNB_ITEMS) {
      let moduleId = moduleIds.get(item.moduleKey);
      if (!moduleId) {
        const row = await db.checklistModule.findUnique({
          where: { key: item.moduleKey },
          select: { id: true },
        });
        if (!row) continue;
        moduleId = row.id;
        moduleIds.set(item.moduleKey, moduleId);
      }
      await db.checklistModuleItem.upsert({
        where: { moduleId_key: { moduleId, key: item.key } },
        create: {
          moduleId,
          key: item.key,
          label: item.label,
          instructions: item.instructions,
          fieldType: item.fieldType,
          required: item.required,
          minPhotos: item.minPhotos ?? null,
          stampTag: item.stampTag ?? null,
          jobTypes: item.jobTypes ?? [],
          appliesWhen: (item.appliesWhen ?? null) as any,
          sortOrder: item.sortOrder,
          evidenceCategory: item.evidenceCategory ?? null,
          frequency: item.frequency ?? "EVERY_CLEAN",
          conditionKey: item.conditionKey ?? null,
          severity: item.severity,
        },
        // Refresh canonical structure/gating on existing rows; instructions +
        // media stay create-only so admin edits survive (same rule as above).
        update: {
          label: item.label,
          fieldType: item.fieldType,
          required: item.required,
          minPhotos: item.minPhotos ?? null,
          stampTag: item.stampTag ?? null,
          jobTypes: item.jobTypes ?? [],
          appliesWhen: (item.appliesWhen ?? null) as any,
          sortOrder: item.sortOrder,
          evidenceCategory: item.evidenceCategory ?? null,
          frequency: item.frequency ?? "EVERY_CLEAN",
          conditionKey: item.conditionKey ?? null,
          severity: item.severity,
        },
      });
      itemCount += 1;
    }
  }

  // ── CONDITIONAL exception-evidence module ──────────────────────────────────
  {
    const mod = EXCEPTION_MODULE;
    const moduleRow = await db.checklistModule.upsert({
      where: { key: mod.key },
      create: {
        key: mod.key,
        title: mod.title,
        category: mod.category,
        appliesWhen: null as any,
        sortOrder: mod.sortOrder,
      },
      update: {
        title: mod.title,
        category: mod.category,
        appliesWhen: null as any,
        sortOrder: mod.sortOrder,
      },
      select: { id: true },
    });
    moduleCount += 1;

    let sortIndex = 0;
    for (const item of mod.items) {
      sortIndex += 10;
      await db.checklistModuleItem.upsert({
        where: { moduleId_key: { moduleId: moduleRow.id, key: item.key } },
        create: {
          moduleId: moduleRow.id,
          key: item.key,
          label: item.label,
          instructions: item.instructions,
          fieldType: item.fieldType,
          required: false,
          minPhotos: item.minPhotos,
          stampTag: item.stampTag,
          jobTypes: mod.jobTypes,
          appliesWhen: null as any,
          sortOrder: sortIndex,
          frequency: "CONDITIONAL",
          conditionKey: item.conditionKey,
          severity: item.severity,
        },
        update: {
          label: item.label,
          fieldType: item.fieldType,
          minPhotos: item.minPhotos,
          stampTag: item.stampTag,
          jobTypes: mod.jobTypes,
          sortOrder: sortIndex,
          frequency: "CONDITIONAL",
          conditionKey: item.conditionKey,
          severity: item.severity,
        },
      });
      itemCount += 1;
    }
  }

  // ── Always-present final self-inspection module ────────────────────────────
  // 14 required EVERY_CLEAN checkboxes composing last (before sign-off). Upserted
  // like the exception module so admin edits (instructions/isActive) are kept.
  {
    const mod = SELF_INSPECTION_MODULE;
    const moduleRow = await db.checklistModule.upsert({
      where: { key: mod.key },
      create: {
        key: mod.key,
        title: mod.title,
        category: mod.category,
        appliesWhen: null as any,
        sortOrder: mod.sortOrder,
      },
      update: {
        title: mod.title,
        category: mod.category,
        appliesWhen: null as any,
        sortOrder: mod.sortOrder,
      },
      select: { id: true },
    });
    moduleCount += 1;

    let sortIndex = 0;
    for (const item of mod.items) {
      sortIndex += 10;
      await db.checklistModuleItem.upsert({
        where: { moduleId_key: { moduleId: moduleRow.id, key: item.key } },
        create: {
          moduleId: moduleRow.id,
          key: item.key,
          label: item.label,
          fieldType: "checkbox",
          required: true,
          jobTypes: item.jobTypes,
          appliesWhen: null as any,
          sortOrder: sortIndex,
          evidenceCategory: "FINAL",
          frequency: "EVERY_CLEAN",
          severity: item.severity,
        },
        update: {
          label: item.label,
          fieldType: "checkbox",
          required: true,
          jobTypes: item.jobTypes,
          sortOrder: sortIndex,
          frequency: "EVERY_CLEAN",
          severity: item.severity,
        },
      });
      itemCount += 1;
    }

    // Remove items dropped from the catalog (e.g. the duplicate laundry-bag
    // confirm) so regenerated templates stop including them. Past submissions
    // are unaffected — they snapshot their schema.
    if (SELF_INSPECTION_REMOVED_ITEM_KEYS.length > 0) {
      await db.checklistModuleItem.deleteMany({
        where: { moduleId: moduleRow.id, key: { in: SELF_INSPECTION_REMOVED_ITEM_KEYS } },
      });
    }
  }

  return { modules: moduleCount, items: itemCount, skipped: false };
}
