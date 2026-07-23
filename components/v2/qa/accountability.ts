/**
 * Accountability Phase 4b — shared, framework-agnostic logic for the QA
 * per-item VERDICT capture. Pure TypeScript (types + constants + helpers), no
 * React and no styling, so BOTH the Estate v2 QA inspection workspace and the
 * v1 QA review page can consume it and produce the identical `accountability`
 * POST blob.
 *
 * The wire contract (mirrored here as LOCAL types — the API/types may not exist
 * yet; a parallel agent owns app/api/qa/jobs/[id]/route.ts + lib/accountability):
 *
 *   POST body gains: accountability?: {
 *     verdicts: AccountabilityVerdictEntry[];
 *     missingMandatoryEvidenceFieldIds?: string[];
 *     suspectedFalseConfirmations?: { fieldId; itemKey?; description? }[];
 *   }
 */

/* ── Wire types (kept in exact sync with the API contract) ────────────────── */
export type AccountabilityVerdict = "PASS" | "MINOR" | "MAJOR" | "CRITICAL" | "NA";

export interface AccountabilityVerdictEntry {
  fieldId: string;
  itemKey?: string | null;
  label?: string | null;
  verdict: AccountabilityVerdict;
  category?: string | null; // issue-category key (required for MINOR+)
  description?: string | null; // required for MINOR+
  guestReadyImpact?: boolean;
  cleanerMarkedComplete?: boolean;
  qaPhotoKeys?: { key: string; annotatedKey?: string | null }[];
  cleanerMediaIds?: string[];
}

export interface AccountabilityBlob {
  verdicts: AccountabilityVerdictEntry[];
  missingMandatoryEvidenceFieldIds?: string[];
  suspectedFalseConfirmations?: { fieldId: string; itemKey?: string | null; description?: string | null }[];
}

/* ── Scoring settings (DEFAULTS mirror lib/settings DEFAULT_ACCOUNTABILITY_
 *    SETTINGS.scoring; the page overrides these when its data source exposes
 *    settings.accountability.scoring). ────────────────────────────────────── */
export interface AccountabilityScoring {
  minorDeduction: number;
  majorDeduction: number;
  criticalDeduction: number;
  missingMandatoryEvidenceDeduction: number;
  falseConfirmationExtraDeduction: number;
  floor: number;
  excellentMin: number;
  passMin: number;
  needsImprovementMin: number;
  criticalTriggersManagementReview: boolean;
}

export const DEFAULT_ACCOUNTABILITY_SCORING: AccountabilityScoring = {
  minorDeduction: 3,
  majorDeduction: 10,
  criticalDeduction: 25,
  missingMandatoryEvidenceDeduction: 5,
  falseConfirmationExtraDeduction: 10,
  floor: 0,
  excellentMin: 97,
  passMin: 93,
  needsImprovementMin: 85,
  criticalTriggersManagementReview: true,
};

/** Seeded issue taxonomy (key → label) — mirrors lib/settings
 *  DEFAULT_ACCOUNTABILITY_ISSUE_CATEGORIES. */
export const DEFAULT_ISSUE_CATEGORIES: { key: string; label: string }[] = [
  { key: "dusting", label: "Dusting" },
  { key: "laundry_bag", label: "Laundry bag" },
  { key: "laundry_linen", label: "Laundry / linen" },
  { key: "restock", label: "Restock" },
  { key: "kitchen_reset", label: "Kitchen reset" },
  { key: "bathroom_detail", label: "Bathroom detail" },
  { key: "bed_setup", label: "Bed setup" },
  { key: "furniture_reset", label: "Furniture reset" },
  { key: "balcony_setup", label: "Balcony setup" },
  { key: "rubbish", label: "Rubbish" },
  { key: "damage_missed", label: "Damage missed" },
  { key: "evidence_quality", label: "Evidence quality" },
  { key: "coffee_machine", label: "Coffee machine" },
  { key: "other", label: "Other" },
];

export const VERDICT_OPTIONS: AccountabilityVerdict[] = ["PASS", "MINOR", "MAJOR", "CRITICAL", "NA"];

export const VERDICT_LABELS: Record<AccountabilityVerdict, string> = {
  PASS: "Pass",
  MINOR: "Minor",
  MAJOR: "Major",
  CRITICAL: "Critical",
  NA: "N/A",
};

/** Verdicts that require an issue category + description before submit. */
export function verdictRequiresIssue(v: AccountabilityVerdict): boolean {
  return v === "MINOR" || v === "MAJOR" || v === "CRITICAL";
}

/* ── What each grade MEANS and what it actually DOES ───────────────────────
 * Plain-operator English for the grading control. Every consequence below is
 * taken from the code that consumes the verdict, not from intent:
 *
 *   • points off  — lib/accountability/scoring.ts computeAccountabilityScore
 *                   (MINOR −minorDeduction, MAJOR −majorDeduction,
 *                    CRITICAL −criticalDeduction; PASS and N/A deduct nothing).
 *   • written up  — app/api/qa/jobs/[id]/route.ts creates one QaIssue row per
 *                   MINOR/MAJOR/CRITICAL verdict, against the job's primary
 *                   cleaner. PASS/N/A create nothing.
 *   • repeat flag — lib/accountability/patterns.ts groups those issues by
 *                   category; enough of the same category inside the settings
 *                   window becomes a repeat-issue watch-out on the cleaner and
 *                   the property (all severities count).
 *   • bonus       — lib/accountability/streaks.ts qualifies(): a clean counts
 *                   toward the streak bonus only if it scored at or above the
 *                   streak minimum AND had no CRITICAL issue. So MINOR/MAJOR
 *                   hurt only through the score; CRITICAL breaks the streak
 *                   outright.
 *   • manager     — CRITICAL sets the review to MANAGEMENT REVIEW
 *                   (ratingForScore + criticalTriggersManagementReview) and
 *                   notifies management, regardless of the number.
 *   • rework      — NO verdict creates a rework job by itself. The rework job,
 *                   its pay and its deduction come only from the inspector
 *                   ticking "rework required" further down the form
 *                   (`if (rk?.enabled)` in the QA submit route).
 */
export interface VerdictGuide {
  label: string;
  /** One line: what the cleaner would have had to do to earn this grade. */
  meaning: string;
  /** One line: what it actually causes. */
  consequence: string;
  /** True when a category + description are required before you can submit. */
  needsDetail: boolean;
}

/**
 * Grade guidance for the inspector, filled in with the live scoring settings so
 * the numbers on screen are the numbers that will be applied. Pure — unit
 * tested in tests/lib/qa-verdict-guide.test.ts.
 */
export function verdictGuide(
  v: AccountabilityVerdict,
  scoring: AccountabilityScoring = DEFAULT_ACCOUNTABILITY_SCORING
): VerdictGuide {
  switch (v) {
    case "PASS":
      return {
        label: VERDICT_LABELS.PASS,
        meaning: "Done properly — you'd hand the place to a guest like this.",
        consequence: "No points off and nothing written up.",
        needsDetail: false,
      };
    case "MINOR":
      return {
        label: VERDICT_LABELS.MINOR,
        meaning: "Small slip a guest probably wouldn't notice — a smudge, a crooked cushion, one missed dust spot.",
        consequence: `−${scoring.minorDeduction} points and a written-up issue on the cleaner's record. Repeats of the same kind become a watch-out.`,
        needsDetail: true,
      };
    case "MAJOR":
      return {
        label: VERDICT_LABELS.MAJOR,
        meaning: "A guest would see it and complain — a dirty bathroom, unmade bed, bin not emptied.",
        consequence: `−${scoring.majorDeduction} points and a written-up issue on the cleaner's record. Repeats of the same kind become a watch-out.`,
        needsDetail: true,
      };
    case "CRITICAL":
      return {
        label: VERDICT_LABELS.CRITICAL,
        meaning: "The place isn't fit for a guest, or it's a safety/damage problem — soiled linen, no hot water, hazard left behind.",
        consequence: `−${scoring.criticalDeduction} points, written up, ${
          scoring.criticalTriggersManagementReview ? "sent to management review whatever the score, " : ""
        }and it breaks the cleaner's bonus streak.`,
        needsDetail: true,
      };
    case "NA":
    default:
      return {
        label: VERDICT_LABELS.NA,
        meaning: "Doesn't apply here — no balcony, no coffee machine, area not in use.",
        consequence: "No points off and nothing written up.",
        needsDetail: false,
      };
  }
}

/** The whole grading control explained in a few lines, for the step header. */
export interface GradingExplainer {
  /** e.g. "93 or above out of 100 passes." */
  passLine: string;
  /** The per-grade cost lines, in the order the buttons are shown. */
  gradeLines: string[];
  /** Everything else that changes the number. */
  extraLines: string[];
  /** What is NOT automatic — set expectations about rework/pay. */
  notAutomatic: string;
}

export function gradingExplainer(
  scoring: AccountabilityScoring = DEFAULT_ACCOUNTABILITY_SCORING
): GradingExplainer {
  return {
    passLine: `Every clean starts at 100. Anything you grade below Pass takes points off. ${scoring.passMin} or more still passes, ${scoring.excellentMin}+ is excellent, under ${scoring.needsImprovementMin} is a fail.`,
    gradeLines: VERDICT_OPTIONS.map((v) => {
      const g = verdictGuide(v, scoring);
      return `${g.label} — ${g.meaning} ${g.consequence}`;
    }),
    extraLines: [
      `Missing or unusable evidence on a required photo: −${scoring.missingMandatoryEvidenceDeduction} each.`,
      `An item the cleaner ticked off that clearly wasn't done ("false confirmation"): an extra −${scoring.falseConfirmationExtraDeduction} on top of the grade.`,
      `The score can't go below ${scoring.floor}.`,
    ],
    notAutomatic:
      "Grading alone never sends anyone back or moves any money. A re-clean, and any pay that goes with it, only happens if you tick \"rework required\" further down and choose who fixes it.",
  };
}

/* ── Per-item local UI state (client-only; never posted verbatim) ─────────── */
export interface VerdictState {
  verdict: AccountabilityVerdict;
  category?: string | null;
  description?: string | null;
  guestReadyImpact?: boolean;
  qaPhotoKeys?: { key: string; annotatedKey?: string | null }[];
  /** UI-only: item is flagged as a false confirmation (→ suspectedFalseConfirmations). */
  falseConfirmation?: boolean;
}

export function emptyVerdictState(): VerdictState {
  return { verdict: "PASS" };
}

/** Metadata about each reviewed item, computed from the template field + the
 *  cleaner's submission, needed to enrich verdict entries. */
export interface ItemMeta {
  fieldId: string;
  label?: string | null;
  itemKey?: string | null;
  cleanerMarkedComplete: boolean;
  cleanerMediaIds: string[];
}

/* ── Blob assembly ─────────────────────────────────────────────────────────
 * Entries are emitted for every non-PASS verdict (MINOR/MAJOR/CRITICAL/NA);
 * PASS items are omitted to keep the payload lean (PASS = default, no
 * deduction). Missing-evidence + false-confirmation flags collect separately.
 * Returns null when nothing meaningful was captured, so the caller omits the
 * `accountability` key entirely and preserves legacy behaviour. */
export function buildAccountabilityBlob(
  verdicts: Record<string, VerdictState>,
  missingEvidence: Record<string, boolean>,
  meta: Record<string, ItemMeta>
): AccountabilityBlob | null {
  const entries: AccountabilityVerdictEntry[] = [];
  const falseConfirmations: { fieldId: string; itemKey?: string | null; description?: string | null }[] = [];

  for (const [fieldId, state] of Object.entries(verdicts)) {
    if (!state) continue;
    const m = meta[fieldId];
    const isNonPass = state.verdict !== "PASS";
    if (isNonPass) {
      entries.push({
        fieldId,
        itemKey: m?.itemKey ?? null,
        label: m?.label ?? null,
        verdict: state.verdict,
        category: verdictRequiresIssue(state.verdict) ? state.category ?? null : null,
        description: verdictRequiresIssue(state.verdict) ? state.description ?? null : null,
        guestReadyImpact: Boolean(state.guestReadyImpact),
        cleanerMarkedComplete: Boolean(m?.cleanerMarkedComplete),
        qaPhotoKeys: state.qaPhotoKeys && state.qaPhotoKeys.length > 0 ? state.qaPhotoKeys : undefined,
        cleanerMediaIds: m?.cleanerMediaIds && m.cleanerMediaIds.length > 0 ? m.cleanerMediaIds : undefined,
      });
    }
    if (state.falseConfirmation) {
      falseConfirmations.push({
        fieldId,
        itemKey: m?.itemKey ?? null,
        description: state.description ?? null,
      });
    }
  }

  const missingIds = Object.entries(missingEvidence)
    .filter(([, v]) => v)
    .map(([k]) => k);

  if (entries.length === 0 && missingIds.length === 0 && falseConfirmations.length === 0) {
    return null;
  }

  const blob: AccountabilityBlob = { verdicts: entries };
  if (missingIds.length > 0) blob.missingMandatoryEvidenceFieldIds = missingIds;
  if (falseConfirmations.length > 0) blob.suspectedFalseConfirmations = falseConfirmations;
  return blob;
}

/* ── Submit validation ─────────────────────────────────────────────────────
 * Every MINOR+ verdict must carry a category AND a description. Returns the
 * list of offending items (fieldId + label) so the caller can block + explain. */
export function validateAccountability(
  verdicts: Record<string, VerdictState>,
  meta: Record<string, ItemMeta>
): { fieldId: string; label: string }[] {
  const invalid: { fieldId: string; label: string }[] = [];
  for (const [fieldId, state] of Object.entries(verdicts)) {
    if (!state || !verdictRequiresIssue(state.verdict)) continue;
    const hasCategory = Boolean(state.category && state.category.trim());
    const hasDescription = Boolean(state.description && state.description.trim());
    if (!hasCategory || !hasDescription) {
      invalid.push({ fieldId, label: meta[fieldId]?.label || fieldId });
    }
  }
  return invalid;
}

/* ── Live score preview ────────────────────────────────────────────────────
 * Mirrors the scoring-preview rules in the Phase 4b brief: start 100; MINOR −3,
 * MAJOR −10, CRITICAL −25; missing evidence −5 each; suspected false
 * confirmation extra −10 each; floor 0. */
export interface AccountabilityPreview {
  raw: number;
  minor: number;
  major: number;
  critical: number;
  na: number;
  missingEvidence: number;
  falseConfirmations: number;
  rating: "EXCELLENT" | "PASS" | "NEEDS IMPROVEMENT" | "FAILED";
  managementReview: boolean;
  /** True when any non-PASS/NA verdict or flag exists (i.e. the blob will send). */
  active: boolean;
}

export function computeAccountabilityPreview(
  verdicts: Record<string, VerdictState>,
  missingEvidence: Record<string, boolean>,
  scoring: AccountabilityScoring = DEFAULT_ACCOUNTABILITY_SCORING
): AccountabilityPreview {
  let minor = 0;
  let major = 0;
  let critical = 0;
  let na = 0;
  let falseConfirmations = 0;

  for (const state of Object.values(verdicts)) {
    if (!state) continue;
    switch (state.verdict) {
      case "MINOR":
        minor += 1;
        break;
      case "MAJOR":
        major += 1;
        break;
      case "CRITICAL":
        critical += 1;
        break;
      case "NA":
        na += 1;
        break;
      default:
        break;
    }
    if (state.falseConfirmation) falseConfirmations += 1;
  }

  const missing = Object.values(missingEvidence).filter(Boolean).length;

  let raw =
    100 -
    minor * scoring.minorDeduction -
    major * scoring.majorDeduction -
    critical * scoring.criticalDeduction -
    missing * scoring.missingMandatoryEvidenceDeduction -
    falseConfirmations * scoring.falseConfirmationExtraDeduction;
  raw = Math.max(scoring.floor, raw);

  const rating: AccountabilityPreview["rating"] =
    raw >= scoring.excellentMin
      ? "EXCELLENT"
      : raw >= scoring.passMin
        ? "PASS"
        : raw >= scoring.needsImprovementMin
          ? "NEEDS IMPROVEMENT"
          : "FAILED";

  const managementReview = critical > 0 && scoring.criticalTriggersManagementReview;
  const active = minor + major + critical + na + missing + falseConfirmations > 0;

  return { raw, minor, major, critical, na, missingEvidence: missing, falseConfirmations, rating, managementReview, active };
}

/* ── Cleaner-submission helpers ────────────────────────────────────────────
 * Derive whether the cleaner effectively "marked complete" a given field
 * (answered affirmatively / uploaded evidence) — the false-confirmation
 * signal — and collect their media ids for that field. */
export function cleanerAnsweredAffirmatively(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (value === false) return false;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "" || v === "no" || v === "false" || v === "na" || v === "n/a") return false;
    return true;
  }
  if (Array.isArray(value)) return value.length > 0;
  return true; // numbers, true, objects → answered
}
