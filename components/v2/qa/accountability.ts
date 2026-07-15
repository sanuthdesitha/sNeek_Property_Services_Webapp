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
