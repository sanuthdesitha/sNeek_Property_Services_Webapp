// @vitest-environment node
/**
 * People directory services against PostgreSQL: client money from the Finance
 * rules (owing less payments and credits, fully credited not counted, overdue
 * by the invoice's own terms, paid this month), logins and assistants, last
 * clean; the account emails list from audit rows and invitations; assistant
 * teams with their members' states. Needs a disposable database on
 * 127.0.0.1:55439 (SNEEK_TEST_DATABASE_URL); clears nothing it did not create.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get(_target, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }),
}));
vi.mock("@/lib/notifications/office-send-permission", () => ({ officeSendDecision: vi.fn(async () => ({ allowed: true, actorRole: "ADMIN" })) }));

import { loadClientDirectory } from "@/lib/people/clients/service";
import { loadClientSummary } from "@/lib/people/clients/summary";
import { loadAccountEmailRows } from "@/lib/people/account-emails/service";
import { listAssistantTeams } from "@/lib/people/assistants";
import { loadAccountRows } from "@/lib/accounts/list/service";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const id = () => randomUUID();
const [adminId, loginId, vaId, vaGoneId, clientA, clientB, propertyId, jobId, teamId] = Array.from({ length: 9 }, id);
const invoiceIds = Array.from({ length: 5 }, id);
const DAY = 86_400_000;

describe.skipIf(!url)("People directory services (PostgreSQL)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Dedicated fixtures required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    const now = Date.now();
    await m.client.user.create({ data: { id: adminId, role: Role.ADMIN, email: `${adminId}@example.invalid`, name: "Hannah Admin" } });
    await m.client.client.createMany({ data: [{ id: clientA, name: "Harbour View Stays", suburb: "Bondi" }, { id: clientB, name: "Cronulla Sands" }] });
    await m.client.property.create({ data: { id: propertyId, clientId: clientA, name: "Glebe House", address: "1 Fixture St", suburb: "Glebe", clientRates: { create: { jobType: "AIRBNB_TURNOVER", baseCharge: 210 } } } });
    await m.client.job.create({ data: { id: jobId, jobNumber: `J-${jobId}`, propertyId, jobType: "AIRBNB_TURNOVER", status: "COMPLETED", scheduledDate: new Date(now - DAY) } });
    await m.client.user.create({ data: { id: loginId, role: Role.CLIENT, email: `${loginId}@example.invalid`, clientId: clientA, isActive: true } });
    await m.client.vaTeam.create({ data: { id: teamId, clientId: clientA, name: "Front desk team", permissions: { bookings: true, reports: true }, createdById: adminId } });
    await m.client.user.create({ data: { id: vaId, role: Role.VA, email: `${vaId}@example.invalid`, name: "Maya", vaTeamId: teamId, invitation: { create: { token: `t-${vaId}`, expiresAt: new Date(now + 3 * DAY), createdById: adminId } } } });
    await m.client.user.create({ data: { id: vaGoneId, role: Role.VA, email: `${vaGoneId}@example.invalid`, name: "Ruby", vaTeamId: teamId, isActive: false } });
    const [overdue, partPaid, credited, credit, paid] = invoiceIds;
    await m.client.clientInvoice.create({ data: { id: overdue, clientId: clientA, invoiceNumber: `INV-${overdue}`, status: "SENT", totalAmount: 200, paidAmount: 50, createdAt: new Date(now - 60 * DAY) } });
    await m.client.clientInvoice.create({ data: { id: partPaid, clientId: clientA, invoiceNumber: `INV-${partPaid}`, status: "PART_PAID", totalAmount: 100, paidAmount: 0, paymentTermsDays: 30, createdAt: new Date(now - DAY) } });
    await m.client.clientInvoice.create({ data: { id: credited, clientId: clientA, invoiceNumber: `INV-${credited}`, status: "SENT", totalAmount: 80, createdAt: new Date(now - 90 * DAY) } });
    await m.client.clientInvoice.create({ data: { id: credit, clientId: clientA, invoiceNumber: `CN-${credit}`, kind: "CREDIT_NOTE", status: "SENT", totalAmount: -80, creditsInvoiceId: credited } });
    await m.client.clientInvoice.create({ data: { id: paid, clientId: clientA, invoiceNumber: `INV-${paid}`, status: "PAID", totalAmount: 300, paidAt: new Date() } });
    await m.client.auditLog.create({ data: { userId: adminId, action: "ACCOUNT_EMAIL_SENT", entity: "User", entityId: loginId, after: { type: "PASSWORD_RESET", state: "ACCEPTED", sentBy: "OFFICE", to: "x" } } });
  });

  afterAll(async () => {
    if (!m.client) return;
    await m.client.auditLog.deleteMany({ where: { OR: [{ userId: adminId }, { entityId: loginId }] } });
    await m.client.clientInvoice.deleteMany({ where: { id: { in: [invoiceIds[3]] } } });
    await m.client.clientInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await m.client.job.deleteMany({ where: { id: jobId } });
    await m.client.userInvitation.deleteMany({ where: { userId: { in: [vaId] } } });
    await m.client.user.deleteMany({ where: { id: { in: [vaId, vaGoneId, loginId] } } });
    await m.client.vaTeam.deleteMany({ where: { id: teamId } });
    await m.client.propertyClientRate.deleteMany({ where: { propertyId } });
    await m.client.property.deleteMany({ where: { id: propertyId } });
    await m.client.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
    await m.client.user.deleteMany({ where: { id: adminId } });
    await m.client.$disconnect();
  });

  it("reads each client's money with the Finance rules, plus logins, assistants and last clean", async () => {
    const { rows, activeProperties } = await loadClientDirectory({ money: true });
    const a = rows.find((row) => row.id === clientA)!;
    const b = rows.find((row) => row.id === clientB)!;
    // 150 left on the overdue invoice + 100 part paid; the fully credited invoice is not chased.
    expect(a).toMatchObject({ owing: 250, overdue: 150, overdueCount: 1, invoicesOpen: 2, paidThisMonth: 300, properties: 1, logins: 1, assistants: 1, attention: ["OVERDUE"] });
    expect(a.lastCleanDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(b).toMatchObject({ owing: 0, logins: 0, lastCleanDay: null, attention: ["NO_LOGIN"] });
    expect(activeProperties).toBeGreaterThanOrEqual(1);
  });

  it("summarises one client: invoices with due days, rates, logins and teams", async () => {
    const summary = (await loadClientSummary(clientA, { money: true, profit: false }))!;
    expect(summary.money?.invoices.map((invoice) => invoice.owing)).toEqual([150, 100]);
    expect(summary.money?.invoices[0]).toMatchObject({ overdue: true });
    expect(summary.money?.invoices[1]).toMatchObject({ overdue: false });
    expect(summary.properties[0]).toMatchObject({ name: "Glebe House", turnoverRate: 210, calendar: "NOT_CONNECTED" });
    expect(summary.teams[0]).toMatchObject({ name: "Front desk team", members: 2, propertyCount: null });
    expect(summary.attention[0]).toMatchObject({ kind: "INVOICE" });
  });

  it("lists account emails per person from audit rows and invitations", async () => {
    const session = { user: { id: adminId, role: "ADMIN", heldRoles: ["ADMIN"] } } as never;
    const { rows } = await loadAccountEmailRows(session);
    const login = rows.find((row) => row.userId === loginId)!;
    const va = rows.find((row) => row.userId === vaId)!;
    expect(login).toMatchObject({ kind: "PASSWORD_RESET", delivery: "ACCEPTED", sentBy: "Hannah Admin", canCopyLink: false });
    expect(va).toMatchObject({ kind: "ASSISTANT_ACCESS", nextStep: "RESEND_INVITATION", canResend: true, canCopyLink: true, delivery: "NOT_RECORDED", context: "Assistant · Harbour View Stays" });
  });

  it("lists assistant teams with each member's real state", async () => {
    const team = (await listAssistantTeams()).find((row) => row.id === teamId)!;
    // Grants as the client-portal chokepoint parses them (its own defaults included).
    expect(team.grantedCount).toBe(Object.values(team.permissions).filter(Boolean).length);
    expect(team.permissions).toMatchObject({ bookings: true, reports: true });
    expect(team).toMatchObject({ propertyIds: null, client: { name: "Harbour View Stays", propertyCount: 1 } });
    expect(team.members.map((member) => member.status).sort()).toEqual(["INVITED", "SUSPENDED"]);
  });

  it("adds Jobs this week and Owed to the login list, Owed only for viewers who may see pay", async () => {
    await m.client.jobAssignment.create({ data: { jobId, userId: loginId } });
    await m.client.job.update({ where: { id: jobId }, data: { scheduledDate: new Date() } });
    try {
      const withPay = (await loadAccountRows({ pay: true, quality: false })).find((row) => row.id === loginId)!;
      expect(withPay).toMatchObject({ jobsWeek: 1, owed: 0 });
      const withoutPay = (await loadAccountRows({ pay: false, quality: false })).find((row) => row.id === loginId)!;
      expect(withoutPay).not.toHaveProperty("owed");
    } finally {
      await m.client.jobAssignment.deleteMany({ where: { jobId } });
    }
  });
});
