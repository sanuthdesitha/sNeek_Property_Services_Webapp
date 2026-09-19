// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/reports/pdf", () => ({ renderPdfFromHtml: vi.fn() }));
vi.mock("@/lib/s3", () => ({ publicUrl: (value: string) => value }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ pricing: { gstEnabled: false } }) }));
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: async () => `fixture-${randomUUID()}` }));
import { generateClientInvoice } from "@/lib/billing/client-invoices";
const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
const day = new Date("2026-09-10T00:00:00Z");
const window = { periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T23:59:59.999Z"), periodBasis: "SCHEDULED" as const };
async function job(suffix: string, status: string, extra: Record<string, unknown> = {}, started = false) {
  const jobId = `${id}-${suffix}`;
  await m.client.job.create({ data: { id: jobId, jobNumber: jobId, propertyId: id, jobType: "GENERAL_CLEAN", status, scheduledDate: day, fixedPrice: 100, ...extra } });
  if (started) await m.client.timeLog.create({ data: { jobId, userId: id, startedAt: day, stoppedAt: new Date(day.getTime() + 60_000), durationM: 1 } });
  return jobId;
}
describe.skipIf(!url)("client invoice started-job selection on PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/^postgres(ql)?:$/.test(parsed.protocol) || Array.from(parsed.searchParams.keys()).some(key => ["host", "hostaddr"].includes(key.toLowerCase()))) throw new Error("Explicit loopback PostgreSQL required");
    m.client = new PrismaClient({ datasources: { db: { url } } }); await m.client.$connect();
  });
  beforeEach(async () => {
    id = `qa-invoice-${randomUUID()}`;
    await m.client.client.createMany({ data: [{ id, name: "Invoice fixture" }, { id: `${id}-other`, name: "Other invoice fixture" }] });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "CLEANER" } });
    await m.client.property.createMany({ data: [
      { id, clientId: id, name: "Invoice property", address: "1 Test Street", suburb: "Sydney" },
      { id: `${id}-second`, clientId: id, name: "Second property", address: "2 Test Street", suburb: "Sydney" },
      { id: `${id}-other`, clientId: `${id}-other`, name: "Other property", address: "3 Test Street", suburb: "Sydney" },
    ] });
  });
  afterEach(async () => {
    if (!m.client || !id) return;
    await m.client.clientInvoice.deleteMany({ where: { clientId: { in: [id, `${id}-other`] } } });
    await m.client.timeLog.deleteMany({ where: { userId: id } });
    await m.client.job.deleteMany({ where: { id: { startsWith: `${id}-` } } });
    await m.client.property.deleteMany({ where: { clientId: { in: [id, `${id}-other`] } } });
    await m.client.user.delete({ where: { id } }); await m.client.client.deleteMany({ where: { id: { in: [id, `${id}-other`] } } });
  });
  afterAll(async () => m.client?.$disconnect());
  it("includes every started state and retained clock history while excluding scoped or unstarted work", async () => {
    const expected: string[] = [];
    for (const status of ["IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL", "SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"]) expected.push(await job(status, status));
    for (const status of ["UNASSIGNED", "OFFERED", "ASSIGNED", "EN_ROUTE"]) {
      expected.push(await job(`${status}-started`, status, {}, true));
      await job(`${status}-not-started`, status);
    }
    await job("skipped", "IN_PROGRESS", { cleanSkipStatus: "SKIPPED" }, true);
    await job("out-of-window", "COMPLETED", { scheduledDate: new Date("2026-08-31T23:59:59Z") });
    await job("other-client", "IN_PROGRESS", { propertyId: `${id}-other` });
    const billed = await job("already-billed", "IN_PROGRESS");
    const voided = await job("voided", "PAUSED"); expected.push(voided);
    for (const [jobId, status] of [[billed, "DRAFT"], [voided, "VOID"]]) await m.client.clientInvoice.create({ data: { clientId: id, invoiceNumber: `${jobId}-invoice`, status, lines: { create: { jobId, description: "Previous bill", quantity: 1, unitPrice: 100, lineTotal: 100, category: "SERVICE" } } } });
    const invoice = await generateClientInvoice({ clientId: id, ...window });
    expect(invoice.lines.map(line => line.jobId).sort()).toEqual(expected.sort());
    expect(invoice.totalAmount).toBe(expected.length * 100);
    expect(invoice.generationSummary).toEqual({ includedJobCount: expected.length, alreadyInvoicedJobCount: 1 });
    expect(invoice.metadata).toMatchObject({ generationSummary: invoice.generationSummary });
    await expect(generateClientInvoice({ clientId: id, ...window })).rejects.toThrow(`${expected.length + 1} eligible job(s) are already on a non-void invoice, including drafts.`);
  });
  it("preserves property and completion-only automation boundaries", async () => {
    const finished = await job("finished", "COMPLETED");
    await job("in-progress", "IN_PROGRESS");
    await job("historical-start", "OFFERED", {}, true);
    await job("second-property", "COMPLETED", { propertyId: `${id}-second` });
    const invoice = await generateClientInvoice({ clientId: id, propertyId: id, completedOnly: true, ...window });
    expect(invoice.lines.map(line => line.jobId)).toEqual([finished]);
  });
  it("combines historical starts with the service-date window without bypassing either branch", async () => {
    const historical = await job("historical-in-window", "OFFERED", {}, true);
    const completed = await job("completed-in-window", "COMPLETED", { scheduledDate: new Date("2026-08-31T00:00:00Z"), completedAt: day });
    await job("historical-outside", "UNASSIGNED", { scheduledDate: new Date("2026-08-31T00:00:00Z") }, true);
    await job("completed-later", "COMPLETED", { completedAt: new Date("2026-10-01T00:00:00Z") });
    const invoice = await generateClientInvoice({ clientId: id, ...window, periodBasis: "SERVICE" });
    expect(invoice.lines.map(line => line.jobId).sort()).toEqual([historical, completed].sort());
  });
});
