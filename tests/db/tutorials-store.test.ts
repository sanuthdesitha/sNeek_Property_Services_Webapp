// @vitest-environment node
/**
 * Tutorial storage on a real, disposable PostgreSQL (127.0.0.1:55439):
 * per-person rows, no downgrade of a finished tour, What's new revisions,
 * resets that touch only tour progress, and isolation between people.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  readPersonTours,
  readTourClientState,
  readTourSettings,
  readTourStats,
  recordTourProgress,
  resetPersonTours,
  saveTourSetting,
  setRoleToursOn,
  updateTourPreference,
} from "@/lib/tutorials/store";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let db: PrismaClient;
const run = randomUUID().slice(0, 8);
let jane = "";
let maria = "";

describe.skipIf(!url)("tutorial storage (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.tourSetting.deleteMany({});
    jane = (await db.user.create({ data: { email: `tour-jane-${run}@fixture.invalid`, name: "Jane Fixture", role: "CLEANER" } })).id;
    maria = (await db.user.create({ data: { email: `tour-maria-${run}@fixture.invalid`, name: "Maria Fixture", role: "CLEANER" } })).id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.tourSetting.deleteMany({});
    await db.user.deleteMany({ where: { id: { in: [jane, maria] } } });
    await db.$disconnect();
  });

  it("records one person's progress without touching another's", async () => {
    await recordTourProgress(db, jane, { tourKey: "cleaner.today", version: 1000, status: "IN_PROGRESS", seenSteps: ["clock"], missingSteps: [], currentStep: 0 });
    await recordTourProgress(db, jane, { tourKey: "cleaner.today", version: 1000, status: "IN_PROGRESS", seenSteps: ["nextJob"], missingSteps: ["offer"], currentStep: 2 });
    const state = await readTourClientState(db, { userId: jane, role: "CLEANER", impersonating: false, legacyWelcomeSeen: false });
    expect(state.progress["cleaner.today"]).toMatchObject({ status: "IN_PROGRESS", currentStep: 2, seenSteps: ["clock", "nextJob"], missingSteps: ["offer"] });
    const other = await readTourClientState(db, { userId: maria, role: "CLEANER", impersonating: false, legacyWelcomeSeen: false });
    expect(other.progress).toEqual({});
  });

  it("never downgrades a finished version when a replay is stopped part-way", async () => {
    await recordTourProgress(db, jane, { tourKey: "cleaner.today", version: 1000, status: "DONE", seenSteps: ["pay", "help"], missingSteps: [], currentStep: 4 });
    const after = await recordTourProgress(db, jane, { tourKey: "cleaner.today", version: 1000, status: "IN_PROGRESS", seenSteps: ["clock"], missingSteps: [], currentStep: 0 });
    expect(after.status).toBe("DONE");
    expect(after.completedAt).not.toBeNull();
  });

  it("refuses unknown tours and drops unknown step ids", async () => {
    await expect(recordTourProgress(db, jane, { tourKey: "nope", version: 1000, status: "DONE", seenSteps: [], missingSteps: [], currentStep: 0 })).rejects.toThrow("Unknown tour.");
    const row = await recordTourProgress(db, maria, { tourKey: "cleaner.today", version: 1000, status: "IN_PROGRESS", seenSteps: ["clock", "made-up"], missingSteps: [], currentStep: 0 });
    expect(row.seenSteps).toEqual(["clock"]);
  });

  it("caps a claimed version at the current effective version", async () => {
    const row = await recordTourProgress(db, maria, { tourKey: "cleaner.today", version: 999_999, status: "DONE", seenSteps: [], missingSteps: [], currentStep: 0 });
    expect(row.version).toBe(1000);
  });

  it("stores Show tours and Don't show again per person", async () => {
    await updateTourPreference(db, jane, { dontShowAgain: { tourKey: "cleaner.today", value: true } }, jane);
    const preference = await updateTourPreference(db, jane, { toursOn: false }, jane);
    expect(preference).toEqual({ toursOn: false, dontShowAgain: ["cleaner.today"] });
    const state = await readTourClientState(db, { userId: maria, role: "CLEANER", impersonating: false, legacyWelcomeSeen: false });
    expect(state.toursOn).toBe(true);
  });

  it("reads nothing for anyone while testing as someone else", async () => {
    const state = await readTourClientState(db, { userId: jane, role: "CLEANER", impersonating: true, legacyWelcomeSeen: true });
    expect(state.recordable).toBe(false);
    expect(state.progress).toEqual({});
  });

  it("publishes wording, raises the revision only for What's new, and switches roles", async () => {
    const wording = await saveTourSetting(db, "admin.jobs", { steps: [{ id: "row", body: "Click a job to open it." }] }, "admin");
    expect(wording.revision).toBe(0);
    const whatsNew = await saveTourSetting(db, "admin.jobs", { steps: [{ id: "row", body: "Click a job to open it.", whatsNew: true }] }, "admin");
    expect(whatsNew.revision).toBe(1);
    expect(whatsNew.overrides.steps?.[0]).toMatchObject({ id: "row", whatsNewRevision: 1 });
    await expect(saveTourSetting(db, "admin.jobs", { steps: [{ id: "not-a-step" }] }, "admin")).rejects.toThrow();
    await setRoleToursOn(db, "QA_INSPECTOR", false, "admin");
    const settings = await readTourSettings(db);
    expect(settings.roles.QA_INSPECTOR).toBe(false);
    expect(settings.roles.CLEANER).toBe(true);
  });

  it("counts finished and skipped per tour, and resets only the chosen person's tour progress", async () => {
    const stats = await readTourStats(db);
    expect(stats.find((entry) => entry.tourKey === "cleaner.today")).toMatchObject({ finished: 2, opened: 2, missingReports: 1 });
    const removed = await resetPersonTours(db, jane, "all");
    expect(removed).toBe(1);
    expect((await readPersonTours(db, jane)).progress).toEqual([]);
    expect((await readPersonTours(db, maria)).progress).toHaveLength(1);
    const preference = await db.userTourPreference.findUnique({ where: { userId: jane } });
    expect(preference?.dontShowAgain).toEqual([]);
  });
});
