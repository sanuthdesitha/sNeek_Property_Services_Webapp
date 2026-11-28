// @vitest-environment node
/**
 * Smart property reminders in the start briefing (item 9, slice A): pilot off
 * gives the old list; on adds office reminders decided for this job and
 * person; an edit or another job using a "next job" reminder between opening
 * the briefing and clock-in makes the shown fingerprint stale.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parsePilotState, type PilotState } from "@/lib/pilots/registry";

type Row = Record<string, unknown>;
const m = vi.hoisted(() => ({
  state: null as unknown as PilotState,
  reminders: [] as Row[],
  claims: [] as Array<{ reminderKey: string; jobId: string }>,
  acks: [] as Array<{ reminderKey: string }>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney" }) }));
vi.mock("@/lib/db", () => ({
  db: {
    qaIssue: { findMany: async () => [] },
    propertyReminder: { findMany: async () => m.reminders },
    propertyReminderClaim: { findMany: async (args: { where: { reminderKey: { in: string[] } } }) => m.claims.filter((claim) => args.where.reminderKey.in.includes(claim.reminderKey)) },
    propertyReminderAck: { findMany: async () => m.acks },
  },
}));
vi.mock("@/lib/pilots/state", async () => {
  const registry = await vi.importActual<typeof import("@/lib/pilots/registry")>("@/lib/pilots/registry");
  return {
    loadPilotState: async () => m.state,
    isPilotOn: async (key: Parameters<typeof registry.pilotApplies>[1], subject: Parameters<typeof registry.pilotApplies>[2]) => registry.pilotApplies(m.state, key, subject),
  };
});

import { reminderSource, reminderSourceByUser, unconfirmedLeavingReminders } from "@/lib/pilots/gates";
import { checkIncomingAckVersion, resolveStartBriefingItems, startBriefingHash } from "@/lib/forms/start-briefing";

const on = (extra: Record<string, unknown> = {}) => ({ mode: "ON", userIds: [], propertyIds: [], onSince: null, changedAt: null, changedById: null, ...extra });
const property = { features: { livePlants: false } };
const subject = { userId: "cleaner-a", propertyId: "property-1" };

function reminder(id: string, extra: Row = {}): Row {
  return {
    id,
    cleanerId: null,
    text: `Wipe the rangehood ${id}`,
    moment: "BEFORE_START",
    roomKey: null,
    lifetime: "EVERY_JOB",
    jobsCount: null,
    untilDate: null,
    mustConfirm: false,
    reason: null,
    createdAt: new Date("2026-11-20T00:00:00Z"),
    ...extra,
  };
}

async function briefingFor(jobId: string, userId = "cleaner-a") {
  const source = await reminderSource(property, { ...subject, userId }, jobId);
  return resolveStartBriefingItems({ meta: {}, property: source });
}

beforeEach(() => {
  m.state = parsePilotState({ "property-reminders": on() });
  m.reminders = [reminder("r1")];
  m.claims = [];
  m.acks = [];
});

describe("office reminders in the start briefing", () => {
  it("pilot off: nothing new, the briefing from before", async () => {
    m.state = parsePilotState(null);
    expect(await reminderSource(property, subject, "job-1")).toBeNull();
    expect(await briefingFor("job-1")).toEqual([]);
  });

  it("pilot on: read out as a property reminder with why it exists", async () => {
    const items = await briefingFor("job-1");
    expect(items).toEqual([
      { id: "property-reminder-office-r1", title: "Wipe the rangehood r1", detail: "From the office, for every clean at this property.", source: "PROPERTY_REMINDER" },
    ]);
  });

  it("scoped to one cleaner: only that cleaner reads it", async () => {
    m.reminders = [reminder("r1", { cleanerId: "cleaner-b" })];
    expect(await briefingFor("job-1", "cleaner-a")).toEqual([]);
    expect((await briefingFor("job-1", "cleaner-b")).map((item) => item.id)).toEqual(["property-reminder-office-r1"]);
  });

  it("an edit between opening the briefing and clock-in makes the shown version stale", async () => {
    const shown = await briefingFor("job-1");
    m.reminders = [reminder("r1", { text: "Wipe the rangehood and the filter" })];
    const now = await briefingFor("job-1");
    expect(checkIncomingAckVersion(now, startBriefingHash(shown))).toEqual({ ok: false, reason: "STALE", missingIds: ["property-reminder-office-r1"] });
  });

  it("ended (no longer listed): the item leaves the briefing and the old fingerprint is stale", async () => {
    const shown = await briefingFor("job-1");
    m.reminders = [];
    const now = await briefingFor("job-1");
    expect(now).toEqual([]);
    expect(checkIncomingAckVersion(now, startBriefingHash(shown))).toEqual({ ok: true });
  });

  it("next job only: once another job used it, this job's briefing changes; the job that used it keeps it", async () => {
    m.reminders = [reminder("r1", { lifetime: "NEXT_JOBS", jobsCount: 1 })];
    const shownOnJob2 = await briefingFor("job-2");
    expect(shownOnJob2).toHaveLength(1);
    m.claims = [{ reminderKey: "office:r1", jobId: "job-1" }];
    expect(await briefingFor("job-1")).toHaveLength(1);
    const nowOnJob2 = await briefingFor("job-2");
    expect(nowOnJob2).toEqual([]);
    expect(startBriefingHash(nowOnJob2)).not.toBe(startBriefingHash(shownOnJob2));
  });

  it("until a date: gone the day after", async () => {
    m.reminders = [reminder("r1", { lifetime: "UNTIL_DATE", untilDate: new Date("2000-01-01T00:00:00Z") })];
    expect(await briefingFor("job-1")).toEqual([]);
  });

  it("room and before-leaving reminders are not in the briefing", async () => {
    m.reminders = [reminder("room", { moment: "ROOM", roomKey: "kitchen" }), reminder("leave", { moment: "BEFORE_LEAVING" })];
    expect(await briefingFor("job-1")).toEqual([]);
    const source = await reminderSource(property, subject, "job-1");
    expect(source?.reminders?.map((item) => item.key).sort()).toEqual(["office:leave", "office:room"]);
  });

  it("a failed read is reported as unavailable, never as none, and never blocks", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = await import("@/lib/db");
    const spy = vi.spyOn(db.propertyReminder, "findMany").mockRejectedValueOnce(new Error("db down"));
    const source = await reminderSource(property, subject, "job-1");
    expect(source).toMatchObject({ remindersUnavailable: true });
    expect(resolveStartBriefingItems({ meta: {}, property: source })).toEqual([]);
    spy.mockRestore();
  });

  it("the office proof decides per cleaner from one read", async () => {
    m.reminders = [reminder("r1", { cleanerId: "cleaner-b" })];
    const sourceFor = await reminderSourceByUser(property, "property-1", "job-1");
    expect(sourceFor("cleaner-a")?.reminders).toEqual([]);
    expect(sourceFor("cleaner-b")?.reminders?.map((item) => item.key)).toEqual(["office:r1"]);
  });
});

describe("before leaving: must confirm", () => {
  it("lists must-confirm reminders not yet confirmed; none once confirmed; none with the pilot off", async () => {
    m.reminders = [reminder("leave", { moment: "BEFORE_LEAVING", mustConfirm: true }), reminder("soft", { moment: "BEFORE_LEAVING" })];
    expect((await unconfirmedLeavingReminders(property, subject, "job-1")).map((item) => item.key)).toEqual(["office:leave"]);
    m.acks = [{ reminderKey: "office:leave" }];
    expect(await unconfirmedLeavingReminders(property, subject, "job-1")).toEqual([]);
    m.acks = [];
    m.state = parsePilotState(null);
    expect(await unconfirmedLeavingReminders(property, subject, "job-1")).toEqual([]);
  });
});
