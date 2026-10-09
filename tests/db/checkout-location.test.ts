// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from "vitest";
import { recordCheckoutLocation } from "@/lib/jobs/checkout-location";
const url = process.env.SNEEK_TEST_DATABASE_URL;
let db: PrismaClient;
let id: string;
const now = new Date();
describe.skipIf(!url)("checkout location retention", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Disposable loopback DB required");
    db = new PrismaClient({ datasources: { db: { url } } });
  });
  beforeEach(async () => {
    id = randomUUID();
    await db.user.create({ data: { id, email: `${id}@example.invalid`, role: "CLEANER", passwordHash: "fixture" } });
    await db.client.create({ data: { id, name: "Clock fixture" } });
    await db.property.create({ data: { id, clientId: id, name: "Clock fixture", address: "Fixture", suburb: "Sydney" } });
    await db.job.create({ data: { id, jobNumber: id, propertyId: id, jobType: "AIRBNB_TURNOVER", status: "PAUSED", scheduledDate: now } });
    await db.jobAssignment.create({ data: { jobId: id, userId: id } });
    await db.timeLog.create({ data: { id, jobId: id, userId: id, startedAt: new Date(now.getTime() - 600_000), stoppedAt: new Date(now.getTime() - 1000), durationM: 10 } });
  });
  afterEach(async () => {
    await db.timeLog.deleteMany({ where: { jobId: id } });
    await db.jobAssignment.deleteMany({ where: { jobId: id } });
    await db.job.deleteMany({ where: { id } });
    await db.property.deleteMany({ where: { id } });
    await db.client.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id } });
  });
  afterAll(async () => { await db?.$disconnect(); });
  const capture = (lat = 1, timeLogId = id) => db.$transaction(tx => recordCheckoutLocation(tx, { jobId: id, userId: id, timeLogId, lat, lng: 2 }, now));
  it("keeps the first location and actual stopped time across simultaneous device captures", async () => {
    const results = await Promise.all([capture(1), capture(3)]);
    expect(results.filter(r => r.recorded)).toHaveLength(1);
    const saved = await db.job.findUniqueOrThrow({ where: { id } });
    expect(saved.gpsCheckOutAt).toEqual(new Date(now.getTime() - 1000));
    await capture(9);
    expect((await db.job.findUniqueOrThrow({ where: { id } })).gpsCheckOutLat).toBe(saved.gpsCheckOutLat);
  });
  it("does not attach a late form location to an earlier clock-out", async () => {
    await db.timeLog.update({ where: { id }, data: { stoppedAt: new Date(now.getTime() - 300_000) } });
    expect(await capture()).toMatchObject({ recorded: false, reason: "CLOCK_OUT_LOCATION_EXPIRED" });
    expect((await db.job.findUniqueOrThrow({ where: { id } })).gpsCheckOutAt).toBeNull();
  });
  it("rejects another clock segment and a running clock", async () => {
    expect((await capture(1, "another-log")).recorded).toBe(false);
    await db.timeLog.update({ where: { id }, data: { stoppedAt: null } });
    expect((await capture()).recorded).toBe(false);
  });
  it("revalidates assignment before writing", async () => {
    await db.jobAssignment.updateMany({ where: { jobId: id }, data: { removedAt: now } });
    await expect(capture()).rejects.toThrow("FORBIDDEN");
  });
  it("preserves historical coordinates with no timestamp", async () => {
    await db.job.update({ where: { id }, data: { gpsCheckOutLat: 42, gpsCheckOutLng: 43 } });
    expect((await capture()).recorded).toBe(false);
  });
  it("rejects a job reset to its pre-start state", async () => {
    await db.job.update({ where: { id }, data: { status: "ASSIGNED" } });
    expect(await capture()).toMatchObject({ recorded: false, reason: "CLOCK_CONTEXT_CHANGED" });
  });
  it("allows a real resumed shift to record its own subsequent clock-out", async () => {
    await db.job.update({ where: { id }, data: { gpsCheckOutLat: 42, gpsCheckOutLng: 43, gpsCheckOutAt: new Date(now.getTime() - 700_000) } });
    expect((await capture()).recorded).toBe(true);
  });
});
