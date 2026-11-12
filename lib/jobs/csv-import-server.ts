import "server-only";
import { createHash } from "crypto";
import { JobType, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { holdsRoleWhere } from "@/lib/auth/role-query";
import { createAdminJobOnce, type CreateJobInput } from "./admin-create";
import { previewImport, type ImportLookups, type ImportPreview, type ImportRowValues } from "./csv-import";

/**
 * Server side of the Jobs CSV import.
 *
 * preview: parse and validate every row against the live properties, active
 *   cleaners and job types. Nothing is written. The answer carries the file's
 *   key: the SHA-256 of its text.
 * apply: the same file is sent back with that key; the server checks the key
 *   matches the text, validates again, and creates each valid row through the
 *   job-create service (`createAdminJobOnce`) with a receipt keyed by
 *   file key + row. A retry of the same file (a lost response, a double click,
 *   the same file uploaded again) finds the receipts and reports those rows as
 *   already created instead of creating them twice.
 *
 * The optional cleaner is NOT assigned here: the page assigns newly created
 * rows through the existing assign route, as the New job page does.
 */
export type ImportApplyOutcome = "created" | "already_created" | "refused" | "failed";
export type ImportApplyRow = {
  line: number;
  outcome: ImportApplyOutcome;
  message: string;
  jobId: string | null;
  jobNumber: string | null;
  /** Set only on rows created by this request that named a cleaner. */
  assignCleanerId: string | null;
};

export function importFileKey(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function loadImportLookups(): Promise<ImportLookups> {
  const [properties, cleaners] = await Promise.all([
    db.property.findMany({ select: { id: true, name: true, isActive: true } }),
    db.user.findMany({ where: { isActive: true, ...holdsRoleWhere(Role.CLEANER) }, select: { id: true, name: true, email: true } }),
  ]);
  return { properties, cleaners, jobTypes: Object.values(JobType) };
}

export async function previewJobImport(text: string): Promise<ImportPreview & { key: string }> {
  const preview = previewImport(text, await loadImportLookups());
  return { ...preview, key: importFileKey(text) };
}

export function createInputForRow(values: ImportRowValues): CreateJobInput {
  return {
    propertyId: values.propertyId,
    jobType: values.jobType as JobType,
    scheduledDate: `${values.date}T00:00:00.000Z`,
    ...(values.startTime ? { startTime: values.startTime } : {}),
    ...(values.dueTime ? { dueTime: values.dueTime } : {}),
    ...(values.notes ? { notes: values.notes } : {}),
  };
}

export class ImportKeyMismatchError extends Error {
  readonly status = 409;
  constructor() {
    super("This file changed since it was checked. Check it again before importing.");
    this.name = "ImportKeyMismatchError";
  }
}

export async function applyJobImport(text: string, key: string, userId: string): Promise<{ rows: ImportApplyRow[] } | { error: string }> {
  if (importFileKey(text) !== key) throw new ImportKeyMismatchError();
  const preview = previewImport(text, await loadImportLookups());
  if (preview.kind === "error") return { error: preview.message };
  const rows: ImportApplyRow[] = [];
  for (const row of preview.rows) {
    if (!row.ok || !row.values) {
      rows.push({ line: row.line, outcome: "refused", message: row.errors.join(" "), jobId: null, jobNumber: null, assignCleanerId: null });
      continue;
    }
    try {
      const result = await createAdminJobOnce(createInputForRow(row.values), {
        key: `${key}:${row.line}`,
        userId,
        detail: { fileKey: key, line: row.line, property: row.values.propertyName, date: row.values.date },
      });
      rows.push({
        line: row.line,
        outcome: result.replayed ? "already_created" : "created",
        message: result.replayed ? "Already created from this file earlier; not created again." : "Created.",
        jobId: result.jobId,
        jobNumber: result.jobNumber,
        assignCleanerId: result.replayed ? null : row.values.cleanerId,
      });
    } catch (error) {
      rows.push({ line: row.line, outcome: "failed", message: error instanceof Error ? error.message : "Could not create this job.", jobId: null, jobNumber: null, assignCleanerId: null });
    }
  }
  return { rows };
}
