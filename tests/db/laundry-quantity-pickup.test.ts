// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Role } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordQuantityPickup } from "@/lib/laundry/quantity-pickup";
import { GET, PATCH } from "@/app/api/laundry/quantity-exceptions/route";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ client: null as any, mime: "image/jpeg", actorId: "", role: "ADMIN", impersonation: undefined as any }));
vi.mock("@/lib/auth/session", () => ({ requireRole: async (roles: string[]) => { if (!roles.includes(m.role)) throw new Error("FORBIDDEN"); return { user: { id: m.actorId, role: m.role }, impersonation: m.impersonation }; } }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://example.invalid/${key}`, resolveS3: async () => ({ client: { headObject: () => ({ promise: async () => ({ ContentType: m.mime, ContentLength: 10 }) }) }, bucket: "fixture" }) }));
const url = process.env.SNEEK_TEST_DATABASE_URL; let id = ""; let baselineId = "";
const input = () => ({ taskId: id, actorId: id, role: Role.ADMIN, bagCount: 2, baselineId, discrepancyReason: "One bag missing", photoKey: `laundry/pickup/${id}/ab12.jpg` });
describe.skipIf(!url)("quantity pickup transaction", () => {
  beforeAll(async () => { const parsed = new URL(url!); if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/^postgres(ql)?:$/.test(parsed.protocol) || Array.from(parsed.searchParams.keys()).some(key => ["host", "hostaddr"].includes(key.toLowerCase()))) throw new Error("Loopback DB required"); m.client = new PrismaClient({ datasources: { db: { url } } }); await m.client.$connect(); });
  beforeEach(async () => {
    id = `qa-quantity-${randomUUID()}`; m.mime = "image/jpeg"; m.actorId = id; m.role = "ADMIN"; m.impersonation = undefined;
    await m.client.client.create({ data: { id, name: "Quantity fixture" } });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "ADMIN" } });
    await m.client.property.create({ data: { id, clientId: id, name: "Quantity fixture", address: "1 Test Street", suburb: "Sydney", laundryEnabled: true } });
    await m.client.job.create({ data: { id, jobNumber: id, propertyId: id, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date() } });
    await m.client.laundryTask.create({ data: { id, jobId: id, propertyId: id, status: "CONFIRMED", pickupDate: new Date("2026-09-13T00:00:00Z"), dropoffDate: new Date("2026-09-15T00:00:00Z") } });
    baselineId = (await m.client.laundryConfirmation.create({ data: { laundryTaskId: id, confirmedById: id, laundryReady: true, notes: JSON.stringify({ source: "EARLY_UPDATE", laundryOutcome: "READY_FOR_PICKUP", unit: "bags", bagCount: 3 }) } })).id;
  });
  afterEach(async () => {
    await m.client.auditLog.deleteMany({ where: { userId: id } }); await m.client.laundryQuantityException.deleteMany({ where: { originalTaskId: id } });
    await m.client.laundryConfirmation.deleteMany({ where: { laundryTaskId: id } }); await m.client.laundryTask.deleteMany({ where: { id } }); await m.client.job.deleteMany({ where: { id } });
    await m.client.property.deleteMany({ where: { id } }); await m.client.user.deleteMany({ where: { id } }); await m.client.client.deleteMany({ where: { id } });
  });
  afterAll(async () => { await m.client?.$disconnect(); });
  it("preserves an immutable exception through corrections and deletion", async () => {
    expect((await recordQuantityPickup(input())).status).toBe("PICKED_UP");
    const exception = await m.client.laundryQuantityException.findFirst({ where: { originalTaskId: id } });
    expect(exception).toMatchObject({ expectedCount: 3, actualCount: 2, resolvedAt: null, unit: "bags" });
    await m.client.laundryConfirmation.update({ where: { id: exception.pickupConfirmationId }, data: { notes: '{"event":"PICKED_UP","bagCount":3}' } });
    await m.client.laundryConfirmation.deleteMany({ where: { laundryTaskId: id } }); await m.client.laundryTask.delete({ where: { id } });
    expect(await m.client.laundryQuantityException.findUnique({ where: { id: exception.id } })).toMatchObject({ expectedCount: 3, actualCount: 2, laundryTaskId: null, propertyId: id });
  });
  it("keeps equal and unknown expected counts free of invented exceptions", async () => {
    await recordQuantityPickup({ ...input(), bagCount: 3, photoKey: undefined }); expect(await m.client.laundryQuantityException.count({ where: { originalTaskId: id } })).toBe(0);
    await m.client.laundryTask.update({ where: { id }, data: { status: "CONFIRMED" } }); await m.client.laundryConfirmation.deleteMany({ where: { laundryTaskId: id } });
    await recordQuantityPickup({ ...input(), baselineId: null, photoKey: undefined }); expect(await m.client.laundryQuantityException.count({ where: { originalTaskId: id } })).toBe(0);
    const row = await m.client.laundryConfirmation.findFirst({ where: { laundryTaskId: id } }); expect(JSON.parse(row.notes).expectedBagCount).toBeNull();
  });
  it("rejects stale baseline, missing reason, cross-uploader proof and nonimage proof", async () => {
    await expect(recordQuantityPickup({ ...input(), baselineId: "stale" })).rejects.toMatchObject({ status: 409 });
    await expect(recordQuantityPickup({ ...input(), discrepancyReason: "" })).rejects.toMatchObject({ status: 400 });
    await expect(recordQuantityPickup({ ...input(), photoKey: "laundry/pickup/other/ab.jpg" })).rejects.toMatchObject({ status: 400 });
    m.mime = "video/mp4"; await expect(recordQuantityPickup(input())).rejects.toMatchObject({ status: 400 });
    expect((await m.client.laundryTask.findUnique({ where: { id } })).status).toBe("CONFIRMED");
  });
  it("rolls back pickup and exception when audit cannot persist", async () => {
    await expect(recordQuantityPickup({ ...input(), actorId: "missing-actor", photoKey: "laundry/pickup/missing-actor/ab.jpg" })).rejects.toThrow();
    expect((await m.client.laundryTask.findUnique({ where: { id } })).status).toBe("CONFIRMED"); expect(await m.client.laundryQuantityException.count({ where: { originalTaskId: id } })).toBe(0);
  });
  it("rechecks a competing pickup under the task lock", async () => {
    let acquired!: () => void, release!: () => void; const held = new Promise<void>(done => acquired = done), released = new Promise<void>(done => release = done);
    const first = m.client.$transaction(async (tx: Prisma.TransactionClient) => { await tx.laundryTask.update({ where: { id }, data: { status: "PICKED_UP" } }); acquired(); await released; }); await held;
    const second = recordQuantityPickup(input()).catch(error => error); release(); await first;
    expect(await second).toMatchObject({ status: 409 }); expect(await m.client.laundryQuantityException.count({ where: { originalTaskId: id } })).toBe(0);
  });
  it("filters snapshots by current property scope and permits only audited office resolution", async () => {
    await recordQuantityPickup(input()); const row = await m.client.laundryQuantityException.findFirst({ where: { originalTaskId: id } });
    await m.client.property.update({ where: { id }, data: { accessInfo: { laundryTeamUserIds: ["different-worker"] } } }); m.role = "LAUNDRY";
    const feed = await GET(new NextRequest("http://localhost/api/laundry/quantity-exceptions")); expect(feed.headers.get("Cache-Control")).toBe("private, no-store"); expect((await feed.json()).rows.some((entry: any) => entry.id === row.id)).toBe(false);
    const resolve = (version = 0) => PATCH(new NextRequest("http://localhost/api/laundry/quantity-exceptions", { method: "PATCH", body: JSON.stringify({ id: row.id, version, note: "Count checked with cleaner" }) }));
    expect((await resolve()).status).toBe(403); m.role = "ADMIN"; m.impersonation = { actorId: "other-admin", mode: "READ_ONLY" };
    expect((await resolve()).status).toBe(403); m.impersonation = undefined;
    expect((await resolve()).status).toBe(200); expect((await resolve()).status).toBe(409);
    expect(await m.client.laundryQuantityException.findUnique({ where: { id: row.id } })).toMatchObject({ expectedCount: 3, actualCount: 2, version: 1, resolutionNote: "Count checked with cleaner" });
    expect(await m.client.auditLog.count({ where: { userId: id, action: "LAUNDRY_QUANTITY_EXCEPTION_RESOLVED" } })).toBe(1);
  });
  it("rejects a revoked team at pickup without creating evidence or exception", async () => {
    await m.client.property.update({ where: { id }, data: { accessInfo: { laundryTeamUserIds: ["different-worker"] } } });
    await expect(recordQuantityPickup({ ...input(), role: Role.LAUNDRY })).rejects.toMatchObject({ status: 403 });
    expect(await m.client.laundryQuantityException.count({ where: { originalTaskId: id } })).toBe(0);
  });
  it("rejects a formerly displayed baseline that is now unknown", async () => {
    await m.client.laundryConfirmation.deleteMany({ where: { laundryTaskId: id } });
    await expect(recordQuantityPickup(input())).rejects.toMatchObject({ status: 409 });
    expect((await m.client.laundryTask.findUnique({ where: { id } })).status).toBe("CONFIRMED");
  });
  it("reads a new cleaner baseline committed while pickup waits on the task", async () => {
    let acquired!: () => void, release!: () => void; const held = new Promise<void>(done => acquired = done), released = new Promise<void>(done => release = done);
    const cleaner = m.client.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT "id" FROM "LaundryTask" WHERE "id" = ${id} FOR UPDATE`;
      await tx.laundryConfirmation.create({ data: { laundryTaskId: id, confirmedById: id, laundryReady: true, createdAt: new Date(Date.now() + 1000), notes: '{"source":"EARLY_UPDATE","laundryOutcome":"READY_FOR_PICKUP","bagCount":4,"unit":"bags"}' } }); acquired(); await released;
    });
    await held; const driver = recordQuantityPickup(input()).catch(error => error); release(); await cleaner;
    expect(await driver).toMatchObject({ status: 409 }); expect((await m.client.laundryTask.findUnique({ where: { id } })).status).toBe("CONFIRMED");
  });
});
