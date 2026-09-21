export type HistoricalField = { id: string; label: string; sectionLabel: string };
export type HistoricalSubmission = {
  data: unknown; template?: { schema: unknown } | null;
  jobId?: string; submittedById?: string | null;
};

/** Match report generation: immutable snapshot first, linked template for older
 * submissions predating snapshots. An existing snapshot is never overwritten. */
export function getHistoricalSubmissionFields(submission: HistoricalSubmission): HistoricalField[] {
  const data = submission.data && typeof submission.data === "object" ? submission.data as Record<string, unknown> : {};
  const snapshot = data.__templateSchema;
  const schema = snapshot && typeof snapshot === "object" ? snapshot : submission.template?.schema;
  const fields: HistoricalField[] = [];
  let visited = 0;
  function visit(node: any, section = "", isField = false, depth = 0) {
    if (!node || typeof node !== "object" || depth > 20 || ++visited > 2000) return;
    const sectionLabel = Array.isArray(node.fields) ? String(node.title ?? node.label ?? section).slice(0, 300) : section;
    // Reports attach PHOTO rows by fieldId to checkbox/status/text rows too.
    // The existence of a submitted PHOTO, not the modern upload-field type,
    // establishes evidence. Section containers are never destinations.
    if (isField && typeof node.id === "string" && node.id && !Array.isArray(node.fields)) fields.push({ id: node.id, label: String(node.label ?? node.id).slice(0, 300), sectionLabel });
    for (const key of ["sections", "fields", "children"]) if (Array.isArray(node[key])) node[key].forEach((child: unknown) => visit(child, sectionLabel, key !== "sections", depth + 1));
  }
  visit(schema);
  return fields;
}

/** Known cleaner storage layouts, confirmed in the v1 job upload and v2 form
 * capture writers. The submitted media row must still be authorized separately. */
export function isHistoricalSubmissionImageKey(key: string, jobId: string, submittedById?: string | null): boolean {
  if (!key || key.length > 1000 || !jobId || /[\\\u0000-\u0020]/.test(key)) return false;
  const parts = key.split("/");
  if (parts.some(part => !part || part === "." || part === "..")) return false;
  // v1 uploadViaDirect: folder jobs/{jobId}, server adds actor + filename.
  if (parts[0] === "jobs" && parts[1] === jobId && parts.length >= 4) return true;
  // Durable v2 forms/{jobId}/{captureId}/{actorId}/{filename}; earlier job-bound
  // form objects are also valid when their DB submission belongs to this job.
  if (parts[0] === "forms" && parts[1] === jobId && parts.length >= 3) return true;
  // Earlier v2 MediaCapture used folder="forms", producing forms/{actor}/{file}.
  return parts[0] === "forms" && parts.length === 3 && Boolean(submittedById && parts[1] === submittedById);
}

export function resolveHistoricalMediaField(submission: HistoricalSubmission, media: { fieldId: string; mediaType: string; s3Key: string }): HistoricalField | null {
  if (media.mediaType !== "PHOTO" || !isHistoricalSubmissionImageKey(media.s3Key, submission.jobId ?? "", submission.submittedById)) return null;
  const matches = getHistoricalSubmissionFields(submission).filter(field => field.id === media.fieldId);
  return matches.length === 1 ? matches[0] : null;
}
