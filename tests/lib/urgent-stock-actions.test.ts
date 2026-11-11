// @vitest-environment node
import { describe, expect, it } from "vitest";
import { neededByState, stagesForFilter, suggestedBuy, urgentNextAction, URGENT_BULK_TARGET } from "@/lib/inventory/urgent-stock-actions";
import { URGENT_STOCK_STAGES, validateUrgentStockTransition } from "@/lib/inventory/urgent-stock-policy";
import { bulkRowRequestId, urgentBulkInput } from "@/lib/inventory/urgent-stock-bulk";
import { neededByLabel } from "@/components/v2/admin/inventory/urgent/urgent-format";
import { readUrgentView, urgentViewSearch } from "@/components/v2/admin/inventory/urgent/urgent-view";
import { urgentStockOfficeHref } from "@/lib/inventory/urgent-stock-links";

describe("one next action per stage", () => {
  it("offers exactly the next recorded stage, then waiting, then nothing", () => {
    expect(URGENT_STOCK_STAGES.map((stage) => urgentNextAction(stage).label)).toEqual(["Acknowledge", "Mark ordered", "Mark delivered", "Waiting for cleaner to confirm", "Closed", "Closed"]);
  });
  it("every offered transition passes the existing policy, wording stays truthful", () => {
    for (const stage of URGENT_STOCK_STAGES) {
      const next = urgentNextAction(stage);
      if (next.kind !== "transition") continue;
      expect(() => validateUrgentStockTransition({ from: stage, to: next.to, isAdmin: true, reason: next.reason })).not.toThrow();
      expect(next.reason).not.toMatch(/purchased|bought|delivered to/i);
    }
    expect(urgentNextAction("DELIVERED").label).toMatch(/cleaner to confirm/);
  });
  it("bulk targets are policy stages; the policy refuses out-of-order rows", () => {
    expect(URGENT_BULK_TARGET).toEqual({ acknowledge: "ACKNOWLEDGED", "mark-ordered": "ORDERED", close: "ADMIN_RESOLVED" });
    expect(() => validateUrgentStockTransition({ from: "ORDERED", to: "ACKNOWLEDGED", isAdmin: true, reason: "x" })).toThrow("in order");
    expect(() => validateUrgentStockTransition({ from: "REPORTED", to: "ADMIN_RESOLVED", isAdmin: false, reason: "x" })).toThrow("administrator");
    expect(urgentBulkInput.safeParse({ action: "acknowledge", bulkRequestId: crypto.randomUUID(), reason: " ", needs: [{ id: crypto.randomUUID(), expectedVersion: 1 }] }).success).toBe(false);
  });
  it("derives a stable UUID-shaped request id per need within one bulk request", () => {
    const bulk = crypto.randomUUID();
    const id = bulkRowRequestId(bulk, "need-1");
    expect(id).toBe(bulkRowRequestId(bulk, "need-1"));
    expect(id).not.toBe(bulkRowRequestId(bulk, "need-2"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("needed by and quantities", () => {
  const now = new Date("2026-11-11T23:00:00Z"); // Thu 12 Nov 10:00 Sydney
  it("is unknown without a clean, passed when gone, never a made-up date", () => {
    expect(neededByState("REPORTED", null, now)).toBe("unknown");
    expect(neededByState("ORDERED", new Date("2026-11-11T22:00:00Z"), now)).toBe("passed");
    expect(neededByState("PROPERTY_CONFIRMED", new Date("2026-11-20T00:00:00Z"), now)).toBe("closed");
    expect(neededByLabel(null, "unknown", "Australia/Sydney", now)).toMatchObject({ text: "–" });
    expect(neededByLabel("2026-11-11T22:00:00Z", "passed", "Australia/Sydney", now)).toMatchObject({ text: "Passed", tone: "bad" });
    expect(neededByLabel("2026-11-12T23:00:00Z", "upcoming", "Australia/Sydney", now)).toMatchObject({ text: "Tomorrow 10:00 clean", tone: "bad" });
    expect(neededByLabel("2026-11-19T23:00:00Z", "upcoming", "Australia/Sydney", now)).toMatchObject({ text: "Fri 20 Nov", tone: null });
  });
  it("suggests a buy only from a known count and a set par level", () => {
    expect(suggestedBuy(12, 0)).toBe(12);
    expect(suggestedBuy(12, 20)).toBe(0);
    expect(suggestedBuy(null, 0)).toBeNull();
    expect(suggestedBuy(0, 0)).toBeNull();
    expect(suggestedBuy(12, null)).toBeNull();
  });
  it("maps chips onto the existing stages", () => {
    expect(stagesForFilter("open")).toEqual(["REPORTED", "ACKNOWLEDGED", "ORDERED", "DELIVERED"]);
    expect(stagesForFilter("closed")).toEqual(["PROPERTY_CONFIRMED", "ADMIN_RESOLVED"]);
    expect(stagesForFilter("all")).toBeNull();
  });
});

describe("urgent needs links", () => {
  it("keeps old /urgent-stock?propertyId links meaningful inside Stock", () => {
    expect(urgentStockOfficeHref("p-1")).toBe("/v2/admin/inventory?tab=urgent-stock&propertyId=p-1");
    expect(urgentStockOfficeHref()).toBe("/v2/admin/inventory?tab=urgent-stock");
    expect(readUrgentView("?tab=urgent-stock&propertyId=p-1")).toMatchObject({ propertyId: "p-1", filter: "open", sort: "neededBy", dir: "asc" });
    expect(urgentViewSearch(readUrgentView("?propertyId=p-1&open=n1"))).toBe("?tab=urgent-stock&propertyId=p-1&open=n1");
  });
});
