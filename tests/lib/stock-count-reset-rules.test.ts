// @vitest-environment node
/**
 * Owner decision 2026-11-12, pure rules: the reverse / keep choice for stock
 * counts applied before a job reset, the 409 wording, and the dialog helpers.
 */
import { describe, expect, it } from "vitest";
import {
  parseAppliedCountChoice,
  reversalDisposition,
  stockCountChoiceMessage,
  stockCountChoiceRequiredBody,
  type AppliedStockCount,
} from "@/lib/inventory/stock-count-reset";
import { appliedCountsFromRefusal, formatCountQuantity, summarizeCountResolution } from "@/lib/inventory/stock-count-reset-format";
import { urgentStockActor } from "@/lib/inventory/urgent-stock-actor";

const soap: AppliedStockCount = { observationId: "o1", itemId: "soap", itemName: "Soap", label: "Soap left", unit: "bottle", count: 3, previousOnHand: 10, onHandNow: 3, appliedAt: null };
const towels: AppliedStockCount = { observationId: "o2", itemId: "towel", itemName: "Towels", label: "Towels left", unit: null, count: 5, previousOnHand: null, onHandNow: null, appliedAt: null };

describe("reversal disposition", () => {
  it("reverses only when nothing newer happened and the replaced value is known", () => {
    expect(reversalDisposition({ countedValue: 3, onHandNow: 3, previousOnHand: 10, newerMovementAt: null })).toBe("REVERSE");
    expect(reversalDisposition({ countedValue: 3, onHandNow: 3, previousOnHand: 10, newerMovementAt: new Date() })).toBe("NEWER_RECORD");
    // On-hand changed without a ledger row is still a newer record.
    expect(reversalDisposition({ countedValue: 3, onHandNow: 4, previousOnHand: 10, newerMovementAt: null })).toBe("NEWER_RECORD");
    // An unknown prior value is never taken as zero.
    expect(reversalDisposition({ countedValue: 3, onHandNow: 3, previousOnHand: null, newerMovementAt: null })).toBe("NO_PRIOR_VALUE");
  });
});

describe("the explicit choice", () => {
  it("accepts only REVERSE or KEEP; nothing is a default", () => {
    expect(parseAppliedCountChoice("REVERSE")).toBe("REVERSE");
    expect(parseAppliedCountChoice("KEEP")).toBe("KEEP");
    for (const value of [undefined, null, "", "reverse", true, "SKIP"]) expect(parseAppliedCountChoice(value)).toBeNull();
  });
  it("names every applied count in the 409 and keeps unknowns unknown", () => {
    expect(stockCountChoiceMessage([soap, towels])).toBe('Stock counts from this job were already applied to on-hand stock: Soap (counted 3 bottle, on hand now 3 bottle); Towels (counted 5, on hand now unknown). Choose "Reverse these counts" or "Keep them" before resetting.');
    const body = stockCountChoiceRequiredBody([soap]);
    expect(body).toMatchObject({ code: "STOCK_COUNT_CHOICE_REQUIRED", appliedStockCounts: [soap] });
    expect(appliedCountsFromRefusal(body)).toEqual([soap]);
    expect(appliedCountsFromRefusal({ code: "JOB_RESET_BLOCKED", error: "x" })).toBeNull();
    expect(formatCountQuantity(null, "roll")).toBe("unknown");
  });
  it("summarises what the reset did, naming items that were not reversed", () => {
    expect(summarizeCountResolution({ choice: "REVERSE", outcomes: [] })).toBeNull();
    expect(summarizeCountResolution({ choice: "REVERSE", outcomes: [
      { observationId: "o1", itemId: "soap", itemName: "Soap", outcome: "REVERSED", onHandBefore: 3, onHandAfter: 10, detail: "" },
      { observationId: "o2", itemId: "towel", itemName: "Towels", outcome: "NOT_REVERSED_NEWER_RECORD", onHandBefore: 9, onHandAfter: 9, detail: "" },
    ] })).toBe("1 stock count reversed; not reversed (newer record): Towels");
  });
});

describe("urgent stock acting account", () => {
  it("passes the session user unchanged, and names the administrator while impersonating", () => {
    const user = { id: "ops", role: "OPS_MANAGER" as const };
    expect(urgentStockActor({ user })).toBe(user);
    expect(urgentStockActor({ user, impersonation: { actorId: "admin" } })).toEqual({ id: "ops", role: "OPS_MANAGER", impersonatedBy: "admin" });
  });
});
