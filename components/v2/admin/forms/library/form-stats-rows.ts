/**
 * Rows of the Results and stats question table (board "Forms: results and
 * stats"): answered, skipped, the result in words and "QA issues after", plus
 * the question sort. Unknown is never written as zero: "–" when a figure
 * cannot be told, "None" only when the count is a real zero, and "No
 * submissions yet" instead of "0 photos average".
 *
 * PURE (plain module, safe from server pages).
 */
import { isUploadFieldType } from "@/lib/forms/field-types";

export type QuestionSort = "order" | "skipped" | "no" | "issues";
export const QUESTION_SORTS: ReadonlyArray<{ key: QuestionSort; label: string }> = [
  { key: "order", label: "Form order" },
  { key: "skipped", label: "Most skipped" },
  { key: "no", label: "Most \"No\"" },
  { key: "issues", label: "Most issues" },
];

export function parseQuestionSort(value: string | undefined): QuestionSort {
  return QUESTION_SORTS.some((sort) => sort.key === value) ? (value as QuestionSort) : "order";
}

export type QuestionStatInput = {
  id: string;
  label: string;
  type: string;
  sectionLabel: string;
  locationTag?: string;
  conditionNote: string | null;
  rotational: boolean;
  answered: number;
  shown: number | null;
  skipped: number | null;
  photoTotal: number;
  yesCount: number;
  noCount: number;
  ratingSum: number;
  ratingCount: number;
  details: string[];
};

export type AreaIssues = { count: number; confirmedFalse: number; topCategory: string | null; topCleaner: { name: string; count: number } | null };

export type QaAfterLookup =
  | { status: "ready"; byArea: ReadonlyMap<string, AreaIssues> }
  | { status: "failed" };

export type QuestionRow = {
  id: string;
  label: string;
  sub: string;
  typeLabel: string;
  answeredPct: number | null;
  answeredText: string;
  skippedText: string;
  skipped: number | null;
  noRate: number | null;
  result: string;
  resultTone: "bad" | null;
  resultDetail: string | null;
  qaCount: number | null;
  qaText: string;
  qaNote: string | null;
  /** Skipped often and followed by QA issues: the row's leading cell is tinted. */
  flagged: boolean;
  /** The one figure that matters on a phone card. */
  phonePill: { text: string; tone: "warn" | "bad" | "neutral" } | null;
  order: number;
};

const TYPE_LABELS: Record<string, string> = {
  photo: "Photo",
  video: "Video",
  file: "File",
  upload: "Photo",
  yesno: "Yes / No",
  checkbox: "Tick",
  number: "Number",
  counter: "Number",
  rating: "Rating",
  scale: "Scale",
  slider: "Scale",
  temperature: "Temperature",
  text: "Text",
  textarea: "Text",
  longtext: "Paragraph",
  select: "Choice",
  radio: "Choice",
  multiselect: "Choices",
  scan: "Scan",
  date: "Date",
  time: "Time",
  signature: "Signature",
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

export function topReasons(details: readonly string[], limit = 2): string {
  const counts = new Map<string, number>();
  for (const detail of details) counts.set(detail, (counts.get(detail) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => (count > 1 ? `"${text}" (×${count})` : `"${text}"`))
    .join(" · ");
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

function resultFor(input: QuestionStatInput, parsed: number, weeks: number): { text: string; tone: "bad" | null; detail: string | null } {
  if (parsed === 0) return { text: "No submissions yet", tone: null, detail: null };
  const never = `Never answered in ${weeks} week${weeks === 1 ? "" : "s"}`;
  if (isUploadFieldType(input.type)) {
    if (input.answered === 0) return { text: never, tone: null, detail: null };
    const base = input.shown ?? parsed;
    return { text: `${(input.photoTotal / Math.max(1, base)).toFixed(1)} photos average`, tone: null, detail: null };
  }
  if (input.type === "yesno" || input.type === "checkbox") {
    const answered = input.yesCount + input.noCount;
    if (answered === 0) return { text: never, tone: null, detail: null };
    const rate = pct(input.noCount, answered) ?? 0;
    const reasons = topReasons(input.details);
    return { text: `${rate}% No`, tone: input.noCount > 0 ? "bad" : null, detail: reasons || null };
  }
  if (input.ratingCount > 0) {
    const average = (input.ratingSum / input.ratingCount).toFixed(1);
    return { text: `Average ${average}`, tone: null, detail: null };
  }
  if (input.answered === 0) return { text: never, tone: null, detail: null };
  return { text: `${input.answered} answer${input.answered === 1 ? "" : "s"}`, tone: null, detail: null };
}

function qaFor(input: QuestionStatInput, parsed: number, lookup: QaAfterLookup): { count: number | null; text: string; note: string | null } {
  if (!input.locationTag) return { count: null, text: "–", note: "No area tag" };
  if (lookup.status === "failed") return { count: null, text: "–", note: "Could not be read" };
  if (parsed === 0) return { count: null, text: "–", note: null };
  const area = lookup.byArea.get(input.locationTag);
  if (!area || area.count === 0) return { count: 0, text: "None", note: null };
  const notes: string[] = [];
  if (area.topCategory) notes.push(area.topCleaner ? `${area.topCategory}, ${area.topCleaner.count} by ${area.topCleaner.name}` : area.topCategory);
  else if (area.topCleaner) notes.push(`${area.topCleaner.count} by ${area.topCleaner.name}`);
  if (area.confirmedFalse > 0) notes.push(`${area.confirmedFalse} confirmed false confirmation${area.confirmedFalse === 1 ? "" : "s"}`);
  return { count: area.count, text: String(area.count), note: notes.join(" · ") || null };
}

export function buildQuestionRows(input: { questions: readonly QuestionStatInput[]; parsed: number; weeks: number; qaAfter: QaAfterLookup }): QuestionRow[] {
  return input.questions.map((question, order) => {
    const base = question.shown ?? input.parsed;
    const answeredPct = input.parsed === 0 ? null : pct(question.answered, base);
    const result = resultFor(question, input.parsed, input.weeks);
    const qa = qaFor(question, input.parsed, input.qaAfter);
    const skipRate = question.skipped !== null && question.shown ? question.skipped / question.shown : null;
    const yesNoTotal = question.yesCount + question.noCount;
    const noRate = yesNoTotal > 0 ? question.noCount / yesNoTotal : null;
    const skippedText = input.parsed === 0 || question.skipped === null ? "–" : question.skipped === 0 ? "None" : String(question.skipped);
    const sub = [question.locationTag ?? question.sectionLabel, question.conditionNote ?? (question.rotational ? "on some cleans" : "every clean")].join(" · ");
    let phonePill: QuestionRow["phonePill"] = null;
    if (input.parsed > 0 && question.answered === 0) phonePill = { text: "Never answered", tone: "neutral" };
    else if (noRate !== null && question.noCount > 0) phonePill = { text: `${Math.round(noRate * 100)}% No`, tone: "bad" };
    else if (question.skipped !== null && question.skipped > 0) phonePill = { text: `Skipped ${question.skipped}`, tone: "warn" };
    return {
      id: question.id,
      label: question.label,
      sub,
      typeLabel: typeLabel(question.type),
      answeredPct,
      answeredText: answeredPct === null ? "–" : `${answeredPct}%`,
      skippedText,
      skipped: input.parsed === 0 ? null : question.skipped,
      noRate,
      result: result.text,
      resultTone: result.tone,
      resultDetail: result.detail,
      qaCount: qa.count,
      qaText: qa.text,
      qaNote: qa.note,
      flagged: skipRate !== null && skipRate >= 0.1 && (qa.count ?? 0) > 0,
      phonePill,
      order,
    };
  });
}

/** Unknown values sort last; ties keep form order. */
export function sortQuestionRows(rows: readonly QuestionRow[], sort: QuestionSort): QuestionRow[] {
  const key = (row: QuestionRow): number | null => (sort === "skipped" ? row.skipped : sort === "no" ? row.noRate : sort === "issues" ? row.qaCount : row.order);
  if (sort === "order") return rows.slice().sort((a, b) => a.order - b.order);
  return rows.slice().sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null && kb === null) return a.order - b.order;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return kb - ka || a.order - b.order;
  });
}

/** "2 h 41" / "38 min" / "Not tracked". */
export function formatCompletion(minutes: number | null): string {
  if (minutes === null) return "Not tracked";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h ${String(rest).padStart(2, "0")}`;
}

/** A Results and stats URL (the tab plus its form, range, sort and "Show all"). */
export function statsHref(params: { templateId?: string; weeks?: number; qsort?: string; qall?: boolean }): string {
  const search = new URLSearchParams({ tab: "stats" });
  if (params.templateId) search.set("templateId", params.templateId);
  if (params.weeks) search.set("weeks", String(params.weeks));
  if (params.qsort && params.qsort !== "order") search.set("qsort", params.qsort);
  if (params.qall) search.set("qall", "1");
  return `/v2/admin/forms?${search.toString()}`;
}
