// @vitest-environment node
/**
 * Cases → "Add charge to invoice" (Wave F) on PostgreSQL: the line goes onto a
 * DRAFT of the case's client through the invoice PATCH (totals by the shared
 * function, case recorded on the line), once per request key; an approved
 * invoice and another client's draft are refused and left untouched; a new
 * draft is started when asked; an operations manager needs finance "manage".
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ pricing: { gstEnabled: true }, invoicing: { defaultPaymentTermsDays: 14 }, timezone: "Australia/Sydney" }), getTransactionAppSettings: async () => ({}) }));
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: async () => `WF-${randomUUID().slice(0, 8)}` }));

import { addCaseChargeToInvoice, caseChargeContext } from "@/lib/billing/client-invoice-case-charge";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = randomUUID().slice(0, 8);
const id = (name: string) => `wfc${tag}${name}`;
const admin = { id: id("admin"), role: Role.ADMIN };
const ops = { id: id("ops"), role: Role.OPS_MANAGER };
const OPS_KEY = "ops_feature_permissions_v1";

describe.skipIf(!url)("case charge on a draft invoice", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.createMany({ data: [admin, ops].map((user) => ({ id: user.id, email: `${user.id}@example.invalid`, role: user.role })) });
    await m.client.client.createMany({ data: [{ id: id("client"), name: "Harbour View" }, { id: id("other"), name: "Other client" }] });
    await m.client.property.create({ data: { id: id("property"), name: "Bondi Studio", clientId: id("client"), address: "1 St", suburb: "Bondi" } });
    await m.client.issueTicket.create({ data: { id: id("case"), title: "Scratched bench top", propertyId: id("property") } });
    await m.client.clientInvoice.createMany({ data: [
      { id: id("draft"), clientId: id("client"), invoiceNumber: id("INV1"), status: "DRAFT", gstEnabled: true },
      { id: id("approved"), clientId: id("client"), invoiceNumber: id("INV2"), status: "APPROVED", gstEnabled: true, subtotal: 100, gstAmount: 10, totalAmount: 110 },
      { id: id("otherdraft"), clientId: id("other"), invoiceNumber: id("INV3"), status: "DRAFT", gstEnabled: true },
    ] });
    await m.client.clientInvoiceLine.create({ data: { invoiceId: id("approved"), description: "Clean", quantity: 1, unitPrice: 100, lineTotal: 100, category: "SERVICE" } });
  });
  afterAll(async () => {
    if (!m.client) return;
    await m.client.caseComment.deleteMany({ where: { caseId: id("case") } });
    await m.client.clientInvoice.deleteMany({ where: { clientId: { in: [id("client"), id("other")] } } });
    await m.client.issueTicket.deleteMany({ where: { id: id("case") } });
    await m.client.property.deleteMany({ where: { id: id("property") } });
    await m.client.client.deleteMany({ where: { id: { in: [id("client"), id("other")] } } });
    await m.client.appSetting.deleteMany({ where: { OR: [{ key: OPS_KEY }, { key: { startsWith: "case_charge_v1:" } }] } });
    await m.client.auditLog.deleteMany({ where: { userId: { in: [admin.id, ops.id] } } });
    await m.client.user.deleteMany({ where: { id: { in: [admin.id, ops.id] } } });
    await m.client.$disconnect();
  });

  it("adds the line to the draft once per request key, with the case on the line and the totals recomputed", async () => {
    const body = { requestKey: randomUUID(), invoiceId: id("draft"), description: "Bench top repair", amount: 120 };
    const first = await addCaseChargeToInvoice(admin, id("case"), body);
    expect(first).toMatchObject({ invoiceId: id("draft"), createdDraft: false });
    expect(await addCaseChargeToInvoice(admin, id("case"), body)).toEqual(first);
    const lines = await m.client.clientInvoiceLine.findMany({ where: { invoiceId: id("draft") } });
    expect(lines).toEqual([expect.objectContaining({ caseId: id("case"), description: "Bench top repair", unitPrice: 120, lineTotal: 120, category: "SERVICE" })]);
    const invoice = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: id("draft") } });
    expect([invoice.status, invoice.subtotal, invoice.gstAmount, invoice.totalAmount]).toEqual(["DRAFT", 120, 12, 132]);
    expect(await m.client.caseComment.count({ where: { caseId: id("case"), isInternal: true } })).toBe(1);
    const context = await caseChargeContext(admin, id("case"));
    expect(context.charges).toEqual([expect.objectContaining({ invoiceId: id("draft"), status: "DRAFT", lineTotal: 120 })]);
    expect(context.drafts.map((draft) => draft.id)).toEqual([id("draft")]);
  });

  it("never touches an approved invoice or another client's draft", async () => {
    await expect(addCaseChargeToInvoice(admin, id("case"), { requestKey: randomUUID(), invoiceId: id("approved"), description: "Late fee", amount: 10 })).rejects.toThrow(/draft/);
    await expect(addCaseChargeToInvoice(admin, id("case"), { requestKey: randomUUID(), invoiceId: id("otherdraft"), description: "Late fee", amount: 10 })).rejects.toThrow(/different client/);
    const approved = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: id("approved") }, include: { lines: true } });
    expect([approved.totalAmount, approved.lines.length]).toEqual([110, 1]);
    expect(await m.client.clientInvoiceLine.count({ where: { invoiceId: id("otherdraft") } })).toBe(0);
  });

  it("starts a new draft when asked, and needs finance manage for an operations manager", async () => {
    const created = await addCaseChargeToInvoice(admin, id("case"), { requestKey: randomUUID(), invoiceId: null, description: "Callout", amount: 50 });
    expect(created.createdDraft).toBe(true);
    const draft = await m.client.clientInvoice.findUniqueOrThrow({ where: { id: created.invoiceId }, include: { lines: true } });
    expect([draft.status, draft.clientId, draft.lines.map((line) => line.caseId)]).toEqual(["DRAFT", id("client"), [id("case")]]);
    const value = { revision: 1, presets: [], assignments: { [ops.id]: { presetId: "existing", overrides: { cases: "manage", finance: "read" } } } };
    await m.client.appSetting.upsert({ where: { key: OPS_KEY }, create: { key: OPS_KEY, value }, update: { value } });
    await expect(addCaseChargeToInvoice(ops, id("case"), { requestKey: randomUUID(), invoiceId: id("draft"), description: "x", amount: 1 })).rejects.toThrow("FORBIDDEN");
    expect((await caseChargeContext(ops, id("case"))).canManage).toBe(false);
  });
});
