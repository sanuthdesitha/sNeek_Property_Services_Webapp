/**
 * Reading FormSubmission answers for statistics. The definitions here are the
 * ones the Results and stats tab has always used (it imports them), so a
 * figure in the forms library means the same thing as on that tab:
 *
 *  - answered:   a non-empty value under the field id; for photo/video/file
 *                questions, at least one stored upload under `uploads[id]`
 *  - duration:   submission time minus the `__startedAt` / `startedAt` the
 *                cleaner app records, when that is a valid earlier instant
 *
 * PURE: no database.
 */
import { startOfWeek, subWeeks } from "date-fns";
import { isUploadFieldType } from "./field-types";
import { isBalconyLikeTemplateNode } from "./visibility";
import { isNode, schemaSections } from "./template-questions";

/** The stats tab's default range, used for the library's figures. */
export const STATS_DEFAULT_WEEKS = 8;
/** Fewer samples than this and a figure is shown as "–", never 0% or 100%. */
export const MIN_STATS_SAMPLE = 5;
/** Usage check: look back this far, and only with at least this many submissions. */
export const USAGE_CHECK_DAYS = 90;
export const USAGE_CHECK_MIN_SUBMISSIONS = 20;

export type SubmissionSample = { templateId: string; data: unknown; createdAt: Date };

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function isAnsweredValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Uploaded file count for one field, as stored under `data.uploads[fieldId]`. */
export function uploadCount(data: Record<string, unknown>, fieldId: string): number {
  const keys = asRecord(data.uploads)?.[fieldId];
  return Array.isArray(keys) ? keys.length : 0;
}

export function isFieldAnswered(data: Record<string, unknown>, fieldId: string, type: string): boolean {
  if (isUploadFieldType(type)) return uploadCount(data, fieldId) > 0;
  return isAnsweredValue(data[fieldId]);
}

/** Time from start to submit in ms, or null when the start was not recorded. */
export function submissionDurationMs(data: Record<string, unknown>, createdAt: Date): number | null {
  const startRaw = data.__startedAt ?? data.startedAt;
  if (typeof startRaw !== "string") return null;
  const startedAt = Date.parse(startRaw);
  if (!Number.isFinite(startedAt) || startedAt <= 0 || createdAt.getTime() <= startedAt) return null;
  return createdAt.getTime() - startedAt;
}

export function statsWindowStart(now: Date, weeks = STATS_DEFAULT_WEEKS): Date {
  return startOfWeek(subWeeks(now, weeks - 1), { weekStartsOn: 1 });
}

export type AlwaysShownQuestion = { id: string; label: string; type: string };

function isAlwaysShown(node: Record<string, unknown>): boolean {
  return (
    !isNode(node.conditional) &&
    node.frequency === undefined &&
    node.rotationEveryNCleans === undefined &&
    node.deviceStatus !== true &&
    !isBalconyLikeTemplateNode(node as { id?: unknown; label?: unknown })
  );
}

/**
 * Required questions every submission of this form must show: no condition on
 * the question or its section, no rotation, no device-status exception and no
 * balcony applicability. Only these can honestly be expected in every answer.
 */
export function alwaysShownRequiredQuestions(schema: unknown): AlwaysShownQuestion[] {
  const out: AlwaysShownQuestion[] = [];
  for (const section of schemaSections(schema)) {
    if (!isAlwaysShown(section)) continue;
    const fields = Array.isArray(section.fields) ? section.fields.filter(isNode) : [];
    for (const field of fields) {
      if (!isAlwaysShown(field)) continue;
      const type = typeof field.type === "string" ? field.type : "";
      if (field.required === true && typeof field.id === "string" && type !== "instruction") {
        out.push({ id: field.id, label: typeof field.label === "string" ? field.label : field.id, type });
      }
    }
  }
  return out;
}

export type TemplateUsageFigures = {
  /** Mean minutes from start to submit; null when fewer than MIN_STATS_SAMPLE timed submissions. */
  avgMinutes: number | null;
  timedSubmissions: number;
  /** Mean share (0–100) of always-shown required questions answered; null with too little data. */
  completionPct: number | null;
  submissionsInWindow: number;
  /** Always-shown required questions never answered (usage check), when the sample is large enough. */
  neverAnswered: AlwaysShownQuestion[];
  usageSample: number;
};

export function summariseTemplateUsage(input: {
  schema: unknown;
  samples: SubmissionSample[];
  now: Date;
  /** When the current live version went live; older answers are not held against new questions. */
  liveSince: Date | null;
}): TemplateUsageFigures {
  const windowStart = statsWindowStart(input.now);
  const usageStart = new Date(Math.max(input.now.getTime() - USAGE_CHECK_DAYS * 86_400_000, input.liveSince?.getTime() ?? 0));
  const questions = alwaysShownRequiredQuestions(input.schema);
  let durationSum = 0;
  let timed = 0;
  let inWindow = 0;
  let completionSum = 0;
  let usageSample = 0;
  const answeredInUsage = new Map<string, number>(questions.map((q) => [q.id, 0]));

  for (const sample of input.samples) {
    const data = asRecord(sample.data);
    if (!data) continue;
    if (sample.createdAt >= windowStart) {
      inWindow += 1;
      const duration = submissionDurationMs(data, sample.createdAt);
      if (duration !== null) {
        durationSum += duration;
        timed += 1;
      }
      if (questions.length > 0) {
        const answered = questions.filter((q) => isFieldAnswered(data, q.id, q.type)).length;
        completionSum += answered / questions.length;
      }
    }
    if (sample.createdAt >= usageStart) {
      usageSample += 1;
      for (const q of questions) {
        if (isFieldAnswered(data, q.id, q.type)) answeredInUsage.set(q.id, (answeredInUsage.get(q.id) ?? 0) + 1);
      }
    }
  }

  return {
    avgMinutes: timed >= MIN_STATS_SAMPLE ? Math.round(durationSum / timed / 60_000) : null,
    timedSubmissions: timed,
    completionPct: inWindow >= MIN_STATS_SAMPLE && questions.length > 0 ? Math.round((completionSum / inWindow) * 100) : null,
    submissionsInWindow: inWindow,
    neverAnswered:
      usageSample >= USAGE_CHECK_MIN_SUBMISSIONS ? questions.filter((q) => (answeredInUsage.get(q.id) ?? 0) === 0) : [],
    usageSample,
  };
}
