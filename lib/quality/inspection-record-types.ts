/**
 * The office view of one submitted QA inspection (board "QualityInspection",
 * /v2/admin/quality/[assignmentId]). Plain types only: the server page builds
 * an InspectionRecord with lib/quality/inspection-record.ts and hands it to the
 * client component, so nothing here may come from a "use client" module.
 *
 * Every value that was not recorded stays null and is written as "Not
 * recorded" on screen; nothing unknown becomes zero or a pass.
 */

export type RecordTone = "neutral" | "ok" | "warn" | "bad" | "info";

/** A stored QA issue as it reads on the record. */
export type RecordIssue = {
  id: string;
  categoryLabel: string;
  description: string;
  /** "Minor", "Fail", "Fail · serious", or a history "Major" / "Critical". */
  verdictLabel: string;
  /** The verdict-scale option this issue stands for (MINOR, FAIL, MAJOR, CRITICAL). */
  verdictKey: string;
  severity: string;
  falseConfirmation: string;
  rectificationStatus: string;
  cleanerMarkedComplete: boolean;
  guestReadyImpact: boolean;
  /** QA photo keys (the flattened mark-up when there is one) with whether they were marked up. */
  qaPhotos: Array<{ key: string; markedUp: boolean }>;
};

/** One reviewed checklist item. `issue` is null when no issue was recorded for it. */
export type RecordItem = {
  fieldId: string;
  label: string;
  issue: RecordIssue | null;
};

export type RecordArea = {
  id: string;
  title: string;
  items: RecordItem[];
  issueCount: number;
};

export type RecordScoreLine = { label: string; count: number };

export type RecordScore = {
  score: number;
  /** The score before an office adjustment, when it differs. */
  rawScore: number | null;
  adjustmentReason: string | null;
  ratingLabel: string | null;
  ratingTone: RecordTone;
  passed: boolean;
  managementReview: boolean;
  /** Stored issues by verdict, plus false confirmations still standing. */
  lines: RecordScoreLine[];
};

export type RecordDamage = {
  id: string;
  area: string;
  description: string;
  severity: string;
  photoKeys: string[];
  estimatedCost: number | null;
};

export type RecordNextClean = { id: string; kind: "DEEP_CLEAN_AREA" | "SPECIAL_REQUEST"; area: string | null; note: string };

export type RecordEvidencePhoto = { id: string; key: string; label: string };

export type RecordEvidence = {
  submittedByName: string | null;
  submittedAt: string | null;
  photoCount: number;
  photos: RecordEvidencePhoto[];
};

/** One line of "Who fixes it", read from the stored rework offer, rework jobs and rework transfers. */
export type RecordTimelineEvent = {
  /** ISO instant, or null when the record keeps no time for this step. */
  at: string | null;
  text: string;
};

export type RecordWhoFixes = {
  status: { label: string; tone: RecordTone } | null;
  events: RecordTimelineEvent[];
  /** Where pay that came out of it stands (never claims it was paid). */
  note: string | null;
};

export type RecordSignOff = {
  signedByName: string | null;
  signedAt: string | null;
  attested: boolean;
  signatureKey: string | null;
};

export type RecordReopen = {
  eligible: boolean;
  blockedReason: string | null;
  /** Money already moved by this inspection, said before anyone reopens it. */
  warnings: string[];
};

/**
 * Facts the AI photo review panel needs to explain, per finding, why a person
 * cannot approve it. They mirror the approval route's own refusals
 * (app/api/qa/jobs/[id]/photo-review): an existing QA issue on the same field
 * or photo, and an earlier approved photo deduction on the same QA review.
 */
export type RecordAiFacts = {
  scoreReviewId: string | null;
  coveredFieldIds: string[];
  coveredMediaIds: string[];
  /** AI analyses that already deducted from the authoritative QA review. */
  deductedAnalysisIds: string[];
};

export type InspectionRecord = {
  assignmentId: string;
  jobId: string;
  jobNumber: string | null;
  jobStatus: string;
  propertyName: string;
  jobTypeLabel: string;
  /** Calendar day of the clean (yyyy-MM-dd), not shifted by any viewer time zone. */
  serviceDate: string | null;
  cleanerNames: string[];
  inspectorName: string | null;
  checkIn: { at: string | null; method: "gps" | "remote" | "none"; reason: string | null };
  submittedAt: string | null;
  templateLabel: string;
  /** The verdict options this inspection was graded with, in order. */
  verdictOptions: string[];
  areas: RecordArea[];
  itemCount: number;
  issueCount: number;
  score: RecordScore | null;
  damage: RecordDamage[];
  nextClean: RecordNextClean[];
  evidence: RecordEvidence | null;
  whoFixes: RecordWhoFixes;
  signOff: RecordSignOff | null;
  reopen: RecordReopen;
  ai: RecordAiFacts;
  timeZone: string;
};
