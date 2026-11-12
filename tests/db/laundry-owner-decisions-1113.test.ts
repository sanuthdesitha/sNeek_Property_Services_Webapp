// @vitest-environment node
/**
 * Laundry owner decisions (2026-11-13) on a real disposable PostgreSQL
 * (127.0.0.1:55439):
 *  - partner weight / price before drop-off: LAUNDRY only, never while
 *    impersonating, scope + partner + version checked, audited, optional,
 *    no client invoice row changes; a drop that leaves price empty keeps it;
 *  - "Ready to return": marked once, a drop is accepted from it;
 *  - drop-off photos: append only, own uploads only, originals kept, the
 *    missing-photo exception clears;
 *  - a team "Yes, <time>" sets the planned time (same transaction, audited)
 *    only while the leg is open; never a date; a replay does not re-apply;
 *  - partner schedule: saved and audited; new runs get a TIME only; dates and
 *    existing runs unchanged; CHECK constraints hold.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  session: null as null | { user: { id: string; role: string; name?: string }; impersonation?: unknown },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: async (roles: string[]) => {
    if (!m.session) throw new Error("UNAUTHORIZED");
    if (!roles.includes(m.session.user.role)) throw new Error("FORBIDDEN");
    return m.session;
  },
}));

import { POST as weightPricePost } from "@/app/api/laundry/[taskId]/weight-price/route";
import { POST as readyPost } from "@/app/api/laundry/[taskId]/ready-to-return/route";
import { POST as photosPost } from "@/app/api/laundry/[taskId]/dropoff-photos/route";
import { POST as statusPost } from "@/app/api/laundry/[taskId]/status/route";
import { recordTeamRequestReply } from "@/lib/laundry/team-request-replies";
import { partnerTimesForNewRuns, updatePartnerSchedule } from "@/lib/laundry/partner-schedule-server";
import { applyLaundryPlanDraft } from "@/lib/laundry/planner";
import { detectExceptions } from "@/lib/laundry/pipeline";
import { applyCleanerLaundryStatusUpdate } from "@/lib/laundry/cleaner-status";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `lod-${randomUUID().slice(0, 8)}`;
const ids = {
  client: randomUUID(), property: randomUUID(), otherProperty: randomUUID(), teamProperty: randomUUID(), mixedProperty: randomUUID(),
  partner: randomUUID(), otherPartner: randomUUID(),
  tom: randomUUID(), mia: randomUUID(), rival: randomUUID(), outsider: randomUUID(), admin: randomUUID(),
  task: randomUUID(), pickupTask: randomUUID(), hiddenTask: randomUUID(), rivalTask: randomUUID(),
  confirmRequest: randomUUID(), dropRequest: randomUUID(), closedRequest: randomUUID(),
};

function post(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function version(taskId: string): Promise<string> {
  return (await m.client.laundryTask.findUniqueOrThrow({ where: { id: taskId } })).updatedAt.toISOString();
}

async function invoiceChecksum(): Promise<string> {
  const rows = await m.client.$queryRaw<Array<{ sum: string | null }>>`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS sum FROM (SELECT i.* FROM "ClientInvoice" i) t`;
  const lines = await m.client.$queryRaw<Array<{ sum: string | null }>>`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) AS sum FROM (SELECT l.* FROM "ClientInvoiceLine" l) t`;
  return `${rows[0]?.sum}:${lines[0]?.sum}`;
}

function as(user: string, role: Role, impersonation?: unknown) {
  m.session = { user: { id: user, role, name: user === ids.tom ? "Tom" : "Someone" }, ...(impersonation ? { impersonation } : {}) };
}

describe.skipIf(!url)("laundry owner decisions 2026-11-13 (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.client.create({ data: { id: ids.client, name: `${tag} client` } });
    await m.client.laundrySupplier.createMany({ data: [
      { id: ids.partner, name: `${tag} CleanCo`, avgTurnaround: 48 },
      { id: ids.otherPartner, name: `${tag} Linen Lab` },
    ] });
    await m.client.user.createMany({ data: [
      { id: ids.tom, email: `${tag}-tom@example.invalid`, name: "Tom", role: Role.LAUNDRY, laundrySupplierId: ids.partner },
      { id: ids.mia, email: `${tag}-mia@example.invalid`, name: "Mia", role: Role.LAUNDRY, laundrySupplierId: ids.partner },
      { id: ids.rival, email: `${tag}-riv@example.invalid`, name: "Rex", role: Role.LAUNDRY, laundrySupplierId: ids.otherPartner },
      { id: ids.outsider, email: `${tag}-out@example.invalid`, name: "Oli", role: Role.LAUNDRY },
      { id: ids.admin, email: `${tag}-ad@example.invalid`, name: "Ada", role: Role.ADMIN },
    ] });
    await m.client.property.createMany({ data: [
      { id: ids.property, name: `${tag} Glebe House`, clientId: ids.client, address: "1 Test St", suburb: "Glebe", laundryEnabled: true },
      // Visible only to the outsider: Tom must not see it.
      { id: ids.otherProperty, name: `${tag} Hidden Flat`, clientId: ids.client, address: "2 Test St", suburb: "Glebe", laundryEnabled: true, accessInfo: { laundryTeamUserIds: [ids.outsider] } },
      // Team is all CleanCo: new runs follow CleanCo's schedule.
      { id: ids.teamProperty, name: `${tag} Team House`, clientId: ids.client, address: "3 Test St", suburb: "Glebe", laundryEnabled: true, accessInfo: { laundryTeamUserIds: [ids.tom, ids.mia] } },
      // Mixed partners: nothing is prefilled.
      { id: ids.mixedProperty, name: `${tag} Mixed House`, clientId: ids.client, address: "4 Test St", suburb: "Glebe", laundryEnabled: true, accessInfo: { laundryTeamUserIds: [ids.tom, ids.rival] } },
    ] });
    const jobs = await Promise.all(["J1", "J2", "J3", "J4"].map((suffix, index) => m.client.job.create({ data: { jobNumber: `${tag}-${suffix}`, propertyId: index === 2 ? ids.otherProperty : ids.property, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-09T00:00:00Z") } })));
    const pickedUpAt = new Date("2026-11-10T03:00:00Z");
    await m.client.laundryTask.createMany({ data: [
      { id: ids.task, jobId: jobs[0].id, propertyId: ids.property, supplierId: ids.partner, status: "PICKED_UP", pickedUpAt, pickupDate: new Date("2026-11-10T00:00:00Z"), dropoffDate: new Date("2026-11-14T00:00:00Z") },
      { id: ids.pickupTask, jobId: jobs[1].id, propertyId: ids.property, supplierId: ids.partner, status: "CONFIRMED", pickupDate: new Date("2026-11-13T00:00:00Z"), dropoffDate: new Date("2026-11-15T00:00:00Z") },
      { id: ids.hiddenTask, jobId: jobs[2].id, propertyId: ids.otherProperty, status: "PICKED_UP", pickedUpAt, pickupDate: new Date("2026-11-10T00:00:00Z"), dropoffDate: new Date("2026-11-14T00:00:00Z") },
      { id: ids.rivalTask, jobId: jobs[3].id, propertyId: ids.property, supplierId: ids.otherPartner, status: "PICKED_UP", pickedUpAt, pickupDate: new Date("2026-11-10T00:00:00Z"), dropoffDate: new Date("2026-11-14T00:00:00Z") },
    ] });
    await m.client.auditLog.createMany({ data: [
      { id: ids.confirmRequest, userId: ids.admin, action: "LAUNDRY_TEAM_REQUEST_SENT", entity: "LaundryTask", entityId: ids.pickupTask, after: { kind: "TEAM_CONFIRM_PICKUP", recipientIds: [ids.tom] } },
      { id: ids.dropRequest, userId: ids.admin, action: "LAUNDRY_TEAM_REQUEST_SENT", entity: "LaundryTask", entityId: ids.task, after: { kind: "TEAM_CONFIRM_DROP", recipientIds: [ids.tom] } },
      { id: ids.closedRequest, userId: ids.admin, action: "LAUNDRY_TEAM_REQUEST_SENT", entity: "LaundryTask", entityId: ids.task, after: { kind: "TEAM_CONFIRM_PICKUP", recipientIds: [ids.tom] } },
    ] });
  });

  afterAll(async () => {
    if (!m.client) return;
    const propertyIds = [ids.property, ids.otherProperty, ids.teamProperty, ids.mixedProperty];
    const tasks = await m.client.laundryTask.findMany({ where: { propertyId: { in: propertyIds } }, select: { id: true } });
    const taskIds = tasks.map((row) => row.id);
    await m.client.laundryTeamRequestReply.deleteMany({ where: { laundryTaskId: { in: taskIds } } });
    await m.client.laundryConfirmation.deleteMany({ where: { laundryTaskId: { in: taskIds } } });
    await m.client.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...taskIds, ids.partner, ids.otherPartner] } }, { id: { in: [ids.confirmRequest, ids.dropRequest, ids.closedRequest] } }] } });
    await m.client.laundryTask.deleteMany({ where: { id: { in: taskIds } } });
    await m.client.job.deleteMany({ where: { propertyId: { in: propertyIds } } });
    await m.client.user.deleteMany({ where: { id: { in: [ids.tom, ids.mia, ids.rival, ids.outsider, ids.admin] } } });
    await m.client.laundrySupplier.deleteMany({ where: { id: { in: [ids.partner, ids.otherPartner] } } });
    await m.client.property.deleteMany({ where: { id: { in: propertyIds } } });
    await m.client.client.deleteMany({ where: { id: ids.client } });
    await m.client.$disconnect();
  });

  it("weight / price: refused for office roles, impersonation, another partner, an unseen run and a stale version", async () => {
    const params = { params: { taskId: ids.task } };
    as(ids.admin, Role.ADMIN);
    expect((await weightPricePost(post({ price: 40, expectedUpdatedAt: await version(ids.task) }), params)).status).toBe(403);
    as(ids.tom, Role.LAUNDRY, { actor: { id: ids.admin } });
    expect((await weightPricePost(post({ price: 40, expectedUpdatedAt: await version(ids.task) }), params)).status).toBe(403);
    as(ids.tom, Role.LAUNDRY);
    expect((await weightPricePost(post({ price: 40, expectedUpdatedAt: await version(ids.rivalTask) }), { params: { taskId: ids.rivalTask } })).status).toBe(403);
    expect((await weightPricePost(post({ price: 40, expectedUpdatedAt: await version(ids.hiddenTask) }), { params: { taskId: ids.hiddenTask } })).status).toBe(404);
    expect((await weightPricePost(post({ price: 40, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }), params)).status).toBe(409);
    expect((await weightPricePost(post({ expectedUpdatedAt: await version(ids.task) }), params)).status).toBe(400);
    // Before pickup: not at the laundry yet.
    expect((await weightPricePost(post({ price: 40, expectedUpdatedAt: await version(ids.pickupTask) }), { params: { taskId: ids.pickupTask } })).status).toBe(409);
    expect((await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.task } })).dropoffCostAud).toBeNull();
  });

  it("weight / price: optional fields saved, audited with the actor, no client invoice row changes", async () => {
    const before = await invoiceChecksum();
    as(ids.tom, Role.LAUNDRY);
    const weightOnly = await weightPricePost(post({ weightKg: 11.2, expectedUpdatedAt: await version(ids.task) }), { params: { taskId: ids.task } });
    expect(weightOnly.status).toBe(200);
    let row = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.task } });
    expect([row.bagWeightKg, row.dropoffCostAud]).toEqual([11.2, null]);
    const priceOnly = await weightPricePost(post({ price: 48.2, expectedUpdatedAt: row.updatedAt.toISOString() }), { params: { taskId: ids.task } });
    expect(priceOnly.status).toBe(200);
    row = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.task } });
    expect([row.bagWeightKg, row.dropoffCostAud]).toEqual([11.2, 48.2]);
    const events = await m.client.laundryConfirmation.findMany({ where: { laundryTaskId: ids.task }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => [event.confirmedById, JSON.parse(event.notes ?? "{}").event])).toEqual([[ids.tom, "PARTNER_WEIGHT_PRICE"], [ids.tom, "PARTNER_WEIGHT_PRICE"]]);
    expect(await m.client.auditLog.count({ where: { action: "LAUNDRY_PARTNER_WEIGHT_PRICE", entityId: ids.task, userId: ids.tom } })).toBe(2);
    expect(await invoiceChecksum()).toBe(before);
  });

  it("ready to return: marked once by the team, then a drop with an empty price keeps the entered price", async () => {
    as(ids.tom, Role.LAUNDRY);
    const ready = await readyPost(post({ expectedUpdatedAt: await version(ids.task) }), { params: { taskId: ids.task } });
    expect(ready.status).toBe(200);
    expect((await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.task } })).status).toBe("READY_TO_RETURN");
    expect((await readyPost(post({ expectedUpdatedAt: await version(ids.task) }), { params: { taskId: ids.task } })).status).toBe(409);
    expect(await m.client.auditLog.count({ where: { action: "LAUNDRY_READY_TO_RETURN", entityId: ids.task } })).toBe(1);

    // The team's "Yes, 09:15" to the drop-time request sets the planned drop time (leg open).
    const reply = await recordTeamRequestReply({ id: ids.tom, role: Role.LAUNDRY }, ids.dropRequest, { answer: "CONFIRMED", time: "09:15", idempotencyKey: `${tag}-drop-1` });
    expect(reply.plannedTimeSet).toEqual({ field: "dropoffTime", time: "09:15" });
    const afterReply = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.task } });
    expect([afterReply.dropoffTime, afterReply.dropoffDate.toISOString(), afterReply.status]).toEqual(["09:15", "2026-11-14T00:00:00.000Z", "READY_TO_RETURN"]);
    const timeAudit = await m.client.auditLog.findFirstOrThrow({ where: { action: "LAUNDRY_PLANNED_TIMES_UPDATED", entityId: ids.task } });
    expect(timeAudit.after).toMatchObject({ dropoffTime: "09:15", source: "LAUNDRY_TEAM_ANSWER", label: "Set from laundry team's answer" });
    // A pickup-time answer on a run already picked up changes nothing.
    const closed = await recordTeamRequestReply({ id: ids.tom, role: Role.LAUNDRY }, ids.closedRequest, { answer: "CONFIRMED", time: "15:00", idempotencyKey: `${tag}-closed-1` });
    expect(closed.plannedTimeSet).toBeNull();
    expect((await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.task } })).pickupTime).toBeNull();

    // The drop leaves weight and price empty; photo and early reason cover the portal settings.
    const drop = await statusPost(post({ confirm: true, status: "RETURNED", dropoffLocation: "Lobby", dropoffPhotoKey: `laundry/dropoff/${ids.tom}/drop.jpg`, earlyDropoffReason: "Ready early", expectedUpdatedAt: await version(ids.task) }) as never, { params: { taskId: ids.task } });
    expect(drop.status).toBe(200);
    const dropped = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.task } });
    expect([dropped.status, dropped.dropoffCostAud, dropped.bagWeightKg]).toEqual(["DROPPED", 48.2, 11.2]);
  });

  it("drop-off photos: append only, own uploads only, originals kept, the missing-photo exception clears", async () => {
    as(ids.tom, Role.LAUNDRY);
    const originals = await m.client.laundryConfirmation.findMany({ where: { laundryTaskId: ids.task }, orderBy: { createdAt: "asc" } });
    expect((await photosPost(post({ photoKeys: [`laundry/dropoff/${ids.mia}/x.jpg`], expectedUpdatedAt: await version(ids.task) }), { params: { taskId: ids.task } })).status).toBe(403);
    // Not on a run that is not delivered.
    expect((await photosPost(post({ photoKeys: [`laundry/dropoff/${ids.tom}/a.jpg`], expectedUpdatedAt: await version(ids.pickupTask) }), { params: { taskId: ids.pickupTask } })).status).toBe(409);
    const added = await photosPost(post({ photoKeys: [`laundry/dropoff/${ids.tom}/a.jpg`, `laundry/dropoff/${ids.tom}/b.jpg`], expectedUpdatedAt: await version(ids.task) }), { params: { taskId: ids.task } });
    expect(added.status).toBe(200);
    const after = await m.client.laundryConfirmation.findMany({ where: { laundryTaskId: ids.task }, orderBy: { createdAt: "asc" } });
    expect(after).toHaveLength(originals.length + 2);
    for (const original of originals) expect(after.find((row) => row.id === original.id)).toEqual(original);
    const task = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.task }, include: { confirmations: true } });
    const codes = detectExceptions(task, { todayKey: "2026-11-16", now: new Date("2026-11-16T00:00:00Z"), settings: { maxOutdoorDays: 3, requireDropoffPhoto: true } }).map((item) => item.code);
    expect(codes).not.toContain("NO_DROP_PHOTO");
    expect(await m.client.auditLog.count({ where: { action: "LAUNDRY_DROPOFF_PHOTO_ADDED", entityId: ids.task, userId: ids.tom } })).toBe(1);
  });

  it("a team Yes-with-time on an open pickup sets only the pickup time; a replay does not re-apply", async () => {
    const before = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.pickupTask } });
    const body = { answer: "CONFIRMED", time: "15:30", idempotencyKey: `${tag}-pickup-1` };
    const first = await recordTeamRequestReply({ id: ids.tom, role: Role.LAUNDRY }, ids.confirmRequest, body);
    expect(first.plannedTimeSet).toEqual({ field: "pickupTime", time: "15:30" });
    const after = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.pickupTask } });
    expect([after.pickupTime, after.dropoffTime, after.pickupDate.getTime(), after.dropoffDate.getTime(), after.status]).toEqual(["15:30", before.dropoffTime, before.pickupDate.getTime(), before.dropoffDate.getTime(), "CONFIRMED"]);
    const replay = await recordTeamRequestReply({ id: ids.tom, role: Role.LAUNDRY }, ids.confirmRequest, body);
    expect(replay).toMatchObject({ replayed: true, plannedTimeSet: null });
    expect(await m.client.auditLog.count({ where: { action: "LAUNDRY_PLANNED_TIMES_UPDATED", entityId: ids.pickupTask } })).toBe(1);
    // An invalid time is refused before anything is written.
    await expect(recordTeamRequestReply({ id: ids.tom, role: Role.LAUNDRY }, ids.confirmRequest, { answer: "CONFIRMED", time: "7pm", idempotencyKey: `${tag}-pickup-2` })).rejects.toBeTruthy();
    expect((await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.pickupTask } })).pickupTime).toBe("15:30");
  });

  it("partner schedule: saved and audited; new runs get a time only; existing runs and dates unchanged", async () => {
    const existingBefore = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.pickupTask } });
    const saved = await updatePartnerSchedule(ids.admin, ids.partner, {
      pickupWeekdays: [1, 2, 3, 4, 5, 6], pickupWindowStart: "13:00", pickupWindowEnd: "16:00",
      dropWeekdays: [6, 1, 2, 3, 4, 5], dropWindowStart: "08:00", dropWindowEnd: "11:00",
    });
    expect(saved).toMatchObject({ pickupWeekdays: [1, 2, 3, 4, 5, 6], dropWeekdays: [1, 2, 3, 4, 5, 6], pickupWindowStart: "13:00" });
    expect(await m.client.auditLog.count({ where: { action: "LAUNDRY_PARTNER_SCHEDULE_UPDATED", entityId: ids.partner, userId: ids.admin } })).toBe(1);
    await expect(updatePartnerSchedule(ids.admin, ids.partner, {
      pickupWeekdays: [], pickupWindowStart: null, pickupWindowEnd: null, dropWeekdays: [], dropWindowStart: null, dropWindowEnd: null,
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    })).rejects.toMatchObject({ status: 409 });
    // Existing runs keep their times and dates.
    const existingAfter = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.pickupTask } });
    expect([existingAfter.pickupTime, existingAfter.dropoffTime, existingAfter.pickupDate, existingAfter.dropoffDate]).toEqual([existingBefore.pickupTime, existingBefore.dropoffTime, existingBefore.pickupDate, existingBefore.dropoffDate]);

    // Monday 16 Nov pickup, Wednesday 18 Nov drop; Sunday 15 Nov is not a stated day.
    const times = await partnerTimesForNewRuns(m.client as never, [
      { propertyId: ids.property, supplierId: ids.partner, pickupDate: new Date("2026-11-16T00:00:00Z"), dropoffDate: new Date("2026-11-18T00:00:00Z") },
      { propertyId: ids.teamProperty, pickupDate: new Date("2026-11-16T00:00:00Z"), dropoffDate: new Date("2026-11-15T00:00:00Z") },
      { propertyId: ids.mixedProperty, pickupDate: new Date("2026-11-16T00:00:00Z"), dropoffDate: new Date("2026-11-18T00:00:00Z") },
      { propertyId: ids.property, pickupDate: new Date("2026-11-16T00:00:00Z"), dropoffDate: new Date("2026-11-18T00:00:00Z") },
      { propertyId: ids.teamProperty, pickupDate: new Date("2026-11-16T00:00:00Z"), dropoffDate: new Date("2026-11-16T00:00:00Z"), flagNotes: "KEY_LOST same day" },
    ]);
    expect(times).toEqual([
      { pickupTime: "13:00", dropoffTime: "08:00" },
      { pickupTime: "13:00", dropoffTime: null },
      { pickupTime: null, dropoffTime: null },
      { pickupTime: null, dropoffTime: null },
      { pickupTime: null, dropoffTime: null },
    ]);

    // A new run applied by the planner gets the partner's time; its dates are the draft's.
    const job = await m.client.job.create({ data: { jobNumber: `${tag}-J5`, propertyId: ids.teamProperty, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-15T00:00:00Z") } });
    const draft = { jobId: job.id, propertyId: ids.teamProperty, propertyName: "Team House", suburb: "Glebe", cleanDate: "2026-11-15T00:00:00.000Z", pickupDate: "2026-11-16T00:00:00.000Z", dropoffDate: "2026-11-18T00:00:00.000Z", status: "PENDING", flagReason: null, flagNotes: null, scenario: "COMPRESSED", linenBufferSets: 1 };
    await applyLaundryPlanDraft([draft as never]);
    const created = await m.client.laundryTask.findUniqueOrThrow({ where: { jobId: job.id } });
    expect([created.pickupDate.toISOString(), created.dropoffDate.toISOString(), created.pickupTime, created.dropoffTime, created.supplierId]).toEqual(["2026-11-16T00:00:00.000Z", "2026-11-18T00:00:00.000Z", "13:00", "08:00", null]);
    // Re-applying (an update) never changes the time the office may have set since.
    await m.client.laundryTask.update({ where: { id: created.id }, data: { pickupTime: "10:00" } });
    await applyLaundryPlanDraft([{ ...draft, dropoffDate: "2026-11-19T00:00:00.000Z" } as never]);
    const updated = await m.client.laundryTask.findUniqueOrThrow({ where: { id: created.id } });
    expect([updated.pickupTime, updated.dropoffDate.toISOString()]).toEqual(["10:00", "2026-11-19T00:00:00.000Z"]);
  });

  it("a cleaner's late laundry update never moves a ready-to-return set back", async () => {
    const job = await m.client.job.create({ data: { jobNumber: `${tag}-J6`, propertyId: ids.property, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-09T00:00:00Z") } });
    const run = await m.client.laundryTask.create({ data: { jobId: job.id, propertyId: ids.property, status: "READY_TO_RETURN", pickedUpAt: new Date("2026-11-10T03:00:00Z"), pickupDate: new Date("2026-11-10T00:00:00Z"), dropoffDate: new Date("2026-11-14T00:00:00Z") } });
    for (const laundryOutcome of ["NOT_READY", "NO_PICKUP_REQUIRED"] as const) {
      const result = await applyCleanerLaundryStatusUpdate({ jobId: job.id, cleanerId: ids.admin, laundryOutcome, laundrySkipReasonCode: "OTHER", laundrySkipReasonNote: "late note", source: "EARLY_UPDATE", portalUrl: "http://localhost" });
      expect(result).toMatchObject({ duplicated: true });
    }
    expect((await m.client.laundryTask.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("READY_TO_RETURN");
  });

  it("CHECK constraints refuse a bad weekday or time on the partner", async () => {
    await expect(m.client.$executeRawUnsafe(`UPDATE "LaundrySupplier" SET "pickupWeekdays" = ARRAY[7] WHERE id = '${ids.otherPartner}'`)).rejects.toBeTruthy();
    await expect(m.client.$executeRawUnsafe(`UPDATE "LaundrySupplier" SET "dropWindowStart" = '25:00' WHERE id = '${ids.otherPartner}'`)).rejects.toBeTruthy();
    const untouched = await m.client.laundrySupplier.findUniqueOrThrow({ where: { id: ids.otherPartner } });
    expect([untouched.pickupWeekdays, untouched.dropWindowStart]).toEqual([[], null]);
  });
});
