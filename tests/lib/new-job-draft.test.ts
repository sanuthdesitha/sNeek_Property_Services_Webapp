import { describe, expect, it } from "vitest";
import { JobType } from "@prisma/client";
import {
  NEW_JOB_TYPES,
  assignRequest,
  buildCreateBody,
  draftForAnother,
  draftFromDuplicate,
  emptyDraft,
  parsePasteLines,
  parseStoredDraft,
  propertyChangeLosesWork,
  resetForPropertyChange,
  targetDays,
  validateDraft,
  type NewJobDraft,
} from "@/lib/jobs/new-job/draft";
import { dayRequestKey, isValidIdempotencyKey } from "@/lib/jobs/new-job/request-key";
import type { NewJobDuplicateSource } from "@/lib/jobs/new-job/types";

/** The New job page's draft rules (board "New job", 2026-11). */
function draft(patch: Partial<NewJobDraft> = {}): NewJobDraft {
  return { ...emptyDraft("prop-1"), dayKey: "2026-11-20", estimatedHours: "3", ...patch };
}

describe("buildCreateBody: the previous form's request for the same inputs", () => {
  it("matches the old form's body field for field for a plain turnover", () => {
    const body = buildCreateBody(draft(), { dayKey: "2026-11-20" }, { asDraftJob: false });
    // The body the old NewJobForm sent for: property, date, 10:00–15:00, 3 h, no notes.
    expect(body).toEqual({
      propertyId: "prop-1",
      clientId: undefined,
      jobType: "AIRBNB_TURNOVER",
      scheduledDate: "2026-11-20T00:00:00.000Z",
      startTime: "10:00",
      dueTime: "15:00",
      endTime: undefined,
      estimatedHours: 3,
      notes: undefined,
      internalNotes: undefined,
      isDraft: false,
      tags: [],
      attachments: [],
      earlyCheckin: { enabled: false, preset: "none" },
      lateCheckout: { enabled: false, preset: "none" },
      reservationContext: undefined,
      serviceSite: undefined,
      serviceContext: undefined,
    });
  });

  it("sends the new per-job choices only when the office changes them", () => {
    const plain = buildCreateBody(draft(), { dayKey: "2026-11-20" }, { asDraftJob: false });
    expect(plain).not.toHaveProperty("skipPreferredCleaner");
    expect(plain).not.toHaveProperty("sendBookingConfirmation");
    const changed = buildCreateBody(draft({ cleaner: { kind: "unassigned" }, sendBookingConfirmation: false }), { dayKey: "2026-11-20" }, { asDraftJob: false });
    expect(changed).toMatchObject({ skipPreferredCleaner: true, sendBookingConfirmation: false });
  });

  it("adds special tasks, the notice, fixed price and invoice note only when used", () => {
    const body = buildCreateBody(
      draft({ specialTasks: [{ id: "t", title: " Inside oven ", requiresPhoto: true }], notice: "Lock the balcony", noticeImages: ["u1"], fixedPriceOn: true, fixedPrice: "180", invoiceNote: "Owner rate" }),
      { dayKey: "2026-11-20" },
      { asDraftJob: true },
    );
    expect(body).toMatchObject({
      isDraft: true,
      specialRequestTasks: [{ title: "Inside oven", requiresPhoto: true }],
      notices: [{ body: "Lock the balcony", urgency: "IMPORTANT", imageUrls: ["u1"] }],
      fixedPrice: 180,
      invoiceNote: "Owner rate",
    });
  });

  it("keeps today's service-site path for a one-off address", () => {
    const body = buildCreateBody(
      draft({ jobType: "GENERAL_CLEAN", siteMode: "one_off", propertyId: "", oneOff: { ...emptyDraft().oneOff, siteName: "Gym", siteAddress: "1 Main St", siteSuburb: "Bondi", clientId: "c1" } }),
      { dayKey: "2026-11-20" },
      { asDraftJob: false },
    );
    expect(body.propertyId).toBeUndefined();
    expect(body).toMatchObject({ clientId: "c1", serviceSite: { name: "Gym", address: "1 Main St", suburb: "Bondi", state: "NSW" }, earlyCheckin: undefined });
    expect(body.serviceContext).toBeDefined();
  });

  it("uses each several-dates row's own times", () => {
    const value = draft({ mode: "several", severalDays: [{ dayKey: "2026-11-26", startTime: "11:00", dueTime: "16:00" }, { dayKey: "2026-11-23", startTime: "10:00", dueTime: "14:00", endTime: "15:00" }] });
    const days = targetDays(value);
    expect(days.map((day) => day.dayKey)).toEqual(["2026-11-23", "2026-11-26"]);
    expect(buildCreateBody(value, days[0], { asDraftJob: false })).toMatchObject({ startTime: "10:00", dueTime: "14:00", endTime: "15:00" });
  });

  it("assigns only chosen cleaners, first one primary", () => {
    expect(assignRequest(draft())).toBeNull();
    expect(assignRequest(draft({ cleaner: { kind: "unassigned" } }))).toBeNull();
    expect(assignRequest(draft({ cleaner: { kind: "chosen", ids: ["a", "b"], names: ["A", "B"] } }))).toEqual({ userIds: ["a", "b"], primaryUserId: "a" });
  });
});

describe("draft scope and checks", () => {
  it("a property change clears date, cleaner, tasks and hours but keeps notes, with a new request key", () => {
    const before = draft({ cleaner: { kind: "chosen", ids: ["a"], names: ["A"] }, specialTasks: [{ id: "t", title: "Oven", requiresPhoto: false }], notice: "Toddler", internalNote: "Owner Sat", hoursEdited: true });
    expect(propertyChangeLosesWork(before)).toBe(true);
    const after = resetForPropertyChange(before, "prop-2");
    expect(after).toMatchObject({ propertyId: "prop-2", dayKey: "", cleaner: { kind: "preferred" }, specialTasks: [], notice: "Toddler", internalNote: "Owner Sat", hoursEdited: false, estimatedHours: "" });
    expect(after.requestKey).not.toBe(before.requestKey);
    expect(propertyChangeLosesWork(emptyDraft("prop-1"))).toBe(false);
  });

  it("names every problem with its step and never blocks on a blank hours box", () => {
    expect(validateDraft(draft()).length).toBe(0);
    expect(validateDraft(draft({ estimatedHours: "" }))).toEqual([]);
    const problems = validateDraft(draft({ dayKey: "", propertyId: "", startTime: "10:00", dueTime: "09:30" }));
    expect(problems.map((problem) => [problem.field, problem.step])).toEqual([["property", "property"], ["date", "when"], ["dueTime", "when"]]);
    expect(problems[2].message).toBe("Ready by 09:30 is before the start, 10:00");
  });

  it("refuses a draft job with a chosen cleaner (the assign route refuses drafts)", () => {
    const value = draft({ cleaner: { kind: "chosen", ids: ["a"], names: ["A"] } });
    expect(validateDraft(value, { asDraftJob: true }).map((problem) => problem.field)).toEqual(["cleaner"]);
    expect(validateDraft(value, { asDraftJob: false })).toEqual([]);
  });

  it("checks repeats: days, a saved property and the date order", () => {
    const problems = validateDraft(draft({ mode: "repeats", repeats: { ruleId: "r", daysOfWeek: [], startDate: "2026-12-01", endDate: "2026-11-01" } }));
    expect(problems.map((problem) => problem.field)).toEqual(["repeatDays", "repeatEnd"]);
  });

  it("reads the old typed lines unchanged", () => {
    expect(parsePasteLines("2026-11-24\n2026-11-26 9:00 15:00\nbad line\n2026-11-27 25:00")).toEqual({
      valid: [{ dayKey: "2026-11-24", startTime: undefined, dueTime: undefined, endTime: undefined }, { dayKey: "2026-11-26", startTime: "09:00", dueTime: "15:00", endTime: undefined }],
      invalid: ["bad line", "2026-11-27 25:00"],
    });
  });

  it("restores only a valid stored draft of this version", () => {
    expect(parseStoredDraft(null)).toBeNull();
    expect(parseStoredDraft("not json")).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ version: 2, requestKey: "x" }))).toBeNull();
    const stored = parseStoredDraft(JSON.stringify({ ...draft(), jobType: "NOPE", cleaner: { kind: "chosen", ids: "x" } }));
    expect(stored?.jobType).toBe("AIRBNB_TURNOVER");
    expect(stored?.cleaner).toEqual({ kind: "preferred" });
    const round = parseStoredDraft(JSON.stringify(draft({ notice: "Keep me" })));
    expect(round?.notice).toBe("Keep me");
  });

  it("duplicate copies what the board lists and nothing else", () => {
    const source: NewJobDuplicateSource = {
      jobId: "j1", jobNumber: "J-1051", propertyId: "prop-9", propertyName: "Bondi", jobType: "DEEP_CLEAN", dayKey: "2026-11-10", status: "COMPLETED",
      cleaners: ["Maria"], startTime: "09:00", dueTime: "13:00", endTime: "13:30", estimatedHours: 4, notes: "Bring ladder", internalNote: "Owner",
      tags: ["vip"], attachments: [], specialRequestTasks: [{ title: "Oven", requiresPhoto: true }], notices: [{ body: "Cot", urgency: "INFO" }],
      fixedPrice: 200, invoiceNote: "Agreed",
    };
    const copy = draftFromDuplicate(source);
    expect(copy).toMatchObject({ propertyId: "prop-9", jobType: "DEEP_CLEAN", startTime: "09:00", dueTime: "13:00", endTime: "13:30", estimatedHours: "4", notes: "Bring ladder", internalNote: "Owner", tagsText: "vip", notice: "Cot", noticeImportant: false, fixedPriceOn: true, fixedPrice: "200", invoiceNote: "Agreed", dayKey: "", cleaner: { kind: "preferred" }, duplicatedFrom: { jobId: "j1", jobNumber: "J-1051" } });
    expect(copy.earlyCheckin.preset).toBe("none");
    expect(copy.guest.guestName).toBe("");
  });

  it("another for this property keeps property, type and times and clears the date", () => {
    const next = draftForAnother(draft({ jobType: "DEEP_CLEAN", startTime: "08:00", notice: "x" }));
    expect(next).toMatchObject({ propertyId: "prop-1", jobType: "DEEP_CLEAN", startTime: "08:00", dayKey: "", notice: "" });
  });

  it("lists every job type the schema has", () => {
    expect([...NEW_JOB_TYPES].sort()).toEqual(Object.values(JobType).sort());
  });

  it("accepts only well-formed request keys; several dates append the day", () => {
    expect(isValidIdempotencyKey("272bdb5b-2665-433c-a440-e47207e81072")).toBe(true);
    expect(isValidIdempotencyKey(dayRequestKey("272bdb5b-2665-433c", "2026-11-20"))).toBe(true);
    expect(isValidIdempotencyKey("short")).toBe(false);
    expect(isValidIdempotencyKey("a b c d e f g h")).toBe(false);
  });
});
