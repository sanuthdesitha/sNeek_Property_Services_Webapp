// @vitest-environment node
/** Smart property reminders (item 9, slice A): lifetimes, scope, caps, room sections by stable markers. */
import { describe, expect, it } from "vitest";
import {
  BEFORE_START_CAP,
  PER_ROOM_CAP,
  describeLifetime,
  lifetimeFinished,
  planJobReminders,
  reminderApplies,
  remindersForJob,
  splitBeforeStart,
  type ReminderCandidate,
} from "@/lib/properties/reminders/model";
import { firstSectionByRoom, sectionRoomKeys } from "@/lib/properties/reminders/sections";
import { beforeStartOverflow, resolvePropertyReminders } from "@/lib/properties/property-reminders";
import { LAUNDRY_AREA_SECTION } from "@/lib/forms/laundry-area";

function candidate(id: string, extra: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    key: `office:${id}`,
    briefingId: `property-reminder-office-${id}`,
    text: `Reminder ${id}`,
    why: "From the office, for every clean at this property.",
    moment: "BEFORE_START",
    roomKey: null,
    mustConfirm: false,
    rank: 1,
    createdAt: "2026-11-01T00:00:00.000Z",
    cleanerId: null,
    lifetime: "EVERY_JOB",
    jobsCount: null,
    untilDate: null,
    claimedJobIds: [],
    ...extra,
  };
}

const context = { jobId: "job-1", userId: "cleaner-a", todayKey: "2026-11-28" };

describe("which jobs a reminder applies to", () => {
  it("every job, until someone ends it", () => {
    expect(reminderApplies(candidate("a"), context)).toBe(true);
  });

  it("one cleaner only: never another cleaner, never a viewer with no person", () => {
    const own = candidate("a", { cleanerId: "cleaner-a" });
    expect(reminderApplies(own, context)).toBe(true);
    expect(reminderApplies(own, { ...context, userId: "cleaner-b" })).toBe(false);
    expect(reminderApplies(own, { ...context, userId: null })).toBe(false);
  });

  it("next job: open until one job uses it; that job keeps it, every other job loses it", () => {
    const next = candidate("a", { lifetime: "NEXT_JOBS", jobsCount: 1 });
    expect(reminderApplies(next, context)).toBe(true);
    const used = { ...next, claimedJobIds: ["job-1"] };
    expect(reminderApplies(used, context)).toBe(true);
    expect(reminderApplies(used, { ...context, jobId: "job-2" })).toBe(false);
  });

  it("next 3 jobs counts distinct jobs", () => {
    const three = candidate("a", { lifetime: "NEXT_JOBS", jobsCount: 3, claimedJobIds: ["j1", "j2", "j2"] });
    expect(reminderApplies(three, { ...context, jobId: "j9" })).toBe(true);
    expect(reminderApplies({ ...three, claimedJobIds: ["j1", "j2", "j3"] }, { ...context, jobId: "j9" })).toBe(false);
  });

  it("until a date is inclusive and an unreadable date never applies", () => {
    expect(reminderApplies(candidate("a", { lifetime: "UNTIL_DATE", untilDate: "2026-11-28" }), context)).toBe(true);
    expect(reminderApplies(candidate("a", { lifetime: "UNTIL_DATE", untilDate: "2026-11-27" }), context)).toBe(false);
    expect(reminderApplies(candidate("a", { lifetime: "UNTIL_DATE", untilDate: null }), context)).toBe(false);
    expect(reminderApplies(candidate("a", { lifetime: "UNTIL_DATE", untilDate: "28/11/2026" }), context)).toBe(false);
  });

  it("a room reminder without a room never applies", () => {
    expect(reminderApplies(candidate("a", { moment: "ROOM", roomKey: null }), context)).toBe(false);
  });

  it("says when it ends, and when it has run its course", () => {
    expect(describeLifetime({ lifetime: "NEXT_JOBS", jobsCount: 3, untilDate: null, usedOnJobs: 1 })).toBe("Next 3 jobs: 2 left");
    expect(describeLifetime({ lifetime: "NEXT_JOBS", jobsCount: 1, untilDate: null, usedOnJobs: 1 })).toBe("Next job only: used");
    expect(lifetimeFinished({ lifetime: "UNTIL_DATE", jobsCount: null, untilDate: "2026-11-27", usedOnJobs: 0, todayKey: "2026-11-28" })).toBe(true);
    expect(lifetimeFinished({ lifetime: "EVERY_JOB", jobsCount: null, untilDate: null, usedOnJobs: 50, todayKey: "2026-11-28" })).toBe(false);
  });
});

describe("caps and order", () => {
  it("before start: must confirm first, then newest; at most five with live plants counted, the rest under More notes", () => {
    const items = remindersForJob(
      Array.from({ length: 6 }, (_, index) => candidate(`r${index}`, { createdAt: `2026-11-0${index + 1}T00:00:00.000Z`, mustConfirm: index === 0 })),
      context,
    );
    const split = splitBeforeStart(items, 1);
    expect(split.shown).toHaveLength(BEFORE_START_CAP - 1);
    expect(split.shown[0].key).toBe("office:r0");
    expect(split.shown[1].key).toBe("office:r5");
    expect(split.more.map((item) => item.key)).toEqual(["office:r2", "office:r1"]);

    const source = { features: { livePlants: true }, reminders: items };
    const briefing = resolvePropertyReminders(source);
    expect(briefing).toHaveLength(BEFORE_START_CAP);
    expect(briefing[0].id).toBe("property-reminder-live-plants");
    expect(briefing[1]).toEqual({ id: "property-reminder-office-r0", title: "Reminder r0", detail: "From the office, for every clean at this property." });
    expect(beforeStartOverflow(source).map((item) => item.key)).toEqual(["office:r2", "office:r1"]);
  });

  it("no smart reminders: the briefing is exactly as before (pilot off)", () => {
    expect(resolvePropertyReminders({ features: { livePlants: true } }).map((item) => item.id)).toEqual(["property-reminder-live-plants"]);
    expect(resolvePropertyReminders(null)).toEqual([]);
  });

  it("rooms: at most three at the top of the first matching section, the rest under More notes", () => {
    const sections = [
      { id: "s-kitchen", fields: [{ id: "k", type: "photo", evidenceCategory: "KITCHEN" }] },
      { id: "s-kitchen-2", fields: [{ id: "k2", type: "photo", evidenceCategory: "KITCHEN" }] },
    ];
    const items = remindersForJob(
      Array.from({ length: 4 }, (_, index) => candidate(`k${index}`, { moment: "ROOM", roomKey: "kitchen", createdAt: `2026-11-0${index + 1}T00:00:00.000Z` })),
      context,
    );
    const plan = planJobReminders({ items, sections });
    expect(plan.rooms).toEqual([{ sectionId: "s-kitchen", roomKey: "kitchen", items: expect.any(Array) }]);
    expect(plan.rooms[0].items).toHaveLength(PER_ROOM_CAP);
    expect(plan.more.map((item) => item.key)).toEqual(["office:k0"]);
  });

  it("never for a section the form lacks", () => {
    const items = remindersForJob([candidate("b", { moment: "ROOM", roomKey: "balcony" })], context);
    const plan = planJobReminders({ items, sections: [{ id: "s-kitchen", fields: [{ id: "k", evidenceCategory: "KITCHEN" }] }] });
    expect(plan.rooms).toEqual([]);
    expect(plan.more).toEqual([]);
  });

  it("before leaving reminders all go to Wrap up", () => {
    const items = remindersForJob([candidate("l", { moment: "BEFORE_LEAVING", mustConfirm: true })], context);
    expect(planJobReminders({ items, sections: [] }).leaving.map((item) => item.key)).toEqual(["office:l"]);
  });
});

describe("room sections are found by stable markers, never label text", () => {
  it("evidence category, repeat-by, stock questions and the built-in laundry section", () => {
    expect(Array.from(sectionRoomKeys({ id: "x", fields: [{ evidenceCategory: "KITCHEN" }, { evidenceCategory: "LIVING" }] }))).toEqual(["kitchen", "living"]);
    expect(Array.from(sectionRoomKeys({ id: "x", repeatBy: "bedrooms", fields: [] }))).toEqual(["bedroom"]);
    expect(Array.from(sectionRoomKeys({ id: "x", fields: [{ type: "inventory" }] }))).toEqual(["supplies"]);
    expect(Array.from(sectionRoomKeys({ id: LAUNDRY_AREA_SECTION, fields: [] }))).toEqual(["laundry"]);
    expect(Array.from(sectionRoomKeys({ id: "x", fields: [{ evidenceCategory: "FINAL" }] }))).toEqual(["lockup"]);
  });

  it("a section titled Kitchen without a marker is not the kitchen", () => {
    const map = firstSectionByRoom([{ id: "kitchen", title: "Kitchen", fields: [{ type: "checkbox", label: "Kitchen benches" }] } as never]);
    expect(map.has("kitchen")).toBe(false);
  });
});
