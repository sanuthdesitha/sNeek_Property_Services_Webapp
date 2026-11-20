// @vitest-environment node
/**
 * Property devices (2026-11-20) on a real, disposable PostgreSQL
 * (127.0.0.1:55439, run with --no-file-parallelism).
 *
 * Covered: manual-only mode (a hand-added device and a hand-entered 18% put
 * ONE high-priority, photo-required task on the next clean); exactly one task
 * under concurrent evaluations and retried readings; stale, unknown and wired
 * never raise; no upcoming clean → waiting, then attached when a clean exists;
 * a cancelled clean → the task follows to the next one; the cleaner's answers
 * (done needs a photo; could-not-do needs a reason and carries the task, with
 * its device, to the next clean); "charged, awaiting a new reading" and the
 * cool-down; recovery closes and cancels; the Ring sync stores the rotated
 * refresh token encrypted, links only confirmed locations, never writes a
 * token into a run, audit or error; repeated failures notify once and leave
 * readings to go out of date; Minut with no client id or secret is honestly
 * not connected.
 *
 * Providers are fakes (recorded-shape answers); nothing contacts Ring or Minut.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = "property-devices-test-key-0123456789";
  process.env.NEXTAUTH_SECRET = "property-devices-test-secret-0123456789";
  return { client: null as unknown as PrismaClient, officeSends: [] as Array<Record<string, unknown>> };
});
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, {
    get(_target, key) {
      const value = (m.client as unknown as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value;
    },
  }),
}));
vi.mock("@/lib/notifications/office-sends", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/office-sends")>();
  return { ...actual, sendOfficeNotification: async (input: Record<string, unknown>) => { m.officeSends.push(input); return []; } };
});

import { applyCleanerJobTaskUpdates, attachPendingAdminTasksToJob } from "@/lib/job-tasks/service";
import { cancelJob } from "@/lib/jobs/cancel";
import { closeConditionByOffice, evaluateDevice, recordReading, rehomeChargeTasks } from "@/lib/property-devices/charge-service";
import { connectionViews, readRingSecret } from "@/lib/property-devices/connections";
import { DEFAULT_DEVICE_SETTINGS } from "@/lib/property-devices/charge-policy";
import { PROPERTY_DEVICE_SETTINGS_KEY } from "@/lib/property-devices/settings";
import { runProviderSync } from "@/lib/property-devices/sync";
import { listDeviceAttention, listPropertyDevices } from "@/lib/property-devices/views";
import { encryptSecret, decryptSecret } from "@/lib/security/encryption";
import type { ProviderFetchDeps } from "@/lib/property-devices/providers/http";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = `pdv-${randomUUID().slice(0, 8)}`;
const id = (name: string) => `${tag}-${name}`;
const settings = { ...DEFAULT_DEVICE_SETTINGS };
const TZ = "Australia/Sydney";

function dayFromNow(days: number): Date {
  const today = new Date().toISOString().slice(0, 10);
  return new Date(Date.parse(`${today}T00:00:00.000Z`) + days * 86_400_000);
}
const hoursAgo = (hours: number, from = new Date()) => new Date(from.getTime() - hours * 3_600_000);

async function device(name: string, propertyId: string, extra: Record<string, unknown> = {}) {
  return m.client.propertyDevice.create({ data: { id: id(name), propertyId, provider: "MANUAL", name, kind: "CAMERA", ...extra } });
}

async function openChargeTasks(deviceId: string) {
  return m.client.jobTask.findMany({ where: { executionStatus: "OPEN", metadata: { path: ["deviceId"], equals: deviceId } } });
}

let savedSettings: unknown = undefined;
let savedCredentials: unknown = undefined;

describe.skipIf(!url)("property devices (explicit local DB)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55439") throw new Error("Dedicated loopback fixture database required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    savedSettings = (await m.client.appSetting.findUnique({ where: { key: PROPERTY_DEVICE_SETTINGS_KEY } }))?.value;
    savedCredentials = (await m.client.appSetting.findUnique({ where: { key: "integrationCredentials" } }))?.value;
    await m.client.appSetting.deleteMany({ where: { key: { in: [PROPERTY_DEVICE_SETTINGS_KEY, "integrationCredentials"] } } });
    await m.client.deviceProviderConnection.deleteMany({});
    await m.client.deviceProviderLocation.deleteMany({});
    await m.client.user.createMany({
      data: [
        { id: id("admin"), email: `${id("admin")}@test.local`, role: "ADMIN", name: "Ada Admin" },
        { id: id("cleaner"), email: `${id("cleaner")}@test.local`, role: "CLEANER", name: "Cleo Cleaner" },
      ],
    });
    await m.client.client.create({ data: { id: id("client"), name: `${tag} Client` } });
    await m.client.property.createMany({
      data: [
        { id: id("pa"), clientId: id("client"), name: `${tag} Bondi Beach House`, address: "1 Ocean St", suburb: "Bondi" },
        { id: id("pb"), clientId: id("client"), name: `${tag} Coogee`, address: "3 Beach Rd", suburb: "Coogee" },
      ],
    });
    await m.client.job.createMany({
      data: [
        { id: id("job1"), jobNumber: `${tag}-J1`, propertyId: id("pa"), jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: dayFromNow(2), startTime: "10:00" },
        { id: id("job2"), jobNumber: `${tag}-J2`, propertyId: id("pa"), jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: dayFromNow(6), startTime: "10:00" },
        { id: id("past"), jobNumber: `${tag}-J0`, propertyId: id("pa"), jobType: "AIRBNB_TURNOVER", status: "CANCELLED", scheduledDate: dayFromNow(1), startTime: "09:00" },
      ],
    });
    await m.client.jobAssignment.createMany({ data: [{ jobId: id("job1"), userId: id("cleaner"), isPrimary: true }, { jobId: id("job2"), userId: id("cleaner"), isPrimary: true }] });
  }, 60_000);

  afterAll(async () => {
    if (!m.client) return;
    const jobIds = ["job1", "job2", "job3", "past", "jobb"].map(id);
    await m.client.jobTask.deleteMany({ where: { propertyId: { in: [id("pa"), id("pb")] } } });
    await m.client.propertyDevice.deleteMany({ where: { propertyId: { in: [id("pa"), id("pb")] } } });
    await m.client.deviceProviderLocation.deleteMany({});
    await m.client.deviceProviderConnection.deleteMany({});
    await m.client.deviceSyncRun.deleteMany({});
    await m.client.auditLog.deleteMany({ where: { OR: [{ jobId: { in: jobIds } }, { userId: { in: [id("admin"), id("cleaner")] } }] } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: { in: jobIds } } });
    await m.client.job.deleteMany({ where: { id: { in: jobIds } } });
    await m.client.property.deleteMany({ where: { id: { in: [id("pa"), id("pb")] } } });
    await m.client.user.deleteMany({ where: { id: { in: [id("admin"), id("cleaner")] } } });
    await m.client.client.deleteMany({ where: { id: id("client") } });
    await m.client.appSetting.deleteMany({ where: { key: { startsWith: "notificationDispatch:" }, value: { path: ["event"], string_starts_with: "device-charge:" } } });
    for (const [key, value] of [[PROPERTY_DEVICE_SETTINGS_KEY, savedSettings], ["integrationCredentials", savedCredentials]] as const) {
      if (value !== undefined) await m.client.appSetting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
      else await m.client.appSetting.deleteMany({ where: { key } });
    }
    await m.client.$disconnect();
  });

  beforeEach(() => {
    m.officeSends.length = 0;
  });

  it("manual-only mode: an 18% reading puts ONE high-priority, photo-required task on the next clean, and tells its cleaner", async () => {
    const front = await device("front", id("pa"), { locationNote: "Above the front door" });
    const requestId = `manual-reading-${front.id}-r1`;
    const first = await recordReading({ deviceId: front.id, percent: 18, source: "MANUAL", readAt: new Date(), recordedById: id("admin"), readingId: requestId }, { settings, timeZone: TZ });
    expect(first.outcome.decision.action).toBe("RAISE");
    // A retry of the same entry records nothing new and raises nothing new.
    const retry = await recordReading({ deviceId: front.id, percent: 18, source: "MANUAL", readAt: new Date(), recordedById: id("admin"), readingId: requestId }, { settings, timeZone: TZ });
    expect(retry.created).toBe(false);
    await recordReading({ deviceId: front.id, percent: 17, source: "MANUAL", readAt: new Date(), recordedById: id("admin") }, { settings, timeZone: TZ });
    const tasks = await openChargeTasks(front.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ jobId: id("job1"), title: "Charge the camera: front (18%)", requiresPhoto: true, visibleToCleaner: true, source: "ADMIN", approvalStatus: "APPROVED" });
    expect(tasks[0].metadata).toMatchObject({ kind: "DEVICE_CHARGE", priority: "HIGH", allowNotApplicable: false, strictPhoto: true, deviceId: front.id });
    expect(tasks[0].description).toContain("Above the front door");
    expect(await m.client.propertyDeviceReading.count({ where: { deviceId: front.id } })).toBe(2);
    const sends = m.officeSends.filter((send) => send.typeKey === "property.device_charge_task");
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ transports: ["INBOX"], scopeType: "JOB_ASSIGNED_CLEANER", jobId: id("job1") });
  });

  it("exactly one task under concurrent evaluations", async () => {
    const back = await device("back", id("pa"), { lastBatteryPercent: 10, lastReadingAt: new Date(), lastReadingSource: "PROVIDER" });
    await Promise.all(Array.from({ length: 6 }, () => evaluateDevice(back.id, { settings, timeZone: TZ })));
    expect(await openChargeTasks(back.id)).toHaveLength(1);
    expect((await m.client.propertyDevice.findUniqueOrThrow({ where: { id: back.id } })).raiseCount).toBe(1);
  });

  it("threshold boundary on the live path: 26% does not raise at 25%; the device override wins", async () => {
    const at26 = await device("at26", id("pa"));
    await recordReading({ deviceId: at26.id, percent: 26, source: "MANUAL", readAt: new Date(), recordedById: id("admin") }, { settings, timeZone: TZ });
    expect(await openChargeTasks(at26.id)).toHaveLength(0);
    const override = await device("override", id("pa"), { thresholdPercent: 30 });
    await recordReading({ deviceId: override.id, percent: 26, source: "MANUAL", readAt: new Date(), recordedById: id("admin") }, { settings, timeZone: TZ });
    expect(await openChargeTasks(override.id)).toHaveLength(1);
  });

  it("stale, unknown and wired devices never raise", async () => {
    const stale = await device("stale", id("pa"));
    await recordReading({ deviceId: stale.id, percent: 5, source: "PROVIDER", readAt: hoursAgo(49), recordedById: null }, { settings, timeZone: TZ });
    const unknown = await device("unknown", id("pa"));
    await evaluateDevice(unknown.id, { settings, timeZone: TZ });
    const wired = await device("wired", id("pa"), { batteryPowered: false });
    await recordReading({ deviceId: wired.id, percent: 3, source: "MANUAL", readAt: new Date(), recordedById: id("admin") }, { settings, timeZone: TZ });
    for (const row of [stale, unknown, wired]) expect(await openChargeTasks(row.id)).toHaveLength(0);
    const list = await listPropertyDevices(id("pa"));
    expect(list.devices.find((row) => row.id === stale.id)?.status).toBe("STALE");
    expect(list.devices.find((row) => row.id === unknown.id)).toMatchObject({ status: "UNKNOWN", lastBatteryPercent: null });
    expect(list.devices.find((row) => row.id === wired.id)?.status).toBe("WIRED");
  });

  it("no upcoming clean: the task waits, shows 'no clean scheduled', then attaches when a clean is scheduled", async () => {
    const hall = await device("hall", id("pb"), { kind: "SMOKE_ALARM" });
    await recordReading({ deviceId: hall.id, percent: 12, source: "MANUAL", readAt: new Date(), recordedById: id("admin") }, { settings, timeZone: TZ });
    const [waiting] = await openChargeTasks(hall.id);
    expect(waiting).toMatchObject({ jobId: null, visibleToCleaner: false, approvalStatus: "AUTO_APPROVED" });
    const attention = await listDeviceAttention();
    expect(attention.rows.find((row) => row.deviceId === hall.id)?.reasons).toEqual(expect.arrayContaining(["LOW", "NO_CLEAN_SCHEDULED"]));
    await m.client.job.create({ data: { id: id("jobb"), jobNumber: `${tag}-JB`, propertyId: id("pb"), jobType: "AIRBNB_TURNOVER", status: "UNASSIGNED", scheduledDate: dayFromNow(3), startTime: "11:00" } });
    // The existing attach hook (used on assignment and iCal sync) …
    await attachPendingAdminTasksToJob({ jobId: id("jobb"), propertyId: id("pb") });
    // … and the scheduled check's re-home agree; neither creates a second task.
    await m.client.$transaction((tx) => rehomeChargeTasks(tx, { propertyId: id("pb"), timeZone: TZ, now: new Date() }));
    const after = await openChargeTasks(hall.id);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: waiting.id, jobId: id("jobb"), visibleToCleaner: true });
  });

  it("a cancelled clean: the charge task follows to the next clean", async () => {
    const lounge = await device("lounge", id("pa"));
    await recordReading({ deviceId: lounge.id, percent: 9, source: "MANUAL", readAt: new Date(), recordedById: id("admin") }, { settings, timeZone: TZ });
    const [task] = await openChargeTasks(lounge.id);
    expect(task.jobId).toBe(id("job1"));
    await cancelJob(id("job1"), { reason: "Booking cancelled" }, { id: id("admin"), isAdmin: true });
    const moved = await m.client.jobTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(moved).toMatchObject({ jobId: id("job2"), executionStatus: "OPEN", visibleToCleaner: true });
    expect(await m.client.jobTaskEvent.count({ where: { taskId: task.id, action: "DEVICE_CHARGE_TASK_MOVED" } })).toBe(1);
  });

  it("the cleaner: done needs a photo; could-not-do needs a reason and carries the task (with its device) to the next clean", async () => {
    const porch = await device("porch", id("pa"));
    await recordReading({ deviceId: porch.id, percent: 15, source: "MANUAL", readAt: new Date(), recordedById: id("admin") }, { settings, timeZone: TZ });
    const [task] = await openChargeTasks(porch.id);
    expect(task.jobId).toBe(id("job2"));
    const base = { jobId: id("job2"), propertyId: id("pa"), clientId: id("client"), cleanerId: id("cleaner") };
    await expect(applyCleanerJobTaskUpdates({ ...base, taskUpdates: [{ id: task.id, decision: "COMPLETED", missingPhotoReason: "Phone flat" }] })).rejects.toThrow(/photo/i);
    await expect(applyCleanerJobTaskUpdates({ ...base, taskUpdates: [{ id: task.id, decision: "NOT_COMPLETED" }] })).rejects.toThrow(/why/i);
    expect((await m.client.jobTask.findUniqueOrThrow({ where: { id: task.id } })).executionStatus).toBe("OPEN");

    // Make a later clean exist so the carried task has somewhere to go.
    await m.client.job.create({ data: { id: id("job3"), jobNumber: `${tag}-J3`, propertyId: id("pa"), jobType: "AIRBNB_TURNOVER", status: "ASSIGNED", scheduledDate: dayFromNow(9), startTime: "10:00" } });
    await applyCleanerJobTaskUpdates({ ...base, taskUpdates: [{ id: task.id, decision: "NOT_COMPLETED", note: "No charger or cable on site" }] });
    const carried = await m.client.jobTask.findFirstOrThrow({ where: { parentTaskId: task.id } });
    expect(carried).toMatchObject({ source: "CARRY_FORWARD", jobId: id("job3"), executionStatus: "OPEN", requiresPhoto: true });
    expect(carried.metadata).toMatchObject({ kind: "DEVICE_CHARGE", deviceId: porch.id, priority: "HIGH", allowNotApplicable: false, strictPhoto: true });
    const afterNotDone = await m.client.propertyDevice.findUniqueOrThrow({ where: { id: porch.id } });
    expect(afterNotDone).toMatchObject({ chargeCondition: "NEEDS_CHARGE", chargeTaskId: carried.id, lastCouldNotChargeNote: "No charger or cable on site" });

    // Done with a photo, battery seen 90%: charged, awaiting a new reading (a cleaner's reading does not close it).
    await applyCleanerJobTaskUpdates({ jobId: id("job3"), propertyId: id("pa"), clientId: id("client"), cleanerId: id("cleaner"), taskUpdates: [{ id: carried.id, decision: "COMPLETED", proofKeys: ["jobs/porch-charging.jpg"], observedBatteryPercent: 90 }] });
    const charged = await m.client.propertyDevice.findUniqueOrThrow({ where: { id: porch.id } });
    expect(charged).toMatchObject({ chargeCondition: "CHARGED_AWAITING_CONFIRMATION", chargeTaskId: null, chargedTaskId: carried.id, lastBatteryPercent: 90, lastReadingSource: "CLEANER" });
    expect(await m.client.jobTaskAttachment.count({ where: { taskId: carried.id, kind: "COMPLETION_PROOF" } })).toBe(1);
    await evaluateDevice(porch.id, { settings, timeZone: TZ });
    expect((await m.client.propertyDevice.findUniqueOrThrow({ where: { id: porch.id } })).chargeCondition).toBe("CHARGED_AWAITING_CONFIRMATION");

    // Cool-down: a still-low provider reading soon after does not raise again …
    await recordReading({ deviceId: porch.id, percent: 20, source: "PROVIDER", readAt: new Date(), recordedById: null }, { settings, timeZone: TZ });
    expect(await openChargeTasks(porch.id)).toHaveLength(0);
    // … but once the cool-down has passed it does.
    const later = new Date(Date.now() + 73 * 3_600_000);
    await recordReading({ deviceId: porch.id, percent: 19, source: "PROVIDER", readAt: later, recordedById: null }, { settings, timeZone: TZ, now: later });
    expect(await openChargeTasks(porch.id)).toHaveLength(1);
    // Recovery: an office reading of 80% closes it and cancels the open task.
    await recordReading({ deviceId: porch.id, percent: 80, source: "MANUAL", readAt: new Date(later.getTime() + 60_000), recordedById: id("admin") }, { settings, timeZone: TZ, now: new Date(later.getTime() + 60_000) });
    expect(await openChargeTasks(porch.id)).toHaveLength(0);
    expect((await m.client.propertyDevice.findUniqueOrThrow({ where: { id: porch.id } })).chargeCondition).toBe("NONE");
  });

  it("the office can close a charge with a note; the open task is cancelled", async () => {
    const side = await device("side", id("pa"));
    await recordReading({ deviceId: side.id, percent: 4, source: "MANUAL", readAt: new Date(), recordedById: id("admin") }, { settings, timeZone: TZ });
    await expect(closeConditionByOffice(side.id, id("admin"), "  ")).rejects.toThrow(/note/);
    await closeConditionByOffice(side.id, id("admin"), "Device replaced");
    expect(await openChargeTasks(side.id)).toHaveLength(0);
    expect(await m.client.propertyDevice.findUniqueOrThrow({ where: { id: side.id } })).toMatchObject({ chargeCondition: "NONE", conditionClosedNote: "Device replaced" });
  });

  it("Minut with no client id or secret is honestly not connected, and a sync is skipped", async () => {
    const views = await connectionViews(settings);
    const minut = views.find((view) => view.provider === "MINUT")!;
    expect(minut).toMatchObject({ status: "NOT_CONNECTED", missing: ["Minut API client id", "Minut API client secret"] });
    expect(await runProviderSync("MINUT", { mode: "MANUAL", settings })).toMatchObject({ status: "SKIPPED" });
  });

  describe("Ring sync", () => {
    const calls: string[] = [];
    let ringDown = false;
    let rotation = 0;
    const fakeFetch: ProviderFetchDeps = {
      timeoutMs: 1000,
      sleep: async () => undefined,
      checkUrl: async () => undefined,
      fetch: (async (input: RequestInfo | URL) => {
        const href = String(input);
        calls.push(href);
        if (ringDown) return new Response(null, { status: 503 });
        if (href.endsWith("/oauth/token")) {
          rotation += 1;
          return Response.json({ access_token: `ACCESS-${rotation}`, refresh_token: `REFRESH-ROTATED-${rotation}` });
        }
        if (href.endsWith("/session")) return Response.json({});
        if (href.endsWith("/locations")) return Response.json({ user_locations: [{ location_id: `${tag}-loc`, name: `${tag} Bondi Beach House`, address: { address1: "1 Ocean St", city: "Bondi" } }, { location_id: `${tag}-other`, name: "Somewhere else" }] });
        return Response.json({ doorbots: [{ id: `${tag}-101`, description: "Ring front door", location_id: `${tag}-loc`, battery_life: "21", alerts: { connection: "online" } }], authorized_doorbots: [], stickup_cams: [{ id: `${tag}-202`, description: "Elsewhere cam", location_id: `${tag}-other`, battery_life: 5, alerts: { connection: "online" } }] });
      }) as typeof fetch,
    };
    const notices: Array<Record<string, unknown>> = [];
    const deps = { fetch: fakeFetch, now: () => new Date(), notifyFailure: async (input: Record<string, unknown>) => { notices.push(input); } };

    it("stores the rotated refresh token encrypted, links only confirmed locations, and writes no token anywhere", async () => {
      await m.client.deviceProviderConnection.create({ data: { provider: "RING", status: "CONNECTED", refreshToken: encryptSecret("REFRESH-ORIGINAL"), hardwareId: "hw-test", accountLabel: "s•••@example.test" } });
      // First sync: locations are learnt, none linked, so no device is added.
      const first = await runProviderSync("RING", { mode: "MANUAL", settings, deps });
      expect(first.status).toBe("SUCCESS");
      expect(await m.client.propertyDevice.count({ where: { provider: "RING" } })).toBe(0);
      const location = await m.client.deviceProviderLocation.findFirstOrThrow({ where: { externalLocationId: `${tag}-loc` } });
      expect(location.propertyId).toBeNull();
      await m.client.deviceProviderLocation.update({ where: { id: location.id }, data: { propertyId: id("pa"), confirmedAt: new Date(), confirmedById: id("admin") } });

      const second = await runProviderSync("RING", { mode: "MANUAL", settings, deps });
      expect(second).toMatchObject({ status: "SUCCESS", summary: { devicesSeen: 1, devicesAdded: 1, readingsRecorded: 1, tasksRaised: 1 } });
      const ringDevice = await m.client.propertyDevice.findFirstOrThrow({ where: { provider: "RING", externalDeviceId: `${tag}-101` } });
      expect(ringDevice).toMatchObject({ propertyId: id("pa"), lastBatteryPercent: 21, lastReadingSource: "PROVIDER", online: true, kind: "DOORBELL" });
      expect(await openChargeTasks(ringDevice.id)).toHaveLength(1);
      expect((await openChargeTasks(ringDevice.id))[0].title).toBe("Charge the Ring doorbell: Ring front door (21%)");

      const stored = await m.client.deviceProviderConnection.findUniqueOrThrow({ where: { provider: "RING" } });
      expect(stored.refreshToken?.startsWith("enc:v1:")).toBe(true);
      expect(decryptSecret(stored.refreshToken)).toBe(`REFRESH-ROTATED-${rotation}`);
      expect(stored.tokenVersion).toBe(2);
      expect((await readRingSecret())?.refreshToken).toBe(`REFRESH-ROTATED-${rotation}`);
      for (const href of calls) expect(["https://oauth.ring.com/oauth/token", "https://api.ring.com/clients_api/session", "https://api.ring.com/devices/v1/locations", "https://api.ring.com/clients_api/ring_devices"]).toContain(href);

      const runs = JSON.stringify(await m.client.deviceSyncRun.findMany({ where: { provider: "RING" } }));
      const audits = JSON.stringify(await m.client.auditLog.findMany({ where: { entity: "DeviceProviderConnection" } }));
      const views = JSON.stringify(await connectionViews(settings));
      for (const text of [runs, audits, views]) {
        expect(text).not.toMatch(/REFRESH-|ACCESS-|enc:v1:/);
      }
    });

    it("repeated failures tell the office once, keep the last good time, and readings go out of date", async () => {
      ringDown = true;
      const failures = [];
      for (let attempt = 0; attempt < 5; attempt += 1) failures.push(await runProviderSync("RING", { mode: "MANUAL", settings, deps }));
      expect(failures.every((result) => result.status === "ERROR")).toBe(true);
      expect(notices).toHaveLength(1);
      expect(String(notices[0].reason)).toMatch(/503/);
      const connection = await m.client.deviceProviderConnection.findUniqueOrThrow({ where: { provider: "RING" } });
      expect(connection).toMatchObject({ status: "CONNECTED", consecutiveFailures: 5 });
      expect(connection.lastSuccessAt).not.toBeNull();
      expect(connection.failureNoticeAt).not.toBeNull();
      const views = await connectionViews(settings);
      expect(views.find((view) => view.provider === "RING")).toMatchObject({ failing: true });
      const attention = await listDeviceAttention();
      expect(attention.brokenProviders).toContain("RING");
      // Two days later the last Ring reading is out of date, and still not cleared.
      const ringDevice = await m.client.propertyDevice.findFirstOrThrow({ where: { provider: "RING" } });
      await m.client.propertyDevice.update({ where: { id: ringDevice.id }, data: { lastReadingAt: hoursAgo(50), lastBatteryPercent: 90 } });
      const list = await listPropertyDevices(id("pa"));
      expect(list.devices.find((row) => row.id === ringDevice.id)?.status).toBe("STALE");
      await evaluateDevice(ringDevice.id, { settings, timeZone: TZ });
      expect((await m.client.propertyDevice.findUniqueOrThrow({ where: { id: ringDevice.id } })).chargeCondition).toBe("NEEDS_CHARGE");
      // A successful sync starts a new outage window.
      ringDown = false;
      expect((await runProviderSync("RING", { mode: "MANUAL", settings, deps })).status).toBe("SUCCESS");
      expect((await m.client.deviceProviderConnection.findUniqueOrThrow({ where: { provider: "RING" } })).failureNoticeAt).toBeNull();
    });

    it("a refused sign-in needs reconnecting, forgets the token and tells the office at once", async () => {
      notices.length = 0;
      const refusing: ProviderFetchDeps = { ...fakeFetch, fetch: (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 401 })) as typeof fetch };
      const result = await runProviderSync("RING", { mode: "MANUAL", settings, deps: { ...deps, fetch: refusing } });
      expect(result).toMatchObject({ status: "ERROR" });
      const connection = await m.client.deviceProviderConnection.findUniqueOrThrow({ where: { provider: "RING" } });
      expect(connection).toMatchObject({ status: "NEEDS_RECONNECT", refreshToken: null });
      expect(notices).toHaveLength(1);
      expect(await runProviderSync("RING", { mode: "MANUAL", settings, deps })).toMatchObject({ status: "SKIPPED" });
    });
  });
});
