// @vitest-environment node
/**
 * Laundry run Change state and Void (owner request 2026-11-14) on a real
 * disposable PostgreSQL (127.0.0.1:55439):
 *  - Change state records the real time, who did it and the reason; the
 *    original confirmations are untouched and the correction is its own row
 *    and audit; a stale version and a missing time are refused; the laundry
 *    team's own later record is kept beside the correction;
 *  - Void (ADMIN + own PIN): stored as SKIPPED_PICKUP with who, when and why;
 *    a waiting skip request closes; the run leaves the Pipeline, the feeds,
 *    the laundry portal scope, reports and the finance cost; the planner and
 *    a cleaner's outcome never change it; edits are refused; refused on an
 *    emailed report; refused for an operations manager; bulk outcomes per run;
 *    Undo void restores the previous state and reopens the request.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  session: null as null | { user: { id: string; role: string; name?: string; heldRoles?: string[] }; impersonation?: unknown },
  pinOk: true,
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
// The capability rule: ADMIN has both; an operations manager (Laundry at
// manage) may change state but may not void (administrators only by default).
vi.mock("@/lib/rbac/can", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rbac/can")>("@/lib/rbac/can");
  return {
    ...actual,
    can: async (session: { user: { role: string } }, key: string) => session.user.role === "ADMIN" || key === "laundry.change_state",
    requireCapability: async (session: { user: { role: string } }, key: string) => {
      if (session.user.role !== "ADMIN" && key !== "laundry.change_state") throw new actual.CapabilityDenied(key as never);
    },
  };
});
// The own-PIN check is covered by its own tests; here a wrong PIN is a 423.
vi.mock("@/lib/security/admin-verification", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security/admin-verification")>("@/lib/security/admin-verification");
  return {
    ...actual,
    verifySensitiveAction: async (_userId: string, credentials: { pin?: string } | null, action: string) => {
      if (action !== "laundry.void") throw new Error("unexpected action");
      if (!m.pinOk || credentials?.pin !== "2468") throw new actual.SensitiveVerificationError("INVALID_SECURITY_VERIFICATION");
      return true;
    },
  };
});
vi.mock("@/lib/notifications/office-sends", () => ({ sendOfficeNotification: vi.fn(async () => []) }));

import { POST as statePost } from "@/app/api/admin/laundry/runs/state/route";
import { POST as voidPost } from "@/app/api/admin/laundry/runs/void/route";
import { POST as undoPost } from "@/app/api/admin/laundry/runs/void/undo/route";
import { POST as statusPost } from "@/app/api/laundry/[taskId]/status/route";
import { PATCH as adminPatch } from "@/app/api/admin/laundry/[taskId]/route";
import { getLaundryInvoiceData } from "@/lib/laundry/invoice";
import { loadLaundryPipeline } from "@/lib/laundry/pipeline-server";
import { fetchLaundryWeekTasks } from "@/lib/laundry/week-feed";
import { laundryTaskScope } from "@/lib/laundry/teams";
import { applyLaundryPlanDraft } from "@/lib/laundry/planner";
import { applyCleanerLaundryStatusUpdate } from "@/lib/laundry/cleaner-status";
import { sendOfficeNotification } from "@/lib/notifications/office-sends";
import { sydneyDayStart, sydneyTodayKey, addDaysToKey } from "@/lib/time/sydney-range";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `lrv-${randomUUID().slice(0, 8)}`;
const ids = {
  client: randomUUID(), property: randomUUID(), partner: randomUUID(),
  tom: randomUUID(), admin: randomUUID(), ops: randomUUID(),
  corrected: randomUUID(), flagged: randomUUID(), skipped: randomUUID(), emailed: randomUUID(), atLaundry: randomUUID(), failedPending: randomUUID(),
  reportAudit: randomUUID(),
};
const jobIds: Record<string, string> = {};

function post(body: unknown): Request {
  return new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function patch(body: unknown): Request {
  return new Request("http://localhost/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function version(taskId: string): Promise<string> {
  return (await m.client.laundryTask.findUniqueOrThrow({ where: { id: taskId } })).updatedAt.toISOString();
}
function as(user: string, role: Role, impersonation?: unknown) {
  m.session = { user: { id: user, role, name: user === ids.tom ? "Tom" : "Office person", heldRoles: [role] }, ...(impersonation ? { impersonation } : {}) };
}

const todayKey = sydneyTodayKey();
const today = sydneyDayStart(todayKey);
const handoffAt = new Date(Date.now() - 4 * 3600_000);

describe.skipIf(!url)("laundry run Change state and Void (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.client.create({ data: { id: ids.client, name: `${tag} client` } });
    await m.client.laundrySupplier.create({ data: { id: ids.partner, name: `${tag} CleanCo`, avgTurnaround: 48 } });
    await m.client.user.createMany({ data: [
      { id: ids.tom, email: `${tag}-tom@example.invalid`, name: "Tom", role: Role.LAUNDRY, laundrySupplierId: ids.partner },
      { id: ids.admin, email: `${tag}-ad@example.invalid`, name: "Hannah", role: Role.ADMIN },
      { id: ids.ops, email: `${tag}-op@example.invalid`, name: "Priya", role: Role.OPS_MANAGER },
    ] });
    await m.client.property.create({ data: { id: ids.property, name: `${tag} Coogee Terrace`, clientId: ids.client, address: "9 Arden St", suburb: "Coogee", laundryEnabled: true, accessInfo: { laundryTeamUserIds: [ids.tom] } } });
    const names = ["corrected", "flagged", "skipped", "emailed", "atLaundry", "failedPending"] as const;
    for (const [index, name] of names.entries()) {
      const job = await m.client.job.create({ data: { jobNumber: `${tag}-${index}`, propertyId: ids.property, jobType: "AIRBNB_TURNOVER", scheduledDate: sydneyDayStart(addDaysToKey(todayKey, -1)) } });
      jobIds[name] = job.id;
    }
    const base = { propertyId: ids.property, supplierId: ids.partner, pickupDate: today, dropoffDate: sydneyDayStart(addDaysToKey(todayKey, 2)) };
    await m.client.laundryTask.createMany({ data: [
      { id: ids.corrected, jobId: jobIds.corrected, status: "CONFIRMED", ...base },
      { id: ids.flagged, jobId: jobIds.flagged, status: "FLAGGED", flagNotes: "Failed pickup - skip approval requested: locked", ...base },
      { id: ids.skipped, jobId: jobIds.skipped, status: "SKIPPED_PICKUP", skipReasonCode: "NO_LINEN_USED", dropoffCostAud: 30, droppedAt: null, ...base },
      { id: ids.emailed, jobId: jobIds.emailed, status: "SKIPPED_PICKUP", skipReasonCode: "OTHER", ...base },
      { id: ids.atLaundry, jobId: jobIds.atLaundry, status: "PICKED_UP", pickedUpAt: handoffAt, ...base },
      { id: ids.failedPending, jobId: jobIds.failedPending, status: "CONFIRMED", ...base },
    ] });
    await m.client.laundryConfirmation.createMany({ data: [
      { laundryTaskId: ids.corrected, confirmedById: ids.admin, laundryReady: true, bagLocation: "Lobby", createdAt: handoffAt },
      { laundryTaskId: ids.flagged, confirmedById: ids.tom, laundryReady: true, notes: JSON.stringify({ event: "FAILED_PICKUP_REQUEST", reason: "locked", requestedAction: "SKIP", approvalStatus: "PENDING", previousStatus: "CONFIRMED" }) },
      { laundryTaskId: ids.failedPending, confirmedById: ids.tom, laundryReady: true, notes: JSON.stringify({ event: "FAILED_PICKUP_RESCHEDULE", reason: "door locked" }) },
    ] });
    await m.client.auditLog.create({ data: { id: ids.reportAudit, userId: ids.admin, action: "LAUNDRY_REPORT_EMAIL", entity: "LaundryReport", entityId: `custom:${tag}`, after: { mode: "batch", taskIds: [ids.emailed], startDate: today.toISOString(), endDate: today.toISOString(), propertyId: ids.property } } });
  });

  afterAll(async () => {
    if (!m.client) return;
    const taskIds = (await m.client.laundryTask.findMany({ where: { propertyId: ids.property }, select: { id: true } })).map((row) => row.id);
    await m.client.laundryConfirmation.deleteMany({ where: { laundryTaskId: { in: taskIds } } });
    await m.client.auditLog.deleteMany({ where: { OR: [{ entityId: { in: taskIds } }, { id: ids.reportAudit }] } });
    await m.client.laundryRoute.deleteMany({ where: { userId: ids.tom } });
    await m.client.laundryTask.deleteMany({ where: { id: { in: taskIds } } });
    await m.client.job.deleteMany({ where: { propertyId: ids.property } });
    await m.client.user.deleteMany({ where: { id: { in: [ids.tom, ids.admin, ids.ops] } } });
    await m.client.laundrySupplier.deleteMany({ where: { id: ids.partner } });
    await m.client.property.deleteMany({ where: { id: ids.property } });
    await m.client.client.deleteMany({ where: { id: ids.client } });
    await m.client.$disconnect();
  });

  it("Change state: refuses a stale version and a missing time; records the real time, who and why beside the originals", async () => {
    const before = await m.client.laundryConfirmation.findMany({ where: { laundryTaskId: ids.corrected }, orderBy: { createdAt: "asc" } });
    as(ids.ops, Role.OPS_MANAGER);
    const happenedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const common = { target: "PICKED_UP", doneById: ids.tom, reason: "Tom had no signal; called at 15:05", bagCount: 2 };
    expect((await statePost(post({ items: [{ taskId: ids.corrected, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }], happenedAt, ...common }))).status).toBe(409);
    expect((await statePost(post({ items: [{ taskId: ids.corrected, expectedUpdatedAt: await version(ids.corrected) }], ...common }))).status).toBe(400);
    const response = await statePost(post({ items: [{ taskId: ids.corrected, expectedUpdatedAt: await version(ids.corrected) }], happenedAt, ...common }));
    expect(response.status).toBe(200);
    const task = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.corrected } });
    expect(task.status).toBe("PICKED_UP");
    expect(task.pickedUpAt?.toISOString()).toBe(happenedAt);
    expect(task.bagWeightKg).toBeNull(); // blank stays not recorded, never 0
    const after = await m.client.laundryConfirmation.findMany({ where: { laundryTaskId: ids.corrected }, orderBy: { createdAt: "asc" } });
    expect(after.slice(0, before.length)).toEqual(before); // originals byte-equal
    const correction = JSON.parse(after[after.length - 1].notes ?? "{}");
    expect(correction).toMatchObject({ event: "OFFICE_CORRECTION", fromStatus: "CONFIRMED", toStatus: "PICKED_UP", doneById: ids.tom, bagCount: 2, reason: common.reason });
    const audit = await m.client.auditLog.findFirstOrThrow({ where: { entityId: ids.corrected, action: "LAUNDRY_OFFICE_CORRECTION" } });
    expect(audit.userId).toBe(ids.ops);
    expect(audit.after).toMatchObject({ actorRole: "OPS_MANAGER", status: "PICKED_UP" });
    expect(sendOfficeNotification).not.toHaveBeenCalled(); // nothing sent unless ticked
  });

  it("the laundry team's own pickup arriving later is kept beside the office correction", async () => {
    as(ids.tom, Role.LAUNDRY);
    const response = await statusPost(post({ status: "PICKED_UP", confirm: true, bagCount: 2, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }), { params: { taskId: ids.corrected } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ keptBesideCorrection: true });
    const rows = await m.client.laundryConfirmation.findMany({ where: { laundryTaskId: ids.corrected }, orderBy: { createdAt: "asc" } });
    expect(JSON.parse(rows[rows.length - 1].notes ?? "{}")).toMatchObject({ event: "TEAM_RECORD_AFTER_OFFICE_CORRECTION", leg: "PICKUP" });
    expect((await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.corrected } })).status).toBe("PICKED_UP");
  });

  it("Void: refused for an operations manager, with a wrong PIN, on a run that is not voidable, and on an emailed report", async () => {
    as(ids.ops, Role.OPS_MANAGER);
    const body = (taskId: string, pin = "2468") => ({ items: [{ taskId, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }], reason: "No laundry run took place", security: { pin } });
    expect((await voidPost(post(body(ids.flagged)))).status).toBe(403);
    as(ids.admin, Role.ADMIN);
    expect((await voidPost(post({ ...body(ids.flagged, "0000"), items: [{ taskId: ids.flagged, expectedUpdatedAt: await version(ids.flagged) }] }))).status).toBe(423);
    const notVoidable = await voidPost(post({ ...body(ids.atLaundry), items: [{ taskId: ids.atLaundry, expectedUpdatedAt: await version(ids.atLaundry) }] }));
    expect(notVoidable.status).toBe(409);
    expect(await notVoidable.json()).toMatchObject({ code: "NOT_VOIDABLE" });
    const emailed = await voidPost(post({ ...body(ids.emailed), items: [{ taskId: ids.emailed, expectedUpdatedAt: await version(ids.emailed) }] }));
    expect(emailed.status).toBe(409);
    expect(await emailed.json()).toMatchObject({ code: "ON_EMAILED_REPORT" });
    expect((await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.emailed } })).voidedAt).toBeNull();
  });

  it("Void (bulk): one reason and one PIN, an outcome per run; the voided run keeps who, when, why and closes the skip request", async () => {
    as(ids.admin, Role.ADMIN);
    const response = await voidPost(post({
      items: [
        { taskId: ids.flagged, expectedUpdatedAt: await version(ids.flagged) },
        { taskId: ids.skipped, expectedUpdatedAt: await version(ids.skipped) },
        { taskId: ids.failedPending, expectedUpdatedAt: await version(ids.failedPending) },
        { taskId: ids.atLaundry, expectedUpdatedAt: await version(ids.atLaundry) },
      ],
      reason: "Building management washed it on site",
      security: { pin: "2468" },
    }));
    expect(response.status).toBe(200);
    const { outcomes } = (await response.json()) as { outcomes: Array<{ taskId: string; ok: boolean; code?: string }> };
    expect(outcomes.map((row) => [row.taskId, row.ok])).toEqual([[ids.flagged, true], [ids.skipped, true], [ids.failedPending, true], [ids.atLaundry, false]]);
    const flagged = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.flagged } });
    expect(flagged).toMatchObject({ status: "SKIPPED_PICKUP", voidedById: ids.admin, voidReason: "Building management washed it on site", voidPreviousStatus: "FLAGGED" });
    expect(flagged.voidedAt).toBeInstanceOf(Date);
    const events = (await m.client.laundryConfirmation.findMany({ where: { laundryTaskId: ids.flagged }, orderBy: { createdAt: "asc" } })).map((row) => JSON.parse(row.notes ?? "{}").event);
    expect(events).toEqual(["FAILED_PICKUP_REQUEST", "RUN_VOIDED", "FAILED_PICKUP_REQUEST_VOIDED"]);
    expect(await m.client.auditLog.count({ where: { entityId: ids.flagged, action: "LAUNDRY_RUN_VOIDED" } })).toBe(1);
  });

  it("a voided run is left out of the Pipeline, the feeds, the laundry portal, reports and the finance cost", async () => {
    const voided = [ids.flagged, ids.skipped, ids.failedPending];
    const pipeline = await loadLaundryPipeline(todayKey, {}, { role: Role.ADMIN, userId: ids.admin });
    const onBoard = Object.values(pipeline.lanes).flat().map((card) => card.id);
    for (const id of voided) expect(onBoard).not.toContain(id);
    expect(pipeline.voidedRecent).toBeGreaterThanOrEqual(3);
    const end = sydneyDayStart(addDaysToKey(todayKey, 3));
    const feed = (await fetchLaundryWeekTasks(today, end, { role: Role.ADMIN, userId: ids.admin })).map((task) => task.id);
    for (const id of voided) expect(feed).not.toContain(id);
    const officeHistory = (await fetchLaundryWeekTasks(today, end, { role: Role.ADMIN, userId: ids.admin }, {}, { includeVoided: true })).map((task) => task.id);
    for (const id of voided) expect(officeHistory).toContain(id);
    const portal = (await fetchLaundryWeekTasks(today, end, { role: Role.LAUNDRY, userId: ids.tom }, {}, { includeVoided: true })).map((task) => task.id);
    for (const id of voided) expect(portal).not.toContain(id);
    const scope = await laundryTaskScope({ id: ids.tom, role: Role.LAUNDRY });
    expect(await m.client.laundryTask.count({ where: { ...scope, id: { in: voided } } })).toBe(0);
    const report = await getLaundryInvoiceData({ period: "custom", startDate: addDaysToKey(todayKey, -1), endDate: addDaysToKey(todayKey, 1), dateField: "pickup", propertyId: ids.property });
    const reported = report.rows.map((row) => row.taskId);
    for (const id of voided) expect(reported).not.toContain(id);
    expect(reported).toContain(ids.atLaundry);
  });

  it("the planner and a cleaner's outcome never change or un-void a voided run; edits and deletes are refused", async () => {
    const before = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.flagged } });
    await applyLaundryPlanDraft([{ jobId: jobIds.flagged, propertyId: ids.property, propertyName: "x", suburb: "x", cleanDate: today.toISOString(), pickupDate: sydneyDayStart(addDaysToKey(todayKey, 1)).toISOString(), dropoffDate: sydneyDayStart(addDaysToKey(todayKey, 4)).toISOString(), status: "PENDING", flagReason: null, flagNotes: null } as never]);
    await applyCleanerLaundryStatusUpdate({ jobId: jobIds.flagged, cleanerId: ids.admin, laundryOutcome: "READY_FOR_PICKUP", laundryPhotoKey: "laundry/test.jpg", bagLocation: "Lobby", source: "EARLY_UPDATE", portalUrl: "http://localhost" }).catch(() => null);
    const after = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.flagged } });
    expect(after).toMatchObject({ status: "SKIPPED_PICKUP", pickupDate: before.pickupDate, dropoffDate: before.dropoffDate, voidedAt: before.voidedAt });
    as(ids.admin, Role.ADMIN);
    const edit = await adminPatch(patch({ flagNotes: "edit" }), { params: { taskId: ids.flagged } });
    expect(edit.status).toBe(409);
    const change = await statePost(post({ items: [{ taskId: ids.flagged, expectedUpdatedAt: await version(ids.flagged) }], target: "FLAGGED", flagNote: "n", reason: "try a change" }));
    expect(change.status).toBe(409);
  });

  it("Undo void restores the previous state and reopens the skip request", async () => {
    as(ids.admin, Role.ADMIN);
    // 2026-11-14 (simpler confirmations): undoing a void needs a reason (quick pick, no minimum length).
    expect((await undoPost(post({ taskId: ids.flagged, expectedUpdatedAt: await version(ids.flagged), security: { pin: "2468" } }))).status).toBe(400);
    expect((await undoPost(post({ taskId: ids.flagged, expectedUpdatedAt: await version(ids.flagged), reason: "Voided by mistake", security: { pin: "0000" } }))).status).toBe(423);
    const response = await undoPost(post({ taskId: ids.flagged, expectedUpdatedAt: await version(ids.flagged), reason: "x", security: { pin: "2468" } }));
    expect(response.status).toBe(200);
    const task = await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.flagged } });
    expect(task).toMatchObject({ status: "FLAGGED", voidedAt: null, voidedById: null, voidReason: null, voidPreviousStatus: null });
    // The existing approval route finds the request again.
    const decided = await adminPatch(patch({ action: "REJECT_FAILED_PICKUP_REQUEST", resolutionNotes: "try again" }), { params: { taskId: ids.flagged } });
    expect(decided.status).toBe(200);
  });

  it("the database refuses a half-recorded void", async () => {
    await expect(m.client.laundryTask.update({ where: { id: ids.atLaundry }, data: { voidedAt: new Date() } })).rejects.toThrow();
  });
});
