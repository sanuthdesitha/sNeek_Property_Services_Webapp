/**
 * Recurring-issue pattern detection (Accountability Phase 7a).
 *
 * "Patterns" are the same QA issue category recurring for the same cleaner (or
 * at the same property) within a rolling window. They are COMPUTED AT READ TIME
 * from the `QaIssue` table — there are no pattern tables and nothing is
 * persisted. `detectPatterns` is intentionally pure (no DB, no I/O) so it can be
 * unit-tested and reused; the DB readers below wrap it with settings-driven
 * windows and category-label resolution.
 *
 * Every reader degrades silently (returns []) on error — pattern surfacing is
 * advisory and must never break the briefing, the job-start form, or QA review.
 */
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";

export type PatternKind = "CLEANER_CATEGORY" | "PROPERTY_CATEGORY";

/** A raw pattern hit — one recurring category for one cleaner or property. */
export interface PatternHit {
  kind: PatternKind;
  cleanerId?: string;
  propertyId?: string;
  category: string;
  count: number;
  lastAt: Date;
  /** Stable key: `cleaner:<id>:<category>` / `property:<id>:<category>`. */
  patternKey: string;
}

/** Minimal issue shape `detectPatterns` needs (matches a QaIssue projection). */
export interface PatternIssue {
  cleanerId: string;
  propertyId: string;
  category: string;
  severity: string;
  createdAt: Date;
}

export interface DetectPatternsOptions {
  sameCategoryCount: number;
  windowDays: number;
  now?: Date;
}

/** Display-ready recurring category for a UI surface. */
export interface RecurringIssueDisplay {
  category: string;
  label: string;
  count: number;
  lastAt: Date;
  kind: PatternKind;
  severityMax: string;
}

const SEVERITY_RANK: Record<string, number> = { MINOR: 1, MAJOR: 2, CRITICAL: 3 };

function maxSeverity(a: string, b: string): string {
  return (SEVERITY_RANK[b] ?? 0) > (SEVERITY_RANK[a] ?? 0) ? b : a;
}

const DAY_MS = 86_400_000;

/**
 * Pure detector. Groups the given issues by (cleaner, category) and
 * (property, category) within `windowDays` of `now`, and returns one hit per
 * group whose count reaches `sameCategoryCount`.
 */
export function detectPatterns(issues: PatternIssue[], opts: DetectPatternsOptions): PatternHit[] {
  const now = opts.now ?? new Date();
  const sameCategoryCount = Math.max(1, Math.floor(opts.sameCategoryCount));
  const windowDays = Math.max(0, opts.windowDays);
  const cutoff = now.getTime() - windowDays * DAY_MS;

  type Acc = { count: number; lastAt: Date };
  const cleaner = new Map<string, Acc>();
  const property = new Map<string, Acc>();

  for (const issue of issues) {
    if (!issue || !issue.category) continue;
    const at = issue.createdAt instanceof Date ? issue.createdAt : new Date(issue.createdAt);
    const t = at.getTime();
    if (!Number.isFinite(t) || t < cutoff) continue;

    if (issue.cleanerId) {
      const key = `cleaner:${issue.cleanerId}:${issue.category}`;
      const cur = cleaner.get(key);
      if (cur) {
        cur.count += 1;
        if (t > cur.lastAt.getTime()) cur.lastAt = at;
      } else {
        cleaner.set(key, { count: 1, lastAt: at });
      }
    }
    if (issue.propertyId) {
      const key = `property:${issue.propertyId}:${issue.category}`;
      const cur = property.get(key);
      if (cur) {
        cur.count += 1;
        if (t > cur.lastAt.getTime()) cur.lastAt = at;
      } else {
        property.set(key, { count: 1, lastAt: at });
      }
    }
  }

  const hits: PatternHit[] = [];
  Array.from(cleaner.entries()).forEach(([key, acc]) => {
    if (acc.count < sameCategoryCount) return;
    const [, cleanerId, category] = key.split(":");
    hits.push({ kind: "CLEANER_CATEGORY", cleanerId, category, count: acc.count, lastAt: acc.lastAt, patternKey: key });
  });
  Array.from(property.entries()).forEach(([key, acc]) => {
    if (acc.count < sameCategoryCount) return;
    const [, propertyId, category] = key.split(":");
    hits.push({ kind: "PROPERTY_CATEGORY", propertyId, category, count: acc.count, lastAt: acc.lastAt, patternKey: key });
  });
  // Strongest first — most frequent, then most recent.
  hits.sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime());
  return hits;
}

// ── Settings + label helpers ────────────────────────────────────────────────

async function loadPatternConfig(): Promise<{
  sameCategoryCount: number;
  windowDays: number;
  labels: Map<string, string>;
}> {
  const settings = await getAppSettings();
  const acc = settings.accountability;
  const labels = new Map<string, string>();
  for (const c of acc.issueCategories ?? []) {
    if (c?.key) labels.set(c.key, c.label || c.key);
  }
  return {
    sameCategoryCount: acc.patternSameCategoryCount,
    windowDays: acc.patternWindowDays,
    labels,
  };
}

/** Prettify an unknown category key (fallback when no settings label exists). */
function fallbackLabel(category: string): string {
  return category
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ") || category;
}

/**
 * Turn raw hits (of one kind) into display-ready rows: resolve labels, compute
 * per-category max severity from the source issues, sort by count desc.
 */
function toDisplay(
  hits: PatternHit[],
  issues: PatternIssue[],
  labels: Map<string, string>,
  keyOf: (i: PatternIssue) => string
): RecurringIssueDisplay[] {
  // Per-category max severity over the in-window source issues.
  const sevByKey = new Map<string, string>();
  for (const i of issues) {
    const k = keyOf(i);
    sevByKey.set(k, maxSeverity(sevByKey.get(k) ?? "MINOR", i.severity || "MINOR"));
  }
  return hits
    .map((h) => ({
      category: h.category,
      label: labels.get(h.category) ?? fallbackLabel(h.category),
      count: h.count,
      lastAt: h.lastAt,
      kind: h.kind,
      severityMax: sevByKey.get(h.patternKey.split(":").slice(1).join(":")) ?? "MINOR",
    }))
    .sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime());
}

// ── DB readers (settings-driven, degrade to [] on error) ────────────────────

/** Recurring categories flagged against THIS cleaner in the window. */
export async function getCleanerRecurringIssues(cleanerId: string): Promise<RecurringIssueDisplay[]> {
  if (!cleanerId) return [];
  try {
    const { sameCategoryCount, windowDays, labels } = await loadPatternConfig();
    const since = new Date(Date.now() - windowDays * DAY_MS);
    const rows = await db.qaIssue.findMany({
      where: { cleanerId, createdAt: { gte: since } },
      select: { cleanerId: true, propertyId: true, category: true, severity: true, createdAt: true },
    });
    const issues = rows as PatternIssue[];
    const hits = detectPatterns(issues, { sameCategoryCount, windowDays }).filter(
      (h) => h.kind === "CLEANER_CATEGORY"
    );
    return toDisplay(hits, issues, labels, (i) => `${i.cleanerId}:${i.category}`);
  } catch {
    return [];
  }
}

/** Recurring categories flagged at THIS property in the window. */
export async function getPropertyRecurringIssues(propertyId: string): Promise<RecurringIssueDisplay[]> {
  if (!propertyId) return [];
  try {
    const { sameCategoryCount, windowDays, labels } = await loadPatternConfig();
    const since = new Date(Date.now() - windowDays * DAY_MS);
    const rows = await db.qaIssue.findMany({
      where: { propertyId, createdAt: { gte: since } },
      select: { cleanerId: true, propertyId: true, category: true, severity: true, createdAt: true },
    });
    const issues = rows as PatternIssue[];
    const hits = detectPatterns(issues, { sameCategoryCount, windowDays }).filter(
      (h) => h.kind === "PROPERTY_CATEGORY"
    );
    return toDisplay(hits, issues, labels, (i) => `${i.propertyId}:${i.category}`);
  } catch {
    return [];
  }
}

// Short, category-specific coaching tips for the job-start reminder line.
const CATEGORY_TIPS: Record<string, string> = {
  dusting: "check skirting boards, sills & high surfaces",
  laundry_bag: "double-check the bag label and colour",
  laundry_linen: "confirm fresh linen is laid and old linen bagged",
  restock: "top up consumables to par before you finish",
  kitchen_reset: "check inside the microwave, oven and behind the kettle",
  bathroom_detail: "check grout, drains and behind the toilet",
  bed_setup: "hospital corners and even cushion placement",
  furniture_reset: "return furniture to the reference layout",
  balcony_setup: "wipe the outdoor table and set the chairs",
  rubbish: "empty every bin and remove all rubbish",
  damage_missed: "photograph and report any damage you spot",
  evidence_quality: "clear, well-lit before/after photos of each area",
  coffee_machine: "empty, rinse and reset the coffee machine",
};

/**
 * Build a short, deduped list of reminder strings for a job's start card —
 * merging the primary cleaner's recurring categories with the property's.
 * Never throws; returns [] on any failure.
 */
export async function getJobStartReminders(jobId: string): Promise<string[]> {
  if (!jobId) return [];
  try {
    const job = await db.job.findUnique({
      where: { id: jobId },
      select: {
        propertyId: true,
        assignments: {
          where: { removedAt: null },
          orderBy: [{ isPrimary: "desc" }, { assignedAt: "asc" }],
          take: 1,
          select: { userId: true },
        },
      },
    });
    if (!job) return [];
    const cleanerId = job.assignments[0]?.userId ?? null;

    const { windowDays } = await loadPatternConfig();
    const [cleanerHits, propertyHits] = await Promise.all([
      cleanerId ? getCleanerRecurringIssues(cleanerId) : Promise.resolve([]),
      getPropertyRecurringIssues(job.propertyId),
    ]);

    const out: string[] = [];
    const seenCategory = new Set<string>();

    for (const h of cleanerHits) {
      const tip = CATEGORY_TIPS[h.category];
      out.push(
        `${h.label} flagged ${h.count}× in your last ${windowDays} days${tip ? ` — ${tip}` : ""}`
      );
      seenCategory.add(h.category);
    }
    for (const h of propertyHits) {
      // Skip a property line for a category the cleaner is already reminded about.
      if (seenCategory.has(h.category)) continue;
      const tip = CATEGORY_TIPS[h.category];
      out.push(
        `This property: ${h.label.toLowerCase()} reported ${h.count}× recently${tip ? ` — ${tip}` : ""}`
      );
      seenCategory.add(h.category);
    }
    return out.slice(0, 6);
  } catch {
    return [];
  }
}
