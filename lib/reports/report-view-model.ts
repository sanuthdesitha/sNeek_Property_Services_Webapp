// Pure data-shaping for the "Estate" job report template.
//
// buildReportViewModel maps a loaded job (+ latest form submission, QA review
// and QA form submission) into a render-ready view model so the HTML template
// stays thin and this mapping stays unit-testable. No DB, no I/O — the only
// injection point is `resolveKeyUrl` (S3 key → public URL) so tests don't need
// the s3 module.
//
// Rendering rule for unanswered fields (stated + enforced here): every field
// that is VISIBLE under the form's conditional rules is rendered; unanswered
// fields show an em dash ("—"). Nothing the cleaner filled in may be dropped.

import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  formatFieldValue,
  isUploadFieldType,
  isReadOnlyFieldType,
} from "@/lib/forms/field-types";
import {
  isTemplateConditionalMet,
  flattenFieldsOneLevel,
  isFlattenedFieldVisible,
} from "@/lib/forms/visibility";
import { QA_TOOLS_DATA_KEY } from "@/lib/qa/inspection-tools";

const TZ = "Australia/Sydney";
const UNANSWERED = "—"; // em dash

export type ReportMediaVM = {
  id: string;
  url: string;
  isVideo: boolean;
  caption: string;
  timestamp: string | null;
};

export type ReportFieldVM = {
  id: string;
  label: string;
  type: string;
  kind:
    | "checkbox"
    | "yesno"
    | "rating"
    | "signature"
    | "instruction"
    | "media"
    | "longtext"
    | "value";
  /** Formatted display value; em dash when unanswered. */
  value: string;
  answered: boolean;
  checked?: boolean;
  yesNo?: "yes" | "no" | "na";
  rating?: { value: number; max: number };
  signatureDataUrl?: string;
  isChild: boolean;
  media: ReportMediaVM[];
};

export type ReportSectionVM = {
  id: string;
  label: string;
  fields: ReportFieldVM[];
  answeredCount: number;
  answerableCount: number;
  photoCount: number;
};

export type ReportTaskVM = {
  title: string;
  description: string;
  statusLabel: string;
  statusTone: "good" | "bad" | "neutral";
  note: string;
  noteLabel: string;
  meta: string;
  media: ReportMediaVM[];
};

export type ReportQaVM = {
  score: number | null;
  passed: boolean | null;
  notes: string;
  damage: Array<{ area: string; severity: string; description: string }>;
  photoUrls: string[];
} | null;

export type ReportStatVM = { label: string; value: string; sub?: string };
export type ReportFlagVM = { label: string; tone: "warn" | "info" | "good" };

export type ReportLaundryVM = {
  readyLabel: string;
  outcome: string | null;
  bagLocation: string | null;
  skipReason: string | null;
} | null;

export type ReportReworkAreaVM = {
  label: string;
  note: string;
  photoUrls: string[];
};

export type ReportViewModel = {
  propertyName: string;
  propertyAddress: string;
  jobNumber: string;
  jobTypeLabel: string;
  isRework: boolean;
  dateLabel: string;
  cleaners: string[];
  submittedBy: string;
  submittedAtLabel: string | null;
  stats: ReportStatVM[];
  flags: ReportFlagVM[];
  sections: ReportSectionVM[];
  adminTasks: ReportTaskVM[];
  jobTasks: ReportTaskVM[];
  laundry: ReportLaundryVM;
  stockUsed: Array<{ name: string; quantity: number }>;
  reworkReason: string | null;
  reworkAreas: ReportReworkAreaVM[];
  selfInspectionIncomplete: string[];
  qa: ReportQaVM;
  /** Media not attached to any rendered field or task. */
  extraMedia: ReportMediaVM[];
};

export type BuildReportViewModelInput = {
  job: any;
  submission: any;
  qa?: any;
  qaSubmission?: any;
  /** Preformatted job date label (e.g. "12 July 2026"). */
  localDate: string;
  /** S3 key → public URL. Defaults to identity (tests). */
  resolveKeyUrl?: (key: string) => string;
  /** Include the client-safe QA summary section. */
  includeQa?: boolean;
};

function fmtSydney(value: unknown, pattern: string): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return format(toZonedTime(date, TZ), pattern);
}

function isBalconyLikeField(field: any): boolean {
  const text = `${String(field?.id ?? "")} ${String(field?.label ?? "")}`.toLowerCase();
  return text.includes("balcony");
}

function isFieldVisible(
  field: any,
  answers: Record<string, unknown>,
  property: Record<string, unknown>
): boolean {
  if (property?.hasBalcony !== true && isBalconyLikeField(field)) return false;
  return (
    isTemplateConditionalMet(field?.conditional, answers, property) &&
    isFlattenedFieldVisible(field, answers, property)
  );
}

function toMediaVM(row: any, fallbackCaption: string): ReportMediaVM {
  return {
    id: String(row?.id ?? ""),
    url: String(row?.url ?? ""),
    isVideo: String(row?.mediaType ?? "").toUpperCase() === "VIDEO",
    caption: String(row?.label ?? fallbackCaption ?? "").trim() || fallbackCaption,
    timestamp: fmtSydney(row?.createdAt, "d MMM yyyy, h:mm aaa"),
  };
}

function classifyField(field: any, answers: Record<string, unknown>): ReportFieldVM {
  const id = String(field?.id ?? "");
  const label = String(field?.label ?? id ?? UNANSWERED);
  const type = String(field?.type ?? "text");
  const raw = answers[id];

  const base: ReportFieldVM = {
    id,
    label,
    type,
    kind: "value",
    value: UNANSWERED,
    answered: false,
    isChild: Boolean(field?._isChild),
    media: [],
  };

  if (isReadOnlyFieldType(type)) {
    // The builder stores an instruction block's body in `helpText`; legacy
    // templates used `description`/`text`. Reading only the legacy keys printed
    // every builder-authored instruction as an empty block.
    return {
      ...base,
      kind: "instruction",
      value: String(field?.description ?? field?.text ?? field?.helpText ?? ""),
    };
  }

  if (type === "checkbox") {
    const checked = raw === true || raw === "true" || raw === "yes";
    return {
      ...base,
      kind: "checkbox",
      checked,
      answered: raw !== undefined && raw !== null && raw !== "",
      value: checked ? "Yes" : raw === false || raw === "false" ? "No" : UNANSWERED,
    };
  }

  if (type === "yesno") {
    // Yes/No is stored as a boolean, but "yes"/"no" strings exist in
    // submissions written before the cleaner renderer was aligned — read both,
    // or a genuinely answered question prints as unanswered in the report.
    const na = raw === "na" || raw === "NA" || raw === "N/A";
    const yes = raw === true || raw === "true" || raw === "yes";
    const no = raw === false || raw === "false" || raw === "no";
    const answered = na || yes || no;
    return {
      ...base,
      kind: "yesno",
      yesNo: na ? "na" : yes ? "yes" : no ? "no" : undefined,
      answered,
      value: answered ? (na ? "N/A" : yes ? "Yes" : "No") : UNANSWERED,
    };
  }

  if (type === "rating" || type === "scale" || type === "slider") {
    const num = Number(raw);
    const answered = raw !== undefined && raw !== null && raw !== "" && Number.isFinite(num);
    const max = Number(field?.max);
    return {
      ...base,
      kind: "rating",
      answered,
      rating: answered
        ? { value: num, max: Number.isFinite(max) && max > 0 ? max : 5 }
        : undefined,
      value: answered ? formatFieldValue(field, raw) : UNANSWERED,
    };
  }

  if (type === "signature") {
    const dataUrl =
      typeof raw === "string" && raw.trim().startsWith("data:image/") ? raw.trim() : undefined;
    return {
      ...base,
      kind: "signature",
      signatureDataUrl: dataUrl,
      answered: Boolean(dataUrl),
      value: dataUrl ? "Signed" : UNANSWERED,
    };
  }

  if (isUploadFieldType(type)) {
    return { ...base, kind: "media", answered: false, value: UNANSWERED };
  }

  if (type === "longtext") {
    const answered = raw !== undefined && raw !== null && String(raw).trim() !== "";
    return {
      ...base,
      kind: "longtext",
      answered,
      value: answered ? String(raw) : UNANSWERED,
    };
  }

  const formatted = formatFieldValue(field, raw);
  const answered = formatted !== "-" && formatted !== "";
  return { ...base, kind: "value", answered, value: answered ? formatted : UNANSWERED };
}

function buildSections(
  job: any,
  submission: any,
  usedMediaIds: Set<string>
): ReportSectionVM[] {
  const data = submission?.data && typeof submission.data === "object" ? submission.data : {};
  const templateSchema =
    data.__templateSchema && typeof data.__templateSchema === "object"
      ? data.__templateSchema
      : submission?.template?.schema;
  const sections = Array.isArray(templateSchema?.sections) ? templateSchema.sections : [];
  const property = job?.property ?? {};
  const media: any[] = Array.isArray(submission?.media) ? submission.media : [];

  const out: ReportSectionVM[] = [];
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    if (property?.hasBalcony !== true && isBalconyLikeField(section)) continue;
    if (!isTemplateConditionalMet(section?.conditional, data, property)) continue;

    const flat = flattenFieldsOneLevel(Array.isArray(section.fields) ? section.fields : []).filter(
      (field: any) => field?.id && isFieldVisible(field, data, property)
    );
    if (flat.length === 0) continue;

    const fields: ReportFieldVM[] = flat.map((field: any) => {
      const vm = classifyField(field, data);
      const rows = media.filter((m) => String(m?.fieldId ?? "") === vm.id);
      vm.media = rows.map((m) => toMediaVM(m, vm.label));
      rows.forEach((m) => m?.id && usedMediaIds.add(String(m.id)));
      if (vm.kind === "media") {
        vm.answered = vm.media.length > 0;
        vm.value = vm.media.length > 0 ? `${vm.media.length} file(s)` : UNANSWERED;
      }
      return vm;
    });

    const answerable = fields.filter((f) => f.kind !== "instruction");
    out.push({
      id: String(section.id ?? section.label ?? section.title ?? `section-${out.length}`),
      // Canonical heading key is `title` (normalize-schema maps legacy `label` →
      // `title`); reading only `label` labelled every modern section "Section".
      label: String(section.label ?? section.title ?? "Section"),
      fields,
      answeredCount: answerable.filter((f) => f.answered).length,
      answerableCount: answerable.length,
      photoCount: fields.reduce((n, f) => n + f.media.filter((m) => !m.isVideo).length, 0),
    });
  }
  return out;
}

function buildTasks(
  rawTasks: unknown,
  submission: any,
  usedMediaIds: Set<string>,
  variant: "admin" | "job"
): ReportTaskVM[] {
  const tasks = Array.isArray(rawTasks)
    ? rawTasks.filter((t: any) => t && typeof t === "object")
    : [];
  const media: any[] = Array.isArray(submission?.media) ? submission.media : [];

  return tasks.map((task: any) => {
    const proofFieldId = String(
      (variant === "admin" ? task.photoFieldId : task.proofFieldId) ?? ""
    );
    const rows = proofFieldId ? media.filter((m) => String(m?.fieldId ?? "") === proofFieldId) : [];
    rows.forEach((m) => m?.id && usedMediaIds.add(String(m.id)));

    let statusLabel: string;
    let statusTone: "good" | "bad" | "neutral";
    let noteLabel = "Cleaner note";
    if (variant === "admin") {
      statusLabel = task.completed ? "Completed" : "Incomplete";
      statusTone = task.completed ? "good" : "bad";
    } else {
      const decision = String(task.decision ?? "OPEN");
      statusLabel =
        decision === "NOT_COMPLETED"
          ? "Not completed"
          : decision === "COMPLETED"
            ? "Completed"
            : decision.replace(/_/g, " ");
      statusTone = decision === "COMPLETED" ? "good" : decision === "NOT_COMPLETED" ? "bad" : "neutral";
      if (decision === "NOT_COMPLETED") noteLabel = "Reason";
    }

    const metaParts: string[] = [];
    if (variant === "admin") {
      if (task.requiresPhoto) metaParts.push("Photo proof required");
      if (task.requiresNote) metaParts.push("Note required");
    } else {
      if (task.source) metaParts.push(`Source: ${String(task.source).replace(/_/g, " ")}`);
      if (task.approvalStatus) metaParts.push(String(task.approvalStatus).replace(/_/g, " "));
    }

    const title = String(task.title ?? (variant === "admin" ? "Admin requested task" : "Job task"));
    return {
      title,
      description: String(task.description ?? ""),
      statusLabel,
      statusTone,
      note: typeof task.note === "string" ? task.note.trim() : "",
      noteLabel,
      meta: metaParts.join(" · "),
      media: rows.map((m) => toMediaVM(m, title)),
    };
  });
}

/**
 * Client-safe QA summary — mirrors the exclusions in the legacy
 * buildQaSummaryHtml: score, pass/fail, inspector notes, compact damage
 * findings (no costs) and section photos. Internal pay/rework figures and
 * cleaner-blame detail stay OUT of the client report.
 */
function buildQa(
  qa: any,
  qaSubmission: any,
  resolveKeyUrl: (key: string) => string
): ReportQaVM {
  const data =
    qaSubmission?.data && typeof qaSubmission.data === "object"
      ? (qaSubmission.data as Record<string, unknown>)
      : {};
  const tools =
    data[QA_TOOLS_DATA_KEY] && typeof data[QA_TOOLS_DATA_KEY] === "object"
      ? (data[QA_TOOLS_DATA_KEY] as Record<string, any>)
      : null;

  const score = qa?.score ?? qaSubmission?.score ?? null;
  const passed = qa?.passed ?? qaSubmission?.passed ?? null;
  const notes = String(qa?.notes ?? qaSubmission?.notes ?? "").trim();

  const sectionPhotos: Record<string, unknown> =
    tools?.sectionPhotos && typeof tools.sectionPhotos === "object" ? tools.sectionPhotos : {};
  const photoUrls: string[] = [];
  for (const value of Object.values(sectionPhotos)) {
    if (!Array.isArray(value)) continue;
    for (const key of value) {
      if (typeof key === "string" && key.trim()) photoUrls.push(resolveKeyUrl(key));
    }
  }

  const damage = (Array.isArray(tools?.damage) ? tools.damage : [])
    .filter((d: any) => d && (d.area || d.description))
    .map((d: any) => ({
      area: String(d.area ?? UNANSWERED),
      severity: String(d.severity ?? ""),
      description: String(d.description ?? UNANSWERED),
    }));

  if (score == null && !notes && damage.length === 0 && photoUrls.length === 0) return null;
  return { score: score == null ? null : Number(score), passed, notes, damage, photoUrls };
}

export function buildReportViewModel(input: BuildReportViewModelInput): ReportViewModel {
  const { job, submission, qa, qaSubmission, localDate } = input;
  const resolveKeyUrl = input.resolveKeyUrl ?? ((key: string) => key);
  const data = submission?.data && typeof submission.data === "object" ? submission.data : {};
  const media: any[] = Array.isArray(submission?.media) ? submission.media : [];

  const usedMediaIds = new Set<string>();
  const sections = buildSections(job, submission, usedMediaIds);
  const adminTasks = buildTasks(data.__adminRequestedTasks, submission, usedMediaIds, "admin");
  const jobTasks = buildTasks(data.__jobTasks, submission, usedMediaIds, "job");

  const extraMedia = media
    .filter((m) => !usedMediaIds.has(String(m?.id ?? "")))
    .map((m) => toMediaVM(m, String(m?.fieldId ?? "Evidence").replace(/_/g, " ")));

  const photoCount = media.filter(
    (m) => String(m?.mediaType ?? "").toUpperCase() !== "VIDEO"
  ).length;
  const videoCount = media.length - photoCount;

  const stockUsed = (Array.isArray(submission?.stockTxs) ? submission.stockTxs : [])
    .filter((tx: any) => Number(tx?.quantity) < 0)
    .map((tx: any) => ({
      name: String(tx?.propertyStock?.item?.name ?? tx?.propertyStock?.itemId ?? "Item"),
      quantity: Math.abs(Number(tx.quantity)),
    }));

  const laundry: ReportLaundryVM =
    submission && (submission.laundryReady != null || submission.laundryOutcome || submission.bagLocation)
      ? {
          readyLabel:
            submission.laundryReady === true
              ? "Yes"
              : submission.laundryReady === false
                ? "No"
                : UNANSWERED,
          outcome: submission.laundryOutcome
            ? String(submission.laundryOutcome).replace(/_/g, " ")
            : null,
          bagLocation: submission.bagLocation ? String(submission.bagLocation) : null,
          skipReason: submission.laundrySkipReasonNote
            ? String(submission.laundrySkipReasonNote)
            : submission.laundrySkipReasonCode
              ? String(submission.laundrySkipReasonCode).replace(/_/g, " ")
              : null,
        }
      : null;

  const selfInspectionIncomplete = Array.isArray(data.__selfInspectionIncomplete)
    ? data.__selfInspectionIncomplete.map((k: unknown) => String(k))
    : [];

  const reworkAreas: ReportReworkAreaVM[] = (Array.isArray(job?.reworkAreas) ? job.reworkAreas : [])
    .filter((a: any) => a && typeof a === "object")
    .map((a: any) => ({
      label: String(a.label ?? a.id ?? "Flagged area"),
      note: String(a.note ?? ""),
      photoUrls: (Array.isArray(a.photoKeys) ? a.photoKeys : [])
        .filter((k: unknown) => typeof k === "string" && (k as string).trim())
        .map((k: string) => resolveKeyUrl(k)),
    }));

  const qaVm = input.includeQa === false ? null : buildQa(qa, qaSubmission, resolveKeyUrl);

  // ── At-a-glance stats ─────────────────────────────────────────────────────
  const arrived = fmtSydney(job?.gpsCheckInAt, "h:mm aaa");
  const finished = fmtSydney(job?.gpsCheckOutAt ?? job?.completedAt, "h:mm aaa");
  const submittedAtLabel = fmtSydney(submission?.createdAt, "d MMM yyyy, h:mm aaa");
  const durationLabel =
    typeof job?.actualHours === "number" && Number.isFinite(job.actualHours) && job.actualHours > 0
      ? `${job.actualHours.toFixed(1)} h`
      : null;

  const totalAnswerable = sections.reduce((n, s) => n + s.answerableCount, 0);
  const totalAnswered = sections.reduce((n, s) => n + s.answeredCount, 0);
  const openTaskCount =
    adminTasks.filter((t) => t.statusTone === "bad").length +
    jobTasks.filter((t) => t.statusTone === "bad").length;
  const issueCount = (qaVm?.damage.length ?? 0) + openTaskCount + selfInspectionIncomplete.length;

  const stats: ReportStatVM[] = [
    {
      label: "Checklist completed",
      value: totalAnswerable > 0 ? `${totalAnswered}/${totalAnswerable}` : UNANSWERED,
      sub: `${sections.length} section${sections.length === 1 ? "" : "s"}`,
    },
    {
      label: "Evidence captured",
      value: String(photoCount),
      sub: videoCount > 0 ? `photos + ${videoCount} video${videoCount === 1 ? "" : "s"}` : "photos",
    },
    { label: "Issues reported", value: String(issueCount), sub: issueCount === 0 ? "all clear" : "see details" },
    {
      label: "Timing",
      value: arrived && finished ? `${arrived} – ${finished}` : (arrived ?? finished ?? UNANSWERED),
      sub: durationLabel ?? undefined,
    },
  ];

  const flags: ReportFlagVM[] = [];
  if (qaVm && qaVm.damage.length > 0) flags.push({ label: "Damage reported", tone: "warn" });
  if (stockUsed.length > 0) flags.push({ label: "Supplies used / restock", tone: "info" });
  if (laundry?.readyLabel === "Yes") flags.push({ label: "Laundry ready", tone: "good" });
  if (selfInspectionIncomplete.length > 0)
    flags.push({ label: "Self-inspection incomplete", tone: "warn" });
  if (openTaskCount > 0) flags.push({ label: "Tasks not completed", tone: "warn" });
  if (job?.isRework) flags.push({ label: "Rework visit", tone: "info" });

  return {
    propertyName: String(job?.property?.name ?? ""),
    propertyAddress: [job?.property?.address, job?.property?.suburb]
      .filter(Boolean)
      .map(String)
      .join(", "),
    jobNumber: String(job?.jobNumber ?? job?.id ?? ""),
    jobTypeLabel: String(job?.jobType ?? "").replace(/_/g, " "),
    isRework: Boolean(job?.isRework),
    dateLabel: localDate,
    cleaners: (Array.isArray(job?.assignments) ? job.assignments : [])
      .map((a: any) => String(a?.user?.name ?? "").trim())
      .filter(Boolean),
    submittedBy: String(submission?.submittedBy?.name ?? "Unknown"),
    submittedAtLabel,
    stats,
    flags,
    sections,
    adminTasks,
    jobTasks,
    laundry,
    stockUsed,
    reworkReason: job?.reworkReason ? String(job.reworkReason) : null,
    reworkAreas,
    selfInspectionIncomplete,
    qa: qaVm,
    extraMedia,
  };
}
