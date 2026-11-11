/**
 * What a job payload may contain when the reader is a cleaner.
 *
 * Job rows carry the price the client pays, the office's raw notes, and every
 * cleaner's pay. A cleaner is entitled to their own pay and the working
 * details of the job, nothing more. Applied at the response boundary so the
 * queries can stay shared with the office views.
 */

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Fields on Job that are commercial or office-only. */
const JOB_OFFICE_FIELDS = ["fixedPrice", "internalNotes", "reworkPayAmount"] as const;

function ownEntryOnly(map: unknown, userId: string): Record<string, unknown> {
  if (!isRow(map) || !(userId in map)) return {};
  return { [userId]: map[userId] };
}

function redactPerson(person: unknown): unknown {
  if (!isRow(person)) return person;
  const { email: _email, phone: _phone, ...rest } = person;
  return rest;
}

function redactAssignment(assignment: unknown, userId: string): unknown {
  if (!isRow(assignment)) return assignment;
  const mine = assignment.userId === userId || (isRow(assignment.user) && assignment.user.id === userId);
  if (mine) return assignment;
  // A colleague's name and acceptance are working information; their pay,
  // their note to the office and their contact details are not.
  const { payRate: _payRate, responseNote: _responseNote, ...rest } = assignment;
  return { ...rest, user: redactPerson(rest.user) };
}

export function redactJobForCleaner<T>(job: T, userId: string): T {
  if (!isRow(job)) return job;
  const redacted: Row = { ...job };
  for (const field of JOB_OFFICE_FIELDS) delete redacted[field];

  if (Array.isArray(job.assignments)) {
    redacted.assignments = job.assignments.map((assignment) => redactAssignment(assignment, userId));
  }
  if (Array.isArray(job.qaAssignments)) {
    redacted.qaAssignments = job.qaAssignments.map((row) =>
      isRow(row) ? { ...row, assignedTo: redactPerson(row.assignedTo) } : row,
    );
  }
  if (isRow(job.property) && isRow(job.property.client)) {
    const { email: _email, ...client } = job.property.client;
    redacted.property = { ...job.property, client };
  }
  if (isRow(job.laundryTask)) {
    const { adminOverrideNote: _note, ...laundryTask } = job.laundryTask;
    redacted.laundryTask = laundryTask;
  }
  return redacted as T;
}

/** Parsed job notes: a cleaner sees their own payout and allowance only. */
export function redactJobMetaForCleaner<T>(meta: T, userId: string): T {
  if (!isRow(meta)) return meta;
  const redacted: Row = { ...meta };
  if ("cleanerPayouts" in meta) redacted.cleanerPayouts = ownEntryOnly(meta.cleanerPayouts, userId);
  if ("transportAllowances" in meta) {
    redacted.transportAllowances = ownEntryOnly(meta.transportAllowances, userId);
  }
  return redacted as T;
}

/** People a job can be handed to: a name to pick, never an address to contact. */
export function redactTransferCandidates(
  candidates: ReadonlyArray<{ id: string; name: string | null; email?: string | null }>,
): Array<{ id: string; name: string }> {
  return candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name?.trim() || "Cleaner",
  }));
}
