// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ClientInvoiceStatus, JobStatus } from "@prisma/client";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/reports/pdf", () => ({ renderPdfFromHtml: vi.fn() }));
vi.mock("@/lib/s3", () => ({ publicUrl: (value: string) => value }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: vi.fn() }));

import { billedJobLinesWhere } from "@/lib/billing/client-invoices";
import {
  INVOICED_JOB_WHERE,
  LIVE_INVOICE_LINE_WHERE,
  NOT_INVOICED_JOB_WHERE,
  isJobInvoiced,
  isLiveInvoiceLine,
  notInvoicedJobSql,
} from "@/lib/jobs/invoiced-rule";
import { buildJobsWhere } from "@/lib/jobs/list-filters";

type StatusFilter = { not: ClientInvoiceStatus };

/** Evaluates an invoice-status filter of the `{ not: X }` shape against one status. */
function statusPasses(filter: StatusFilter, status: ClientInvoiceStatus): boolean {
  return status !== filter.not;
}

const ALL_INVOICE_STATUSES = Object.values(ClientInvoiceStatus);

describe("Jobs 'invoiced' rule matches the invoice generator", () => {
  it("treats exactly the same invoice statuses as billed as billedJobLinesWhere", () => {
    const generator = billedJobLinesWhere("client-1").invoice as { status: StatusFilter };
    const jobs = LIVE_INVOICE_LINE_WHERE.invoice.status as StatusFilter;
    for (const status of ALL_INVOICE_STATUSES) {
      expect(statusPasses(jobs, status), status).toBe(statusPasses(generator.status, status));
      expect(isLiveInvoiceLine({ invoice: { status } }), status).toBe(statusPasses(generator.status, status));
    }
    expect(isLiveInvoiceLine({ invoice: { status: ClientInvoiceStatus.VOID } })).toBe(false);
  });

  it("a job whose only invoice line is on a VOID invoice is not invoiced", () => {
    const voidOnly = { status: JobStatus.COMPLETED, invoiceLines: [{ invoice: { status: ClientInvoiceStatus.VOID } }] };
    expect(isJobInvoiced(voidOnly)).toBe(false);
    const reissued = { ...voidOnly, invoiceLines: [...voidOnly.invoiceLines, { invoice: { status: ClientInvoiceStatus.DRAFT } }] };
    expect(isJobInvoiced(reissued)).toBe(true);
    expect(isJobInvoiced({ status: JobStatus.INVOICED, invoiceLines: [] })).toBe(true);
    expect(isJobInvoiced({ status: JobStatus.COMPLETED, invoiceLines: [] })).toBe(false);
  });

  it("the Invoice filter only counts lines on non-VOID invoices", () => {
    const base = {
      status: null, statusGroup: null, jobType: null, propertyId: null, clientId: null, cleanerId: null,
      date: null, dateFrom: null, dateTo: null, search: "", role: "ADMIN" as const, userId: "admin-1",
    };
    const no = buildJobsWhere({ ...base, invoiced: "no" }) as { AND: unknown[] };
    expect(no.AND).toEqual([NOT_INVOICED_JOB_WHERE]);
    expect(NOT_INVOICED_JOB_WHERE.invoiceLines).toEqual({ none: { invoice: { status: { not: ClientInvoiceStatus.VOID } } } });
    const yes = buildJobsWhere({ ...base, invoiced: "yes" }) as { AND: unknown[] };
    expect(yes.AND).toEqual([INVOICED_JOB_WHERE]);
    expect(INVOICED_JOB_WHERE.OR[1]).toEqual({ invoiceLines: { some: { invoice: { status: { not: ClientInvoiceStatus.VOID } } } } });
  });

  it("the view-count SQL ignores lines on VOID invoices", () => {
    const sql = notInvoicedJobSql().sql;
    expect(sql).toContain(`JOIN "ClientInvoice" i ON i."id" = l."invoiceId"`);
    expect(sql).toContain(`i."status"::text <> 'VOID'`);
    expect(sql).toContain(`j."status"::text <> 'INVOICED'`);
  });
});
