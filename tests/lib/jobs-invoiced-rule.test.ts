// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ClientInvoiceKind, ClientInvoiceStatus, JobStatus } from "@prisma/client";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/reports/pdf", () => ({ renderPdfFromHtml: vi.fn() }));
vi.mock("@/lib/s3", () => ({ publicUrl: (value: string) => value }));
vi.mock("@/lib/settings", () => ({ getAppSettings: vi.fn() }));
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: vi.fn() }));

import { billedJobLinesWhere } from "@/lib/billing/client-invoices";
import {
  FINANCIAL_RECORD_LINE_WHERE,
  INVOICED_JOB_WHERE,
  LIVE_INVOICE_LINE_WHERE,
  LIVE_INVOICE_WHERE,
  NOT_INVOICED_JOB_WHERE,
  creditsCoverInvoice,
  isFinancialRecordLine,
  isJobInvoiced,
  isLiveInvoiceLine,
  notInvoicedJobSql,
} from "@/lib/invoicing/invoiced-job-rule";
import * as jobsRule from "@/lib/jobs/invoiced-rule";
import { buildJobsWhere } from "@/lib/jobs/list-filters";

type InvoiceFacts = { status: ClientInvoiceStatus; kind: ClientInvoiceKind; creditedInFullAt: Date | null };

/** Evaluates the LIVE_INVOICE_WHERE shape against one invoice. */
function livePasses(where: typeof LIVE_INVOICE_WHERE, invoice: InvoiceFacts): boolean {
  return invoice.kind === where.kind && invoice.status !== where.status.not && invoice.creditedInFullAt === where.creditedInFullAt;
}

const CASES: InvoiceFacts[] = Object.values(ClientInvoiceStatus).flatMap((status) =>
  Object.values(ClientInvoiceKind).flatMap((kind) => [
    { status, kind, creditedInFullAt: null },
    { status, kind, creditedInFullAt: new Date("2026-11-01") },
  ]),
);

describe("one invoiced rule shared by the generator, Ready to bill and the Jobs screens", () => {
  it("the generator, the Jobs re-export and the in-memory test agree on every invoice state", () => {
    const generator = billedJobLinesWhere("client-1").invoice as typeof LIVE_INVOICE_WHERE & { clientId: string };
    expect(generator.clientId).toBe("client-1");
    expect(jobsRule.LIVE_INVOICE_LINE_WHERE).toBe(LIVE_INVOICE_LINE_WHERE);
    for (const invoice of CASES) {
      const expected = invoice.kind === "INVOICE" && invoice.status !== "VOID" && invoice.creditedInFullAt === null;
      expect(livePasses(generator, invoice), JSON.stringify(invoice)).toBe(expected);
      expect(livePasses(LIVE_INVOICE_LINE_WHERE.invoice, invoice), JSON.stringify(invoice)).toBe(expected);
      expect(isLiveInvoiceLine({ invoice }), JSON.stringify(invoice)).toBe(expected);
    }
  });

  it("void and fully credited invoices free the job; a reissue invoices it again; a partial credit does not", () => {
    const voidOnly = { invoiceLines: [{ invoice: { status: ClientInvoiceStatus.VOID, kind: "INVOICE", creditedInFullAt: null } }] };
    expect(isJobInvoiced(voidOnly)).toBe(false);
    const fullyCredited = { invoiceLines: [{ invoice: { status: ClientInvoiceStatus.SENT, kind: "INVOICE", creditedInFullAt: new Date() } }] };
    expect(isJobInvoiced(fullyCredited)).toBe(false);
    const reissued = { invoiceLines: [...voidOnly.invoiceLines, { invoice: { status: ClientInvoiceStatus.DRAFT, kind: "INVOICE", creditedInFullAt: null } }] };
    expect(isJobInvoiced(reissued)).toBe(true);
    // A partial credit note leaves creditedInFullAt null: still invoiced.
    expect(isJobInvoiced({ invoiceLines: [{ invoice: { status: ClientInvoiceStatus.SENT, kind: "INVOICE", creditedInFullAt: null } }] })).toBe(true);
  });

  it("legacy data: the INVOICED status with no live line is NOT invoiced", () => {
    expect(isJobInvoiced({ invoiceLines: [] })).toBe(false);
    expect(jobsRule.isJobInvoiced({ status: JobStatus.INVOICED, invoiceLines: [] } as { status: string; invoiceLines: [] })).toBe(false);
  });

  it("the full-credit threshold uses the credited amount against the total", () => {
    expect(creditsCoverInvoice(110, 110)).toBe(true);
    expect(creditsCoverInvoice(110, 109.996)).toBe(true);
    expect(creditsCoverInvoice(110, 100)).toBe(false);
    expect(creditsCoverInvoice(0, 0)).toBe(false);
  });

  it("the Jobs Invoice filter is the shared rule, with no status test", () => {
    const base = {
      status: null, statusGroup: null, jobType: null, propertyId: null, clientId: null, cleanerId: null,
      date: null, dateFrom: null, dateTo: null, search: "", role: "ADMIN" as const, userId: "admin-1",
    };
    const no = buildJobsWhere({ ...base, invoiced: "no" }) as { AND: unknown[] };
    expect(no.AND).toEqual([NOT_INVOICED_JOB_WHERE]);
    expect(NOT_INVOICED_JOB_WHERE).toEqual({ invoiceLines: { none: LIVE_INVOICE_LINE_WHERE } });
    const yes = buildJobsWhere({ ...base, invoiced: "yes" }) as { AND: unknown[] };
    expect(yes.AND).toEqual([INVOICED_JOB_WHERE]);
    expect(INVOICED_JOB_WHERE).toEqual({ invoiceLines: { some: LIVE_INVOICE_LINE_WHERE } });
  });

  it("the view-count SQL is the same rule", () => {
    const sql = notInvoicedJobSql().sql;
    expect(sql).toContain(`JOIN "ClientInvoice" i ON i."id" = l."invoiceId"`);
    expect(sql).toContain(`"i"."kind"::text = 'INVOICE'`);
    expect(sql).toContain(`"i"."status"::text <> 'VOID'`);
    expect(sql).toContain(`"i"."creditedInFullAt" IS NULL`);
    expect(sql).not.toContain("INVOICED");
  });

  it("delete/reset guards: a void invoice line is not a financial record; a fully credited one still is", () => {
    expect(FINANCIAL_RECORD_LINE_WHERE).toEqual({ invoice: { status: { not: ClientInvoiceStatus.VOID } } });
    expect(isFinancialRecordLine({ invoice: { status: "VOID" } })).toBe(false);
    expect(isFinancialRecordLine({ invoice: { status: "SENT", creditedInFullAt: new Date() } })).toBe(true);
    expect(isFinancialRecordLine({ invoice: { status: "DRAFT" } })).toBe(true);
  });
});
