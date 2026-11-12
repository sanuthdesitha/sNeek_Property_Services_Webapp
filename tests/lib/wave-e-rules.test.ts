// @vitest-environment node
/**
 * Wave E pure rules: the pay-rate resolver, leave labels and blockers, cancel
 * and restore rules, required-document states, the account documents column,
 * and the "last seen" throttle (actual actor only, never an impersonated target).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PayRateBook, rowInForce } from "@/lib/accounts/pay-rate-resolve";
import { checkAppliesFrom, PayRateError } from "@/lib/accounts/pay-rate";
import { leaveInputSchema, leaveReason, leaveOnDay, unavailabilityKind } from "@/lib/accounts/leave-rules";
import { rankCleanerSuggestions } from "@/lib/jobs/cleaner-suggestions";
import { cancelRefusal, restoreRefusal } from "@/lib/jobs/cancel-rules";
import { requiredCategoriesFor, requiredDocumentStatuses, missingRequiredLabels, requiredDocumentsSchema } from "@/lib/accounts/required-documents";
import { documentState } from "@/lib/accounts/list/attention";
import { recordLastSeen, resetLastSeenThrottle, LAST_SEEN_WRITE_INTERVAL_MS } from "@/lib/auth/last-seen";

vi.mock("@/lib/db", () => ({ db: {} }));

describe("pay rate resolver", () => {
  const rows = [
    { userId: "u", hourlyRate: 30, effectiveFrom: "1970-01-01", createdAt: "2026-11-01T00:00:00Z" },
    { userId: "u", hourlyRate: 40, effectiveFrom: "2026-11-16", createdAt: "2026-11-12T00:00:00Z" },
    { userId: "u", hourlyRate: 41, effectiveFrom: "2026-11-16", createdAt: "2026-11-12T05:00:00Z" },
  ];
  const book = new PayRateBook(rows);

  it("uses the rate in force on the job's calendar day; a future rate never reaches earlier jobs", () => {
    expect(book.rateFor("u", new Date("2026-11-15T00:00:00Z"), 99)).toBe(30);
    expect(book.rateFor("u", "2026-11-16", 99)).toBe(41);
    expect(book.rateFor("u", new Date("2027-01-01T00:00:00Z"), 99)).toBe(41);
  });

  it("a later save on the same day wins without editing the first", () => {
    expect(rowInForce(rows, "2026-11-16")?.hourlyRate).toBe(41);
  });

  it("falls back to the stored rate only for someone with no history; history with nothing in force is null, never zero", () => {
    expect(book.rateFor("other", "2026-11-16", 33)).toBe(33);
    expect(book.rateFor("other", "2026-11-16", null)).toBeNull();
    const late = new PayRateBook([{ userId: "n", hourlyRate: 35, effectiveFrom: "2026-11-20", createdAt: "2026-11-12T00:00:00Z" }]);
    expect(late.rateFor("n", "2026-11-19", 50)).toBeNull();
  });

  it("Applies from is today or later, at most a year ahead", () => {
    expect(checkAppliesFrom(undefined, "2026-11-12")).toBe("2026-11-12");
    expect(checkAppliesFrom("2026-11-16", "2026-11-12")).toBe("2026-11-16");
    expect(() => checkAppliesFrom("2026-11-11", "2026-11-12")).toThrow(PayRateError);
    expect(() => checkAppliesFrom("2026-02-30", "2026-01-01")).toThrow(PayRateError);
    expect(() => checkAppliesFrom("2028-01-01", "2026-11-12")).toThrow(/a year ahead/);
  });
});

describe("leave", () => {
  it("labels the reason as drawn and spots the covering record", () => {
    expect(leaveReason({ startDate: "2026-11-12", endDate: "2026-11-14", kind: "LEAVE" })).toBe("On leave 12–14 Nov");
    expect(leaveReason({ startDate: "2026-11-30", endDate: "2026-12-02", kind: "LEAVE" })).toBe("On leave 30 Nov – 2 Dec");
    expect(leaveReason({ startDate: "2026-11-15", endDate: "2026-11-15", kind: "DAY_OFF" })).toBe("Day off 15 Nov");
    expect(leaveOnDay([{ startDate: "2026-11-12", endDate: "2026-11-14" }], "2026-11-14")).not.toBeNull();
    expect(leaveOnDay([{ startDate: "2026-11-12", endDate: "2026-11-14" }], "2026-11-15")).toBeNull();
    expect(unavailabilityKind("On leave 12–14 Nov")).toBe("leave");
    expect(unavailabilityKind("Not available on Mondays")).toBe("roster");
  });

  it("refuses a last day before the first", () => {
    expect(leaveInputSchema.safeParse({ startDate: "2026-11-14", endDate: "2026-11-12", kind: "LEAVE" }).success).toBe(false);
  });

  it("blocks a suggestion before clashes and roster, with the reason", () => {
    const [verdict] = rankCleanerSuggestions(
      { id: "j", dayKey: "2026-11-13", startTime: "10:00", endTime: null, dueTime: "12:00", estimatedHours: null },
      [{ id: "c", name: "Jane", availability: null, otherJobsThatDay: [], priorCleansHere: 9, leave: [{ startDate: "2026-11-12", endDate: "2026-11-14", kind: "LEAVE" }] }],
    );
    expect(verdict).toMatchObject({ assignable: false, blocker: { kind: "leave", reason: "On leave 12–14 Nov" } });
  });
});

describe("cancel and restore rules", () => {
  it("allows unstarted jobs for the office, started ones for ADMIN only, never invoiced or cancelled, always with a reason", () => {
    expect(cancelRefusal({ status: "ASSIGNED", actorIsAdmin: false, reason: "Owner cancelled" })).toBeNull();
    expect(cancelRefusal({ status: "UNASSIGNED", actorIsAdmin: false, reason: "" })).toMatch(/reason/);
    expect(cancelRefusal({ status: "IN_PROGRESS", actorIsAdmin: false, reason: "Guest stayed" })).toMatch(/administrator/);
    expect(cancelRefusal({ status: "IN_PROGRESS", actorIsAdmin: true, reason: "Guest stayed" })).toBeNull();
    expect(cancelRefusal({ status: "COMPLETED", actorIsAdmin: true, reason: "Duplicate job" })).toBeNull();
    expect(cancelRefusal({ status: "INVOICED", actorIsAdmin: true, reason: "Duplicate job" })).toMatch(/invoiced/);
    expect(cancelRefusal({ status: "CANCELLED", actorIsAdmin: true, reason: "Duplicate job" })).toMatch(/already/);
  });

  it("restores only to an unstarted status", () => {
    expect(restoreRefusal({ status: "CANCELLED", cancelledFromStatus: "OFFERED" })).toBeNull();
    expect(restoreRefusal({ status: "CANCELLED", cancelledFromStatus: "IN_PROGRESS" })).toMatch(/had started/);
    expect(restoreRefusal({ status: "ASSIGNED", cancelledFromStatus: "ASSIGNED" })).toMatch(/not cancelled/);
  });
});

describe("required documents", () => {
  const setting = requiredDocumentsSchema.parse({ byRole: { CLEANER: ["POLICE_CHECK", "INSURANCE"], QA_INSPECTOR: ["TRAINING"] } });

  it("is the union over every role held; nothing is required by default", () => {
    expect(requiredCategoriesFor(setting, ["CLEANER", "QA_INSPECTOR"])).toEqual(["POLICE_CHECK", "TRAINING", "INSURANCE"]);
    expect(requiredCategoriesFor({ byRole: {} }, ["CLEANER"])).toEqual([]);
  });

  it("reports present / expiring / expired / missing; rejected documents do not count", () => {
    const statuses = requiredDocumentStatuses(["POLICE_CHECK", "INSURANCE", "TRAINING", "COMPLIANCE"], [
      { category: "POLICE_CHECK", status: "VERIFIED", expiresAt: "2026-11-20T00:00:00Z" },
      { category: "INSURANCE", status: "VERIFIED", expiresAt: "2026-10-01T00:00:00Z" },
      { category: "TRAINING", status: "REJECTED", expiresAt: null },
      { category: "COMPLIANCE", status: "PENDING", expiresAt: null },
    ], "2026-11-12");
    expect(statuses.map((row) => [row.category, row.state])).toEqual([["POLICE_CHECK", "EXPIRING"], ["INSURANCE", "EXPIRED"], ["TRAINING", "MISSING"], ["COMPLIANCE", "PRESENT"]]);
    expect(missingRequiredLabels(statuses)).toEqual(["Training"]);
  });

  it("drives the Documents column: missing counts, Complete only when requirements are set", () => {
    const base = { documents: [], missingDocuments: [], credentials: { visaExpiry: null, driverLicenseExpiry: null, vehicleRegoExpiry: null } };
    const now = new Date("2026-11-12T00:00:00Z");
    expect(documentState({ ...base, missingRequired: ["Police check", "Insurance"] }, now)).toMatchObject({ kind: "MISSING", label: "2 missing" });
    expect(documentState({ ...base, requirementsSet: true }, now)).toMatchObject({ kind: "OK", label: "Complete" });
    expect(documentState(base, now)).toMatchObject({ kind: "NONE" });
  });
});

describe("last seen", () => {
  beforeEach(() => resetLastSeenThrottle());

  it("writes at most once per interval per person, and only when the stored value is older", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const client = { user: { updateMany } };
    const start = new Date("2026-11-12T00:00:00Z");
    expect(await recordLastSeen("u1", start, client)).toBe("written");
    expect(await recordLastSeen("u1", new Date(start.getTime() + 60_000), client)).toBe("throttled");
    expect(await recordLastSeen("u2", new Date(start.getTime() + 60_000), client)).toBe("written");
    expect(await recordLastSeen("u1", new Date(start.getTime() + LAST_SEEN_WRITE_INTERVAL_MS + 1), client)).toBe("written");
    expect(updateMany).toHaveBeenCalledTimes(3);
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: "u1", OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(start.getTime() - LAST_SEEN_WRITE_INTERVAL_MS) } }] },
      data: { lastSeenAt: start },
    });
  });

  it("never fails the request when the write fails", async () => {
    const client = { user: { updateMany: vi.fn().mockRejectedValue(new Error("db down")) } };
    expect(await recordLastSeen("u3", new Date(), client)).toBe("failed");
  });
});
