import "server-only";
/**
 * One submission for the Forms page's submission view: answers, media, the
 * questions it was filled against (the stored effective form
 * `data.__templateSchema` when present, so a later template edit never changes
 * what an old submission shows; the template's live schema otherwise), the
 * edit history (answer edits with before/after, media removed, added and
 * restored) and the removed media that can be put back.
 */
import { db } from "@/lib/db";
import { SUBMISSION_EDIT_ACTIONS, type RemovedMediaTombstone } from "./submission-edit";
import { readSubmissionWarnings, type SubmissionValidationWarning } from "./submission-warnings";

export type SubmissionField = {
  id: string;
  label: string;
  type: string;
  sectionTitle: string;
  table?: unknown;
  unit?: unknown;
  stockItemName?: unknown;
};

export type SubmissionHistoryEntry = {
  id: string;
  action: string;
  at: string;
  actor: string;
  before: unknown;
  after: unknown;
};

export type SubmissionDetail = {
  id: string;
  createdAt: string;
  jobId: string;
  job: { jobNumber: string | null; scheduledDate: string; status: string };
  property: { id: string; name: string; suburb: string | null } | null;
  form: { id: string; name: string; serviceType: string };
  submittedBy: string;
  data: Record<string, unknown>;
  laundryReady: boolean | null;
  laundryOutcome: string | null;
  bagLocation: string | null;
  media: Array<{ id: string; fieldId: string; mediaType: string; url: string; s3Key: string; label: string | null; mimeType: string | null }>;
  fields: SubmissionField[];
  /** True when the questions come from the stored effective form. */
  fieldsFromSnapshot: boolean;
  warnings: SubmissionValidationWarning[];
  history: SubmissionHistoryEntry[];
  removedMedia: Array<{ auditId: string; removedAt: string; media: RemovedMediaTombstone }>;
};

type SchemaNode = { id?: unknown; label?: unknown; title?: unknown; type?: unknown; fields?: unknown; children?: unknown; table?: unknown; unit?: unknown; stockItemName?: unknown };

/** Every question of a schema in order, children flattened, with its section title. */
export function flattenSubmissionFields(schema: unknown): SubmissionField[] {
  const sections = Array.isArray((schema as { sections?: unknown } | null)?.sections) ? ((schema as { sections: SchemaNode[] }).sections) : [];
  const out: SubmissionField[] = [];
  const visit = (node: SchemaNode, sectionTitle: string) => {
    if (typeof node?.id === "string" && node.id) {
      out.push({
        id: node.id,
        label: typeof node.label === "string" && node.label ? node.label : node.id,
        type: typeof node.type === "string" ? node.type : "text",
        sectionTitle,
        ...(node.table !== undefined ? { table: node.table } : {}),
        ...(node.unit !== undefined ? { unit: node.unit } : {}),
        ...(node.stockItemName !== undefined ? { stockItemName: node.stockItemName } : {}),
      });
    }
    if (Array.isArray(node?.children)) for (const child of node.children as SchemaNode[]) visit(child, sectionTitle);
  };
  for (const section of sections) {
    const title = typeof section?.title === "string" ? section.title : typeof section?.label === "string" ? section.label : "";
    for (const field of Array.isArray(section?.fields) ? (section.fields as SchemaNode[]) : []) visit(field, title);
  }
  return out;
}

const HISTORY_ACTIONS = Object.values(SUBMISSION_EDIT_ACTIONS);

export async function loadSubmissionDetail(submissionId: string): Promise<SubmissionDetail | null> {
  const row = await db.formSubmission.findUnique({
    where: { id: submissionId },
    include: {
      template: { select: { id: true, name: true, serviceType: true, schema: true } },
      submittedBy: { select: { name: true, email: true } },
      media: { orderBy: { createdAt: "asc" }, select: { id: true, fieldId: true, mediaType: true, url: true, s3Key: true, label: true, mimeType: true } },
      job: { select: { jobNumber: true, scheduledDate: true, status: true, property: { select: { id: true, name: true, suburb: true } } } },
    },
  });
  if (!row) return null;
  const data = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
  const snapshot = data.__templateSchema;
  const fromSnapshot = Boolean(snapshot && typeof snapshot === "object" && Array.isArray((snapshot as { sections?: unknown }).sections));
  const audits = await db.auditLog.findMany({
    where: { entity: "FormSubmission", entityId: submissionId, action: { in: HISTORY_ACTIONS } },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, action: true, createdAt: true, before: true, after: true, user: { select: { name: true, email: true } } },
  });
  const present = new Set(row.media.map((media) => media.id));
  const removedMedia = audits.flatMap((audit) => {
    if (audit.action !== SUBMISSION_EDIT_ACTIONS.mediaRemoved) return [];
    const media = (audit.after as { media?: RemovedMediaTombstone } | null)?.media;
    if (!media || present.has(media.id)) return [];
    return [{ auditId: audit.id, removedAt: audit.createdAt.toISOString(), media }];
  });
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    jobId: row.jobId,
    job: { jobNumber: row.job.jobNumber ?? null, scheduledDate: row.job.scheduledDate.toISOString(), status: String(row.job.status) },
    property: row.job.property ? { id: row.job.property.id, name: row.job.property.name, suburb: row.job.property.suburb ?? null } : null,
    form: { id: row.template.id, name: row.template.name, serviceType: String(row.template.serviceType) },
    submittedBy: row.submittedBy.name ?? row.submittedBy.email ?? "Cleaner",
    data,
    laundryReady: row.laundryReady ?? null,
    laundryOutcome: row.laundryOutcome ?? null,
    bagLocation: row.bagLocation ?? null,
    media: row.media.map((media) => ({ ...media, mediaType: String(media.mediaType) })),
    fields: flattenSubmissionFields(fromSnapshot ? snapshot : row.template.schema),
    fieldsFromSnapshot: fromSnapshot,
    warnings: readSubmissionWarnings(data),
    history: audits.map((audit) => ({
      id: audit.id,
      action: audit.action,
      at: audit.createdAt.toISOString(),
      actor: audit.user?.name ?? audit.user?.email ?? "System",
      before: audit.before ?? null,
      after: audit.after ?? null,
    })),
    removedMedia,
  };
}
