import "server-only";
/**
 * Loads Workforce › Compliance: the urgency-sorted action list
 * (./compliance-rows), the library of every document on file, outstanding
 * requests and the people they can be asked of. A failed read is reported as
 * failed, never as an empty, all-clear list.
 */
import { db } from "@/lib/db";
import { listStaffDirectory, listStaffDocumentRequestsForAdmin, listStaffDocumentsForAdmin } from "./service";
import { buildComplianceRows, complianceFigures, type ComplianceActionRow, type ComplianceFigures, type LastChased } from "./compliance-rows";

export type ComplianceLibraryDoc = {
  id: string;
  title: string;
  category: string;
  status: string;
  fileName: string;
  url: string;
  notes: string | null;
  expiresAt: string | null;
  createdAt: string;
  requiresSignature: boolean;
  user: { id: string; name: string; role: string; image: string | null };
  uploadedByName: string | null;
  verifiedByName: string | null;
};

export type ComplianceRequestSummary = {
  id: string;
  title: string;
  category: string;
  notes: string | null;
  dueAt: string | null;
  createdAt: string;
  user: { id: string; name: string };
  requestedByName: string | null;
};

export type ComplianceStaffOption = { id: string; name: string; role: string };

export type ComplianceData =
  | { status: "failed" }
  | {
      status: "ready";
      rows: ComplianceActionRow[];
      figures: ComplianceFigures;
      documents: ComplianceLibraryDoc[];
      requests: ComplianceRequestSummary[];
      staff: ComplianceStaffOption[];
      loadedAt: string;
    };

type OutcomeRecord = { transport?: unknown; state?: unknown };

/** The latest reminder per document from the STAFF_DOCUMENT_REMINDER_SENT audit rows. */
async function loadLastChased(documentIds: string[]): Promise<Map<string, LastChased>> {
  const map = new Map<string, LastChased>();
  if (documentIds.length === 0) return map;
  const rows = await db.auditLog.findMany({
    where: { action: "STAFF_DOCUMENT_REMINDER_SENT", entity: "StaffDocument", entityId: { in: documentIds } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, createdAt: true, after: true },
    take: 500,
  });
  for (const row of rows) {
    if (!row.entityId || map.has(row.entityId)) continue;
    const after = (row.after ?? {}) as { transports?: unknown; outcomes?: unknown };
    const transports = Array.isArray(after.transports) ? after.transports.filter((value): value is string => typeof value === "string") : [];
    const outcomes = Array.isArray(after.outcomes) ? (after.outcomes as OutcomeRecord[]) : [];
    const failedTransports = outcomes
      .filter((outcome) => typeof outcome.state === "string" && /fail/i.test(outcome.state) && typeof outcome.transport === "string")
      .map((outcome) => String(outcome.transport));
    map.set(row.entityId, { at: row.createdAt.toISOString(), transports, failedTransports });
  }
  return map;
}

export async function loadComplianceData(now: Date = new Date()): Promise<ComplianceData> {
  try {
    const [documents, requests, directory] = await Promise.all([
      listStaffDocumentsForAdmin(),
      listStaffDocumentRequestsForAdmin(),
      listStaffDirectory(),
    ]);
    const staffIds = directory.map((person) => person.id);
    const [profiles, lastChased] = await Promise.all([
      db.user.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true, email: true, visaExpiry: true, driverLicenseExpiry: true, vehicleRegoExpiry: true },
      }),
      loadLastChased(documents.map((document) => document.id)),
    ]);
    const openRequests = requests.filter((request) => request.status === "REQUESTED");
    const rows = buildComplianceRows(
      {
        documents: documents.map((document) => ({
          id: document.id,
          title: document.title,
          category: document.category,
          status: document.status,
          expiresAt: document.expiresAt?.toISOString() ?? null,
          createdAt: document.createdAt.toISOString(),
          requiresSignature: document.requiresSignature,
          userId: document.user.id,
          userName: document.user.name ?? "Unknown",
          verifiedByName: document.verifiedBy?.name ?? null,
        })),
        requests: openRequests.map((request) => ({
          id: request.id,
          title: request.title,
          category: request.category,
          dueAt: request.dueAt?.toISOString() ?? null,
          createdAt: request.createdAt.toISOString(),
          userId: request.user.id,
          userName: request.user.name ?? "Unknown",
          requestedByName: request.requestedBy?.name ?? null,
        })),
        profiles: profiles.map((person) => ({
          userId: person.id,
          userName: person.name ?? person.email,
          visaExpiry: person.visaExpiry?.toISOString() ?? null,
          driverLicenseExpiry: person.driverLicenseExpiry?.toISOString() ?? null,
          vehicleRegoExpiry: person.vehicleRegoExpiry?.toISOString() ?? null,
        })),
        lastChased,
      },
      now,
    );
    return {
      status: "ready",
      rows,
      figures: complianceFigures(rows),
      documents: documents.map((document) => ({
        id: document.id,
        title: document.title,
        category: document.category,
        status: document.status,
        fileName: document.fileName,
        url: document.url,
        notes: document.notes ?? null,
        expiresAt: document.expiresAt?.toISOString() ?? null,
        createdAt: document.createdAt.toISOString(),
        requiresSignature: document.requiresSignature,
        user: { id: document.user.id, name: document.user.name ?? "Unknown", role: document.user.role, image: document.user.image },
        uploadedByName: document.uploadedBy?.name ?? null,
        verifiedByName: document.verifiedBy?.name ?? null,
      })),
      requests: openRequests.map((request) => ({
        id: request.id,
        title: request.title,
        category: request.category,
        notes: request.notes ?? null,
        dueAt: request.dueAt?.toISOString() ?? null,
        createdAt: request.createdAt.toISOString(),
        user: { id: request.user.id, name: request.user.name ?? "Unknown" },
        requestedByName: request.requestedBy?.name ?? null,
      })),
      staff: directory.map((person) => ({ id: person.id, name: person.name ?? person.email, role: person.role })),
      loadedAt: now.toISOString(),
    };
  } catch {
    return { status: "failed" };
  }
}
