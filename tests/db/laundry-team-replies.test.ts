// @vitest-environment node
/**
 * Laundry team answers to office requests (2026-11-12) on a real disposable
 * PostgreSQL (127.0.0.1:55439): an asked team member answers once per key,
 * a stranger is refused, the answer clears the request in the portal inbox,
 * the office sees it with the run (pipeline read), the CHECK constraints hold,
 * and the Suppliers directory carries trades and partner figures.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ client: null as unknown as PrismaClient }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));

import { recordTeamRequestReply, loadTeamReplies, repliesByTask } from "@/lib/laundry/team-request-replies";
import { listOfficeRequestsForLaundryUser } from "@/lib/laundry/office-requests";
import { loadSupplierDirectory } from "@/lib/laundry/partners";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `ltr-${randomUUID().slice(0, 8)}`;
const ids = { client: randomUUID(), property: randomUUID(), partner: randomUUID(), task: randomUUID(), tom: randomUUID(), ana: randomUUID(), admin: randomUUID(), request: randomUUID(), worker: randomUUID(), plumber: randomUUID(), item: randomUUID() };

describe.skipIf(!url)("laundry team replies (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.client.create({ data: { id: ids.client, name: `${tag} client` } });
    await m.client.property.create({ data: { id: ids.property, name: `${tag} Glebe House`, clientId: ids.client, address: "1 Test St", suburb: "Glebe", laundryEnabled: true } });
    await m.client.laundrySupplier.create({ data: { id: ids.partner, name: `${tag} CleanCo`, avgTurnaround: 48 } });
    await m.client.user.createMany({ data: [
      { id: ids.tom, email: `${tag}-tom@example.invalid`, name: "Tom", role: Role.LAUNDRY, laundrySupplierId: ids.partner },
      { id: ids.ana, email: `${tag}-ana@example.invalid`, name: "Ana", role: Role.LAUNDRY },
      { id: ids.admin, email: `${tag}-ad@example.invalid`, name: "Ada", role: Role.ADMIN },
      { id: ids.plumber, email: `${tag}-pl@example.invalid`, name: "Sam", role: Role.MAINTENANCE },
    ] });
    const job = await m.client.job.create({ data: { jobNumber: `${tag}-J1`, propertyId: ids.property, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date("2026-11-09T00:00:00Z") } });
    const pickedUpAt = new Date(Date.now() - 72 * 3_600_000);
    await m.client.laundryTask.create({ data: { id: ids.task, jobId: job.id, propertyId: ids.property, supplierId: ids.partner, status: "PICKED_UP", pickedUpAt, pickupDate: new Date(pickedUpAt.toISOString().slice(0, 10)), dropoffDate: new Date(Date.now() - 86_400_000) } });
    await m.client.auditLog.create({ data: { id: ids.request, userId: ids.admin, action: "LAUNDRY_TEAM_REQUEST_SENT", entity: "LaundryTask", entityId: ids.task, after: { kind: "TEAM_RETURN_ETA", recipientIds: [ids.tom], note: "Guest Fri" } } });
    await m.client.maintenanceWorker.create({ data: { id: ids.worker, name: "Sam", company: `${tag} Eastside Plumbing`, trade: "Plumbing", isPermanent: true, userId: ids.plumber } });
    await m.client.propertyMaintenanceItem.create({ data: { id: ids.item, propertyId: ids.property, reportedByUserId: ids.admin, source: "ADMIN", title: `${tag} tap`, assignedWorkerId: ids.worker } });
  });

  afterAll(async () => {
    if (!m.client) return;
    await m.client.propertyMaintenanceItem.deleteMany({ where: { id: ids.item } });
    await m.client.maintenanceWorker.deleteMany({ where: { id: ids.worker } });
    await m.client.auditLog.deleteMany({ where: { OR: [{ entityId: ids.task }, { id: ids.request }] } });
    await m.client.laundryTask.deleteMany({ where: { id: ids.task } });
    await m.client.job.deleteMany({ where: { propertyId: ids.property } });
    await m.client.user.deleteMany({ where: { id: { in: [ids.tom, ids.ana, ids.admin, ids.plumber] } } });
    await m.client.laundrySupplier.deleteMany({ where: { id: ids.partner } });
    await m.client.property.deleteMany({ where: { id: ids.property } });
    await m.client.client.deleteMany({ where: { id: ids.client } });
    await m.client.$disconnect();
  });

  it("shows the request open, records one answer per key, refuses a stranger, then shows it answered", async () => {
    const before = await listOfficeRequestsForLaundryUser({ id: ids.tom, role: Role.LAUNDRY });
    expect(before.find((request) => request.id === ids.request)?.state).toBe("open");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const body = { answer: "RETURN_AT", date: tomorrow, time: "14:00", note: "Dryer repaired", idempotencyKey: `${tag}-key-1` };
    const first = await recordTeamRequestReply({ id: ids.tom, role: Role.LAUNDRY }, ids.request, body);
    expect(first.replayed).toBe(false);
    const again = await recordTeamRequestReply({ id: ids.tom, role: Role.LAUNDRY }, ids.request, body);
    expect(again).toMatchObject({ replayed: true, reply: { id: first.reply.id } });
    expect(await m.client.laundryTeamRequestReply.count({ where: { laundryTaskId: ids.task } })).toBe(1);
    await expect(recordTeamRequestReply({ id: ids.ana, role: Role.LAUNDRY }, ids.request, { ...body, idempotencyKey: `${tag}-key-2` })).rejects.toMatchObject({ status: 403 });
    const after = await listOfficeRequestsForLaundryUser({ id: ids.tom, role: Role.LAUNDRY });
    expect(after.find((request) => request.id === ids.request)).toMatchObject({ state: "answered", replies: [{ answer: "RETURN_AT", date: tomorrow, time: "14:00", note: "Dryer repaired" }] });
    // The office run panel reads the same answer with the run.
    const forOffice = repliesByTask(await loadTeamReplies({ taskIds: [ids.task] })).get(ids.task);
    expect(forOffice?.[0]).toMatchObject({ byName: "Tom", answer: "RETURN_AT" });
    expect(await m.client.auditLog.count({ where: { action: "LAUNDRY_TEAM_REQUEST_REPLIED", entityId: ids.task } })).toBe(1);
    // The run itself is unchanged by an answer.
    expect((await m.client.laundryTask.findUniqueOrThrow({ where: { id: ids.task } })).status).toBe("PICKED_UP");
  });

  it("enforces the answer and time constraints in the database", async () => {
    const insert = (answer: string, time: string | null, date: string | null) => m.client.$executeRawUnsafe(
      `INSERT INTO "LaundryTeamRequestReply" ("id","laundryTaskId","requestAuditId","requestKind","answer","answerTime","answerDate","idempotencyKey") VALUES ($1,$2,$3,'TEAM_RETURN_ETA',$4,$5,$6::date,$7)`,
      randomUUID(), ids.task, ids.request, answer, time, date, `${tag}-${randomUUID().slice(0, 8)}`,
    );
    await expect(insert("MAYBE", null, null)).rejects.toThrow(/answer_check/);
    await expect(insert("MESSAGE", "25:00", null)).rejects.toThrow(/answerTime_check/);
    await expect(insert("RETURN_AT", null, null)).rejects.toThrow(/returnAt_check/);
  });

  it("keeps the answer when the account is deleted (name kept, link cleared)", async () => {
    const extra = randomUUID();
    await m.client.user.create({ data: { id: extra, email: `${tag}-x@example.invalid`, name: "Xan", role: Role.LAUNDRY } });
    const row = await m.client.laundryTeamRequestReply.create({ data: { laundryTaskId: ids.task, requestAuditId: ids.request, requestKind: "TEAM_RETURN_ETA", answer: "MESSAGE", note: "hi", repliedById: extra, repliedByName: "Xan", idempotencyKey: `${tag}-key-x` } });
    await m.client.user.delete({ where: { id: extra } });
    expect(await m.client.laundryTeamRequestReply.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ repliedById: null, repliedByName: "Xan" });
  });

  it("lists trades and partner figures in the Suppliers directory", async () => {
    const directory = await loadSupplierDirectory();
    const trade = directory.trades?.find((row) => row.id === ids.worker);
    expect(trade).toMatchObject({ name: `${tag} Eastside Plumbing`, contactName: "Sam", trade: "Plumbing", openCases: 1, login: { id: ids.plumber } });
    const partner = directory.rows.find((row) => row.laundry?.id === ids.partner)?.laundry;
    expect(partner?.team.map((member) => member.id)).toEqual([ids.tom]);
    expect(partner?.stats).toMatchObject({ toDrop: 1, late: 1, recentProperties: 1 });
  });
});
