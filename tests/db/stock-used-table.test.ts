// @vitest-environment node
/**
 * Stock used tables against PostgreSQL: the server's stock read is scoped to
 * the job's property and carries no cost or supplier; table usage merged with
 * the "Stock & consumables used" block is deducted once per job through the
 * existing deductJobStockOnce (a second submission of the same job — a retry
 * that got past the action receipt, a reset or a rework resubmission — is
 * retained for office review and never deducted again); the low-stock rows
 * the deduction returns still come back for the post-commit triggers.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));

import { deductJobStockOnce, readSubmissionStockTable } from "@/lib/cleaner/submission-stock";
import { mergeStockUsage, resolveStockTableUsage } from "@/lib/forms/stock-table";

const url = process.env.SNEEK_TEST_DATABASE_URL;

describe.skipIf(!url)("Stock used tables (loopback PostgreSQL)", () => {
  let id = "";
  const ids = () => ({
    client: `${id}-client`, property: `${id}-p1`, other: `${id}-p2`, job: `${id}-job`, cleaner: `${id}-cleaner`,
    tp: `${id}-tp`, caps: `${id}-caps`, foreign: `${id}-foreign`, template: `${id}-template`,
  });
  const schema = {
    sections: [{ id: "s", title: "Rooms", fields: [
      { id: "bath", type: "inventory", label: "Bathroom used", stockArea: "bathroom", required: true },
      { id: "all", type: "inventory", label: "All used", stockArea: "all" },
    ] }],
  };

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Explicit loopback test database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });

  beforeEach(async () => {
    id = `stock-table-${randomUUID()}`;
    const k = ids();
    await m.client.client.create({ data: { id: k.client, name: "Stock table fixture" } });
    await m.client.user.create({ data: { id: k.cleaner, email: `${k.cleaner}@example.invalid`, role: "CLEANER" } });
    for (const propertyId of [k.property, k.other]) {
      await m.client.property.create({ data: { id: propertyId, clientId: k.client, name: propertyId, address: "1 Fixture Street", suburb: "Sydney", inventoryEnabled: true } });
    }
    await m.client.formTemplate.create({ data: { id: k.template, name: "Stock table fixture", serviceType: "AIRBNB_TURNOVER", isActive: false, schema } });
    await m.client.job.create({ data: { id: k.job, jobNumber: k.job, propertyId: k.property, jobType: "AIRBNB_TURNOVER", status: "IN_PROGRESS", scheduledDate: new Date() } });
    await m.client.inventoryItem.create({ data: { id: k.tp, name: "Toilet paper", category: "Bathroom", location: "BATHROOM", unit: "roll", supplier: "Fixture supplier" } });
    await m.client.inventoryItem.create({ data: { id: k.caps, name: "Coffee capsules", category: "Kitchen", location: "KITCHEN", unit: "capsule" } });
    await m.client.inventoryItem.create({ data: { id: k.foreign, name: "Other property's soap", category: "Bathroom", location: "BATHROOM", unit: "bottle" } });
    await m.client.propertyStock.create({ data: { propertyId: k.property, itemId: k.tp, onHand: 10, parLevel: 12, reorderThreshold: 8 } });
    await m.client.propertyStock.create({ data: { propertyId: k.property, itemId: k.caps, onHand: 30, parLevel: 30, reorderThreshold: 5 } });
    await m.client.propertyStock.create({ data: { propertyId: k.other, itemId: k.foreign, onHand: 5 } });
  });

  afterEach(async () => {
    if (!m.client || !id) return;
    const k = ids();
    await m.client.appSetting.deleteMany({ where: { key: { in: [`job_submission_stock_v1:${k.job}`] } } });
    await m.client.appSetting.deleteMany({ where: { key: { startsWith: "job_stock_correction_review_v1:" }, value: { path: ["jobId"], equals: k.job } } });
    await m.client.stockTx.deleteMany({ where: { propertyStock: { propertyId: { in: [k.property, k.other] } } } });
    await m.client.formSubmission.deleteMany({ where: { jobId: k.job } });
    await m.client.formTemplate.deleteMany({ where: { id: k.template } });
    await m.client.propertyStock.deleteMany({ where: { propertyId: { in: [k.property, k.other] } } });
    await m.client.inventoryItem.deleteMany({ where: { id: { in: [k.tp, k.caps, k.foreign] } } });
    await m.client.job.deleteMany({ where: { id: k.job } });
    await m.client.property.deleteMany({ where: { id: { in: [k.property, k.other] } } });
    await m.client.user.deleteMany({ where: { id: k.cleaner } });
    await m.client.client.deleteMany({ where: { id: k.client } });
  });

  afterAll(async () => m.client?.$disconnect());

  async function submitOnce(answers: Record<string, unknown>, blockUsage?: Record<string, number>) {
    const k = ids();
    const submission = await m.client.formSubmission.create({ data: { jobId: k.job, templateId: k.template, submittedById: k.cleaner, data: answers } });
    return m.client.$transaction(async (tx: any) => {
      const stock = await readSubmissionStockTable(tx, { propertyId: k.property, inventoryEnabled: true });
      if (stock.status !== "ready") throw new Error("stock not ready");
      const resolution = resolveStockTableUsage({ schema, answers, property: {} }, stock.items);
      const usage = mergeStockUsage(blockUsage, resolution);
      if (!usage) return { stock, result: null };
      const result = await deductJobStockOnce(tx, { jobId: k.job, propertyId: k.property, submissionId: submission.id, usage });
      return { stock, result };
    });
  }

  it("reads only the job property's items, with no cost or supplier", async () => {
    const k = ids();
    const stock = await readSubmissionStockTable(m.client, { propertyId: k.property, inventoryEnabled: true });
    expect(stock.status).toBe("ready");
    if (stock.status !== "ready") return;
    expect(stock.items.map((item) => item.itemId).sort()).toEqual([k.caps, k.tp].sort());
    expect(JSON.stringify(stock.items)).not.toMatch(/supplier|Fixture supplier|parLevel|reorderThreshold/);
    expect(stock.items.find((item) => item.itemId === k.tp)).toMatchObject({ area: "bathroom", onHand: 10, unit: "roll" });
  });

  it("deducts once per job: submit, then a second submission is retained for review", async () => {
    const k = ids();
    const answers = { stockTableUsage: { [k.tp]: 3, [k.caps]: 2, [k.foreign]: 4 } };
    const first = await submitOnce(answers, { [k.tp]: 9 });
    expect(first.result?.stockCorrectionRequired).toBe(false);
    // Toilet paper went below its threshold of 8: the low-stock trigger still gets its row.
    expect(first.result?.lowStockRows.map((row: { itemId: string }) => row.itemId)).toEqual([k.tp]);
    const second = await submitOnce(answers);
    expect(second.result?.stockCorrectionRequired).toBe(true);

    const rows = await m.client.propertyStock.findMany({ where: { propertyId: { in: [k.property, k.other] } }, select: { itemId: true, onHand: true } });
    const onHand = Object.fromEntries(rows.map((row: { itemId: string; onHand: number }) => [row.itemId, row.onHand]));
    // 10 − 3 (the table's answer, not the block's 9), 30 − 2; the other property's item untouched.
    expect(onHand).toEqual({ [k.tp]: 7, [k.caps]: 28, [k.foreign]: 5 });
    const used = await m.client.stockTx.count({ where: { txType: "USED", propertyStock: { propertyId: k.property } } });
    expect(used).toBe(2);
    const review = await m.client.appSetting.findFirst({ where: { key: { startsWith: "job_stock_correction_review_v1:" }, value: { path: ["jobId"], equals: k.job } } });
    expect(review?.value).toMatchObject({ status: "PENDING_ADMIN_REVIEW" });
  });

  it("deducts nothing when every row was answered 0", async () => {
    const k = ids();
    const outcome = await submitOnce({ stockTableUsage: { [k.tp]: 0, [k.caps]: 0 } });
    expect(outcome.result).toBeNull();
    const tp = await m.client.propertyStock.findFirst({ where: { propertyId: k.property, itemId: k.tp } });
    expect(tp.onHand).toBe(10);
  });
});
