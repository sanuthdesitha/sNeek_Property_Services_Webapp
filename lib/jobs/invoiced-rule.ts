/**
 * "Is this job invoiced?" for the Jobs screens.
 *
 * Re-exports THE shared rule from `lib/invoicing/invoiced-job-rule.ts`, which
 * the invoice generator (`billedJobLinesWhere`) and "Ready to bill" also use:
 * a job is invoiced only while it has a line on a live invoice (kind INVOICE,
 * not VOID, not fully credited). The INVOICED job status on its own no longer
 * counts (owner decision, 2026-11-11, second set item 3).
 * `tests/lib/jobs-invoiced-rule.test.ts` keeps every consumer on this rule.
 */
export {
  FINANCIAL_RECORD_LINE_WHERE,
  INVOICED_JOB_WHERE,
  LIVE_INVOICE_LINE_WHERE,
  NOT_INVOICED_JOB_WHERE,
  isFinancialRecordLine,
  isJobInvoiced,
  isLiveInvoiceLine,
  notInvoicedJobSql,
} from "@/lib/invoicing/invoiced-job-rule";
export type { InvoiceLineState as JobInvoiceLineState } from "@/lib/invoicing/invoiced-job-rule";
