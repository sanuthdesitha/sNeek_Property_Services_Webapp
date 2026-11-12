// @vitest-environment node
/**
 * Finance decisions (2026-11-11) on a real PostgreSQL database:
 *  - voiding an invoice / fully crediting it returns its INVOICED jobs to
 *    billable (status restored from audit, else COMPLETED), audited; a partial
 *    credit does not; nothing on the invoice's lines, totals or payments moves;
 *  - the generator bills the job again after void / full credit;
 *  - deleting a job whose only line is on a VOID invoice is allowed and keeps
 *    the voided invoice's line (jobId set null, description and amount kept);
 *  - a sent invoice keeps its snapshotted terms when the client's terms change.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/reports/pdf", () => ({ renderPdfFromHtml: vi.fn() }));
vi.mock("@/lib/s3", () => ({ publicUrl: (value: string) => value }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ pricing: { gstEnabled: false }, invoicing: { defaultPaymentTermsDays: 14 }, timezone: "Australia/Sydney" }), getTransactionAppSettings: async () => ({}) }));
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: async () => `fixture-${randomUUID()}` }));

import { patchClientInvoice } from "@/lib/billing/client-invoice-patch";
import { generateClientInvoice } from "@/lib/billing/client-invoices";
import { assertJobCanBeDeleted } from "@/lib/jobs/delete-financial-guard";
import { effectivePaymentTermsDays } from "@/lib/billing/invoice-due";
import { termsSnapshotFor } from "@/lib/billing/invoice-terms";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
const day = new Date("2026-09-10T00:00:00Z");
const actor = () => ({ id, role: "ADMIN", name: "Admin", email: `${id}@example.invalid` });

async function job(suffix: string, status: string) {
  const jobId = `${id}-${suffix}`;
  await m.client.job.create({ data: { id: jobId, jobNumber: jobId, propertyId: id, jobType: "GENERAL_CLEAN", status: status as never, scheduledDate: day, completedAt: day, fixedPrice: 100 } });
  return jobId;
}

async function invoice(suffix: string, status: string, jobIds: string[], extra: Record<string, unknown> = {}) {
  return m.client.clientInvoice.create({ data: {
    id: `${id}-${suffix}`, clientId: id, invoiceNumber: `${id}-${suffix}`, status: status as never, subtotal: 100 * jobIds.length, totalAmount: 100 * jobIds.length, gstEnabled: false,
    ...extra,
    lines: { create: jobIds.map((jobId) => ({ jobId, description: `Clean ${jobId}`, quantity: 1, unitPrice: 100, lineTotal: 100, category: "SERVICE" })) },
  } });
}

describe.skipIf(!url)("finance decisions on PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Explicit loopback PostgreSQL required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });
  beforeEach(async () => {
    id = `fin-${randomUUID()}`;
    await m.client.client.create({ data: { id, name: "Finance fixture" } });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "ADMIN", isActive: true } });
    await m.client.property.create({ data: { id, clientId: id, name: "Fixture property", address: "1 Test Street", suburb: "Sydney" } });
  });
  afterEach(async () => {
    if (!m.client || !id) return;
    await m.client.auditLog.deleteMany({ where: { userId: id } });
    await m.client.clientInvoiceLine.deleteMany({ where: { invoice: { clientId: id } } });
    await m.client.clientInvoice.deleteMany({ where: { clientId: id, kind: "CREDIT_NOTE" } });
    await m.client.clientInvoice.deleteMany({ where: { clientId: id } });
    await m.client.job.deleteMany({ where: { propertyId: id } });
    await m.client.property.deleteMany({ where: { clientId: id } });
    await m.client.user.deleteMany({ where: { id } });
    await m.client.client.deleteMany({ where: { id } });
  });
  afterAll(async () => m.client?.$disconnect());

  it("voiding returns INVOICED jobs to their audited earlier status (else COMPLETED), audited, and leaves lines and totals alone", async () => {
    const audited = await job("audited", "INVOICED");
    const plain = await job("plain", "INVOICED");
    const elsewhere = await job("elsewhere", "INVOICED");
    await m.client.auditLog.create({ data: { userId: id, jobId: audited, action: "BULK_UPDATE_JOB_STATUS", entity: "Job", entityId: audited, before: { status: "QA_REVIEW" }, after: { status: "INVOICED" } } });
    const inv = await invoice("a", "APPROVED", [audited, plain, elsewhere]);
    await invoice("b", "DRAFT", [elsewhere]);
    const result = await patchClientInvoice({ invoiceId: inv.id, body: { status: "VOID" }, actor: actor() });
    expect(result.status).toBe(200);
    const jobs = await m.client.job.findMany({ where: { id: { in: [audited, plain, elsewhere] } }, select: { id: true, status: true } });
    const status = Object.fromEntries(jobs.map((row) => [row.id, row.status]));
    expect(status).toEqual({ [audited]: "QA_REVIEW", [plain]: "COMPLETED", [elsewhere]: "INVOICED" });
    const rows = await m.client.auditLog.findMany({ where: { action: "JOB_RETURNED_TO_BILLABLE", jobId: { in: [audited, plain] } } });
    expect(rows).toHaveLength(2);
    expect((rows[0].after as { note: string }).note).toContain(`invoice ${inv.invoiceNumber} voided`);
    const after = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: inv.id }, include: { lines: true } });
    expect(after).toMatchObject({ status: "VOID", totalAmount: 300, subtotal: 300 });
    expect(after.lines.map((line) => line.lineTotal)).toEqual([100, 100, 100]);
    // Billable again: the generator picks up the freed jobs.
    const regenerated = await generateClientInvoice({ clientId: id, periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T23:59:59Z"), periodBasis: "SCHEDULED", completedOnly: true } as never);
    const regeneratedLines = await m.client.clientInvoiceLine.findMany({ where: { invoiceId: (regenerated as { id: string }).id }, select: { jobId: true } });
    // completedOnly bills COMPLETED/INVOICED work: the job restored to QA_REVIEW waits for QA.
    expect(regeneratedLines.map((line) => line.jobId)).toEqual([plain]);
  });

  it("a full credit note frees the jobs; a partial one does not; voiding the full one is refused once the work is rebilled", async () => {
    const full = await job("full", "INVOICED");
    const partial = await job("partial", "INVOICED");
    const fullInv = await invoice("full", "SENT", [full], { sentAt: day });
    const partInv = await invoice("part", "SENT", [partial], { sentAt: day });
    const fullCn = await m.client.clientInvoice.create({ data: { id: `${id}-cn1`, clientId: id, invoiceNumber: `${id}-cn1`, kind: "CREDIT_NOTE", creditsInvoiceId: fullInv.id, status: "DRAFT", subtotal: -100, totalAmount: -100, gstEnabled: false, lines: { create: [{ description: "Credit", quantity: 1, unitPrice: -100, lineTotal: -100, category: "SERVICE" }] } } });
    const partCn = await m.client.clientInvoice.create({ data: { id: `${id}-cn2`, clientId: id, invoiceNumber: `${id}-cn2`, kind: "CREDIT_NOTE", creditsInvoiceId: partInv.id, status: "DRAFT", subtotal: -40, totalAmount: -40, gstEnabled: false, lines: { create: [{ description: "Credit", quantity: 1, unitPrice: -40, lineTotal: -40, category: "SERVICE" }] } } });
    expect((await patchClientInvoice({ invoiceId: fullCn.id, body: { status: "APPROVED" }, actor: actor() })).status).toBe(200);
    expect((await patchClientInvoice({ invoiceId: partCn.id, body: { status: "APPROVED" }, actor: actor() })).status).toBe(200);
    expect((await m.client.clientInvoice.findUniqueOrThrow({ where: { id: fullInv.id } })).creditedInFullAt).not.toBeNull();
    expect((await m.client.clientInvoice.findUniqueOrThrow({ where: { id: partInv.id } })).creditedInFullAt).toBeNull();
    expect((await m.client.job.findUniqueOrThrow({ where: { id: full } })).status).toBe("COMPLETED");
    expect((await m.client.job.findUniqueOrThrow({ where: { id: partial } })).status).toBe("INVOICED");
    // Rebill the freed job, then voiding the credit note would bill it twice.
    await invoice("rebill", "DRAFT", [full]);
    const refused = await patchClientInvoice({ invoiceId: fullCn.id, body: { status: "VOID" }, actor: actor() });
    expect(refused.status).toBe(409);
    expect(String(refused.body.error)).toContain("bill it twice");
  });

  it("a job whose only line is on a VOID invoice can be deleted; the voided line is kept", async () => {
    const jobId = await job("del", "COMPLETED");
    const inv = await invoice("void", "VOID", [jobId]);
    await m.client.$transaction(async (tx) => assertJobCanBeDeleted(tx, jobId));
    await m.client.job.delete({ where: { id: jobId } });
    const lines = await m.client.clientInvoiceLine.findMany({ where: { invoiceId: inv.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ jobId: null, description: `Clean ${jobId}`, lineTotal: 100 });
  });

  it("a fully credited (not void) invoice still blocks deletion", async () => {
    const jobId = await job("credited", "COMPLETED");
    await invoice("credited", "SENT", [jobId], { sentAt: day, creditedInFullAt: new Date() });
    await expect(m.client.$transaction(async (tx) => assertJobCanBeDeleted(tx, jobId))).rejects.toThrow("financial records");
  });

  it("the first send snapshots terms; changing the client's terms later does not move it, a new invoice uses the new terms", async () => {
    await m.client.client.update({ where: { id }, data: { paymentTermsDays: 30 } });
    const draft = { clientId: id, paymentTermsDays: null };
    expect(await termsSnapshotFor(m.client, draft, "SENT")).toBe(30);
    expect(await termsSnapshotFor(m.client, draft, "APPROVED")).toBeUndefined();
    const sent = await invoice("sent", "SENT", [], { sentAt: day, paymentTermsDays: 30 });
    await m.client.client.update({ where: { id }, data: { paymentTermsDays: 7 } });
    const client = await m.client.client.findUniqueOrThrow({ where: { id } });
    expect(effectivePaymentTermsDays({ invoiceTermsDays: sent.paymentTermsDays, clientTermsDays: client.paymentTermsDays, organisationDefaultDays: 14 })).toBe(30);
    expect(effectivePaymentTermsDays({ invoiceTermsDays: null, clientTermsDays: client.paymentTermsDays, organisationDefaultDays: 14 })).toBe(7);
    await expect(m.client.client.update({ where: { id }, data: { paymentTermsDays: 121 } })).rejects.toThrow();
  });
});
