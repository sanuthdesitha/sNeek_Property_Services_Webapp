/**
 * Pure pieces of the inspection record (board "QualityInspection"): findings
 * grouped by area, the score lines, and the "Who fixes it" timeline read from
 * the stored rework offer, rework jobs and rework transfers. No database here,
 * so each rule is tested on its own (tests/lib/quality-inspection-record.test.ts).
 *
 * Nothing is inferred: an item without a stored issue is "no issue recorded"
 * (Pass and N/A are not stored separately), and a step without a stored time
 * keeps a null time instead of a made-up one.
 */
import { formatInTimeZone } from "date-fns-tz";
import { countIssuesByVerdict, qaIssueVerdictLabel } from "@/lib/qa/verdict-scale";
import type {
  RecordArea,
  RecordIssue,
  RecordItem,
  RecordScoreLine,
  RecordTimelineEvent,
  RecordTone,
  RecordWhoFixes,
} from "./inspection-record-types";
import { formatAud, isFixedStatus } from "./issue-presentation";

/** Field types the inspection never grades (display-only). */
const UNGRADED_FIELD_TYPES = new Set(["signature", "instruction", "inventory"]);

type SchemaField = { id: string; label: string };
type SchemaSection = { id: string; title: string; fields: SchemaField[] };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The template's sections and graded fields, defensively (older snapshots vary). */
export function readTemplateSections(schema: unknown): SchemaSection[] {
  const sections = asRecord(schema)?.sections;
  if (!Array.isArray(sections)) return [];
  const result: SchemaSection[] = [];
  sections.forEach((raw, index) => {
    const section = asRecord(raw);
    if (!section) return;
    const fields: SchemaField[] = [];
    for (const rawField of Array.isArray(section.fields) ? section.fields : []) {
      const field = asRecord(rawField);
      if (!field || typeof field.id !== "string" || !field.id) continue;
      if (typeof field.type === "string" && UNGRADED_FIELD_TYPES.has(field.type)) continue;
      fields.push({ id: field.id, label: typeof field.label === "string" && field.label.trim() ? field.label.trim() : field.id });
    }
    const id = typeof section.id === "string" && section.id ? section.id : `section-${index + 1}`;
    const title = typeof section.title === "string" && section.title.trim() ? section.title.trim() : `Section ${index + 1}`;
    result.push({ id, title, fields });
  });
  return result;
}

export type IssueForArea = RecordIssue & { fieldId: string | null };

/**
 * Areas in template order with each graded item and its stored issue. Issues
 * whose field is not in the template (a later template, or raised from a case)
 * are kept in an "Other findings" area so none disappears.
 */
export function buildRecordAreas(schema: unknown, issues: readonly IssueForArea[]): RecordArea[] {
  const byField = new Map<string, IssueForArea[]>();
  for (const issue of issues) {
    const key = issue.fieldId ?? "";
    byField.set(key, [...(byField.get(key) ?? []), issue]);
  }
  const placed = new Set<string>();
  const areas: RecordArea[] = readTemplateSections(schema).map((section) => {
    const items = section.fields.flatMap((field): RecordItem[] => {
      const fieldIssues = byField.get(field.id) ?? [];
      fieldIssues.forEach((issue) => placed.add(issue.id));
      if (fieldIssues.length === 0) return [{ fieldId: field.id, label: field.label, issue: null }];
      return fieldIssues.map((issue) => ({ fieldId: field.id, label: field.label, issue: stripField(issue) }));
    });
    return { id: section.id, title: section.title, items, issueCount: items.filter((item) => item.issue).length };
  }).filter((area) => area.items.length > 0);
  const orphans = issues.filter((issue) => !placed.has(issue.id));
  if (orphans.length > 0) {
    areas.push({
      id: "other-findings",
      title: "Other findings",
      items: orphans.map((issue) => ({ fieldId: issue.fieldId ?? issue.id, label: issue.categoryLabel, issue: stripField(issue) })),
      issueCount: orphans.length,
    });
  }
  return areas;
}

function stripField(issue: IssueForArea): RecordIssue {
  const { fieldId: _fieldId, ...rest } = issue;
  return rest;
}

/** The verdict option a stored issue stands for, on the scale it was graded with. */
export function issueVerdictKey(issue: { severity: string; failVerdict?: boolean | null }): string {
  if (issue.failVerdict) return "FAIL";
  return issue.severity;
}

export { qaIssueVerdictLabel };

/**
 * Counts of the stored issues by verdict (FAIL scale: Minor, Fail, Fail ·
 * serious; earlier scale: Minor, Major, Critical; history labels appear only
 * when present), and false confirmations still standing (suspected or
 * confirmed; a rejected one was given back). Points are not shown: the
 * deduction settings in force when it was graded are not stored.
 */
export function buildScoreLines(
  issues: ReadonlyArray<{ severity: string; failVerdict?: boolean | null; serious?: boolean | null; falseConfirmation: string }>,
  verdictScale: "FAIL" | "MAJOR_CRITICAL",
): RecordScoreLine[] {
  const counts = countIssuesByVerdict(issues);
  const lines: RecordScoreLine[] = [{ label: "Minor", count: counts.minor }];
  if (verdictScale === "FAIL") {
    lines.push({ label: "Fail", count: counts.fail }, { label: "Fail · serious", count: counts.seriousFail });
    if (counts.major) lines.push({ label: "Major", count: counts.major });
    if (counts.critical) lines.push({ label: "Critical", count: counts.critical });
  } else {
    lines.push({ label: "Major", count: counts.major }, { label: "Critical", count: counts.critical });
    if (counts.fail) lines.push({ label: "Fail", count: counts.fail });
    if (counts.seriousFail) lines.push({ label: "Fail · serious", count: counts.seriousFail });
  }
  const standing = issues.filter((issue) => issue.falseConfirmation === "SUSPECTED" || issue.falseConfirmation === "CONFIRMED").length;
  lines.push({ label: "False confirmations", count: standing });
  return lines;
}

const RATING: Readonly<Record<string, { label: string; tone: RecordTone }>> = {
  EXCELLENT: { label: "Excellent", tone: "ok" },
  PASS: { label: "Pass", tone: "ok" },
  NEEDS_IMPROVEMENT: { label: "Needs work", tone: "warn" },
  FAILED: { label: "Failed", tone: "bad" },
  MANAGEMENT_REVIEW: { label: "Management review", tone: "bad" },
};

export function ratingPresentation(rating: string | null, passed: boolean): { label: string; tone: RecordTone } {
  if (rating && RATING[rating]) return RATING[rating];
  return passed ? { label: "Passed", tone: "ok" } : { label: "Did not pass", tone: "warn" };
}

/* ── Who fixes it ───────────────────────────────────────────────────────── */

export type ReworkOfferFacts = {
  status: string | null;
  offeredAt: Date | null;
  expiresAt: Date | null;
};

export type ReworkJobFacts = {
  id: string;
  jobNumber: string | null;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  payAmount: number | null;
  /** Null = the same cleaner redoes it (no pay, no deduction). */
  deductFromName: string | null;
  assigneeNames: string[];
};

export type ReworkTransferFacts = {
  id: string;
  createdAt: Date;
  reviewedAt: Date | null;
  status: string;
  qaName: string;
  cleanerName: string;
  minutesFromCleaner: number;
  amountFromCleaner: number;
};

export type WhoFixesFacts = {
  originalCleanerName: string | null;
  offer: ReworkOfferFacts;
  reworkJobs: ReworkJobFacts[];
  transfers: ReworkTransferFacts[];
  /** The rework deduction from the original cleaner (source REWORK_DEDUCTION), if one exists. */
  deduction: { status: string; amount: number | null } | null;
  issues: ReadonlyArray<{ rectificationStatus: string }>;
  timeZone: string;
};

const DONE_JOB_STATUSES = new Set(["COMPLETED", "INVOICED"]);

function clock(value: Date, timeZone: string): string {
  return formatInTimeZone(value, timeZone, "EEE d MMM HH:mm");
}

function approvalWord(status: string): string {
  if (status === "APPROVED") return "approved";
  if (status === "REJECTED") return "declined";
  if (status === "PENDING") return "waiting for approval";
  return status.toLowerCase();
}

/** The "Who fixes it" timeline: what the records say happened, oldest first. */
export function buildWhoFixes(facts: WhoFixesFacts): RecordWhoFixes {
  const events: RecordTimelineEvent[] = [];
  const original = facts.originalCleanerName ?? "the cleaner";

  if (facts.offer.offeredAt) {
    const expiry = facts.offer.expiresAt ? `, expires ${clock(facts.offer.expiresAt, facts.timeZone)}` : "";
    events.push({ at: facts.offer.offeredAt.toISOString(), text: `Offered back to ${original}${expiry}. No pay, no deduction.` });
  }
  if (facts.offer.status === "EXPIRED") {
    events.push({ at: facts.offer.expiresAt?.toISOString() ?? null, text: "Not accepted in time; it came back to the office." });
  } else if (facts.offer.status === "DECLINED") {
    events.push({ at: null, text: `${original} declined the offer.` });
  } else if (facts.offer.status === "ACCEPTED") {
    events.push({ at: null, text: `${original} accepted the offer.` });
  }

  for (const job of facts.reworkJobs) {
    const who = job.assigneeNames.length ? job.assigneeNames.join(", ") : "nobody yet";
    const label = job.jobNumber ? `Rework ${job.jobNumber}` : "A rework job";
    const money =
      job.deductFromName && typeof job.payAmount === "number" && job.payAmount > 0
        ? ` ${formatAud(job.payAmount)}, same amount proposed as a deduction from ${job.deductFromName}.`
        : " No pay, no deduction.";
    events.push({ at: job.createdAt.toISOString(), text: `${label} for ${who}.${money}` });
    if (DONE_JOB_STATUSES.has(job.status)) {
      events.push({ at: job.completedAt?.toISOString() ?? null, text: `${who} finished the rework.` });
    }
  }

  for (const transfer of facts.transfers) {
    events.push({
      at: transfer.createdAt.toISOString(),
      text: `${transfer.qaName} fixed it on site: ${transfer.minutesFromCleaner} min and ${formatAud(transfer.amountFromCleaner)} from ${transfer.cleanerName}, ${approvalWord(transfer.status)}.`,
    });
  }

  events.sort((a, b) => {
    if (a.at === null || b.at === null) return 0;
    return a.at.localeCompare(b.at);
  });

  const fixedIssues = facts.issues.filter((issue) => isFixedStatus(issue.rectificationStatus)).length;
  const anyDone =
    facts.reworkJobs.some((job) => DONE_JOB_STATUSES.has(job.status)) ||
    facts.transfers.some((transfer) => transfer.status === "APPROVED") ||
    (facts.issues.length > 0 && fixedIssues === facts.issues.length);
  const anyOpen =
    facts.offer.status === "OFFERED" ||
    facts.reworkJobs.some((job) => !DONE_JOB_STATUSES.has(job.status)) ||
    facts.transfers.some((transfer) => transfer.status === "PENDING");

  let status: RecordWhoFixes["status"] = null;
  if (anyOpen) status = { label: "In progress", tone: "warn" };
  else if (anyDone) status = { label: "Fixed", tone: "ok" };

  const notes: string[] = [];
  if (facts.issues.length > 0) notes.push(`${fixedIssues} of ${facts.issues.length} issues recorded as fixed.`);
  if (facts.deduction) {
    notes.push(
      facts.deduction.status === "PENDING"
        ? `The deduction from ${original} waits in Approvals › Pay adjustments: Pending.`
        : `The deduction from ${original} was ${approvalWord(facts.deduction.status)} in Approvals.`,
    );
  }
  if (events.length === 0 && facts.issues.length === 0) notes.push("No rework was requested.");

  return { status, events, note: notes.length ? notes.join(" ") : null };
}
