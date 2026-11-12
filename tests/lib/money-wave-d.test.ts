// @vitest-environment node
/**
 * Money Wave D, pure and mocked parts: Ready to bill per client (rated jobs
 * only, unrated counted), the generator's refusal classes, the ZIP writer
 * (opened by `unzip -t`) and the PDF archive's error listing, the Xero failure
 * sanitiser, the stale-write guard, the provisional due line, the payment-link
 * availability, the send options (a push failure never fails the send), the
 * Xero account name cache and the saved items rules. Xero, email and payments
 * are mocked; nothing real is called.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  connected: vi.fn(),
  accountName: vi.fn(),
  integrations: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/xero/client", () => ({ hasActiveXeroConnection: m.connected, readXeroAccountName: m.accountName }));
vi.mock("@/lib/phase3/integrations", () => ({ getPhase3IntegrationsSettings: m.integrations }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ companyName: "Co", invoicing: {} }) }));
vi.mock("@/lib/billing/client-invoices", () => ({ getClientInvoice: vi.fn(), renderClientInvoicePdf: vi.fn() }));

import { summariseReadyToBill } from "@/lib/billing/ready-to-bill";
import { classifyGeneratorError } from "@/lib/billing/client-invoice-batch-generate";
import { crc32, zipStore } from "@/lib/billing/zip-store";
import { archiveFileName, archiveSummaryHeader, buildInvoicePdfArchive, errorsText } from "@/lib/billing/client-invoice-pdf-archive";
import { sanitiseXeroFailureReason } from "@/lib/billing/client-invoice-xero-failure";
import { STALE_INVOICE_CODE, staleInvoiceRefusal } from "@/lib/billing/client-invoice-stale-guard";
import { isProvisionalDueStatus, pdfDueLine } from "@/lib/billing/client-invoice-pdf-parts";
import { paymentLinkAvailability, paymentLinkHtml } from "@/lib/billing/invoice-payment-link";
import { clearXeroAccountNameCache, xeroAccountName } from "@/lib/billing/xero-account-name";
import { leavesDraft } from "@/lib/billing/client-invoice-approval-rules";
import { savedItemsSchema } from "@/lib/billing/invoice-saved-items";
import { xeroExportFailureOf, isXeroExportPending } from "@/lib/billing/client-invoice-guards";

const rates = {
  propertyRates: [{ propertyId: "p1", jobType: "GENERAL_CLEAN" as never, baseCharge: 165, defaultDescription: null, clientId: "c1" }],
  priceBook: [],
};

describe("Ready to bill", () => {
  it("sums charges in cents per client, leaves unrated jobs out of the total and counts their clients as blocked", () => {
    const summary = summariseReadyToBill(
      [
        { id: "j1", jobType: "GENERAL_CLEAN" as never, propertyId: "p1", fixedPrice: null, clientId: "c1", clientName: "Harbour" },
        { id: "j2", jobType: "GENERAL_CLEAN" as never, propertyId: "p1", fixedPrice: 0.1, clientId: "c1", clientName: "Harbour" },
        { id: "j3", jobType: "GENERAL_CLEAN" as never, propertyId: "p1", fixedPrice: 0.2, clientId: "c1", clientName: "Harbour" },
        // The other client's property has no rate of its own: c1's rate must not leak to it.
        { id: "j4", jobType: "GENERAL_CLEAN" as never, propertyId: "p2", fixedPrice: null, clientId: "c2", clientName: "Northside" },
      ],
      rates,
    );
    expect(summary.total).toBe(165.3);
    expect(summary).toMatchObject({ jobs: 4, clients: 2, unratedJobs: 1, blockedClients: 1 });
    expect(summary.byClient.find((row) => row.clientId === "c2")).toMatchObject({ jobs: 1, total: 0, unratedJobs: 1 });
  });

  it("classifies the generator's own refusals", () => {
    expect(classifyGeneratorError("No billable completed jobs found for the selected client and period.")).toBe("nothing");
    expect(classifyGeneratorError("Missing client rates for 2 job(s): J1, J2. Set rates in Billing Rates before invoicing.")).toBe("refused");
    expect(classifyGeneratorError("Some work was invoiced by another request. Refresh before generating again.")).toBe("refused");
    expect(classifyGeneratorError("Connection reset")).toBe("failed");
  });
});

describe("PDF archive", () => {
  it("writes a ZIP that unzip opens and verifies", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zip-"));
    const file = path.join(dir, "test.zip");
    const pdf = new TextEncoder().encode("%PDF-1.4 fixture");
    writeFileSync(file, zipStore([{ name: "INV-0421.pdf", data: pdf }, { name: "_errors.txt", data: new TextEncoder().encode("x") }]));
    const tested = execFileSync("unzip", ["-t", file]).toString();
    expect(tested).toContain("No errors detected");
    expect(execFileSync("unzip", ["-p", file, "INV-0421.pdf"]).toString()).toBe("%PDF-1.4 fixture");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("names files by number, never twice, and lists every row it could not render", async () => {
    const taken = new Set<string>();
    expect(archiveFileName("INV-0421", taken)).toBe("INV-0421.pdf");
    expect(archiveFileName("INV-0421", taken)).toBe("INV-0421-2.pdf");
    expect(archiveFileName("CN/7 x", taken)).toBe("CN_7_x.pdf");
    const archive = await buildInvoicePdfArchive(["a", "b", "missing"], {
      settings: async () => ({ companyName: "Co", invoicing: {} }) as never,
      load: async (id: string) => (id === "missing" ? null : ({ id, invoiceNumber: id === "a" ? "INV-1" : "INV-2", status: "DRAFT" } as never)),
      render: async (invoice: { invoiceNumber: string }) => {
        if (invoice.invoiceNumber === "INV-2") throw new Error("Chromium crashed");
        return Buffer.from("%PDF");
      },
    } as never);
    expect(archive.summary.included.map((row) => row.fileName)).toEqual(["INV-1.pdf"]);
    expect(archive.summary.failed).toEqual([
      { id: "b", invoiceNumber: "INV-2", reason: "Chromium crashed" },
      { id: "missing", invoiceNumber: null, reason: "Invoice not found." },
    ]);
    expect(errorsText(archive.summary.failed)).toContain("INV-2: Chromium crashed");
    expect(archiveSummaryHeader(archive.summary)).toMatchObject({ includedCount: 1 });
    const dir = mkdtempSync(path.join(tmpdir(), "zip-"));
    const file = path.join(dir, "a.zip");
    const bytes = new Uint8Array(archive.byteLength);
    let at = 0;
    for (const chunk of archive.chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    writeFileSync(file, bytes);
    expect(execFileSync("unzip", ["-l", file]).toString()).toMatch(/INV-1\.pdf[\s\S]*_errors\.txt/);
  });
});

describe("Xero push failures, stale writes and due lines", () => {
  it("stores a one-line, bounded reason with no tokens", () => {
    const reason = sanitiseXeroFailureReason(`Xero API error (401):\n Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig token ${"x".repeat(500)}`);
    expect(reason).not.toContain("eyJ");
    expect(reason).not.toContain("\n");
    expect(reason.length).toBeLessThanOrEqual(300);
  });

  it("treats FAILED like PENDING for the lock, and reads its reason", () => {
    const metadata = { xeroExportState: "FAILED", xeroExportFailure: { reason: "bad code", at: "2026-11-12T00:00:00Z" } };
    expect(isXeroExportPending(metadata)).toBe(true);
    expect(xeroExportFailureOf(metadata)).toEqual({ reason: "bad code", at: "2026-11-12T00:00:00Z" });
    expect(xeroExportFailureOf({ xeroExportState: "PENDING" })).toBeNull();
  });

  it("refuses a stale write with the current token and lets callers without one through", () => {
    const stored = new Date("2026-11-12T01:02:03.456Z");
    expect(staleInvoiceRefusal(stored, undefined)).toBeNull();
    expect(staleInvoiceRefusal(stored, "2026-11-12T01:02:03.456Z")).toBeNull();
    const refused = staleInvoiceRefusal(stored, "2026-11-12T01:02:03.000Z")!;
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: STALE_INVOICE_CODE, currentUpdatedAt: stored.toISOString() });
  });

  it("labels an unsent invoice's due day provisional in the office preview only", () => {
    const createdAt = new Date("2026-11-01T00:00:00Z");
    expect(pdfDueLine({ createdAt }, 14, "Australia/Sydney", { provisional: true })).toBe("Due (provisional): 15 Nov 2026 · 14-day terms, fixed when sent");
    expect(pdfDueLine({ createdAt }, 14, "Australia/Sydney")).toBe("Due: 15 Nov 2026");
    expect(isProvisionalDueStatus("DRAFT")).toBe(true);
    expect(isProvisionalDueStatus("SENT")).toBe(false);
  });

  it("applies the approval rules whenever a draft leaves DRAFT, and never to an issued invoice", () => {
    expect(leavesDraft("DRAFT", "APPROVED", false)).toBe(true);
    expect(leavesDraft("DRAFT", "SENT", false)).toBe(true);
    expect(leavesDraft("DRAFT", undefined, true)).toBe(true);
    expect(leavesDraft("DRAFT", "VOID", false)).toBe(false);
    expect(leavesDraft("APPROVED", "SENT", false)).toBe(false);
  });
});

describe("payment link and Xero account name", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    clearXeroAccountNameCache();
    m.connected.mockReset();
    m.accountName.mockReset();
    m.integrations.mockReset();
  });

  it("is offered only when Stripe is on and a key is configured, never on a credit note", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_API_KEY", "");
    expect(await paymentLinkAvailability()).toMatchObject({ available: false, reason: expect.stringContaining("Stripe key") });
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
    m.integrations.mockResolvedValue({ stripe: { enabled: false } });
    expect(await paymentLinkAvailability()).toMatchObject({ available: false, reason: expect.stringContaining("switched off") });
    m.integrations.mockResolvedValue({ stripe: { enabled: true } });
    expect(await paymentLinkAvailability()).toEqual({ available: true });
    expect(await paymentLinkAvailability("CREDIT_NOTE")).toMatchObject({ available: false });
    expect(paymentLinkHtml('https://app.test/v2/client/finance?a="b"')).not.toContain('"b"');
  });

  it("names the account from Xero, caches it, and says why when it cannot", async () => {
    m.connected.mockResolvedValue(true);
    m.accountName.mockResolvedValue({ ok: true, name: "Cleaning income" });
    expect(await xeroAccountName("200", 1000)).toEqual({ name: "Cleaning income", reason: null });
    expect(await xeroAccountName("200", 2000)).toEqual({ name: "Cleaning income", reason: null });
    expect(m.accountName).toHaveBeenCalledTimes(1);
    m.accountName.mockResolvedValue({ ok: false, reason: "Xero API error (401): insufficient scope" });
    expect(await xeroAccountName("201", 1000)).toEqual({ name: null, reason: "Xero API error (401): insufficient scope" });
    m.connected.mockResolvedValue(false);
    expect(await xeroAccountName("202", 1000)).toEqual({ name: null, reason: "Xero is not connected." });
  });
});

describe("saved invoice items", () => {
  it("accepts a valid list and refuses a negative rate or a blank name", () => {
    expect(savedItemsSchema.safeParse({ items: [{ id: "a1", name: "Key cut", rate: 15, gst: true }], expectedUpdatedAt: null }).success).toBe(true);
    expect(savedItemsSchema.safeParse({ items: [{ id: "a1", name: "Key cut", rate: -1, gst: true }] }).success).toBe(false);
    expect(savedItemsSchema.safeParse({ items: [{ id: "a1", name: " ", rate: 1, gst: false }] }).success).toBe(false);
  });
});
