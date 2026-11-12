/**
 * Laundry owner decisions (2026-11-13), pure rules:
 *  1. partner weight / price before drop-off and drop-off photos (optional
 *     fields, status gates, partner rule, "Entered by" attribution);
 *  2. "Yes, <time>" sets the planned time only when valid and the leg is open;
 *  3. READY_TO_RETURN behaves like PICKED_UP in every "at the laundry" rule,
 *     and every other status keeps its old result;
 *  4. partner schedule defaults prefill a TIME only, never a date.
 */
import { LaundryStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AT_LAUNDRY_STATUSES, isAtLaundryStatus, isReadyToReturnStatus } from "@/lib/laundry/status-groups";
import { classifyLane, detectExceptions, hasDropPhoto, type PipelineTaskInput } from "@/lib/laundry/pipeline";
import { stageCounts, trackingDayOf, trackingStage } from "@/lib/laundry/tracking-stages";
import { laundryTeamRequestKinds } from "@/lib/laundry/nudge-rules";
import { supplierChaseBlockedReason } from "@/lib/laundry/supplier-chase-rules";
import { planReschedule } from "@/lib/laundry/reschedule-dates";
import { selectStaleDriverTasks } from "@/lib/laundry/reminders";
import { laundryStatusLabel } from "@/lib/laundry/invoice";
import { LAUNDRY_STATUS_TONES } from "@/lib/jobs/status-presentation";
import { LAUNDRY_STATUS_OPTIONS, statusLabel, statusTone } from "@/components/v2/admin/laundry/laundry-shared";
import { STATUS_LABEL, STATUS_TONE } from "@/components/v2/laundry/laundry-board";
import { STUCK_STATUSES } from "@/lib/accountability/laundry-stats";
import { describeLaundryConfirmation, getLaundryConfirmationLabel } from "@/lib/laundry/media";
import {
  canAddDropoffPhoto,
  canAddWeightPrice,
  canMarkReadyToReturn,
  dropoffPhotoAddSchema,
  partnerCostEntry,
  partnerMayWriteRun,
  partnerWeightPriceSchema,
  readyToReturnSchema,
} from "@/lib/laundry/partner-entry-rules";
import { plannedTimeFromAnswer } from "@/lib/laundry/team-request-reply-rules";
import {
  defaultLegTime,
  describeLeg,
  describeWeekdays,
  noServiceDays,
  outsideStatedDays,
  partnerScheduleInput,
  prefillPlannedTimes,
  scheduleStated,
  type PartnerSchedule,
} from "@/lib/laundry/partner-schedule";
import { parseOptionalPositive } from "@/components/v2/laundry/portal/partner-run-entries";

const VERSION = "2026-11-13T01:00:00.000Z";
const ALL = Object.values(LaundryStatus) as string[];

describe("status groups", () => {
  it("the enum carries READY_TO_RETURN and the at-laundry group is exactly picked up + ready", () => {
    expect(ALL).toContain("READY_TO_RETURN");
    expect([...AT_LAUNDRY_STATUSES]).toEqual(["PICKED_UP", "READY_TO_RETURN"]);
    expect(ALL.filter(isAtLaundryStatus)).toEqual(["PICKED_UP", "READY_TO_RETURN"]);
    expect(ALL.filter(isReadyToReturnStatus)).toEqual(["READY_TO_RETURN"]);
  });

  it("every status label / tone map names the new stage and keeps the old ones", () => {
    for (const status of ALL) {
      expect(laundryStatusLabel(status)).not.toBe(status);
      expect(STATUS_LABEL[status as keyof typeof STATUS_LABEL]).toBeTruthy();
      expect(STATUS_TONE[status as keyof typeof STATUS_TONE]).toBeTruthy();
      expect(LAUNDRY_STATUS_TONES[status]).toBeTruthy();
    }
    expect(laundryStatusLabel("READY_TO_RETURN")).toBe("Ready to return");
    expect(statusLabel("READY_TO_RETURN")).toBe("Ready to return");
    expect(STATUS_LABEL.READY_TO_RETURN).toBe("Ready to return");
    expect(statusTone("READY_TO_RETURN")).toBe("info");
    // Unchanged labels.
    expect([statusLabel("PICKED_UP"), statusLabel("DROPPED"), STATUS_LABEL.DROPPED, laundryStatusLabel("DROPPED")]).toEqual(["Picked up", "Delivered", "Returned", "Dropped off"]);
    expect(LAUNDRY_STATUS_OPTIONS).toContain("READY_TO_RETURN");
    expect([...STUCK_STATUSES]).toEqual(["PENDING", "CONFIRMED", "PICKED_UP", "READY_TO_RETURN"]);
  });
});

function task(status: string, extra: Partial<PipelineTaskInput> = {}): PipelineTaskInput {
  return { status, pickupDate: "2026-11-10T00:00:00.000Z", dropoffDate: "2026-11-14T00:00:00.000Z", pickedUpAt: "2026-11-10T03:00:00.000Z", confirmations: [], ...extra };
}

describe("pipeline, tracking and exceptions: READY_TO_RETURN = PICKED_UP, others unchanged", () => {
  const today = "2026-11-12";
  it("lanes", () => {
    for (const status of ["PICKED_UP", "READY_TO_RETURN"]) {
      expect(classifyLane(task(status), today, today)).toEqual({ lane: "laundry", carriedIn: false });
      expect(classifyLane(task(status, { dropoffDate: "2026-11-12T00:00:00.000Z" }), today, today)).toEqual({ lane: "drop", carriedIn: false });
      expect(classifyLane(task(status, { dropoffDate: "2026-11-11T00:00:00.000Z" }), today, today)).toEqual({ lane: "drop", carriedIn: true });
    }
    expect(classifyLane(task("PENDING", { pickupDate: "2026-11-12T00:00:00.000Z" }), today, today)).toEqual({ lane: "pickup", carriedIn: false });
    expect(classifyLane(task("DROPPED", { droppedAt: "2026-11-12T02:00:00.000Z" }), today, today)).toEqual({ lane: "delivered", carriedIn: false });
    expect(classifyLane(task("SKIPPED_PICKUP"), today, today)).toBeNull();
  });

  it("exceptions: drop overdue and over turnaround apply to ready sets too", () => {
    const now = new Date("2026-11-16T00:00:00.000Z");
    const settings = { maxOutdoorDays: 3, requireDropoffPhoto: true };
    for (const status of ["PICKED_UP", "READY_TO_RETURN"]) {
      const codes = detectExceptions(task(status, { supplier: { avgTurnaround: 48 } }), { todayKey: "2026-11-16", now, settings }).map((item) => item.code);
      expect(codes).toEqual(["DROP_OVERDUE", "OVER_TURNAROUND"]);
    }
    expect(detectExceptions(task("CONFIRMED", { pickupDate: "2026-11-10T00:00:00.000Z" }), { todayKey: "2026-11-16", now, settings }).map((item) => item.code)).toEqual(["PICKUP_OVERDUE"]);
  });

  it("a photo added to a finished drop-off clears the missing-photo exception; a plain run still has it", () => {
    const now = new Date("2026-11-13T00:00:00.000Z");
    const settings = { maxOutdoorDays: 3, requireDropoffPhoto: true };
    const dropped = task("DROPPED", { droppedAt: "2026-11-12T02:00:00.000Z", confirmations: [{ laundryReady: true, notes: JSON.stringify({ event: "DROPPED" }), createdAt: "2026-11-12T02:00:00Z" }] });
    expect(detectExceptions(dropped, { todayKey: "2026-11-13", now, settings }).map((item) => item.code)).toEqual(["NO_DROP_PHOTO"]);
    const added = { ...dropped, confirmations: [...dropped.confirmations!, { laundryReady: true, photoUrl: "https://x/p.jpg", notes: JSON.stringify({ event: "DROPOFF_PHOTO_ADDED", dropoffPhotoKey: "laundry/dropoff/u/p.jpg" }), createdAt: "2026-11-12T05:00:00Z" }] };
    expect(hasDropPhoto(added.confirmations)).toBe(true);
    expect(detectExceptions(added, { todayKey: "2026-11-13", now, settings })).toEqual([]);
  });

  it("tracking stages and day-of", () => {
    expect(trackingStage(task("READY_TO_RETURN"), "2026-11-12")).toBe("laundry");
    expect(trackingStage(task("READY_TO_RETURN", { dropoffDate: "2026-11-12T00:00:00.000Z" }), "2026-11-12")).toBe("drop");
    expect(trackingDayOf(task("READY_TO_RETURN"), "2026-11-12")).toEqual({ day: 3, planned: 4 });
    expect(stageCounts([task("PENDING"), task("PICKED_UP"), task("READY_TO_RETURN"), task("DROPPED"), task("SKIPPED_PICKUP")], "2026-11-12")).toEqual({ pickup: 1, laundry: 2, drop: 0, done: 1 });
  });

  it("team requests and supplier chase treat a ready set as still at the laundry", () => {
    const exceptions = [{ code: "OVER_TURNAROUND" as const, label: "x" }];
    const facts = { exceptions, readiness: null, jobStatus: null, hasJob: true, hasSupplier: true, pickupDate: "2026-11-10T00:00:00Z", dropoffDate: "2026-11-12T00:00:00Z" };
    expect(laundryTeamRequestKinds({ ...facts, status: "READY_TO_RETURN" }, "2026-11-12")).toEqual(laundryTeamRequestKinds({ ...facts, status: "PICKED_UP" }, "2026-11-12"));
    expect(laundryTeamRequestKinds({ ...facts, status: "READY_TO_RETURN" }, "2026-11-12")).toEqual(["TEAM_RETURN_ETA", "TEAM_CONFIRM_DROP"]);
    expect(supplierChaseBlockedReason({ status: "READY_TO_RETURN", hasSupplier: true, exceptions })).toBeNull();
    expect(supplierChaseBlockedReason({ status: "DROPPED", hasSupplier: true, exceptions })).toBe("The run is not at the laundry.");
  });

  it("reschedule moves only the drop-off of a ready set, as for picked up", () => {
    const run = { status: "READY_TO_RETURN", pickupDate: "2026-11-10T00:00:00Z", dropoffDate: "2026-11-14T00:00:00Z", pickedUpAt: "2026-11-10T03:00:00Z" };
    expect(planReschedule(run, "2026-11-15")).toEqual({ ok: true, pickupKey: "2026-11-10", dropoffKey: "2026-11-15", movesPickup: false });
    expect(planReschedule({ ...run, status: "PICKED_UP" }, "2026-11-15")).toEqual(planReschedule(run, "2026-11-15"));
    expect(planReschedule(run, "2026-11-09")).toMatchObject({ ok: false });
  });

  it("the driver nudge counts a ready set sitting more than 24 h", () => {
    const now = new Date("2026-11-12T06:00:00Z");
    const base = { id: "a", pickupDate: "2026-11-10T00:00:00Z", dropoffDate: "2026-11-14T00:00:00Z", pickedUpAt: "2026-11-10T03:00:00Z", updatedAt: now };
    expect(selectStaleDriverTasks([{ ...base, status: "READY_TO_RETURN" }], now)).toHaveLength(1);
    expect(selectStaleDriverTasks([{ ...base, status: "DROPPED" }], now)).toHaveLength(0);
  });

  it("the run history describes the new events", () => {
    expect(describeLaundryConfirmation({ notes: JSON.stringify({ event: "READY_TO_RETURN" }) } as never)).toBe("Marked ready to return");
    expect(describeLaundryConfirmation({ notes: JSON.stringify({ event: "PARTNER_WEIGHT_PRICE", loadWeightKg: 11.2, totalPrice: 48.2 }) } as never)).toBe("Laundry team entered 11.2 kg · $48.20");
    expect(getLaundryConfirmationLabel({ notes: JSON.stringify({ event: "DROPOFF_PHOTO_ADDED" }), laundryReady: true } as never)).toBe("Drop-off photo (added later)");
  });
});

describe("partner entries: optional fields, gates, partner rule", () => {
  it("weight and price are each optional; at least one; never zero or negative", () => {
    expect(partnerWeightPriceSchema.safeParse({ weightKg: 11.2, expectedUpdatedAt: VERSION }).success).toBe(true);
    expect(partnerWeightPriceSchema.safeParse({ price: 48.2, expectedUpdatedAt: VERSION }).success).toBe(true);
    expect(partnerWeightPriceSchema.safeParse({ expectedUpdatedAt: VERSION }).success).toBe(false);
    expect(partnerWeightPriceSchema.safeParse({ price: 0, expectedUpdatedAt: VERSION }).success).toBe(false);
    expect(partnerWeightPriceSchema.safeParse({ weightKg: -1, expectedUpdatedAt: VERSION }).success).toBe(false);
    expect(partnerWeightPriceSchema.safeParse({ price: 10 }).success).toBe(false); // stale-write guard required
    expect(dropoffPhotoAddSchema.safeParse({ photoKeys: [], expectedUpdatedAt: VERSION }).success).toBe(false);
    expect(readyToReturnSchema.safeParse({ expectedUpdatedAt: VERSION }).success).toBe(true);
  });

  it("the portal form reads an empty field as not given, never as zero", () => {
    expect(parseOptionalPositive("")).toEqual({ ok: true, value: undefined });
    expect(parseOptionalPositive("  ")).toEqual({ ok: true, value: undefined });
    expect(parseOptionalPositive("0")).toEqual({ ok: false });
    expect(parseOptionalPositive("11.5")).toEqual({ ok: true, value: 11.5 });
  });

  it("status gates", () => {
    expect(ALL.filter(canAddWeightPrice)).toEqual(["PICKED_UP", "READY_TO_RETURN"]);
    expect(ALL.filter(canMarkReadyToReturn)).toEqual(["PICKED_UP"]);
    expect(ALL.filter(canAddDropoffPhoto)).toEqual(["DROPPED"]);
  });

  it("another partner's run is refused; no partner on either side falls back to visibility", () => {
    expect(partnerMayWriteRun("p1", "p1")).toBe(true);
    expect(partnerMayWriteRun("p1", "p2")).toBe(false);
    expect(partnerMayWriteRun(null, "p2")).toBe(true);
    expect(partnerMayWriteRun("p1", null)).toBe(true);
  });

  it("names the partner while the stored figure is still theirs", () => {
    const partner = { confirmedByName: "Tom", createdAt: "2026-11-12T01:00:00Z", notes: JSON.stringify({ event: "PARTNER_WEIGHT_PRICE", totalPrice: 48.2, loadWeightKg: 11.2 }) };
    expect(partnerCostEntry([partner], { dropoffCostAud: 48.2, bagWeightKg: 11.2 })).toMatchObject({ byName: "Tom", price: true, weight: true });
    // A drop that left the price empty keeps the partner's entry.
    const drop = { confirmedByName: "Mia", createdAt: "2026-11-13T01:00:00Z", notes: JSON.stringify({ event: "DROPPED", dropoffLocation: "Lobby" }) };
    expect(partnerCostEntry([partner, drop], { dropoffCostAud: 48.2, bagWeightKg: 11.2 })).toMatchObject({ byName: "Tom", price: true });
    // The office edit form resending the same price does not take it over.
    const sameOffice = { confirmedByName: "Ada", createdAt: "2026-11-13T02:00:00Z", notes: JSON.stringify({ event: "ADMIN_STATUS_CHANGE", adminEdited: true, totalPrice: 48.2 }) };
    expect(partnerCostEntry([partner, sameOffice], { dropoffCostAud: 48.2, bagWeightKg: 11.2 })?.price).toBe(true);
    // An office correction makes it the office's figure.
    const corrected = { confirmedByName: "Ada", createdAt: "2026-11-13T03:00:00Z", notes: JSON.stringify({ event: "ADMIN_STATUS_CHANGE", adminEdited: true, totalPrice: 45 }) };
    expect(partnerCostEntry([partner, corrected], { dropoffCostAud: 45, bagWeightKg: 11.2 })).toMatchObject({ price: false, weight: true });
    const edited = { confirmedByName: "Ada", createdAt: "2026-11-14T03:00:00Z", notes: JSON.stringify({ event: "EDIT_COMPLETED", changedFields: ["loadWeightKg"], after: { loadWeightKg: 10 } }) };
    expect(partnerCostEntry([partner, corrected, edited], { dropoffCostAud: 45, bagWeightKg: 10 })).toBeNull();
    // Nothing recorded = nothing claimed.
    expect(partnerCostEntry([], { dropoffCostAud: null, bagWeightKg: null })).toBeNull();
  });
});

describe("team answer sets the planned time", () => {
  it("only a valid Yes-with-time, to a time request, while that leg is open", () => {
    expect(plannedTimeFromAnswer({ kind: "TEAM_CONFIRM_PICKUP", answer: "CONFIRMED", time: "15:30", status: "CONFIRMED" })).toEqual({ field: "pickupTime", time: "15:30" });
    expect(plannedTimeFromAnswer({ kind: "TEAM_MOVE_PICKUP", answer: "CONFIRMED", time: "16:00", status: "PENDING" })).toEqual({ field: "pickupTime", time: "16:00" });
    expect(plannedTimeFromAnswer({ kind: "TEAM_MOVE_PICKUP", answer: "CONFIRMED", time: "16:00", status: "FLAGGED" })).toEqual({ field: "pickupTime", time: "16:00" });
    expect(plannedTimeFromAnswer({ kind: "TEAM_CONFIRM_DROP", answer: "CONFIRMED", time: "09:15", status: "READY_TO_RETURN" })).toEqual({ field: "dropoffTime", time: "09:15" });
    expect(plannedTimeFromAnswer({ kind: "TEAM_CONFIRM_DROP", answer: "CONFIRMED", time: "09:15", status: "PICKED_UP" })).toEqual({ field: "dropoffTime", time: "09:15" });
    // Closed legs.
    expect(plannedTimeFromAnswer({ kind: "TEAM_CONFIRM_PICKUP", answer: "CONFIRMED", time: "15:30", status: "PICKED_UP" })).toBeNull();
    expect(plannedTimeFromAnswer({ kind: "TEAM_CONFIRM_DROP", answer: "CONFIRMED", time: "09:15", status: "DROPPED" })).toBeNull();
    expect(plannedTimeFromAnswer({ kind: "TEAM_CONFIRM_PICKUP", answer: "CONFIRMED", time: "15:30", status: "SKIPPED_PICKUP" })).toBeNull();
    // No / invalid time, other answers, other kinds.
    expect(plannedTimeFromAnswer({ kind: "TEAM_CONFIRM_PICKUP", answer: "CONFIRMED", time: null, status: "CONFIRMED" })).toBeNull();
    expect(plannedTimeFromAnswer({ kind: "TEAM_CONFIRM_PICKUP", answer: "CONFIRMED", time: "25:00", status: "CONFIRMED" })).toBeNull();
    expect(plannedTimeFromAnswer({ kind: "TEAM_CONFIRM_PICKUP", answer: "CANNOT", time: "15:30", status: "CONFIRMED" })).toBeNull();
    expect(plannedTimeFromAnswer({ kind: "TEAM_RETURN_ETA", answer: "RETURN_AT", time: "15:30", status: "PICKED_UP" })).toBeNull();
    expect(plannedTimeFromAnswer({ kind: "TEAM_PHOTO", answer: "CONFIRMED", time: "15:30", status: "DROPPED" })).toBeNull();
  });
});

describe("partner schedule: descriptive defaults", () => {
  const schedule: PartnerSchedule = { pickupWeekdays: [1, 2, 3, 4, 5, 6], pickupWindowStart: "13:00", pickupWindowEnd: "16:00", dropWeekdays: [1, 2, 3, 4, 5, 6], dropWindowStart: "08:00", dropWindowEnd: "11:00" };

  it("reads as drawn", () => {
    expect(describeLeg(schedule, "pickup")).toBe("Mon to Sat, 13:00 to 16:00");
    expect(describeLeg(schedule, "drop")).toBe("Mon to Sat, 08:00 to 11:00");
    expect(noServiceDays(schedule)).toEqual([0]);
    expect(describeWeekdays([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(describeWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(describeWeekdays([])).toBeNull();
    expect(scheduleStated({ ...schedule, pickupWeekdays: [], pickupWindowStart: null, dropWeekdays: [], dropWindowStart: null })).toBe(false);
  });

  it("prefills the window start on a stated day, nothing on another day, never replaces a set time", () => {
    // 2026-11-16 is a Monday, 2026-11-15 a Sunday.
    expect(defaultLegTime(schedule, "pickup", "2026-11-16")).toBe("13:00");
    expect(defaultLegTime(schedule, "pickup", "2026-11-15")).toBeNull();
    expect(outsideStatedDays(schedule, "pickup", "2026-11-15")).toBe(true);
    expect(defaultLegTime({ ...schedule, pickupWeekdays: [] }, "pickup", "2026-11-15")).toBe("13:00");
    expect(prefillPlannedTimes(schedule, { pickupDayKey: "2026-11-16", dropDayKey: "2026-11-18" })).toEqual({ pickupTime: "13:00", dropoffTime: "08:00" });
    expect(prefillPlannedTimes(schedule, { pickupDayKey: "2026-11-16", dropDayKey: "2026-11-18", pickupTime: "10:30" })).toEqual({ pickupTime: "10:30", dropoffTime: "08:00" });
    expect(prefillPlannedTimes(schedule, { pickupDayKey: "2026-11-16", dropDayKey: "2026-11-16", keyLost: true })).toEqual({ pickupTime: null, dropoffTime: null });
    expect(prefillPlannedTimes(null, { pickupDayKey: "2026-11-16", dropDayKey: "2026-11-18" })).toEqual({ pickupTime: null, dropoffTime: null });
  });

  it("validates the editor input", () => {
    expect(partnerScheduleInput.safeParse({ ...schedule }).success).toBe(true);
    expect(partnerScheduleInput.safeParse({ ...schedule, pickupWeekdays: [7] }).success).toBe(false);
    expect(partnerScheduleInput.safeParse({ ...schedule, pickupWindowStart: "9:00" }).success).toBe(false);
    expect(partnerScheduleInput.safeParse({ ...schedule, pickupWindowEnd: "12:00" }).success).toBe(false);
    expect(partnerScheduleInput.safeParse({ ...schedule, dropWindowStart: null, dropWindowEnd: "10:00" }).success).toBe(false);
  });
});
