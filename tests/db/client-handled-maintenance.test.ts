// @vitest-environment node
/**
 * Client-handled maintenance (2026-11-18) on a real, disposable PostgreSQL
 * (127.0.0.1:55439): the office hands an item to the client, the client
 * accepts, records their own tradesperson and date (which reaches that day's
 * cleaner through the existing visitPlan), the office reminds (manual, with a
 * gap, idempotent, through the sending safeguards gate, respecting the
 * client's notification switch) and can take it back; the client marks it
 * done with photos (ownership checked) or "could not be done". Scope: client
 * B and an assistant outside the property cannot see or change it. Money: no
 * assignment, pay or invoice rows appear. CP-7: a linked damage case resolves
 * with the item. Races: two client-side people at once; office take-back
 * against client done. Client payloads carry no sensitive keys.
 *
 * Email: the provider SDK is replaced by a stub so the real email chokepoint
 * runs, including the safeguards gate, whose decision this test controls.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  gate: vi.fn(),
  sent: [] as Array<{ to: unknown; subject: string }>,
}));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get(_target, key) {
      const value = (m.client as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value;
    },
  }),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: unknown; subject: string }) => {
        m.sent.push({ to: payload.to, subject: payload.subject });
        return { data: { id: `ext-${m.sent.length}` }, error: null };
      },
    };
  },
}));
vi.mock("@/lib/notifications/safeguards/gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/notifications/safeguards/gate")>("@/lib/notifications/safeguards/gate");
  return { ...actual, guardOutbound: m.gate, recordOutboundOutcome: vi.fn(async () => undefined), refuseOversizedSend: vi.fn(async () => null) };
});

import { ClientHandlingError, clientHandlingAct, getAdminClientHandlingView, handOverToClient, listClientHandledItems, remindClient, takeBackFromClient } from "@/lib/maintenance/client-handling";
import { assignMaintenanceItem } from "@/lib/maintenance/workers";
import { setMaintenanceQuote } from "@/lib/maintenance/service";
import { NOBODY_ASSIGNED_WHERE } from "@/lib/maintenance/admin-list";
import { describeVisitForCleaner, parseVisitPlan, visitIsOnDay } from "@/lib/maintenance/visit-plan";
import type { ClientPortalContext } from "@/lib/auth/client-portal";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `chm-${randomUUID().slice(0, 8)}`;
const id = (name: string) => `${tag}-${name}`;
const office = { userId: id("admin"), impersonatedBy: null };

function portal(overrides: Partial<ClientPortalContext> & { userId: string; clientId: string }): ClientPortalContext {
  return {
    actor: "CLIENT", userName: "Client person", team: null, permissions: {} as never, propertyIds: null,
    visibility: {} as never, settings: {} as never, actorLabel: "Client", ...overrides,
  };
}
const clientA = portal({ userId: id("ua"), clientId: id("ca"), userName: "Ann Owner" });
const clientA2 = portal({ userId: id("ua2"), clientId: id("ca"), userName: "Andy Owner" });
const clientB = portal({ userId: id("ub"), clientId: id("cb"), userName: "Bob Other" });
const vaInScope = portal({ userId: id("va1"), clientId: id("ca"), actor: "VA", propertyIds: [id("pa")], userName: "Vee Assistant", team: { id: id("team1"), name: "Helpers" } });
const vaOutOfScope = portal({ userId: id("va2"), clientId: id("ca"), actor: "VA", propertyIds: [id("pa2")], userName: "Wes Assistant", team: { id: id("team2"), name: "Other helpers" } });

async function makeItem(name: string, data: Record<string, unknown> = {}) {
  await m.client.propertyMaintenanceItem.create({
    data: { id: id(name), propertyId: id("pa"), reportedByUserId: id("admin"), source: "ADMIN", title: `${tag} ${name}`, description: "Shower mixer drips", estimatedCost: 180, assignmentInstructions: [{ kind: "TEXT", text: "internal: key in lockbox 4411" }], ...data },
  });
}

async function expectRefusal(promise: Promise<unknown>, status: number, message: RegExp) {
  const error = await promise.then(() => null, (err: unknown) => err);
  expect(error).toBeInstanceOf(ClientHandlingError);
  expect((error as ClientHandlingError).status).toBe(status);
  expect((error as Error).message).toMatch(message);
}

function deepKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((entry) => deepKeys(entry, keys));
  else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) { keys.add(key); deepKeys(entry, keys); }
  return keys;
}

describe.skipIf(!url)("client-handled maintenance (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    process.env.RESEND_API_KEY = "re_test_stub";
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.user.createMany({
      data: [
        { id: id("admin"), email: `${id("admin")}@test.local`, role: "ADMIN", name: "Ada Admin" },
        { id: id("ops"), email: `${id("ops")}@test.local`, role: "OPS_MANAGER", name: "Otto Ops" },
        { id: id("cleaner"), email: `${id("cleaner")}@test.local`, role: "CLEANER", name: "Cleo Cleaner" },
      ],
    });
    await m.client.client.createMany({ data: [{ id: id("ca"), name: `${tag} A` }, { id: id("cb"), name: `${tag} B` }] });
    await m.client.user.createMany({
      data: [
        { id: id("ua"), email: `${id("ua")}@test.local`, role: "CLIENT", name: "Ann Owner", clientId: id("ca") },
        { id: id("ua2"), email: `${id("ua2")}@test.local`, role: "CLIENT", name: "Andy Owner", clientId: id("ca") },
        { id: id("ub"), email: `${id("ub")}@test.local`, role: "CLIENT", name: "Bob Other", clientId: id("cb") },
      ],
    });
    await m.client.vaTeam.createMany({
      data: [
        { id: id("team1"), clientId: id("ca"), name: "Helpers", permissions: { maintenance: true }, propertyIds: [id("pa")], createdById: id("ua") },
        { id: id("team2"), clientId: id("ca"), name: "Other helpers", permissions: { maintenance: true }, propertyIds: [id("pa2")], createdById: id("ua") },
      ],
    });
    await m.client.user.createMany({
      data: [
        { id: id("va1"), email: `${id("va1")}@test.local`, role: "VA", name: "Vee Assistant", vaTeamId: id("team1") },
        { id: id("va2"), email: `${id("va2")}@test.local`, role: "VA", name: "Wes Assistant", vaTeamId: id("team2") },
      ],
    });
    await m.client.property.createMany({
      data: [
        { id: id("pa"), clientId: id("ca"), name: `${tag} Bondi`, address: "1 St", suburb: "Bondi", accessCode: "4411", keyLocation: "Lockbox" },
        { id: id("pa2"), clientId: id("ca"), name: `${tag} Manly`, address: "2 St", suburb: "Manly" },
        { id: id("pb"), clientId: id("cb"), name: `${tag} Coogee`, address: "3 St", suburb: "Coogee" },
      ],
    });
    await m.client.maintenanceWorker.create({ data: { id: id("worker"), name: "Pat Plumber" } });
    await m.client.issueTicket.create({ data: { id: id("case"), title: "Damage: mixer", caseType: "DAMAGE", propertyId: id("pa"), clientId: id("ca"), status: "OPEN" } });
    await makeItem("main");
    await makeItem("hidden", { clientVisible: false });
    await makeItem("worker", { assignedWorkerId: id("worker") });
    await makeItem("quote", { quotedCost: 240, costApprovalStatus: "PENDING" });
    await makeItem("approved", { quotedCost: 99.5, costApprovalStatus: "APPROVED" });
    await makeItem("roster");
    await m.client.maintenanceItemAssignment.create({ data: { id: id("roster-row"), itemId: id("roster"), userId: id("cleaner"), role: "CLEANER" } });
    await makeItem("case", { caseId: id("case") });
    await makeItem("race");
    await makeItem("decline");
    await makeItem("manly", { propertyId: id("pa2") });
  });

  beforeEach(() => {
    m.gate.mockReset();
    m.gate.mockResolvedValue({ allowed: true, eventId: null });
  });

  afterAll(async () => {
    if (!m.client) return;
    const itemIds = ["main", "hidden", "worker", "quote", "approved", "roster", "case", "race", "decline", "manly"].map(id);
    const userIds = ["admin", "ops", "cleaner", "ua", "ua2", "ub", "va1", "va2"].map(id);
    await m.client.notificationAttempt.deleteMany({ where: { intent: { recipientId: { in: userIds } } } });
    await m.client.notificationIntent.deleteMany({ where: { recipientId: { in: userIds } } });
    await m.client.notification.deleteMany({ where: { userId: { in: userIds } } });
    await m.client.auditLog.deleteMany({ where: { OR: [{ entityId: { in: itemIds } }, { userId: { in: userIds } }] } });
    await m.client.propertyMaintenanceItem.deleteMany({ where: { id: { in: itemIds } } });
    await m.client.issueTicket.deleteMany({ where: { id: id("case") } });
    await m.client.maintenanceWorker.deleteMany({ where: { id: id("worker") } });
    await m.client.property.deleteMany({ where: { id: { in: ["pa", "pa2", "pb"].map(id) } } });
    await m.client.user.deleteMany({ where: { id: { in: ["va1", "va2"].map(id) } } });
    await m.client.vaTeam.deleteMany({ where: { id: { in: ["team1", "team2"].map(id) } } });
    await m.client.user.deleteMany({ where: { id: { in: userIds } } });
    await m.client.clientNotificationPreference.deleteMany({ where: { clientId: { in: ["ca", "cb"].map(id) } } });
    await m.client.client.deleteMany({ where: { id: { in: ["ca", "cb"].map(id) } } });
    await m.client.$disconnect();
  });

  it("refuses a hand-over that is hidden, has our people on it, or has money pending or agreed", async () => {
    await expectRefusal(handOverToClient({ itemId: id("hidden"), actor: office, note: null, transports: [], requestKey: "handover-hidden01" }), 409, /hidden from the client/);
    await expectRefusal(handOverToClient({ itemId: id("worker"), actor: office, note: null, transports: [], requestKey: "handover-worker01" }), 409, /Pat Plumber is on it/);
    await expectRefusal(handOverToClient({ itemId: id("roster"), actor: office, note: null, transports: [], requestKey: "handover-roster01" }), 409, /Cleo Cleaner is assigned/);
    await expectRefusal(handOverToClient({ itemId: id("quote"), actor: office, note: null, transports: [], requestKey: "handover-quote001" }), 409, /\$240\.00 is waiting/);
    await expectRefusal(handOverToClient({ itemId: id("approved"), actor: office, note: null, transports: [], requestKey: "handover-approve1" }), 409, /approved our price/);
    const untouched = await m.client.propertyMaintenanceItem.findMany({ where: { id: { in: ["hidden", "worker", "roster", "quote", "approved"].map(id) } }, select: { clientHandling: true, costApprovalStatus: true, quotedCost: true } });
    expect(untouched.every((row) => row.clientHandling === "NONE")).toBe(true);
    expect(untouched.find((row) => row.costApprovalStatus === "APPROVED")?.quotedCost).toBe(99.5);
    expect(await m.client.maintenanceItemAssignment.count({ where: { id: id("roster-row"), removedAt: null } })).toBe(1);
  });

  it("hands over with a note, tells the client by inbox and email, and records each outcome", async () => {
    const result = await handOverToClient({ itemId: id("main"), actor: office, note: "Please use your usual plumber", transports: ["INBOX", "EMAIL"], requestKey: "handover-main0001" });
    expect(result.outcome).toBe("done");
    expect(result.view.state).toBe("HANDED_OVER");
    expect(result.view.handedOver).toMatchObject({ byName: "Ada Admin", note: "Please use your usual plumber" });
    const message = result.view.handoverMessage!;
    expect(message.pending).toBeUndefined();
    expect(message.outcomes.filter((outcome) => outcome.transport === "INBOX").every((outcome) => outcome.label === "In their portal inbox")).toBe(true);
    expect(message.outcomes.some((outcome) => outcome.transport === "EMAIL" && outcome.tone === "sent")).toBe(true);
    expect(m.gate).toHaveBeenCalled();
    expect(m.gate.mock.calls[0][0]).toMatchObject({ transport: "EMAIL", meta: { typeKey: "client.maintenance_handover" } });
    // The client with no login is never addressed; client B gets nothing.
    expect(message.outcomes.map((outcome) => outcome.name).sort()).toEqual(["Andy Owner", "Andy Owner", "Ann Owner", "Ann Owner"]);
    expect(await m.client.notification.count({ where: { userId: id("ub") } })).toBe(0);
    // A repeat click is answered as unchanged and sends nothing more.
    const before = m.sent.length;
    const again = await handOverToClient({ itemId: id("main"), actor: office, note: "Please use your usual plumber", transports: ["INBOX", "EMAIL"], requestKey: "handover-main0002" });
    expect(again.outcome).toBe("unchanged");
    expect(m.sent.length).toBe(before);
    expect(await m.client.propertyMaintenanceEvent.count({ where: { itemId: id("main"), note: { startsWith: "Asked the client" } } })).toBe(1);
  });

  it("is with the client in the list rules, and our people and our price stay off it", async () => {
    const nobody = await m.client.propertyMaintenanceItem.count({ where: { AND: [{ id: id("main") }, NOBODY_ASSIGNED_WHERE] } });
    expect(nobody).toBe(0);
    await expect(assignMaintenanceItem({ itemId: id("main"), workerId: id("worker"), assignedByUserId: id("admin") })).rejects.toThrow(/with the client to arrange/);
    await expect(setMaintenanceQuote({ itemId: id("main"), quotedCost: 10, userId: id("admin") })).rejects.toThrow(/with the client to arrange/);
    const row = await m.client.propertyMaintenanceItem.findUniqueOrThrow({ where: { id: id("main") }, select: { assignedWorkerId: true, quotedCost: true } });
    expect(row).toEqual({ assignedWorkerId: null, quotedCost: null });
  });

  it("shows only in the caller's current client and property scope", async () => {
    expect((await listClientHandledItems(clientA)).map((item) => item.id)).toContain(id("main"));
    expect((await listClientHandledItems(vaInScope)).map((item) => item.id)).toContain(id("main"));
    expect(await listClientHandledItems(clientB)).toEqual([]);
    expect(await listClientHandledItems(vaOutOfScope)).toEqual([]);
    await expectRefusal(clientHandlingAct(clientB, { itemId: id("main"), action: "ACCEPT" }), 404, /not available to you/);
    await expectRefusal(clientHandlingAct(vaOutOfScope, { itemId: id("main"), action: "ACCEPT" }), 404, /not available to you/);
    await expectRefusal(clientHandlingAct(clientA, { itemId: id("hidden"), action: "ACCEPT" }), 404, /not available to you/);
  });

  it("gives the client no cost, access detail, worker instruction or office record", async () => {
    const [item] = (await listClientHandledItems(clientA)).filter((entry) => entry.id === id("main"));
    const keys = deepKeys(item);
    for (const key of ["estimatedCost", "quotedCost", "costApprovalStatus", "assignmentInstructions", "accessCode", "alarmCode", "keyLocation", "accessNotes", "accessInfo", "payAmount", "payType", "payPayer", "resolutionNote", "clientHandedOverById", "clientHandoverNotice", "clientLastReminderOutcome", "clientReminderCount", "clientTakenBackReason", "events", "assignedWorker", "roleAssignments"]) {
      expect(keys.has(key), key).toBe(false);
    }
    expect(JSON.stringify(item)).not.toContain("4411");
    expect(item.officeNote).toBe("Please use your usual plumber");
  });

  it("two client-side people accepting at once: one records it, the other is unchanged; the office is told once", async () => {
    const [first, second] = await Promise.all([
      clientHandlingAct(clientA, { itemId: id("main"), action: "ACCEPT" }),
      clientHandlingAct(vaInScope, { itemId: id("main"), action: "ACCEPT" }),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual(["done", "unchanged"]);
    const view = await getAdminClientHandlingView(id("main"));
    expect(view?.state).toBe("ACCEPTED");
    expect(view?.response?.state).toBe("ACCEPTED");
    expect(["Ann Owner", "Vee Assistant"]).toContain(view?.response?.byName);
    const officeInbox = await m.client.notification.findMany({ where: { userId: { in: [id("admin"), id("ops")] }, subject: { startsWith: "Client is arranging" } } });
    expect(officeInbox.length).toBe(2);
    expect(new Set(officeInbox.map((row) => row.userId))).toEqual(new Set([id("admin"), id("ops")]));
    // Inbox only: nothing was emailed to the office.
    expect(m.sent.some((entry) => JSON.stringify(entry.to).includes(id("admin")))).toBe(false);
  });

  it("validates the tradesperson, writes the date to that day's cleaner briefing, and refuses a stale screen", async () => {
    await expectRefusal(clientHandlingAct(clientA, { itemId: id("main"), action: "SET_TRADESPERSON", tradesperson: { name: "" } }), 400, /name/);
    const current = (await getAdminClientHandlingView(id("main")))!;
    const day = new Date(Date.now() + 2 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
    const saved = await clientHandlingAct(clientA, {
      itemId: id("main"), action: "SET_TRADESPERSON", expectedVersion: current.version,
      tradesperson: { name: "Sam Sparkie", phone: "0400 111 222", trade: "Plumber", company: "Drip Co", note: "Bringing parts", plannedDate: day, startTime: "09:00", endTime: "10:30", accessMethod: "CLIENT_MEETING" },
    });
    expect(saved.item.tradesperson).toMatchObject({ name: "Sam Sparkie", onCleanersDay: true, updatedByName: "Ann Owner" });
    // The job form reads items with a visitPlan on the job's property within a
    // day of the job, then keeps those on the same Sydney day (app/api/jobs/[id]/form).
    const jobDay = new Date(`${day}T02:00:00.000Z`);
    const rows = await m.client.propertyMaintenanceItem.findMany({
      where: { propertyId: id("pa"), NOT: { visitPlan: { equals: (await import("@prisma/client")).Prisma.DbNull } }, scheduledFor: { gte: new Date(jobDay.getTime() - 86_400_000), lte: new Date(jobDay.getTime() + 86_400_000) } },
      select: { id: true, title: true, visitPlan: true },
    });
    const visit = rows.find((row) => row.id === id("main"));
    const plan = parseVisitPlan(visit?.visitPlan);
    expect(plan && visitIsOnDay(plan, jobDay)).toBe(true);
    expect(describeVisitForCleaner(plan!, visit!.title).lines.join(" | ")).toMatch(/Contractor: Sam Sparkie · 0400 111 222.*The client is meeting them|The client is meeting them.*Contractor: Sam Sparkie/s);
    expect(JSON.stringify(plan)).not.toMatch(/4411|Lockbox|cost/i);
    // A screen still showing the earlier version is refused, its entry kept by the caller.
    await expectRefusal(clientHandlingAct(vaInScope, { itemId: id("main"), action: "CLEAR_TRADESPERSON", expectedVersion: current.version }), 409, /changed this item since you opened it/);
    expect(await m.client.notification.count({ where: { userId: id("admin"), subject: { startsWith: "Repair date set" } } })).toBe(1);
  });

  it("reminds manually: outcome recorded, a repeat key is replayed, a second within the gap is refused", async () => {
    const first = await remindClient({ itemId: id("main"), actor: office, transports: ["INBOX", "EMAIL"], requestKey: "remind-main00001" });
    expect(first.outcome).toBe("sent");
    expect(first.view.reminders.count).toBe(1);
    expect(first.view.reminders.last).toMatchObject({ byName: "Ada Admin" });
    expect(first.record?.outcomes.length).toBeGreaterThan(0);
    // Double click: the same key twice at once is one reminder.
    const [a, b] = await Promise.all([
      remindClient({ itemId: id("main"), actor: office, transports: ["INBOX"], requestKey: "remind-main00001" }),
      remindClient({ itemId: id("main"), actor: office, transports: ["INBOX"], requestKey: "remind-main00001" }),
    ]);
    expect([a.outcome, b.outcome]).toEqual(["replayed", "replayed"]);
    await expectRefusal(remindClient({ itemId: id("main"), actor: office, transports: ["INBOX"], requestKey: "remind-main00002" }), 409, /The next one can be sent from/);
    expect((await getAdminClientHandlingView(id("main")))?.reminders.count).toBe(1);
  });

  it("a reminder held by the sending safeguards is shown as held, and does not start the gap", async () => {
    await m.client.propertyMaintenanceItem.update({ where: { id: id("main") }, data: { clientLastReminderAt: new Date(Date.now() - 5 * 3_600_000) } });
    m.gate.mockResolvedValue({ allowed: false, reason: "QUIET_HOURS", held: false });
    const held = await remindClient({ itemId: id("main"), actor: office, transports: ["EMAIL"], requestKey: "remind-main00003" });
    expect(held.record?.outcomes.every((outcome) => outcome.tone === "held" && /sending safeguards/.test(outcome.label))).toBe(true);
    expect(held.record?.taken).toBe(false);
    expect(held.view.reminderBlocker).toBeNull();
  });

  it("respects the client's notification switch: no reminder is sent or counted", async () => {
    await m.client.clientNotificationPreference.create({ data: { clientId: id("ca"), notificationsEnabled: false } });
    const before = (await getAdminClientHandlingView(id("main")))!.reminders.count;
    await expectRefusal(remindClient({ itemId: id("main"), actor: office, transports: ["INBOX"], requestKey: "remind-main00004" }), 409, /switched off notifications/);
    expect((await getAdminClientHandlingView(id("main")))!.reminders.count).toBe(before);
    await m.client.clientNotificationPreference.delete({ where: { clientId: id("ca") } });
  });

  it("marks done with the client's own photos only, resolves the item and creates no money rows", async () => {
    await expectRefusal(clientHandlingAct(clientA, { itemId: id("main"), action: "MARK_DONE", note: "Fixed", photoKeys: [`maintenance/${id("ub")}/x.jpg`] }), 400, /not uploaded from your account/);
    await expectRefusal(clientHandlingAct(clientA, { itemId: id("main"), action: "MARK_DONE", note: "  " }), 400, /short note/);
    const done = await clientHandlingAct(clientA, { itemId: id("main"), action: "MARK_DONE", note: "Washer replaced", photoKeys: [`maintenance/${id("ua")}/after.jpg`] });
    expect(done.item.state).toBe("DONE");
    expect(done.item.outcome).toMatchObject({ state: "DONE", note: "Washer replaced", byName: "Ann Owner" });
    const row = await m.client.propertyMaintenanceItem.findUniqueOrThrow({ where: { id: id("main") }, select: { status: true, resolvedByUserId: true, visitPlan: true, clientTradesperson: true } });
    expect(row.status).toBe("RESOLVED");
    expect(row.resolvedByUserId).toBe(id("ua"));
    expect(row.visitPlan).toBeNull();
    expect((row.clientTradesperson as { name: string }).name).toBe("Sam Sparkie");
    expect(await m.client.maintenanceItemAssignment.count({ where: { itemId: id("main") } })).toBe(0);
    expect(await m.client.clientInvoiceLine.count({ where: { description: { contains: tag } } })).toBe(0);
    const view = (await getAdminClientHandlingView(id("main")))!;
    expect(view.outcome?.photos.map((photo) => photo.key)).toEqual([`maintenance/${id("ua")}/after.jpg`]);
    expect(await m.client.notification.count({ where: { userId: id("admin"), subject: { startsWith: "Client finished" } } })).toBe(1);
  });

  it("resolves a linked damage case when the client marks the repair done (CP-7)", async () => {
    await handOverToClient({ itemId: id("case"), actor: office, note: null, transports: [], requestKey: "handover-case0001" });
    await clientHandlingAct(clientA, { itemId: id("case"), action: "ACCEPT" });
    await clientHandlingAct(clientA, { itemId: id("case"), action: "MARK_DONE", note: "Replaced the mixer" });
    expect((await m.client.issueTicket.findUniqueOrThrow({ where: { id: id("case") } })).status).toBe("RESOLVED");
  });

  it("declines with a reason: back with the office, attention says so", async () => {
    await handOverToClient({ itemId: id("decline"), actor: office, note: null, transports: [], requestKey: "handover-decl0001" });
    await expectRefusal(clientHandlingAct(clientA, { itemId: id("decline"), action: "DECLINE", reason: " " }), 400, /Pick a reason/);
    const declined = await clientHandlingAct(clientA, { itemId: id("decline"), action: "DECLINE", reason: "I do not have a tradesperson for this" });
    expect(declined.item.state).toBe("DECLINED");
    expect(declined.item.canAct).toBe(false);
    const view = (await getAdminClientHandlingView(id("decline")))!;
    expect(view.response).toMatchObject({ state: "DECLINED", reason: "I do not have a tradesperson for this", byName: "Ann Owner" });
    expect(view.handoverBlockers).toEqual([]);
    expect(await m.client.propertyMaintenanceItem.count({ where: { AND: [{ id: id("decline") }, NOBODY_ASSIGNED_WHERE] } })).toBe(1);
  });

  it("office take-back against client done: exactly one wins; take-back keeps the client's record", async () => {
    await handOverToClient({ itemId: id("race"), actor: office, note: null, transports: [], requestKey: "handover-race0001" });
    await clientHandlingAct(clientA2, { itemId: id("race"), action: "ACCEPT" });
    const day = new Date(Date.now() + 3 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
    await clientHandlingAct(clientA2, { itemId: id("race"), action: "SET_TRADESPERSON", tradesperson: { name: "Rita Roofer", plannedDate: day, startTime: "13:00" } });
    const results = await Promise.allSettled([
      takeBackFromClient({ itemId: id("race"), actor: office, reason: "It became urgent" }),
      clientHandlingAct(clientA2, { itemId: id("race"), action: "MARK_DONE", note: "Done" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(ClientHandlingError);
    expect((loser.reason as ClientHandlingError).status).toBe(409);
    const row = await m.client.propertyMaintenanceItem.findUniqueOrThrow({ where: { id: id("race") } });
    if (row.clientHandling === "TAKEN_BACK") {
      expect(row.clientTakenBackReason).toBe("It became urgent");
      expect(row.clientRespondedById).toBe(id("ua2"));
      expect((row.clientTradesperson as { name: string; visitPublished: boolean }).name).toBe("Rita Roofer");
      expect((row.clientTradesperson as { visitPublished: boolean }).visitPublished).toBe(false);
      expect(row.visitPlan).toBeNull();
      expect(row.scheduledFor).toBeNull();
      await expectRefusal(clientHandlingAct(clientA2, { itemId: id("race"), action: "MARK_DONE", note: "Done" }), 409, /taken this item back/);
    } else {
      expect(row.clientHandling).toBe("DONE");
      await expectRefusal(takeBackFromClient({ itemId: id("race"), actor: office, reason: "x" }), 409, /already marked it done/);
    }
  });

  it("an assistant outside the property and client B cannot change an item even with its id", async () => {
    await handOverToClient({ itemId: id("manly"), actor: office, note: null, transports: [], requestKey: "handover-manly001" });
    await expectRefusal(clientHandlingAct(vaInScope, { itemId: id("manly"), action: "ACCEPT" }), 404, /not available/);
    await expectRefusal(clientHandlingAct(clientB, { itemId: id("manly"), action: "DECLINE", reason: "no" }), 404, /not available/);
    expect((await clientHandlingAct(vaOutOfScope, { itemId: id("manly"), action: "ACCEPT" })).outcome).toBe("done");
  });
});
