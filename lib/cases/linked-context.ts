import "server-only";
/**
 * "Linked, filled in automatically" for the Cases details panel. Everything is
 * derived on the server from the case's linked job (and the case's own
 * attachments) and is read-only: job, property, client, cleaners on the job,
 * the departing guest (the job's own reservation, shown as admin job detail
 * shows it: name, phone, check-out), the service report and evidence counts.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { loadJobPeekSummary } from "@/lib/jobs/peek-summary";

export type CaseLinkedContext = {
  job: { id: string; jobNumber: string | null; scheduledDate: string; status: string } | null;
  property: { id: string; name: string; suburb: string | null } | null;
  client: { id: string; name: string } | null;
  cleaners: Array<{ id: string; name: string; isPrimary: boolean }>;
  departingGuest: { name: string | null; phoneLabel: string | null; phoneHref: string | null; checkoutAt: string | null } | null;
  report: { id: string; href: string } | null;
  evidence: {
    /** Photos submitted on the job's forms; null when no job is linked. */
    jobPhotos: number | null;
    clientAttachments: number;
    officeAttachments: number;
  };
  nextSteps: {
    repairQuoteHref: string;
    /** Invoices for the case's client, drafts first; null when no client is linked. */
    clientDraftInvoicesHref: string | null;
    newInvoiceHref: string;
  };
};

const CLIENT_SIDE_ROLES: Role[] = [Role.CLIENT, Role.VA];

export async function loadCaseLinkedContext(caseId: string): Promise<CaseLinkedContext | null> {
  const row = await db.issueTicket.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      jobId: true,
      reportId: true,
      client: { select: { id: true, name: true } },
      property: { select: { id: true, name: true, suburb: true } },
    },
  });
  if (!row) return null;

  const [summary, jobPhotos, clientAttachments, totalAttachments, jobReport] = await Promise.all([
    row.jobId ? loadJobPeekSummary(row.jobId) : Promise.resolve(null),
    row.jobId
      ? db.submissionMedia.count({ where: { mediaType: "PHOTO", submission: { jobId: row.jobId } } })
      : Promise.resolve(null),
    db.caseAttachment.count({ where: { caseId, uploadedBy: { role: { in: CLIENT_SIDE_ROLES } } } }),
    db.caseAttachment.count({ where: { caseId } }),
    row.jobId && !row.reportId
      ? db.report.findUnique({ where: { jobId: row.jobId }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  const reportId = row.reportId ?? jobReport?.id ?? null;
  const client = row.client ?? summary?.client ?? null;
  return {
    job: summary
      ? { id: summary.id, jobNumber: summary.jobNumber ?? null, scheduledDate: summary.scheduledDate, status: String(summary.status) }
      : null,
    property: row.property ?? summary?.property ?? null,
    client,
    cleaners: summary?.assignments.map((a) => ({ id: a.userId, name: a.name, isPrimary: a.isPrimary })) ?? [],
    departingGuest: summary?.departing ?? null,
    report: reportId ? { id: reportId, href: `/v2/admin/reports?reportId=${reportId}` } : null,
    evidence: {
      jobPhotos,
      clientAttachments,
      officeAttachments: totalAttachments - clientAttachments,
    },
    nextSteps: {
      repairQuoteHref: "/v2/admin/quotes/new",
      clientDraftInvoicesHref: row.client ? `/v2/admin/finance?tab=invoices&client=${encodeURIComponent(row.client.id)}&status=DRAFT` : null,
      newInvoiceHref: "/v2/admin/finance?tab=invoices&new=jobs",
    },
  };
}
