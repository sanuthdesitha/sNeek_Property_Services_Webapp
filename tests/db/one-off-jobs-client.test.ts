// @vitest-environment node
/**
 * One-off jobs (owner bug 2026-11-23): a one-off job for a real client is
 * listed and invoiced like any other; one filed under "Unassigned / One-off
 * Jobs" is refused by the generator until its site is attached to the client,
 * and attaching moves the site, its jobs and their client-scoped rows.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/reports/pdf", () => ({ renderPdfFromHtml: vi.fn() }));
vi.mock("@/lib/s3", () => ({ publicUrl: (value: string) => value }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ pricing: { gstEnabled: false }, timezone: "Australia/Sydney", invoicing: {} }) }));
vi.mock("@/lib/billing/invoice-sequence", () => ({ issueInvoiceNumber: async () => `fixture-${randomUUID()}` }));

import { generateClientInvoice, loadGeneratorJobs, ONE_OFF_CATCH_ALL_REFUSAL } from "@/lib/billing/client-invoices";
import { attachOneOffSiteToClient } from "@/lib/properties/one-off-client";
import { FALLBACK_CLIENT_NAME } from "@/lib/jobs/service-site";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
const day = new Date("2026-09-10T00:00:00Z");
const window = { periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T23:59:59.999Z"), periodBasis: "SCHEDULED" as const };
const actor = () => ({ actualUserId: id, effectiveRole: "ADMIN", impersonatedSubjectId: null });

describe.skipIf(!url)("one-off jobs: listing, invoicing and attaching the client (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Explicit loopback PostgreSQL required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });
  beforeEach(async () => {
    id = `oneoff-${randomUUID()}`;
    await m.client.client.createMany({ data: [
      { id: `${id}-real`, name: "Real one-off customer" },
      { id: `${id}-catch`, name: FALLBACK_CLIENT_NAME },
    ] });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "ADMIN" } });
    await m.client.property.createMany({ data: [
      { id: `${id}-site`, clientId: `${id}-catch`, name: "Unlinked site", address: "1 Test St", suburb: "Bondi", accessInfo: { serviceSite: true } },
      { id: `${id}-realsite`, clientId: `${id}-real`, name: "Real site", address: "2 Test St", suburb: "Bondi", accessInfo: { serviceSite: true } },
      { id: `${id}-managed`, clientId: `${id}-catch`, name: "Managed", address: "3 Test St", suburb: "Bondi" },
    ] });
    await m.client.job.createMany({ data: [
      { id: `${id}-j1`, jobNumber: `${id}-j1`, propertyId: `${id}-site`, jobType: "DEEP_CLEAN", status: "COMPLETED", scheduledDate: day, fixedPrice: 180 },
      { id: `${id}-j2`, jobNumber: `${id}-j2`, propertyId: `${id}-realsite`, jobType: "DEEP_CLEAN", status: "COMPLETED", scheduledDate: day, fixedPrice: 220 },
      { id: `${id}-j3`, jobNumber: `${id}-j3`, propertyId: `${id}-realsite`, jobType: "SPECIAL_CLEAN", status: "COMPLETED", scheduledDate: day },
    ] });
    await m.client.jobTask.create({ data: { id: `${id}-task`, jobId: `${id}-j1`, propertyId: `${id}-site`, clientId: `${id}-catch`, title: "Extra", source: "ADMIN", requestedByUserId: id } });
  });
  afterEach(async () => {
    if (!m.client || !id) return;
    await m.client.auditLog.deleteMany({ where: { userId: id } });
    await m.client.clientInvoice.deleteMany({ where: { clientId: { in: [`${id}-real`, `${id}-catch`] } } });
    await m.client.jobTask.deleteMany({ where: { id: `${id}-task` } });
    await m.client.job.deleteMany({ where: { id: { startsWith: `${id}-` } } });
    await m.client.property.deleteMany({ where: { id: { startsWith: `${id}-` } } });
    await m.client.user.delete({ where: { id } });
    await m.client.client.deleteMany({ where: { id: { in: [`${id}-real`, `${id}-catch`] } } });
  });
  afterAll(async () => m.client?.$disconnect());

  it("bills a priced one-off job of a real client and names the unpriced one as needing a price (never $0)", async () => {
    const selection = await loadGeneratorJobs({ clientId: `${id}-real`, ...window });
    expect(selection.unInvoicedJobs.map((job) => job.id).sort()).toEqual([`${id}-j2`, `${id}-j3`].sort());
    expect(selection.chargeByJob.get(`${id}-j2`)).toMatchObject({ amount: 220, source: "FIXED_JOB" });
    const unpriced = selection.chargeByJob.get(`${id}-j3`)!;
    // Either the live price list prices SPECIAL_CLEAN, or the job is reported without a rate.
    if (unpriced.rateMissing) expect(unpriced.amount).toBeNull();
    else expect(unpriced.amount).toBeGreaterThan(0);
    const invoice = await generateClientInvoice({ clientId: `${id}-real`, ...window, leaveOutUnratedJobIds: [`${id}-j3`] });
    expect(invoice.lines.some((line: { jobId: string | null; lineTotal: number }) => line.jobId === `${id}-j2` && line.lineTotal === 220)).toBe(true);
  });

  it("refuses to invoice the catch-all client and says how to reach the real client", async () => {
    await expect(generateClientInvoice({ clientId: `${id}-catch`, ...window })).rejects.toThrow(ONE_OFF_CATCH_ALL_REFUSAL);
  });

  it("attaches an unlinked one-off site with its jobs and client-scoped rows, then the job is invoiced to the client", async () => {
    const site = await m.client.property.findUniqueOrThrow({ where: { id: `${id}-site` } });
    const result = await attachOneOffSiteToClient({ propertyId: site.id, clientId: `${id}-real`, expectedUpdatedAt: site.updatedAt.toISOString(), actor: actor() });
    expect(result).toMatchObject({ ok: true, clientId: `${id}-real`, counts: { jobs: 1 } });
    expect((await m.client.property.findUniqueOrThrow({ where: { id: site.id } })).clientId).toBe(`${id}-real`);
    expect((await m.client.jobTask.findUniqueOrThrow({ where: { id: `${id}-task` } })).clientId).toBe(`${id}-real`);
    const audit = await m.client.auditLog.findFirstOrThrow({ where: { entityId: site.id, action: "ONE_OFF_SITE_CLIENT_ATTACHED" } });
    expect(audit.userId).toBe(id);
    const selection = await loadGeneratorJobs({ clientId: `${id}-real`, ...window });
    expect(selection.unInvoicedJobs.map((job) => job.id)).toContain(`${id}-j1`);
  });

  it("refuses a stale attach, a managed property, a real client's site and a site with a job on an invoice", async () => {
    const site = await m.client.property.findUniqueOrThrow({ where: { id: `${id}-site` } });
    expect(await attachOneOffSiteToClient({ propertyId: site.id, clientId: `${id}-real`, expectedUpdatedAt: "2000-01-01T00:00:00.000Z", actor: actor() })).toMatchObject({ ok: false, status: 409 });
    expect(await attachOneOffSiteToClient({ propertyId: `${id}-managed`, clientId: `${id}-real`, expectedUpdatedAt: null, actor: actor() })).toMatchObject({ ok: false, status: 400 });
    expect(await attachOneOffSiteToClient({ propertyId: `${id}-realsite`, clientId: `${id}-catch`, expectedUpdatedAt: null, actor: actor() })).toMatchObject({ ok: false, status: 409 });
    await m.client.clientInvoice.create({ data: { clientId: `${id}-catch`, invoiceNumber: `${id}-inv`, status: "DRAFT", lines: { create: { jobId: `${id}-j1`, description: "Billed to the catch-all", quantity: 1, unitPrice: 180, lineTotal: 180, category: "SERVICE" } } } });
    const refused = await attachOneOffSiteToClient({ propertyId: site.id, clientId: `${id}-real`, expectedUpdatedAt: null, actor: actor() });
    expect(refused).toMatchObject({ ok: false, status: 409 });
    expect((await m.client.property.findUniqueOrThrow({ where: { id: site.id } })).clientId).toBe(`${id}-catch`);
  });
});
