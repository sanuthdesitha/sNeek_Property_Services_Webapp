/**
 * What changed on a case, in words, for the timeline.
 *
 * Only STATUS changes used to leave a trace. Re-assigning a case, raising its
 * severity, making it client-visible or linking it to a job all happened in
 * silence — so "who marked this critical" and "who showed this to the client"
 * had no answer, on records that exist precisely to settle disputes.
 *
 * Kept pure so the wording is testable without a database. The caller writes
 * the result as an internal CaseComment, which already carries an author and is
 * already rendered on the case timeline.
 */

/** The subset of a case this compares. Anything absent is "not changed". */
export interface CaseChangeSubject {
  title?: string | null;
  severity?: string | null;
  caseType?: string | null;
  assignedToUserId?: string | null;
  clientVisible?: boolean | null;
  clientCanReply?: boolean | null;
  jobId?: string | null;
  propertyId?: string | null;
  description?: string | null;
  resolutionNote?: string | null;
}

/** Normalises "" and undefined to null so a cleared field reads as cleared. */
function norm(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function changedText(
  label: string,
  before: unknown,
  after: unknown,
  format?: (value: string) => string
): string | null {
  const from = norm(before);
  const to = norm(after);
  if (from === to) return null;
  const show = (value: string | null) =>
    value === null ? "nothing" : format ? format(value) : value;
  return `${label}: ${show(from)} → ${show(to)}`;
}

function changedBool(label: string, before: unknown, after: unknown): string | null {
  if (after === undefined || after === null) return null;
  if (Boolean(before) === Boolean(after)) return null;
  return `${label}: ${before ? "yes" : "no"} → ${after ? "yes" : "no"}`;
}

/**
 * Compares the stored case against a patch and returns one line per real
 * change. A patch that sets a field to the value it already held produces
 * nothing — a timeline full of "severity: HIGH → HIGH" is worse than no
 * timeline, because it buries the entries that matter.
 */
export function describeCaseChanges(
  before: CaseChangeSubject,
  patch: CaseChangeSubject
): string[] {
  const lines: string[] = [];
  const push = (line: string | null) => {
    if (line) lines.push(line);
  };

  if (patch.title !== undefined) push(changedText("Title", before.title, patch.title));
  if (patch.severity !== undefined) push(changedText("Severity", before.severity, patch.severity));
  if (patch.caseType !== undefined) {
    push(changedText("Type", before.caseType, patch.caseType, (v) => v.replace(/_/g, " ")));
  }
  if (patch.assignedToUserId !== undefined) {
    // Ids rather than names: this runs without a user lookup, and the timeline
    // renders the author beside it anyway. Readability is worth less here than
    // never being wrong about who was assigned.
    push(changedText("Assigned", before.assignedToUserId, patch.assignedToUserId));
  }
  if (patch.jobId !== undefined) push(changedText("Linked job", before.jobId, patch.jobId));
  if (patch.propertyId !== undefined) {
    push(changedText("Linked property", before.propertyId, patch.propertyId));
  }
  push(changedBool("Visible to client", before.clientVisible, patch.clientVisible));
  push(changedBool("Client can reply", before.clientCanReply, patch.clientCanReply));

  // Long free text is noted as edited rather than quoted — a diff of a 6000
  // character description would swamp the timeline it is meant to clarify.
  if (patch.description !== undefined && norm(before.description) !== norm(patch.description)) {
    lines.push("Description edited");
  }
  if (
    patch.resolutionNote !== undefined &&
    norm(before.resolutionNote) !== norm(patch.resolutionNote)
  ) {
    lines.push("Resolution note edited");
  }

  return lines;
}
