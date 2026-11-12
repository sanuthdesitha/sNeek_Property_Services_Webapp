/**
 * "Job without a rate" on invoices, defined from what the generator does.
 *
 * The generator refuses to create a draft while any job it would bill has no
 * client rate (computeClientCharge → rateMissing), so a job line can only have
 * no rate when the rate was removed or deactivated after the draft was made, or
 * the job's fixed price was cleared, or the line was added some other way. The
 * figure is therefore "job lines whose job resolves no client rate NOW", by
 * the same function and the same rate tables (active property rates of the
 * invoice's client, active price book) the generator and the approval check
 * use. It is what blocks approval (client-invoice-approval-rules.ts), what the
 * list shows on a draft row and what the Drafts card counts.
 *
 * A job line whose job no longer exists is reported as unreadable, never as
 * rated.
 */
import { db } from "@/lib/db";
import { computeClientCharge } from "@/lib/finance/job-money";

type RateClient = Pick<typeof db, "job" | "propertyClientRate" | "priceBook">;

export type InvoiceJobLines = { id: string; clientId: string; jobIds: string[] };

export type MissingRateReport = {
  /** Jobs that resolve no client rate now. */
  unrated: Array<{ id: string; jobNumber: string | null }>;
  /** Job ids on the invoice that could not be found. */
  missingJobIds: string[];
};

/**
 * For each invoice, the job lines whose job has no client rate now. One query
 * per table, whatever the number of invoices.
 */
export async function missingRateReports(
  invoices: readonly InvoiceJobLines[],
  client: RateClient = db,
): Promise<Map<string, MissingRateReport>> {
  const reports = new Map<string, MissingRateReport>();
  const jobIds = Array.from(new Set(invoices.flatMap((invoice) => invoice.jobIds)));
  const clientIds = Array.from(new Set(invoices.map((invoice) => invoice.clientId)));
  if (jobIds.length === 0) {
    for (const invoice of invoices) reports.set(invoice.id, { unrated: [], missingJobIds: [] });
    return reports;
  }
  const [jobs, propertyRates, priceBook] = await Promise.all([
    client.job.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, jobNumber: true, jobType: true, propertyId: true, fixedPrice: true },
    }),
    client.propertyClientRate.findMany({
      where: { property: { clientId: { in: clientIds } }, isActive: true },
      select: { propertyId: true, jobType: true, baseCharge: true, defaultDescription: true, property: { select: { clientId: true } } },
    }),
    client.priceBook.findMany({ where: { isActive: true }, select: { jobType: true, baseRate: true } }),
  ]);
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  for (const invoice of invoices) {
    // Only the invoice's own client's rates, as the generator reads them.
    const rates = propertyRates.filter((rate) => rate.property.clientId === invoice.clientId);
    const unrated: MissingRateReport["unrated"] = [];
    const missingJobIds: string[] = [];
    for (const jobId of Array.from(new Set(invoice.jobIds))) {
      const job = jobById.get(jobId);
      if (!job) {
        missingJobIds.push(jobId);
        continue;
      }
      if (computeClientCharge(job, { propertyRates: rates, priceBook }).rateMissing) {
        unrated.push({ id: job.id, jobNumber: job.jobNumber ?? null });
      }
    }
    reports.set(invoice.id, { unrated, missingJobIds });
  }
  return reports;
}

/** DRAFT invoices (any client) with at least one job line whose job has no client rate now. */
export async function draftsWithMissingRates(client: RateClient & Pick<typeof db, "clientInvoice"> = db): Promise<{
  drafts: number;
  jobs: number;
}> {
  const drafts = await client.clientInvoice.findMany({
    where: { status: "DRAFT", lines: { some: { jobId: { not: null } } } },
    select: { id: true, clientId: true, lines: { where: { jobId: { not: null } }, select: { jobId: true } } },
  });
  const reports = await missingRateReports(
    drafts.map((draft) => ({ id: draft.id, clientId: draft.clientId, jobIds: draft.lines.flatMap((line) => (line.jobId ? [line.jobId] : [])) })),
    client,
  );
  let affected = 0;
  let jobs = 0;
  for (const report of Array.from(reports.values())) {
    const count = report.unrated.length + report.missingJobIds.length;
    if (count > 0) affected += 1;
    jobs += count;
  }
  return { drafts: affected, jobs };
}
