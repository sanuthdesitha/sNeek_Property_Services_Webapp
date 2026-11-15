import "server-only";
/**
 * The admin damage report record page's read model: the existing ADMIN
 * investigation view model (lib/damage/investigation.ts, unchanged in what it
 * redacts) plus the context the record page shows around it — the job,
 * property and client, the PDF check code, the estimate total with its
 * coverage, earlier reports at the property and the report's history.
 *
 * Office only. The client never receives any of this: "Preview as the client"
 * renders the CLIENT view model (getDamageClientPreview), which goes through
 * the same redaction as the client portal.
 */
import { DamageReportStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { INVESTIGATION_INCLUDE, getDamageInvestigationForAdmin, toInvestigationViewModel, type DamageInvestigation } from "./investigation";
import { buildDamageHistory, releaseMessageText, summariseEstimates, type DamageAuditRow, type DamageRecordContext } from "./record-model";

const HISTORY_ACTIONS = [
  "DAMAGE_REPORT_SUBMITTED",
  "DAMAGE_REPORT_RELEASED",
  "DAMAGE_REPORT_TAKEN_BACK",
  "DAMAGE_REPORT_CLOSED",
  "DAMAGE_REPORT_CLOSED_RELEASED",
  "DAMAGE_REPORT_REOPENED",
  "DAMAGE_REPORT_REVIEWED",
  "DAMAGE_RELEASE_NOTICE_SENT",
  "DAMAGE_ITEM_ESTIMATE_SET",
];

function personName(person: { name?: string | null; email?: string | null } | null | undefined): string | null {
  if (!person) return null;
  return person.name?.trim() || person.email?.trim() || null;
}

export type DamageRecord = { report: DamageInvestigation; context: DamageRecordContext };

export async function getDamageRecordForAdmin(reportId: string): Promise<DamageRecord | null> {
  const report = await getDamageInvestigationForAdmin(reportId);
  if (!report) return null;
  const [row, audits, earlier] = await Promise.all([
    db.damageReport.findUnique({
      where: { id: reportId },
      select: {
        createdAt: true,
        job: { select: { id: true, jobNumber: true, jobType: true, scheduledDate: true } },
        property: { select: { id: true, name: true, client: { select: { id: true, name: true } } } },
        verification: { select: { code: true, createdAt: true, revokedAt: true } },
        items: { select: { id: true, case: { select: { id: true, createdAt: true } } } },
      },
    }),
    db.auditLog.findMany({
      where: { entity: "DamageReport", entityId: reportId, action: { in: HISTORY_ACTIONS } },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, action: true, createdAt: true, before: true, after: true, user: { select: { name: true, email: true } } },
    }),
    db.damageReport.count({
      where: { propertyId: report.propertyId, id: { not: reportId }, status: { not: DamageReportStatus.DRAFT } },
    }),
  ]);
  if (!row) return null;

  const auditRows: DamageAuditRow[] = audits.map((audit) => ({
    id: audit.id,
    action: audit.action,
    createdAt: audit.createdAt.toISOString(),
    actorName: personName(audit.user),
    before: audit.before,
    after: audit.after,
  }));
  const caseOpenedAt: Record<string, string> = {};
  for (const item of row.items) if (item.case) caseOpenedAt[item.case.id] = item.case.createdAt.toISOString();
  const caseTimes = Object.values(caseOpenedAt).sort();
  const voids = report.voids.map((entry) => ({ ...entry, voidedAt: new Date(entry.voidedAt).toISOString() }));
  const submittedAt = report.submittedAt ? new Date(report.submittedAt).toISOString() : null;
  const firstSubmission = auditRows.find((audit) => audit.action === "DAMAGE_REPORT_SUBMITTED")?.createdAt ?? null;
  const itemNumberById = Object.fromEntries(report.items.map((item, index) => [item.id, index + 1]));

  const lastReleaseAudit = report.clientVisible ? [...auditRows].reverse().find((audit) => audit.action === "DAMAGE_REPORT_RELEASED") ?? null : null;
  const releaseMessage = lastReleaseAudit
    ? auditRows.find((audit) => audit.action === "DAMAGE_RELEASE_NOTICE_SENT" && audit.createdAt >= lastReleaseAudit.createdAt) ?? null
    : null;

  return {
    report,
    context: {
      job: { id: row.job.id, jobNumber: row.job.jobNumber ?? null, jobType: String(row.job.jobType), scheduledDate: row.job.scheduledDate.toISOString() },
      property: { id: row.property.id, name: row.property.name },
      client: row.property.client ? { id: row.property.client.id, name: row.property.client.name } : null,
      verification: row.verification ? { code: row.verification.code, issuedAt: row.verification.createdAt.toISOString(), revoked: Boolean(row.verification.revokedAt) } : null,
      earlierReportsAtProperty: earlier,
      firstSubmittedAt: firstSubmission ?? (voids.length > 0 ? caseTimes[0] ?? null : submittedAt),
      estimate: summariseEstimates(report.items),
      history: buildDamageHistory({
        audits: auditRows,
        voids,
        submittedAt,
        reportedByName: report.reportedByName,
        jobNumber: row.job.jobNumber ?? null,
        acknowledgedAt: report.acknowledgedAt ? new Date(report.acknowledgedAt).toISOString() : null,
        acknowledgedName: report.acknowledgedName,
        itemNumberById,
        earliestCaseOpenedAt: caseTimes[0] ?? null,
      }),
      lastRelease: lastReleaseAudit
        ? { at: lastReleaseAudit.createdAt, byName: lastReleaseAudit.actorName, message: releaseMessage ? releaseMessageText(releaseMessage.after) : null }
        : null,
      caseOpenedAt,
    },
  };
}

/**
 * "Preview as the client": the report exactly as the client view model
 * shapes it (the client portal's own serializer: no estimates, no internal
 * transition notes, no reviewer, no send-back history), whether or not it is
 * released yet. Office only; nothing is changed or shown to the client.
 */
export async function getDamageClientPreview(reportId: string): Promise<DamageInvestigation | null> {
  const row = await db.damageReport.findUnique({
    where: { id: reportId },
    include: INVESTIGATION_INCLUDE,
  });
  return row ? toInvestigationViewModel(row, "CLIENT") : null;
}
