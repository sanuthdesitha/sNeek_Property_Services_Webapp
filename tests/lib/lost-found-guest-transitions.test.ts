// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { LostFoundItem } from "@prisma/client";
import { emailFromContact, guestEditPatch, guestFieldsFromBooking, phoneFromContact } from "@/lib/lost-found/guest";
import { checkLostFoundTransition, lostFoundTransitionOptions } from "@/lib/lost-found/transitions";
import { statusChangeData } from "@/lib/lost-found/mutations";
import { LOST_FOUND_STATUSES, WORKFLOW_STATUSES, RESOLVED_STATUSES } from "@/lib/lost-found/status";

describe("guest import from the job's departing booking", () => {
  it("copies name, phone, email and links the booking as BOOKING", () => {
    expect(guestFieldsFromBooking({ id: "r1", guestName: " Priya Shah ", guestPhone: "+61 400 111 222", guestEmail: "p@example.invalid" })).toEqual({
      guestName: "Priya Shah", guestContact: "+61 400 111 222", guestEmail: "p@example.invalid", reservationId: "r1", guestSource: "BOOKING",
    });
  });
  it("invents nothing when the job has no booking, and keeps blanks unknown", () => {
    expect(guestFieldsFromBooking(null)).toBeNull();
    expect(guestFieldsFromBooking(undefined)).toBeNull();
    expect(guestFieldsFromBooking({ id: "r2", guestName: "  ", guestPhone: null, guestEmail: "" })).toEqual({ guestName: null, guestContact: null, guestEmail: null, reservationId: "r2", guestSource: "BOOKING" });
  });
  it("an office edit is MANUAL and only touches the fields sent", () => {
    expect(guestEditPatch({ guestName: "Ana" })).toEqual({ guestName: "Ana", guestSource: "MANUAL" });
    expect(guestEditPatch({ guestEmail: "  " })).toEqual({ guestEmail: null, guestSource: "MANUAL" });
    expect(guestEditPatch({})).toBeNull();
  });
  it("finds a phone or email inside free-text contact for links, or nothing", () => {
    expect(phoneFromContact("call 0400 999 888 after 5")).toBe("0400999888");
    expect(phoneFromContact("no number")).toBeNull();
    expect(emailFromContact("guest: a.b@example.invalid, thanks")).toBe("a.b@example.invalid");
  });
});

describe("lost and found transition table", () => {
  it("keeps every move the old board allowed from an open item", () => {
    for (const from of WORKFLOW_STATUSES) {
      for (const to of LOST_FOUND_STATUSES) {
        const check = checkLostFoundTransition(from, to);
        expect(check.ok, `${from} → ${to}`).toBe(true);
      }
    }
  });
  it("lets an unclaimed item be returned, donated or disposed, and any decision be archived", () => {
    for (const to of ["RETURNED", "DONATED", "DISPOSED"] as const) expect(checkLostFoundTransition("UNCLAIMED", to)).toEqual({ ok: true, kind: "direct" });
    for (const from of RESOLVED_STATUSES) expect(checkLostFoundTransition(from, "ARCHIVED")).toEqual({ ok: true, kind: "direct" });
  });
  it("reopening a closed item needs a reason; a different decision needs a reopen first", () => {
    expect(checkLostFoundTransition("DONATED", "IN_STORAGE")).toEqual({ ok: false, reason: "Give a reason to reopen a closed item." });
    expect(checkLostFoundTransition("DONATED", "IN_STORAGE", "Guest turned up")).toEqual({ ok: true, kind: "reopen" });
    expect(checkLostFoundTransition("ARCHIVED", "REPORTED", "  ")).toMatchObject({ ok: false });
    expect(checkLostFoundTransition("RETURNED", "DONATED")).toEqual({ ok: false, reason: "Reopen the item first to record a different final decision." });
    expect(lostFoundTransitionOptions("ARCHIVED").every((option) => option.kind === "reopen")).toBe(true);
  });
});

const base = {
  id: "i1", propertyId: "p", jobId: null, reportedByUserId: "c", itemName: "Watch", description: null, foundLocation: null, photos: null,
  guestName: null, guestContact: null, estimatedValue: null, resolution: null, resolvedByUserId: null, resolvedAt: null,
  createdAt: new Date("2026-11-01T00:00:00Z"), updatedAt: new Date("2026-11-01T00:00:00Z"), guestEmail: null, guestSource: null, reservationId: null, storageLocation: null,
} as unknown as LostFoundItem;
const now = new Date("2026-11-11T00:00:00Z");

describe("status change data", () => {
  it("a decision stamps who and when with the note", () => {
    const change = statusChangeData({ ...base, status: "IN_STORAGE" }, { status: "DONATED", resolution: "Vinnies" }, "office", now);
    expect(change.action).toBe("DONATED");
    expect(change.data).toMatchObject({ status: "DONATED", resolvedAt: now, resolvedByUserId: "office", resolution: "Vinnies" });
  });
  it("reopen records who and why and keeps the previous decision in the event, not erased", () => {
    const decided = { ...base, status: "DONATED", resolution: "Vinnies", resolvedAt: new Date("2026-11-05T00:00:00Z"), resolvedByUserId: "office" } as LostFoundItem;
    const change = statusChangeData(decided, { status: "IN_STORAGE", reopenReason: "Guest called back" }, "admin", now);
    expect(change.action).toBe("REOPENED");
    expect(change.note).toBe("Guest called back");
    expect(change.data).toMatchObject({ status: "IN_STORAGE", resolvedAt: null, resolvedByUserId: null, resolution: null });
    expect(change.meta.previousResolution).toEqual({ status: "DONATED", resolution: "Vinnies", resolvedAt: "2026-11-05T00:00:00.000Z", resolvedByUserId: "office" });
    expect(() => statusChangeData(decided, { status: "IN_STORAGE" }, "admin", now)).toThrow("Give a reason");
  });
  it("archiving a decided item keeps its decision (the old board silently cleared it)", () => {
    const decided = { ...base, status: "RETURNED", resolution: "Couriered", resolvedAt: new Date("2026-11-05T00:00:00Z"), resolvedByUserId: "office" } as LostFoundItem;
    const change = statusChangeData(decided, { status: "ARCHIVED" }, "admin", now);
    expect(change.data).toEqual({ status: "ARCHIVED" });
  });
});
