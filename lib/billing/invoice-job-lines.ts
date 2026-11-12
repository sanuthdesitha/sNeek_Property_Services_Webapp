/**
 * The generator's job line, as one function: the generator
 * (generateClientInvoice) and "Add finished jobs" (client-invoice-add-jobs.ts)
 * both build a job's invoice line here, so a job added to an existing draft
 * reads and costs exactly what the generator would have written.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { ClientChargeResult } from "@/lib/finance/job-money";

export type JobLineSource = {
  id: string;
  jobType: string;
  scheduledDate: Date;
  property: { name: string };
};

export type JobInvoiceLine = {
  jobId: string;
  shoppingRunId: null;
  description: string;
  note: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  category: string;
};

/** Null when the charge has no amount (a missing rate): such a job is never billed. */
export function buildJobInvoiceLine(job: JobLineSource, charge: ClientChargeResult | undefined, note: string | null): JobInvoiceLine | null {
  if (!charge || charge.amount == null) return null;
  // The SCHEDULED date in Sydney time (matches the small-print subtitle and the
  // jobs page); completedAt could cross the Sydney midnight boundary.
  const description =
    charge.description?.trim() ||
    `${job.property.name} - ${String(job.jobType).replace(/_/g, " ")} - ${formatInTimeZone(new Date(job.scheduledDate), "Australia/Sydney", "dd MMM yyyy")}`;
  return {
    jobId: job.id,
    shoppingRunId: null,
    description,
    note,
    quantity: 1,
    unitPrice: charge.amount,
    lineTotal: charge.amount,
    category: "SERVICE",
  };
}
