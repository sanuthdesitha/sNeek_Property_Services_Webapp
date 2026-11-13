/**
 * Laundry run Change state and Void rules (owner request 2026-11-14), and the
 * run page's status → primary action table.
 */
import { describe, expect, it } from "vitest";
import {
  emailedReportContaining,
  figureProblem,
  isBackwardsChange,
  isVoidableStatus,
  planChangeState,
  undoVoidRefusal,
  voidRefusal,
  type CorrectionTaskFacts,
} from "@/lib/laundry/run-correction-rules";
import { primaryRunAction, runOffTrack, runStageStates, type RunPrimaryFacts } from "@/lib/laundry/run-page-rules";
import { pendingFailedPickupRequest } from "@/lib/laundry/run-correction-events";

const NOW = new Date("2026-11-12T05:30:00.000Z"); // 16:30 Sydney
const HANDOFF = "2026-11-12T02:51:00.000Z"; // 13:51 Sydney

function facts(patch: Partial<CorrectionTaskFacts> = {}): CorrectionTaskFacts {
  return { status: "CONFIRMED", pickedUpAt: null, droppedAt: null, voidedAt: null, handoffAt: HANDOFF, onEmailedReport: false, ...patch };
}

describe("Change state: a later state needs the real time it happened", () => {
  it("refuses Picked up without a time (never defaulted to now)", () => {
    expect(planChangeState(facts(), { target: "PICKED_UP", reason: "Phone had no signal" }, NOW)).toMatchObject({ ok: false, code: "TIME_REQUIRED" });
  });
  it("refuses a time in the future", () => {
    expect(planChangeState(facts(), { target: "PICKED_UP", happenedAt: "2026-11-12T06:00:00.000Z", reason: "Phone had no signal" }, NOW)).toMatchObject({ ok: false, code: "TIME_IN_FUTURE" });
  });
  it("refuses a time before the cleaner's handoff", () => {
    expect(planChangeState(facts(), { target: "PICKED_UP", happenedAt: "2026-11-12T02:00:00.000Z", reason: "Phone had no signal" }, NOW)).toMatchObject({ ok: false, code: "TIME_BEFORE_HANDOFF" });
  });
  it("records the pickup at the time given", () => {
    const plan = planChangeState(facts(), { target: "PICKED_UP", happenedAt: "2026-11-12T03:41:00.000Z", reason: "Tom called at 15:05" }, NOW);
    expect(plan).toMatchObject({ ok: true, nextStatus: "PICKED_UP", backwards: false });
    if (plan.ok) expect(plan.pickedUpAt?.toISOString()).toBe("2026-11-12T03:41:00.000Z");
  });
  it("Dropped off without a recorded pickup asks for the pickup time too", () => {
    expect(planChangeState(facts(), { target: "DROPPED", happenedAt: "2026-11-12T05:00:00.000Z", reason: "Delivered, app not used" }, NOW)).toMatchObject({ ok: false, code: "TIME_REQUIRED" });
    const plan = planChangeState(facts(), { target: "DROPPED", pickedUpAt: "2026-11-12T03:00:00.000Z", happenedAt: "2026-11-12T05:00:00.000Z", reason: "Delivered, app not used" }, NOW);
    expect(plan).toMatchObject({ ok: true, nextStatus: "DROPPED" });
  });
  it("a drop-off cannot be before the pickup", () => {
    expect(planChangeState(facts({ status: "PICKED_UP", pickedUpAt: "2026-11-12T04:00:00.000Z" }), { target: "DROPPED", happenedAt: "2026-11-12T03:30:00.000Z", reason: "Delivered" }, NOW)).toMatchObject({ ok: false, code: "TIME_BEFORE_PICKUP" });
  });
  it("needs a reason, and refuses the state the run is already in", () => {
    expect(planChangeState(facts(), { target: "PICKED_UP", happenedAt: "2026-11-12T03:41:00.000Z", reason: " " }, NOW)).toMatchObject({ ok: false, code: "REASON_REQUIRED" });
    expect(planChangeState(facts({ status: "PICKED_UP", pickedUpAt: "2026-11-12T03:41:00.000Z" }), { target: "PICKED_UP", happenedAt: "2026-11-12T03:41:00.000Z", reason: "again" }, NOW)).toMatchObject({ ok: false, code: "SAME_STATE" });
  });
  it("Skipped needs a skip reason, Flagged needs a note", () => {
    expect(planChangeState(facts(), { target: "SKIPPED", reason: "No linen used" }, NOW)).toMatchObject({ ok: false, code: "SKIP_REASON_REQUIRED" });
    expect(planChangeState(facts(), { target: "SKIPPED", reason: "No linen used", skipReasonCode: "NO_LINEN_USED" }, NOW)).toMatchObject({ ok: true, nextStatus: "SKIPPED_PICKUP" });
    expect(planChangeState(facts(), { target: "FLAGGED", reason: "Check", flagNote: "" }, NOW)).toMatchObject({ ok: false, code: "FLAG_NOTE_REQUIRED" });
  });
  it("Not picked up yet is Confirmed after a cleaner handoff, Waiting for pickup without one", () => {
    const back = { target: "NOT_PICKED_UP" as const, reason: "Recorded on the wrong run", acknowledgeBackwards: true };
    expect(planChangeState(facts({ status: "PICKED_UP", pickedUpAt: "2026-11-12T03:41:00.000Z" }), back, NOW)).toMatchObject({ ok: true, nextStatus: "CONFIRMED", pickedUpAt: null });
    expect(planChangeState(facts({ status: "PICKED_UP", pickedUpAt: "2026-11-12T03:41:00.000Z", handoffAt: null }), back, NOW)).toMatchObject({ ok: true, nextStatus: "PENDING" });
  });
  it("a voided run cannot change state", () => {
    expect(planChangeState(facts({ voidedAt: NOW }), { target: "FLAGGED", reason: "x y z", flagNote: "n" }, NOW)).toMatchObject({ ok: false, code: "VOIDED" });
  });
});

describe("Change state: moving back", () => {
  const dropped = facts({ status: "DROPPED", pickedUpAt: "2026-11-11T03:00:00.000Z", droppedAt: "2026-11-12T01:00:00.000Z", handoffAt: "2026-11-11T01:00:00.000Z" });
  it("is backwards from Dropped off to Picked up, and Flagged is never backwards", () => {
    expect(isBackwardsChange(dropped, "PICKED_UP")).toBe(true);
    expect(isBackwardsChange(dropped, "FLAGGED")).toBe(false);
    expect(isBackwardsChange(facts(), "DROPPED")).toBe(false);
  });
  it("needs the warning confirmed", () => {
    expect(planChangeState(dropped, { target: "PICKED_UP", happenedAt: "2026-11-11T03:00:00.000Z", reason: "Not delivered yet" }, NOW)).toMatchObject({ ok: false, code: "BACKWARDS_NOT_ACKNOWLEDGED" });
    const plan = planChangeState(dropped, { target: "PICKED_UP", happenedAt: "2026-11-11T03:00:00.000Z", reason: "Not delivered yet", acknowledgeBackwards: true }, new Date("2026-11-12T05:30:00.000Z"));
    expect(plan).toMatchObject({ ok: true, backwards: true, droppedAt: null });
  });
  it("is refused past Dropped off when the run is on an emailed report", () => {
    expect(planChangeState({ ...dropped, onEmailedReport: true }, { target: "PICKED_UP", happenedAt: "2026-11-11T03:00:00.000Z", reason: "Not delivered yet", acknowledgeBackwards: true }, NOW)).toMatchObject({ ok: false, code: "ON_EMAILED_REPORT" });
  });
});

describe("optional figures are never turned into zero", () => {
  it("blank is fine; zero and negative are refused", () => {
    expect(figureProblem({})).toBeNull();
    expect(figureProblem({ bagCount: null, weightKg: null, price: null })).toBeNull();
    expect(figureProblem({ price: 0 })).toMatch(/above/);
    expect(figureProblem({ weightKg: -1 })).toMatch(/above 0/);
    expect(figureProblem({ bagCount: 2.5 })).toMatch(/whole/);
  });
});

describe("Void rights by state", () => {
  it("is offered on Skipped and Flagged, and on failed pickups still waiting", () => {
    expect(isVoidableStatus({ status: "SKIPPED_PICKUP", hasFailedPickup: false })).toBe(true);
    expect(isVoidableStatus({ status: "FLAGGED", hasFailedPickup: false })).toBe(true);
    expect(isVoidableStatus({ status: "CONFIRMED", hasFailedPickup: true })).toBe(true);
    expect(isVoidableStatus({ status: "PENDING", hasFailedPickup: true })).toBe(true);
    expect(isVoidableStatus({ status: "CONFIRMED", hasFailedPickup: false })).toBe(false);
    expect(isVoidableStatus({ status: "PICKED_UP", hasFailedPickup: true })).toBe(false);
    expect(isVoidableStatus({ status: "DROPPED", hasFailedPickup: false })).toBe(false);
  });
  it("refuses when already voided, not voidable, or on an emailed report (with the reason)", () => {
    expect(voidRefusal({ status: "FLAGGED", voidedAt: NOW, hasFailedPickup: false, onEmailedReport: false })).toMatchObject({ code: "ALREADY_VOIDED" });
    expect(voidRefusal({ status: "PICKED_UP", voidedAt: null, hasFailedPickup: false, onEmailedReport: false })).toMatchObject({ code: "NOT_VOIDABLE" });
    const refused = voidRefusal({ status: "SKIPPED_PICKUP", voidedAt: null, hasFailedPickup: false, onEmailedReport: true, emailedReportLabel: "emailed 1 Nov 2026" });
    expect(refused).toMatchObject({ code: "ON_EMAILED_REPORT", status: 409 });
    expect(refused?.message).toContain("emailed 1 Nov 2026");
    expect(voidRefusal({ status: "FLAGGED", voidedAt: null, hasFailedPickup: true, onEmailedReport: false })).toBeNull();
  });
  it("Undo void needs a voided run with its previous state", () => {
    expect(undoVoidRefusal({ voidedAt: null, voidPreviousStatus: "FLAGGED" })).toMatchObject({ code: "NOT_VOIDED" });
    expect(undoVoidRefusal({ voidedAt: NOW, voidPreviousStatus: null })).toMatchObject({ code: "NO_PREVIOUS_STATE" });
    expect(undoVoidRefusal({ voidedAt: NOW, voidPreviousStatus: "FLAGGED" })).toBeNull();
  });
});

describe("emailed laundry reports lock their runs", () => {
  const run = { id: "r1", propertyId: "p1", pickupDate: "2026-10-28T00:00:00.000Z", dropoffDate: "2026-10-30T00:00:00.000Z", droppedAt: null };
  it("reports that list their runs lock exactly those runs", () => {
    expect(emailedReportContaining(run, [{ createdAt: NOW, taskIds: ["r1", "r2"] }])).not.toBeNull();
    expect(emailedReportContaining(run, [{ createdAt: NOW, taskIds: ["r2"] }])).toBeNull();
    expect(emailedReportContaining(run, [{ createdAt: NOW, taskId: "r1" }])).not.toBeNull();
    expect(emailedReportContaining(run, [{ createdAt: NOW, taskId: "r9" }])).toBeNull();
  });
  it("earlier batch reports without run ids lock a run their range and property cover (the cautious answer)", () => {
    const legacy = { createdAt: NOW, startDate: "2026-10-16T00:00:00.000Z", endDate: "2026-10-31T12:59:59.999Z", propertyId: null };
    expect(emailedReportContaining(run, [legacy])).not.toBeNull();
    expect(emailedReportContaining(run, [{ ...legacy, propertyId: "p2" }])).toBeNull();
    expect(emailedReportContaining(run, [{ ...legacy, startDate: "2026-11-01T00:00:00.000Z", endDate: "2026-11-15T00:00:00.000Z" }])).toBeNull();
  });
});

describe("run page: one primary action chosen by state", () => {
  const base: RunPrimaryFacts = { status: "CONFIRMED", voided: false, pendingSkipRequest: false, exceptionCodes: [], teamRequestKinds: [], canChase: false, canUndoVoid: true, canChangeState: true };
  const table: Array<[string, Partial<RunPrimaryFacts>, string]> = [
    ["voided, admin", { voided: true, status: "SKIPPED_PICKUP" }, "UNDO_VOID"],
    ["voided, viewer may not undo", { voided: true, status: "SKIPPED_PICKUP", canUndoVoid: false }, "DOWNLOAD_REPORT"],
    ["skip request waiting", { status: "FLAGGED", pendingSkipRequest: true }, "DECIDE_SKIP_REQUEST"],
    ["waiting for pickup with a team", { status: "PENDING", teamRequestKinds: ["TEAM_CONFIRM_PICKUP"] }, "ASK_TEAM_CONFIRM_PICKUP"],
    ["waiting for pickup without a team", { status: "PENDING" }, "CHANGE_STATE"],
    ["over turnaround", { status: "PICKED_UP", exceptionCodes: ["OVER_TURNAROUND"], canChase: true, teamRequestKinds: ["TEAM_RETURN_ETA"] }, "CHASE_SUPPLIER"],
    ["at the laundry", { status: "READY_TO_RETURN", teamRequestKinds: ["TEAM_RETURN_ETA"] }, "ASK_TEAM_RETURN"],
    ["drop time", { status: "PICKED_UP", teamRequestKinds: ["TEAM_CONFIRM_DROP"] }, "ASK_TEAM_DROP_TIME"],
    ["dropped without a photo", { status: "DROPPED", exceptionCodes: ["NO_DROP_PHOTO"], teamRequestKinds: ["TEAM_PHOTO"] }, "ASK_TEAM_PHOTO"],
    ["dropped", { status: "DROPPED" }, "DOWNLOAD_REPORT"],
    ["flagged, no request", { status: "FLAGGED" }, "CHANGE_STATE"],
    ["flagged, viewer may not change", { status: "FLAGGED", canChangeState: false }, "DOWNLOAD_REPORT"],
  ];
  it.each(table)("%s", (_label, patch, expected) => {
    expect(primaryRunAction({ ...base, ...patch }).key).toBe(expected);
  });
});

describe("run page: stage bar and off-track state", () => {
  it("draws the round trip and marks failed pickups as stuck", () => {
    expect(runStageStates({ status: "PICKED_UP", pickedUpAt: "x", droppedAt: null, failedPickups: 0 })).toEqual(["done", "done", "done", "now", "todo", "todo"]);
    expect(runStageStates({ status: "DROPPED", pickedUpAt: "x", droppedAt: "y", failedPickups: 0 })).toEqual(["done", "done", "done", "done", "done", "done"]);
    expect(runStageStates({ status: "FLAGGED", pickedUpAt: null, droppedAt: null, failedPickups: 2 })).toEqual(["done", "done", "stuck", "todo", "todo", "todo"]);
  });
  it("names the off-track state, voided first", () => {
    expect(runOffTrack({ status: "SKIPPED_PICKUP", voided: true })).toBe("VOIDED");
    expect(runOffTrack({ status: "FLAGGED", voided: false })).toBe("FLAGGED");
    expect(runOffTrack({ status: "SKIPPED_PICKUP", voided: false })).toBe("SKIPPED");
    expect(runOffTrack({ status: "PICKED_UP", voided: false })).toBeNull();
  });
});

describe("a waiting skip request", () => {
  const row = (event: string, extra: Record<string, unknown> = {}) => ({ notes: JSON.stringify({ event, ...extra }) });
  it("is closed by a void and reopened by Undo void", () => {
    const request = row("FAILED_PICKUP_REQUEST", { approvalStatus: "PENDING", requestedAction: "SKIP" });
    expect(pendingFailedPickupRequest([request])).toBe(request);
    expect(pendingFailedPickupRequest([request, row("RUN_VOIDED"), row("FAILED_PICKUP_REQUEST_VOIDED")])).toBeNull();
    expect(pendingFailedPickupRequest([request, row("RUN_VOIDED"), row("FAILED_PICKUP_REQUEST_VOIDED"), row("RUN_VOID_UNDONE")])).toBe(request);
    expect(pendingFailedPickupRequest([request, row("FAILED_PICKUP_SKIP_APPROVED")])).toBeNull();
  });
});
