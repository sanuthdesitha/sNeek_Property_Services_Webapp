/**
 * Pure client-report data extraction — no db / server-only imports, so it is
 * unit-testable and reusable by the template engine (doc.clientReport, rebrand
 * doc 03 §4.2). These helpers were factored out of lib/reports/generator.ts so
 * the legacy report HTML and the v2 template render share ONE set of
 * visibility/value semantics (they cannot diverge). generator.ts imports them
 * back for buildChecklistHtml.
 */

import { formatFieldValue, isUploadFieldType } from "@/lib/forms/field-types";
import {
  isTemplateConditionalMet,
  flattenFieldsOneLevel,
  isFlattenedFieldVisible,
} from "@/lib/forms/visibility";

function isBalconyLikeField(field: any) {
  const text = `${String(field?.id ?? "")} ${String(field?.label ?? "")}`.toLowerCase();
  return text.includes("balcony");
}

function isConditionMet(conditional: any, answers: Record<string, unknown>, property: Record<string, unknown>) {
  // Delegate to the shared form-visibility engine so the report honours the
  // full operator set (notEquals/answered/oneOf/gt/lt/…) exactly as the cleaner
  // form and required-field enforcement do.
  return isTemplateConditionalMet(conditional, answers, property);
}

/** A section/field is visible in the report when its condition passes and the
 *  balcony gate allows it (balcony fields hidden when the property has none). */
export function isFieldVisibleInReport(
  field: any,
  conditional: any,
  answers: Record<string, unknown>,
  property: Record<string, unknown>,
) {
  if (property.hasBalcony !== true && isBalconyLikeField(field)) return false;
  return isConditionMet(conditional, answers, property);
}

function uploadCountForField(
  uploads: Record<string, unknown>,
  media: Array<{ fieldId: string }>,
  fieldId: string,
): number {
  const raw = uploads[fieldId];
  if (typeof raw === "string") return raw.trim() ? 1 : 0;
  if (Array.isArray(raw)) {
    return raw.filter((item) => typeof item === "string" && item.trim()).length;
  }
  return media.filter((item) => item.fieldId === fieldId).length;
}

/** Client-report display value for a field (upload counts, inventory, signature
 *  data-URI, else the shared formatter). Mirrors the legacy report exactly. */
export function buildFieldValue(
  field: any,
  context: { answers: Record<string, unknown>; uploads: Record<string, unknown>; submission: any },
) {
  const { answers, uploads, submission } = context;
  if (!field?.id) return "-";

  if (isUploadFieldType(field.type)) {
    const count = uploadCountForField(uploads, submission?.media ?? [], String(field.id));
    return count > 0 ? `${count} file(s)` : "Not uploaded";
  }

  if (field.type === "inventory") {
    const txs = (submission?.stockTxs ?? []).filter((tx: any) => tx.quantity < 0);
    if (txs.length === 0) return "No inventory recorded";
    return txs
      .map((tx: any) => `${tx.propertyStock?.item?.name ?? tx.propertyStock?.itemId ?? "Item"}: ${Math.abs(tx.quantity)}`)
      .join(", ");
  }

  if (field.type === "signature") {
    const value = answers[field.id];
    return typeof value === "string" && value.trim().startsWith("data:image/") ? value.trim() : "-";
  }

  return formatFieldValue(field, answers[field.id]);
}

/**
 * Normalized, template-facing shape for the doc.clientReport v2 kind
 * (rebrand doc 03 §4.2).
 */
export interface ClientReportData {
  report: {
    property: { name: string; suburb: string; jobType: string; cleanDate: string; cleaner: string; client: string };
    summary: { sections: number; photos: number; qaPassed: boolean | null };
    sections: Array<{
      title: string;
      items: Array<{
        label: string;
        checked?: boolean;
        value?: string;
        note?: string;
        media?: Array<{ url: string; type: "PHOTO" | "VIDEO"; caption?: string }>;
      }>;
    }>;
    photos: Array<{ url: string; type: "PHOTO" | "VIDEO"; caption?: string }>;
    qa: { score: number | null; passed: boolean | null; categories: Array<{ label: string; score: number }> } | null;
    hasQa: boolean;
  };
  actionUrl: string;
}

/**
 * Extract the normalized doc.clientReport data from the same job/submission/qa
 * inputs buildReportHtml consumes — reusing isFieldVisibleInReport /
 * buildFieldValue / flatten so the checklist semantics match legacy exactly.
 */
export function extractClientReportData(input: {
  job: any;
  submission: any;
  qa: any;
  qaSubmission: any;
  localDate: string;
  actionUrl?: string;
}): ClientReportData {
  const { job, submission, qa, qaSubmission, localDate } = input;
  const templateSchema =
    submission?.data && typeof submission.data === "object" && submission.data.__templateSchema && typeof submission.data.__templateSchema === "object"
      ? submission.data.__templateSchema
      : submission?.template?.schema;
  const schemaSections = Array.isArray(templateSchema?.sections) ? templateSchema.sections : [];
  const answers = submission?.data && typeof submission.data === "object" ? submission.data : {};
  const uploads = answers?.uploads && typeof answers.uploads === "object" ? answers.uploads : {};
  const property = job?.property ?? {};
  const allMedia: any[] = submission?.media ?? [];

  const toType = (m: any): "PHOTO" | "VIDEO" =>
    String(m?.mediaType ?? "").toUpperCase() === "VIDEO" ? "VIDEO" : "PHOTO";

  const sections = schemaSections
    .filter((section: any) => isFieldVisibleInReport(section, section?.conditional, answers, property))
    .map((section: any) => {
      const fields = flattenFieldsOneLevel(Array.isArray(section?.fields) ? section.fields : []).filter(
        (field: any) =>
          isFieldVisibleInReport(field, field?.conditional, answers, property) &&
          isFlattenedFieldVisible(field, answers, property),
      );
      const items = fields.map((field: any) => {
        const isCheckbox = field?.type === "checkbox";
        const checked = answers[field.id] === true;
        const rawValue = buildFieldValue(field, { answers, uploads, submission });
        const value = isCheckbox ? undefined : rawValue === "-" ? undefined : String(rawValue);
        const media = allMedia
          .filter((m) => m.fieldId === field.id)
          .map((m) => ({ url: String(m.url ?? ""), type: toType(m), caption: m.label ?? undefined }));
        return {
          label: String(field.label ?? field.id ?? "-"),
          checked: isCheckbox ? checked : undefined,
          value,
          media: media.length ? media : undefined,
        };
      });
      return { title: String(section.label ?? section.title ?? "Section"), items };
    })
    .filter((s: any) => s.items.length > 0);

  const photos = allMedia.map((m) => ({ url: String(m.url ?? ""), type: toType(m), caption: m.label ?? undefined }));

  // QA (client-appropriate): overall score + pass + category breakdown.
  // Internal rework/pay is intentionally excluded from the client report.
  const score = qa?.score ?? qaSubmission?.score ?? null;
  const passed = qa?.passed ?? qaSubmission?.passed ?? null;
  const qaSchema =
    qaSubmission?.data && typeof qaSubmission.data === "object" && qaSubmission.data.__templateSchema
      ? qaSubmission.data.__templateSchema
      : qaSubmission?.template?.schema;
  const qaSectionLabels: Record<string, string> = {};
  for (const s of Array.isArray(qaSchema?.sections) ? qaSchema.sections : []) {
    if (s?.id) qaSectionLabels[String(s.id)] = String(s.label ?? s.title ?? s.id);
  }
  const categoryScores: Record<string, number> =
    qaSubmission?.categoryScores && typeof qaSubmission.categoryScores === "object" ? qaSubmission.categoryScores : {};
  const categories = Object.entries(categoryScores)
    .filter(([, v]) => typeof v === "number")
    .map(([id, v]) => ({ label: qaSectionLabels[id] ?? id, score: Number(v) }));
  const hasQa = score != null || passed != null || Boolean(qaSubmission) || Boolean(qa);

  return {
    report: {
      property: {
        name: String(property?.name ?? ""),
        suburb: String(property?.suburb ?? ""),
        jobType: String(job?.jobType ?? "").replace(/_/g, " "),
        cleanDate: localDate,
        cleaner: String(submission?.submittedBy?.name ?? ""),
        client: String(property?.client?.name ?? ""),
      },
      summary: { sections: sections.length, photos: photos.length, qaPassed: passed },
      sections,
      photos,
      qa: hasQa ? { score: score != null ? Number(score) : null, passed, categories } : null,
      hasQa,
    },
    actionUrl: input.actionUrl ?? "",
  };
}
