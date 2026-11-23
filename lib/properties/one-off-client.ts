import "server-only";
/**
 * Attach a one-off site (and every job at it) to its real client. Rules in
 * one-off-client-rules.ts; this does the reads and the one transaction.
 *
 * - Locked per site, re-read under the lock, refused when the site changed
 *   since the office loaded it (`expectedUpdatedAt`).
 * - Refused while any job at the site is on a non-void client invoice of the
 *   catch-all client: an issued or draft invoice is never re-pointed.
 * - The client-scoped rows that belong to the site's jobs (job tasks, cases,
 *   client messages, ratings, feedback, live-location pings, shopping charges)
 *   move with it, but only rows still pointing at the catch-all client.
 * - One audit row with the actual person (not a tested-as subject), their
 *   effective role, the before and after client and what moved.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { FALLBACK_CLIENT_NAME, isFallbackClientName } from "@/lib/jobs/service-site";
import { isOneOffSite } from "@/lib/properties/portfolio-rules";
import { FINANCIAL_RECORD_LINE_WHERE } from "@/lib/invoicing/invoiced-job-rule";
import { attachClientDecision, attachSummary, type AttachMoveCounts, type InvoicedSiteJob } from "./one-off-client-rules";

export type AttachActor = {
  /** The person at the keyboard (the impersonating administrator when testing as someone). */
  actualUserId: string;
  /** The role the request ran as. */
  effectiveRole: string;
  /** Set when testing as someone else: the subject whose session this is. */
  impersonatedSubjectId: string | null;
};

export type AttachResult =
  | { ok: true; status: 200; propertyId: string; clientId: string; clientName: string; counts: AttachMoveCounts; message: string }
  | { ok: false; status: 400 | 404 | 409; reason: string };

type Tx = Prisma.TransactionClient;

async function invoicedJobsAtSite(tx: Tx, propertyId: string): Promise<InvoicedSiteJob[]> {
  const lines = await tx.clientInvoiceLine.findMany({
    where: { job: { propertyId }, ...FINANCIAL_RECORD_LINE_WHERE },
    select: { job: { select: { jobNumber: true } }, invoice: { select: { invoiceNumber: true } } },
    take: 20,
  });
  return lines.map((line) => ({ jobNumber: line.job?.jobNumber ?? null, invoiceNumber: line.invoice?.invoiceNumber ?? null }));
}

async function moveClientScopedRows(tx: Tx, propertyId: string, jobIds: string[], fromClientId: string, toClientId: string): Promise<Omit<AttachMoveCounts, "jobs">> {
  const byJob = jobIds.length ? { jobId: { in: jobIds } } : null;
  const [jobTasks, cases, messages, ratings, feedback, locationPings, shoppingCharges] = await Promise.all([
    tx.jobTask.updateMany({ where: { propertyId, clientId: fromClientId }, data: { clientId: toClientId } }),
    tx.issueTicket.updateMany({ where: { clientId: fromClientId, OR: [{ propertyId }, ...(byJob ? [byJob] : [])] }, data: { clientId: toClientId } }),
    byJob ? tx.clientMessage.updateMany({ where: { clientId: fromClientId, ...byJob }, data: { clientId: toClientId } }) : Promise.resolve({ count: 0 }),
    byJob ? tx.clientSatisfactionRating.updateMany({ where: { clientId: fromClientId, ...byJob }, data: { clientId: toClientId } }) : Promise.resolve({ count: 0 }),
    byJob ? tx.jobFeedback.updateMany({ where: { clientId: fromClientId, ...byJob }, data: { clientId: toClientId } }) : Promise.resolve({ count: 0 }),
    byJob ? tx.cleanerLocationPing.updateMany({ where: { clientId: fromClientId, ...byJob }, data: { clientId: toClientId } }) : Promise.resolve({ count: 0 }),
    tx.shoppingClientCharge.updateMany({ where: { propertyId, clientId: fromClientId, invoiceId: null }, data: { clientId: toClientId } }),
  ]);
  return {
    jobTasks: jobTasks.count,
    cases: cases.count,
    messages: messages.count,
    ratings: ratings.count,
    feedback: feedback.count,
    locationPings: locationPings.count,
    shoppingCharges: shoppingCharges.count,
  };
}

export async function attachOneOffSiteToClient(input: {
  propertyId: string;
  clientId: string;
  /** The site's updatedAt the office saw; a later change refuses the attach. */
  expectedUpdatedAt: string | null;
  actor: AttachActor;
}): Promise<AttachResult> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`one-off-site:${input.propertyId}`}))`;
    const site = await tx.property.findUnique({
      where: { id: input.propertyId },
      select: { id: true, isActive: true, accessInfo: true, clientId: true, updatedAt: true, client: { select: { name: true } } },
    });
    if (site && input.expectedUpdatedAt && site.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      return { ok: false as const, status: 409 as const, reason: "This site changed since you opened it. Reload the page and try again." };
    }
    const target = await tx.client.findUnique({ where: { id: input.clientId }, select: { id: true, name: true, isActive: true } });
    const [invoiced, billedShopping] = site
      ? await Promise.all([
          invoicedJobsAtSite(tx, site.id),
          tx.shoppingClientCharge.count({ where: { propertyId: site.id, invoiceId: { not: null } } }),
        ])
      : [[], 0];
    const decision = attachClientDecision(
      site ? { isOneOffSite: isOneOffSite(site.accessInfo), isActive: site.isActive, currentClientId: site.clientId, currentClientIsFallback: isFallbackClientName(site.client?.name) } : null,
      target ? { id: target.id, isActive: target.isActive, isFallback: isFallbackClientName(target.name) } : null,
      invoiced,
      billedShopping,
    );
    if (!decision.ok) return decision;
    const jobs = await tx.job.findMany({ where: { propertyId: site!.id }, select: { id: true } });
    const jobIds = jobs.map((job) => job.id);
    await tx.property.update({ where: { id: site!.id }, data: { clientId: target!.id } });
    const moved = await moveClientScopedRows(tx, site!.id, jobIds, site!.clientId, target!.id);
    const counts: AttachMoveCounts = { jobs: jobIds.length, ...moved };
    await tx.auditLog.create({
      data: {
        userId: input.actor.actualUserId,
        action: "ONE_OFF_SITE_CLIENT_ATTACHED",
        entity: "Property",
        entityId: site!.id,
        before: { clientId: site!.clientId, clientName: site!.client?.name ?? FALLBACK_CLIENT_NAME },
        after: {
          clientId: target!.id,
          clientName: target!.name,
          counts,
          effectiveRole: input.actor.effectiveRole,
          impersonatedSubjectId: input.actor.impersonatedSubjectId,
        } as Prisma.InputJsonValue,
      },
    });
    return { ok: true as const, status: 200 as const, propertyId: site!.id, clientId: target!.id, clientName: target!.name, counts, message: attachSummary(counts, target!.name) };
  });
}
