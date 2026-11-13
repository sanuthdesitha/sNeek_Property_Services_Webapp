// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ client: null as any }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_target, key) => { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/gps/departure-clockout", () => ({ handleGeofenceDeparture: vi.fn(async () => ({})) }));
import { ingestCleanerBatch, writeLastLocation } from "@/lib/gps/ingest-service";
import { recordCheckoutLocation } from "@/lib/jobs/checkout-location";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let id = "";
const buckets = () => (globalThis as { __sneekLocationBuckets?: Map<string, unknown> }).__sneekLocationBuckets;

describe.skipIf(!url)("location ingest on PostgreSQL (loopback)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Disposable loopback DB on 55439 required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
  });
  beforeEach(async () => {
    id = `loc-${randomUUID()}`;
    buckets()?.clear();
    await m.client.client.create({ data: { id, name: "Location fixture" } });
    await m.client.user.create({ data: { id, email: `${id}@example.invalid`, role: "CLEANER" } });
    await m.client.property.create({ data: { id, clientId: id, name: "Location fixture", address: "1 Fixture St", suburb: "Sydney", latitude: -33.86, longitude: 151.2 } });
    await m.client.job.create({ data: { id, jobNumber: id, propertyId: id, jobType: "GENERAL_CLEAN", status: "IN_PROGRESS", scheduledDate: new Date() } });
    await m.client.jobAssignment.create({ data: { jobId: id, userId: id } });
    await m.client.timeLog.create({ data: { id, jobId: id, userId: id, startedAt: new Date(Date.now() - 30 * 60_000) } });
  });
  afterEach(async () => {
    await m.client.cleanerLocationPing.deleteMany({ where: { userId: id } });
    await m.client.userLastLocation.deleteMany({ where: { userId: id } });
    await m.client.timeLog.deleteMany({ where: { jobId: id } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: id } });
    await m.client.job.deleteMany({ where: { id } });
    await m.client.property.deleteMany({ where: { id } });
    await m.client.client.deleteMany({ where: { id } });
    await m.client.user.deleteMany({ where: { id } });
  });
  afterAll(async () => { await m.client?.$disconnect(); });

  const batch = (clientId: string, ageMs: number, lat = -33.86) => ({
    sentAt: new Date().toISOString(),
    pings: [{ clientId, jobId: id, lat, lng: 151.2, accuracy: 10, timestamp: new Date(Date.now() - ageMs).toISOString() }],
  });

  it("stores a retried batch once and records the receive time and source", async () => {
    const first = await ingestCleanerBatch({ userId: id, impersonating: false, body: batch("same", 5_000) });
    const retry = await ingestCleanerBatch({ userId: id, impersonating: false, body: batch("same", 5_000) });
    expect(first.body).toMatchObject({ received: 1 });
    expect(retry.body).toMatchObject({ received: 0, dropReasons: { DUPLICATE: 1 } });
    const rows = await m.client.cleanerLocationPing.findMany({ where: { userId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ clientId: "same", source: "CLEANER_JOB" });
    expect(rows[0].receivedAt.getTime()).toBeGreaterThanOrEqual(rows[0].timestamp.getTime());
  });

  it("never moves the latest position backwards for a late backlog", async () => {
    await ingestCleanerBatch({ userId: id, impersonating: false, body: batch("new", 10_000, -33.861) });
    await ingestCleanerBatch({ userId: id, impersonating: false, body: batch("old", 20 * 60_000, -33.9) });
    const last = await m.client.userLastLocation.findUnique({ where: { userId: id } });
    expect(last.lat).toBe(-33.861);
    expect(await m.client.cleanerLocationPing.count({ where: { userId: id } })).toBe(2);
  });

  it("records the phone's reported state and refuses fixes once the clock stops", async () => {
    await writeLastLocation({ userId: id, fix: null, receivedAt: new Date(), source: "CLEANER_JOB", jobId: id, laundryRouteId: null, state: { state: "PERMISSION_OFF", at: new Date() } });
    expect((await m.client.userLastLocation.findUnique({ where: { userId: id } })).trackingState).toBe("PERMISSION_OFF");
    await m.client.timeLog.update({ where: { id }, data: { stoppedAt: new Date(), durationM: 30 } });
    await m.client.job.update({ where: { id }, data: { status: "PAUSED" } });
    const refused = await ingestCleanerBatch({ userId: id, impersonating: false, body: batch("after-stop", 1_000) });
    expect(refused.body).toMatchObject({ received: 0, dropReasons: { OUTSIDE_WINDOW: 1 }, window: { active: false, reason: "CLOCK_STOPPED" } });
  });

  it("writes the segment's own stop location once, with accuracy and distance", async () => {
    await m.client.timeLog.update({ where: { id }, data: { stoppedAt: new Date(Date.now() - 1_000), durationM: 30 } });
    await m.client.job.update({ where: { id }, data: { status: "PAUSED" } });
    const first = await m.client.$transaction((tx: any) => recordCheckoutLocation(tx, { jobId: id, userId: id, timeLogId: id, lat: -33.86, lng: 151.2, accuracy: 12, distanceM: 3.4 }));
    const second = await m.client.$transaction((tx: any) => recordCheckoutLocation(tx, { jobId: id, userId: id, timeLogId: id, lat: -33.9, lng: 151.2 }));
    expect([first.segmentRecorded, second.segmentRecorded]).toEqual([true, false]);
    expect(await m.client.timeLog.findUnique({ where: { id } })).toMatchObject({ stopLat: -33.86, stopAccuracyM: 12, stopDistanceM: 3 });
  });
});
