/**
 * "Ready to bill" with a dollar figure (Wave D).
 *
 * The jobs are the stats card's: finished (COMPLETED or INVOICED status), not
 * a skipped clean, and on no live invoice (the one invoiced rule,
 * lib/invoicing/invoiced-job-rule.ts). Each job's charge is computeClientCharge
 * with the generator's own rate tables: the client's ACTIVE property rates and
 * the active price book. A job with no rate is NOT in the dollar figure; it is
 * counted separately, and its client is counted as blocked, because the
 * generator refuses a client's draft while any of its billable jobs has no
 * rate. Amounts are summed in whole cents, never reconstructed elsewhere.
 *
 * Shopping charges and client-paid repairs the generator also bills are not in
 * this figure (it is the finished-jobs figure the card names).
 */
import { JobStatus, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeClientCharge } from "@/lib/finance/job-money";
import { NOT_INVOICED_JOB_WHERE } from "@/lib/invoicing/invoiced-job-rule";

export const READY_TO_BILL_JOB_WHERE: Prisma.JobWhereInput = {
  status: { in: [JobStatus.COMPLETED, JobStatus.INVOICED] },
  cleanSkipStatus: { not: "SKIPPED" },
  // The shared rule: no line on a live invoice (not void, not fully credited).
  ...NOT_INVOICED_JOB_WHERE,
};

export type ReadyToBillClient = {
  clientId: string;
  clientName: string;
  jobs: number;
  /** Sum of the charges of the jobs that have a rate. */
  total: number;
  /** Jobs with no client rate (left out of `total`). */
  unratedJobs: number;
};

export type ReadyToBillSummary = {
  /** Charges of rated jobs only. */
  total: number;
  jobs: number;
  clients: number;
  /** Jobs that resolve no client rate; not in `total`. */
  unratedJobs: number;
  /** Clients with at least one unrated job: the generator would refuse them. */
  blockedClients: number;
  byClient: ReadyToBillClient[];
};

export type ReadyJobFacts = {
  id: string;
  jobType: Parameters<typeof computeClientCharge>[0]["jobType"];
  propertyId: string;
  fixedPrice: number | null;
  clientId: string;
  clientName: string;
};

export type RateFacts = {
  propertyRates: Array<{ propertyId: string; jobType: ReadyJobFacts["jobType"]; baseCharge: number; defaultDescription: string | null; clientId: string }>;
  priceBook: Array<{ jobType: ReadyJobFacts["jobType"]; baseRate: number }>;
};

/** Pure: totals per client from the jobs and the rate tables. */
export function summariseReadyToBill(jobs: readonly ReadyJobFacts[], rates: RateFacts): ReadyToBillSummary {
  const byClient = new Map<string, ReadyToBillClient & { cents: number }>();
  for (const job of jobs) {
    const entry = byClient.get(job.clientId) ?? { clientId: job.clientId, clientName: job.clientName, jobs: 0, total: 0, unratedJobs: 0, cents: 0 };
    entry.jobs += 1;
    const charge = computeClientCharge(
      { jobType: job.jobType, propertyId: job.propertyId, fixedPrice: job.fixedPrice },
      { propertyRates: rates.propertyRates.filter((rate) => rate.clientId === job.clientId), priceBook: rates.priceBook },
    );
    if (charge.rateMissing || charge.amount === null) entry.unratedJobs += 1;
    else entry.cents += Math.round(charge.amount * 100);
    byClient.set(job.clientId, entry);
  }
  const clients = Array.from(byClient.values())
    .map(({ cents, ...entry }) => ({ ...entry, total: cents / 100 }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName) || a.clientId.localeCompare(b.clientId));
  const totalCents = Array.from(byClient.values()).reduce((sum, entry) => sum + entry.cents, 0);
  return {
    total: totalCents / 100,
    jobs: jobs.length,
    clients: clients.length,
    unratedJobs: clients.reduce((sum, entry) => sum + entry.unratedJobs, 0),
    blockedClients: clients.filter((entry) => entry.unratedJobs > 0).length,
    byClient: clients,
  };
}

/** Load the finished, unbilled jobs and the generator's rate tables, and summarise. */
export async function getReadyToBill(client: Pick<typeof db, "job" | "propertyClientRate" | "priceBook"> = db): Promise<ReadyToBillSummary> {
  const jobs = await client.job.findMany({
    where: READY_TO_BILL_JOB_WHERE,
    select: {
      id: true,
      jobType: true,
      propertyId: true,
      fixedPrice: true,
      property: { select: { clientId: true, client: { select: { name: true } } } },
    },
  });
  // A job on a property with no client cannot be invoiced by the generator.
  const facts: ReadyJobFacts[] = jobs.flatMap((job) =>
    job.property.clientId
      ? [{ id: job.id, jobType: job.jobType, propertyId: job.propertyId, fixedPrice: job.fixedPrice, clientId: job.property.clientId, clientName: job.property.client?.name ?? "Client" }]
      : [],
  );
  const clientIds = Array.from(new Set(facts.map((job) => job.clientId)));
  const [propertyRates, priceBook] = clientIds.length
    ? await Promise.all([
        client.propertyClientRate.findMany({
          where: { isActive: true, property: { clientId: { in: clientIds } } },
          select: { propertyId: true, jobType: true, baseCharge: true, defaultDescription: true, property: { select: { clientId: true } } },
        }),
        client.priceBook.findMany({ where: { isActive: true }, select: { jobType: true, baseRate: true } }),
      ])
    : [[], []];
  return summariseReadyToBill(facts, {
    propertyRates: propertyRates.flatMap((rate) =>
      rate.property.clientId ? [{ propertyId: rate.propertyId, jobType: rate.jobType, baseCharge: rate.baseCharge, defaultDescription: rate.defaultDescription, clientId: rate.property.clientId }] : [],
    ),
    priceBook,
  });
}
