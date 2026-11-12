// @vitest-environment node
/**
 * Money Wave D on a real PostgreSQL database (SNEEK_TEST_DATABASE_URL, loopback):
 *  - the SQL owing expression equals invoiceAmountOwing over many fixtures
 *    (payments, approved/sent/draft/void credit notes, credit notes, void),
 *    and the list sorts the whole filtered set by it;
 *  - "Add finished jobs" adds a job with the generator's own line and totals,
 *    and refuses a job already on a live invoice or with no rate;
 *  - a draft's Bill to moves only when every job belongs to the new client;
 *  - approval refuses a draft whose job is also on another live invoice;
 *  - "Create N drafts" runs the generator per client once per request key;
 *  - a failed Xero push is recorded FAILED and listed under "Push failed".
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, push: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/reports/pdf", () => ({ renderPdfFromHtml: vi.fn() }));
vi.mock("@/lib/s3", () => ({ publicUrl: (value: string) => value }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ pricing: { gstEnabled: false }, invoicing: { defaultPaymentTermsDays: 14 }, timezone: "Australia/Sydney" }), getTransactionAppSettings: async () => ({}) }));
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: async () => `fixture-${randomUUID()}` }));
vi.mock("@/lib/phase3/integrations", () => ({ getPhase3IntegrationsSettings: async () => ({ xero: { defaultAccountCode: "200", salesTaxType: "", defaultItemCode: "", itemCodeByService: {} }, stripe: { enabled: false } }) }));
vi.mock("@/lib/xero/client", () => ({ pushClientInvoiceToXero: m.push, pushClientCreditNoteToXero: m.push }));

import { invoiceAmountOwing, creditedAmountOf } from "@/lib/finance/receivables";
import { owingByIdSql, pageIdsByOwing } from "@/lib/billing/client-invoice-owing-sql";
import { addJobsToInvoice } from "@/lib/billing/client-invoice-add-jobs";
import { patchClientInvoice } from "@/lib/billing/client-invoice-patch";
import { runBatchGenerate } from "@/lib/billing/client-invoice-batch-generate";
import { pushClientInvoiceToXeroOnce } from "@/lib/billing/client-invoice-xero";
import { listClientInvoices } from "@/lib/billing/client-invoice-list";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
const day = new Date("2026-09-10T00:00:00Z");
const actor = () => ({ id, role: "ADMIN", name: "Admin", email: `${id}@example.invalid` });

async function job(suffix: string, extra: Record<string, unknown> = {}, propertyId = id) {
  const jobId = `${id}-${suffix}`;
  await m.client.job.create({ data: { id: jobId, jobNumber: jobId, propertyId, jobType: "GENERAL_CLEAN", status: "COMPLETED", scheduledDate: day, completedAt: day, fixedPrice: 100, ...extra } as never });
  return jobId;
}

async function invoice(suffix: string, data: Record<string, unknown> = {}, jobIds: string[] = [], clientId = id) {
  return m.client.clientInvoice.create({ data: {
    id: `${id}-${suffix}`, clientId, invoiceNumber: `${id}-${suffix}`, status: "DRAFT", subtotal: 100 * jobIds.length, totalAmount: 100 * jobIds.length, gstEnabled: false,
    ...data,
    lines: { create: jobIds.map((jobId) => ({ jobId, description: `Clean ${jobId}`, quantity: 1, unitPrice: 100, lineTotal: 100, category: "SERVICE" })) },
  } as never });
}

describe.skipIf(!url)("Money Wave D on PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Explicit loopback PostgreSQL required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });
  beforeEach(async () => {
    id = `wd-${randomUUID()}`;
    m.push.mockReset();
    await m.client.client.create({ data: { id, name: `Wave D ${id}` } });
    await m.client.client.create({ data: { id: `${id}-other`, name: `Other ${id}` } });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "ADMIN", isActive: true } });
    await m.client.property.create({ data: { id, clientId: id, name: "Fixture property", address: "1 Test Street", suburb: "Sydney" } });
    await m.client.property.create({ data: { id: `${id}-other`, clientId: `${id}-other`, name: "Other property", address: "2 Test Street", suburb: "Sydney" } });
  });
  afterEach(async () => {
    if (!m.client || !id) return;
    const clients = [id, `${id}-other`];
    await m.client.auditLog.deleteMany({ where: { userId: id } });
    await m.client.clientInvoiceLine.deleteMany({ where: { invoice: { clientId: { in: clients } } } });
    await m.client.clientInvoice.deleteMany({ where: { clientId: { in: clients }, kind: "CREDIT_NOTE" } });
    await m.client.clientInvoice.deleteMany({ where: { clientId: { in: clients } } });
    await m.client.job.deleteMany({ where: { propertyId: { in: clients } } });
    await m.client.property.deleteMany({ where: { clientId: { in: clients } } });
    await m.client.user.deleteMany({ where: { id } });
    await m.client.client.deleteMany({ where: { id: { in: clients } } });
  });
  afterAll(async () => m.client?.$disconnect());

  it("orders by the SQL owing, which equals invoiceAmountOwing on every fixture", async () => {
    const fixtures: Array<{ total: number; paid: number | null; status: string; kind?: string; credits: Array<{ status: string; total: number }> }> = [];
    for (let n = 0; n < 40; n += 1) {
      const total = Number((50 + ((n * 37.17) % 900)).toFixed(2));
      fixtures.push({
        total,
        paid: n % 3 === 0 ? null : Number(((total * (n % 5)) / 7).toFixed(2)),
        status: ["SENT", "PART_PAID", "PAID", "VOID", "DRAFT"][n % 5],
        kind: n % 11 === 0 ? "CREDIT_NOTE" : "INVOICE",
        credits: n % 4 === 0 ? [{ status: "SENT", total: -12.34 }, { status: "DRAFT", total: -99 }, { status: "VOID", total: -5 }, { status: "APPROVED", total: -0.333 }] : n % 6 === 0 ? [{ status: "APPROVED", total: -(total + 10) }] : [],
      });
    }
    const ids: string[] = [];
    // A credit note always credits an invoice (database check constraint).
    const anchor = await invoice("own-anchor", { status: "SENT", totalAmount: 5000 });
    for (const [index, fixture] of fixtures.entries()) {
      const creditNote = fixture.kind === "CREDIT_NOTE";
      const created = await invoice(`own-${index}`, {
        status: fixture.status,
        kind: fixture.kind ?? "INVOICE",
        totalAmount: creditNote ? -fixture.total : fixture.total,
        paidAmount: creditNote ? null : fixture.paid,
        ...(creditNote ? { creditsInvoiceId: anchor.id } : {}),
      });
      ids.push(created.id);
      for (const [c, credit] of fixture.credits.entries()) {
        await invoice(`own-${index}-cn-${c}`, { kind: "CREDIT_NOTE", status: credit.status, totalAmount: credit.total, creditsInvoiceId: created.id });
      }
    }
    const sql = await owingByIdSql(ids);
    const rows = await m.client.clientInvoice.findMany({ where: { id: { in: ids } }, select: { id: true, kind: true, totalAmount: true, paidAmount: true, creditNotes: { select: { status: true, totalAmount: true } } } });
    for (const row of rows) {
      const expected = row.kind === "CREDIT_NOTE" ? 0 : invoiceAmountOwing({ totalAmount: row.totalAmount, paidAmount: row.paidAmount, creditedAmount: creditedAmountOf(row.creditNotes) });
      expect(sql.get(row.id)).toBeCloseTo(expected, 9);
    }
    const ordered = await pageIdsByOwing({ ids, dir: "desc", skip: 0, take: ids.length });
    const owing = ordered.map((rowId) => sql.get(rowId)!);
    expect(owing).toEqual([...owing].sort((a, b) => b - a));
    const listed = await listClientInvoices({
      query: { page: 1, pageSize: 100, sort: "owing", dir: "asc", skip: 0, take: 100 },
      filters: { status: "all", clientId: id, periodFrom: null, periodTo: null, xero: "any", search: null },
    });
    const all = await owingByIdSql(listed.rows.map((row) => row.id));
    const listedOwing = listed.rows.map((row) => all.get(row.id)!);
    expect(listedOwing).toEqual([...listedOwing].sort((a, b) => a - b));
  });

  it("adds finished jobs with the generator's line and totals, refusing billed or unrated jobs", async () => {
    const billed = await job("billed");
    const unrated = await job("unrated", { fixedPrice: null });
    const fresh = await job("fresh", { fixedPrice: 180 });
    await invoice("live", { status: "SENT" }, [billed]);
    const draft = await invoice("draft", {}, []);
    const refusedBilled = await addJobsToInvoice({ invoiceId: draft.id, jobIds: [billed], actor: actor() });
    expect(refusedBilled.status).toBe(409);
    expect(String(refusedBilled.body.error)).toContain("no longer a finished, unbilled job");
    const refusedRate = await addJobsToInvoice({ invoiceId: draft.id, jobIds: [unrated], actor: actor() });
    expect(String(refusedRate.body.error)).toContain("no client rate");
    const stale = await addJobsToInvoice({ invoiceId: draft.id, jobIds: [fresh], actor: actor(), expectedUpdatedAt: "2020-01-01T00:00:00.000Z" });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("STALE_INVOICE");
    const added = await addJobsToInvoice({ invoiceId: draft.id, jobIds: [fresh], actor: actor(), expectedUpdatedAt: draft.updatedAt.toISOString() });
    expect(added.status).toBe(200);
    const stored = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: true } });
    expect(stored.lines).toHaveLength(1);
    expect(stored.lines[0]).toMatchObject({ jobId: fresh, unitPrice: 180, lineTotal: 180, quantity: 1, category: "SERVICE" });
    expect(stored.totalAmount).toBe(180);
    // The same job cannot be added twice.
    expect((await addJobsToInvoice({ invoiceId: draft.id, jobIds: [fresh], actor: actor() })).status).toBe(409);
  });

  it("moves a draft's Bill to only when every job belongs to the new client", async () => {
    const mine = await job("mine");
    const draft = await invoice("move", {}, [mine]);
    const refused = await patchClientInvoice({ invoiceId: draft.id, body: { clientId: `${id}-other` }, actor: actor() });
    expect(refused.status).toBe(409);
    expect(String(refused.body.error)).toContain("Every job on this draft must belong to");
    const blank = await invoice("blank", {}, []);
    const moved = await patchClientInvoice({ invoiceId: blank.id, body: { clientId: `${id}-other`, paymentTermsDays: 30, period: { start: "2026-09-01", end: "2026-09-15" } }, actor: actor() });
    expect(moved.status).toBe(200);
    const stored = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: blank.id } });
    expect(stored).toMatchObject({ clientId: `${id}-other`, paymentTermsDays: 30 });
    // Approved: read only.
    await m.client.clientInvoice.update({ where: { id: blank.id }, data: { status: "APPROVED" } });
    expect((await patchClientInvoice({ invoiceId: blank.id, body: { paymentTermsDays: 7 }, actor: actor() })).status).toBe(409);
  });

  it("refuses approving a draft whose job is also on another live invoice", async () => {
    const shared = await job("shared");
    await invoice("first", { status: "APPROVED" }, [shared]);
    const second = await invoice("second", {}, [shared]);
    const refused = await patchClientInvoice({ invoiceId: second.id, body: { status: "APPROVED" }, actor: actor() });
    expect(refused.status).toBe(409);
    expect(String(refused.body.error)).toContain("also on another invoice");
    expect((await m.client.clientInvoice.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("DRAFT");
  });

  it("creates one draft per client once per request key, with per-client outcomes", async () => {
    await job("batch-a");
    await job("batch-other", { fixedPrice: null }, `${id}-other`);
    const request = { requestKey: `key-${id}`, periodStart: null, periodEnd: null, periodBasis: "SCHEDULED" as const, gstEnabled: false };
    const first = await runBatchGenerate({ request, actorId: id });
    expect(first.status).toBe(200);
    const body = first.body as { results: Array<{ clientId: string; outcome: string; reason?: string }> };
    expect(body.results.find((row) => row.clientId === id)?.outcome).toBe("created");
    const other = body.results.find((row) => row.clientId === `${id}-other`);
    expect(other?.outcome).toBe("refused");
    expect(other?.reason).toContain("Missing client rates");
    const replay = await runBatchGenerate({ request, actorId: id });
    expect(replay.body).toMatchObject({ replayed: true });
    expect(await m.client.clientInvoice.count({ where: { clientId: id } })).toBe(1);
    const mismatch = await runBatchGenerate({ request: { ...request, gstEnabled: true }, actorId: id });
    expect(mismatch.status).toBe(409);
  });

  it("records a failed Xero push as FAILED with its reason and lists it under Push failed", async () => {
    const draft = await invoice("xero", { status: "SENT", subtotal: 100, totalAmount: 100 }, [await job("xero-job")]);
    m.push.mockRejectedValueOnce(new Error("Xero API error (400): Account code '999' is not valid. Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"));
    const failed = await pushClientInvoiceToXeroOnce(draft.id, id);
    expect(failed.status).toBe(400);
    const stored = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: draft.id } });
    const metadata = stored.metadata as { xeroExportState: string; xeroExportFailure: { reason: string; at: string } };
    expect(metadata.xeroExportState).toBe("FAILED");
    expect(metadata.xeroExportFailure.reason).toContain("Account code '999'");
    expect(metadata.xeroExportFailure.reason).not.toContain("abcdefghijklmnop");
    const listed = await listClientInvoices({
      query: { page: 1, pageSize: 25, sort: "created", dir: "desc", skip: 0, take: 25 },
      filters: { status: "all", clientId: id, periodFrom: null, periodTo: null, xero: "failed", search: null },
    });
    expect(listed.rows.map((row) => row.id)).toEqual([draft.id]);
    expect(listed.rows[0].xeroPushFailure?.reason).toContain("Account code");
    // Locked against edits; a retry with the same key succeeds and clears the failure.
    expect((await patchClientInvoice({ invoiceId: draft.id, body: { clientNote: "x" }, actor: actor() })).status).toBe(409);
    m.push.mockResolvedValueOnce({ xeroInvoiceId: "xero-1", contactId: "contact-1" });
    expect((await pushClientInvoiceToXeroOnce(draft.id, id)).status).toBe(200);
    expect(m.push.mock.calls.every(([input]) => input.idempotencyKey === `client-invoice-${draft.id}`)).toBe(true);
    const after = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.metadata).toMatchObject({ xeroExportState: "EXPORTED" });
    expect((after.metadata as Record<string, unknown>).xeroExportFailure).toBeUndefined();
  });
});
