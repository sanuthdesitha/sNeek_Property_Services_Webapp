// @vitest-environment node
/**
 * New invoice → From finished jobs on PostgreSQL (SNEEK_TEST_DATABASE_URL,
 * loopback 127.0.0.1:55439, a disposable database):
 *  - the preview holds exactly the jobs and charges the generator bills, with
 *    each job's charge source, and a job with no rate has no amount;
 *  - the draft made through the panel (request key) is identical to the draft
 *    the existing generator makes for the same selection (parity);
 *  - an unrated job blocks the draft unless named, then it is left off and
 *    listed on the draft as "not billed: no rate";
 *  - the same request key twice makes one draft;
 *  - issued invoices are never touched (their jobs are listed as already on
 *    them, their totals and lines unchanged);
 *  - the period starts the day after the client's last invoice ended.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient, numbers: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/reports/pdf", () => ({ renderPdfFromHtml: vi.fn() }));
vi.mock("@/lib/s3", () => ({ publicUrl: (value: string) => value }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ pricing: { gstEnabled: true }, invoicing: { defaultPaymentTermsDays: 14 }, timezone: "Australia/Sydney" }), getTransactionAppSettings: async () => ({}) }));
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: async () => `NI-${randomUUID().slice(0, 8)}-${(m.numbers += 1)}` }));

import { generateClientInvoice } from "@/lib/billing/client-invoices";
import { previewClientInvoiceGeneration } from "@/lib/billing/client-invoice-generate-preview";
import { runGenerateRequest, generateRequestSchema } from "@/lib/billing/client-invoice-generate-request";
import { defaultInvoicePeriod } from "@/lib/billing/invoice-period-default";
import { sydneyDayBoundary } from "@/lib/billing/period";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
const day = (value: string) => new Date(`${value}T01:00:00.000Z`);

async function seed(options: { unrated?: boolean } = {}) {
  id = `ni-${randomUUID().slice(0, 12)}`;
  const c = m.client;
  await c.user.create({ data: { id, email: `${id}@example.invalid`, role: "ADMIN", isActive: true } });
  await c.client.create({ data: { id, name: `Harbour ${id}` } });
  await c.property.create({ data: { id: `${id}-bondi`, clientId: id, name: "Bondi Beach House", address: "1 Test St", suburb: "Bondi" } });
  await c.property.create({ data: { id: `${id}-coogee`, clientId: id, name: "Coogee Terrace", address: "2 Test St", suburb: "Coogee" } });
  await c.propertyClientRate.create({ data: { propertyId: `${id}-bondi`, jobType: "AIRBNB_TURNOVER", baseCharge: 165 } });
  const job = (suffix: string, data: Record<string, unknown>) =>
    c.job.create({ data: { id: `${id}-${suffix}`, jobNumber: `${id}-${suffix}`, jobType: "AIRBNB_TURNOVER", status: "COMPLETED", scheduledDate: day("2026-11-02"), completedAt: day("2026-11-02"), ...data } as never });
  await job("j1042", { propertyId: `${id}-bondi` });
  await job("j1051", { propertyId: `${id}-bondi`, scheduledDate: day("2026-11-10"), completedAt: day("2026-11-10") });
  await job("j1049", { propertyId: `${id}-coogee`, fixedPrice: 180, invoiceNote: "late checkout agreed", scheduledDate: day("2026-11-07"), completedAt: day("2026-11-07") });
  await job("j1058", { propertyId: `${id}-coogee`, status: "CANCELLED", scheduledDate: day("2026-11-05") });
  if (options.unrated) await job("j1077", { propertyId: `${id}-coogee`, jobType: "WINDOW_CLEAN", scheduledDate: day("2026-11-12"), completedAt: day("2026-11-12") });
  // An issued (sent) invoice that already bills one job of the period.
  await job("j1039", { propertyId: `${id}-bondi`, scheduledDate: day("2026-11-03"), completedAt: day("2026-11-03") });
  await c.clientInvoice.create({
    data: {
      id: `${id}-issued`, clientId: id, invoiceNumber: `${id}-INV-0418`, status: "SENT", gstEnabled: true, subtotal: 165, gstAmount: 16.5, totalAmount: 181.5,
      periodStart: sydneyDayBoundary("2026-10-01", "start"), periodEnd: sydneyDayBoundary("2026-10-31", "end"), sentAt: new Date("2026-11-01T00:00:00.000Z"),
      lines: { create: [{ jobId: `${id}-j1039`, description: "Bondi - Airbnb turnover", quantity: 1, unitPrice: 165, lineTotal: 165, category: "SERVICE" }] },
    },
  });
}

async function cleanup() {
  const c = m.client;
  await c.auditLog.deleteMany({ where: { userId: id } });
  await c.clientInvoice.deleteMany({ where: { clientId: id } });
  await c.job.deleteMany({ where: { property: { clientId: id } } });
  await c.propertyClientRate.deleteMany({ where: { property: { clientId: id } } });
  await c.property.deleteMany({ where: { clientId: id } });
  await c.client.deleteMany({ where: { id } });
  await c.user.deleteMany({ where: { id } });
}

const selection = () => ({ clientId: id, periodStart: sydneyDayBoundary("2026-11-01", "start"), periodEnd: sydneyDayBoundary("2026-11-14", "end"), periodBasis: "SCHEDULED" as const, gstEnabled: true });
const request = (extra: Record<string, unknown> = {}) => generateRequestSchema.parse({ requestKey: `generate:${randomUUID()}`, clientId: id, periodStart: "2026-11-01", periodEnd: "2026-11-14", periodBasis: "SCHEDULED", gstEnabled: true, ...extra });

function comparable(invoice: { subtotal: number; gstAmount: number; totalAmount: number; gstEnabled: boolean; status: string; periodStart: Date | null; periodEnd: Date | null; metadata: unknown; lines: Array<Record<string, unknown>> }) {
  return {
    status: invoice.status, subtotal: invoice.subtotal, gstAmount: invoice.gstAmount, totalAmount: invoice.totalAmount, gstEnabled: invoice.gstEnabled,
    periodStart: invoice.periodStart?.toISOString(), periodEnd: invoice.periodEnd?.toISOString(), metadata: invoice.metadata,
    lines: invoice.lines
      .map(({ jobId, description, note, quantity, unitPrice, lineTotal, category, shoppingRunId, propertyId }) => ({ jobId, description, note, quantity, unitPrice, lineTotal, category, shoppingRunId, propertyId }))
      .sort((a, b) => String(a.jobId).localeCompare(String(b.jobId))),
  };
}

describe.skipIf(!url)("New invoice from finished jobs on PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Dedicated loopback fixture database on 127.0.0.1:55439 required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
    await m.client.priceBook.deleteMany({ where: { jobType: { in: ["WINDOW_CLEAN", "AIRBNB_TURNOVER"] } } });
  });
  afterAll(async () => {
    if (id && m.client) await cleanup();
    await m.client?.$disconnect();
  });
  beforeEach(async () => {
    if (id) await cleanup();
  });

  it("previews exactly what the generator bills, with each charge's source", async () => {
    await seed({ unrated: true });
    const preview = await previewClientInvoiceGeneration(selection());
    const byJob = Object.fromEntries(preview.jobs.map((job) => [job.jobId.slice(id.length + 1), job]));
    expect(Object.keys(byJob).sort()).toEqual(["j1042", "j1049", "j1051", "j1077"]);
    expect(byJob.j1042).toMatchObject({ source: "PROPERTY_RATE", amount: 165, propertyName: "Bondi Beach House" });
    expect(byJob.j1049).toMatchObject({ source: "FIXED_JOB", amount: 180, note: "late checkout agreed" });
    expect(byJob.j1077).toMatchObject({ source: "MISSING", amount: null, lineDescription: null });
    expect(preview.unratedJobIds).toEqual([`${id}-j1077`]);
    expect(preview.jobTotals).toEqual({ subtotal: 510, gstAmount: 51, totalAmount: 561 });
    expect(preview.chargedJobCount).toBe(3);
    expect(preview.leftOut).toEqual(expect.arrayContaining([
      { jobId: `${id}-j1039`, jobNumber: `${id}-j1039`, reason: "ALREADY_INVOICED", invoiceNumber: `${id}-INV-0418` },
      { jobId: `${id}-j1058`, jobNumber: `${id}-j1058`, reason: "CANCELLED", invoiceNumber: null },
    ]));
    expect(await m.client.clientInvoice.count({ where: { clientId: id } })).toBe(1);
  });

  it("makes the same draft as the existing generator for the same selection", async () => {
    await seed();
    const existing = await generateClientInvoice(selection());
    const existingRow = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: existing.id }, include: { lines: true } });
    // Free the jobs again (a draft holds them), then make it through the panel.
    await m.client.clientInvoice.delete({ where: { id: existing.id } });
    const result = await runGenerateRequest({ request: request(), actorId: id });
    expect(result.status).toBe(200);
    const panelRow = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: (result.body as { id: string }).id }, include: { lines: true } });
    expect(comparable(panelRow)).toEqual(comparable(existingRow));
    expect(panelRow.status).toBe("DRAFT");
  });

  it("refuses an unrated job unless named, then leaves it off and lists it on the draft", async () => {
    await seed({ unrated: true });
    const refused = await runGenerateRequest({ request: request(), actorId: id });
    expect(refused).toMatchObject({ status: 400, body: { error: expect.stringContaining("Missing client rates for 1 job(s)") } });
    expect(await m.client.clientInvoice.count({ where: { clientId: id, status: "DRAFT" } })).toBe(0);

    const result = await runGenerateRequest({ request: request({ leaveOutUnratedJobIds: [`${id}-j1077`] }), actorId: id });
    expect(result.status).toBe(200);
    const body = result.body as { id: string; notBilled: Array<{ jobId: string }> };
    expect(body.notBilled).toEqual([{ jobId: `${id}-j1077`, jobNumber: `${id}-j1077` }]);
    const draft = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: body.id }, include: { lines: true } });
    expect(draft.lines.map((line) => line.jobId)).not.toContain(`${id}-j1077`);
    expect(draft.lines.every((line) => line.lineTotal > 0)).toBe(true);
    expect((draft.metadata as { notBilled: unknown[] }).notBilled).toEqual([expect.objectContaining({ jobId: `${id}-j1077`, reason: "NO_RATE", propertyName: "Coogee Terrace" })]);
    expect([draft.subtotal, draft.totalAmount]).toEqual([510, 561]);
  });

  it("still refuses an unrated job that was not named", async () => {
    await seed({ unrated: true });
    const result = await runGenerateRequest({ request: request({ leaveOutUnratedJobIds: ["someone-else"] }), actorId: id });
    expect(result.status).toBe(400);
    expect(await m.client.clientInvoice.count({ where: { clientId: id, status: "DRAFT" } })).toBe(0);
  });

  it("makes one draft for one request key, even when sent twice", async () => {
    await seed();
    const once = request();
    const first = await runGenerateRequest({ request: once, actorId: id });
    const second = await runGenerateRequest({ request: once, actorId: id });
    expect(first.status).toBe(200);
    expect(second).toMatchObject({ status: 200, body: { id: (first.body as { id: string }).id, replayed: true } });
    expect(await m.client.clientInvoice.count({ where: { clientId: id, status: "DRAFT" } })).toBe(1);
    const reused = await runGenerateRequest({ request: { ...once, gstEnabled: false }, actorId: id });
    expect(reused.status).toBe(409);
  });

  it("never touches an issued invoice", async () => {
    await seed();
    const before = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: `${id}-issued` }, include: { lines: true } });
    await runGenerateRequest({ request: request(), actorId: id });
    const after = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: `${id}-issued` }, include: { lines: true } });
    expect(after).toEqual(before);
    const drafts = await m.client.clientInvoice.findMany({ where: { clientId: id, status: "DRAFT" }, include: { lines: true } });
    expect(drafts.flatMap((draft) => draft.lines.map((line) => line.jobId))).not.toContain(`${id}-j1039`);
  });

  it("starts the period the day after the client's last live invoice ended, else on the 1st", async () => {
    await seed();
    expect(await defaultInvoicePeriod(id, "Australia/Sydney", new Date("2026-11-14T03:00:00.000Z"))).toEqual({
      start: "2026-11-01", end: "2026-11-14", source: "LAST_INVOICE", lastInvoiceNumber: `${id}-INV-0418`, lastPeriodEnd: "2026-10-31",
    });
    await m.client.clientInvoice.update({ where: { id: `${id}-issued` }, data: { status: "VOID" } });
    expect(await defaultInvoicePeriod(id, "Australia/Sydney", new Date("2026-11-14T03:00:00.000Z"))).toMatchObject({ start: "2026-11-01", source: "MONTH_START" });
  });
});
