// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient, Prisma, Role } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { recordFailedPickup } from "@/lib/laundry/failed-pickup";
const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/s3", () => ({ publicUrl: (key: string) => `https://example.invalid/${key}`, resolveS3: async () => ({ client: { headObject: () => ({ promise: async () => ({ ContentType: "image/jpeg", ContentLength: 10 }) }) }, bucket: "fixture" }) }));
const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
const input = () => ({ taskId: id, actorId: id, role: Role.ADMIN, status: "FAILED_PICKUP_REQUEST" as const, reason: "Locked gate", requestedAction: "SKIP" as const, photoKey: `laundry/failed-pickup/${id}/${id}/ab12.jpg` });
describe.skipIf(!url)("access failure transaction (explicit local DB)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/^postgres(ql)?:$/.test(parsed.protocol) || Array.from(parsed.searchParams.keys()).some(key => ["host", "hostaddr"].includes(key.toLowerCase()))) throw new Error("Loopback DB required");
    m.client = new PrismaClient({ datasources: { db: { url } } }); await m.client.$connect();
  });
  beforeEach(async () => {
    id = `qa-access-failure-${randomUUID()}`;
    await m.client.client.create({ data: { id, name: "Failure fixture" } });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "ADMIN" } });
    await m.client.property.create({ data: { id, clientId: id, name: "Failure fixture", address: "1 Test Street", suburb: "Sydney", laundryEnabled: true } });
    await m.client.job.create({ data: { id, jobNumber: id, propertyId: id, jobType: "AIRBNB_TURNOVER", scheduledDate: new Date() } });
    await m.client.laundryTask.create({ data: { id, jobId: id, propertyId: id, pickupDate: new Date("2026-09-13T00:00:00Z"), dropoffDate: new Date("2026-09-15T00:00:00Z") } });
  });
  afterEach(async () => {
    const intents = await m.client.notificationIntent.findMany({ where: { envelope: { path: ["entity", "id"], equals: id } }, select: { id: true, notificationId: true } });
    await m.client.notificationAttempt.deleteMany({ where: { intentId: { in: intents.map((intent: any) => intent.id) } } });
    await m.client.notificationIntent.deleteMany({ where: { id: { in: intents.map((intent: any) => intent.id) } } });
    await m.client.notification.deleteMany({ where: { id: { in: intents.flatMap((intent: any) => intent.notificationId ? [intent.notificationId] : []) } } });
    await m.client.auditLog.deleteMany({ where: { entityId: id, entity: "LaundryTask" } });
    await m.client.laundryConfirmation.deleteMany({ where: { laundryTaskId: id } });
    await m.client.laundryTask.deleteMany({ where: { id } }); await m.client.job.deleteMany({ where: { id } });
    await m.client.property.deleteMany({ where: { id } }); await m.client.user.deleteMany({ where: { id } }); await m.client.client.deleteMany({ where: { id } });
  });
  afterAll(async () => { await m.client?.$disconnect(); });
  it("commits proof, request and audit together without directly skipping", async () => {
    expect((await recordFailedPickup(input())).status).toBe("FLAGGED");
    expect(await m.client.laundryConfirmation.count({ where: { laundryTaskId: id, s3Key: input().photoKey } })).toBe(1);
    expect(await m.client.auditLog.count({ where: { entityId: id } })).toBe(1);
  });
  it("rolls back task and proof when audit persistence fails", async () => {
    await expect(recordFailedPickup({ ...input(), actorId: "nonexistent-fixture-actor", photoKey: undefined })).rejects.toThrow();
    expect((await m.client.laundryTask.findUnique({ where: { id } })).status).toBe("PENDING");
    expect(await m.client.laundryConfirmation.count({ where: { laundryTaskId: id } })).toBe(0);
  });
  it("does not overwrite a pickup that commits while failure reporting waits", async () => {
    let acquired!: () => void, release!: () => void;
    const held = new Promise<void>(done => { acquired = done; }), released = new Promise<void>(done => { release = done; });
    const driver = m.client.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.laundryTask.update({ where: { id }, data: { status: "PICKED_UP" } }); acquired(); await released;
    });
    await held;
    const report = recordFailedPickup(input()).then(() => null, error => error);
    release(); await driver;
    expect(await report).toMatchObject({ status: 409 });
    expect((await m.client.laundryTask.findUnique({ where: { id } })).status).toBe("PICKED_UP");
    expect(await m.client.laundryConfirmation.count({ where: { laundryTaskId: id } })).toBe(0);
  });
});
