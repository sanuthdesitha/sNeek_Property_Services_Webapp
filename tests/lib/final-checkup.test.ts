import { describe, expect, it } from "vitest";
import {
  GUEST_CHECKUP_ITEM_ID,
  adminRequestCheckupItemId,
  guestSummaryFromReservation,
  resolveFinalCheckupItems,
  validateFinalCheckupAck,
} from "@/lib/forms/final-checkup";
import type { FinalCheckupSettings } from "@/lib/settings";

const baseSettings = (over?: Partial<FinalCheckupSettings>) => ({
  finalCheckup: {
    enabled: true,
    items: [
      { id: "s1", title: "Check the balcony", referenceImageKeys: ["k1.jpg"] },
      {
        id: "s2",
        title: "Turnover-only item",
        detail: "Only for Airbnb",
        referenceImageKeys: [],
        appliesTo: ["AIRBNB_TURNOVER"],
      },
    ],
    ...over,
  } satisfies FinalCheckupSettings,
});

const noExtras = { adminRequests: [] as Array<{ id: string; title: string }> };

describe("resolveFinalCheckupItems", () => {
  it("returns [] when the feature is disabled or config missing (no gate)", () => {
    expect(
      resolveFinalCheckupItems(baseSettings({ enabled: false }), { jobType: "AIRBNB_TURNOVER" }, noExtras)
    ).toEqual([]);
    expect(resolveFinalCheckupItems(null, { jobType: "AIRBNB_TURNOVER" }, noExtras)).toEqual([]);
    expect(resolveFinalCheckupItems({}, { jobType: "AIRBNB_TURNOVER" }, noExtras)).toEqual([]);
  });

  it("returns [] for an enabled config with no items and no extras", () => {
    expect(
      resolveFinalCheckupItems(baseSettings({ items: [] }), { jobType: "DEEP_CLEAN" }, noExtras)
    ).toEqual([]);
  });

  it("filters settings items by appliesTo (empty/undefined = all job types)", () => {
    const turnover = resolveFinalCheckupItems(
      baseSettings(),
      { jobType: "AIRBNB_TURNOVER" },
      noExtras
    );
    expect(turnover.map((i) => i.id)).toEqual(["s1", "s2"]);

    const deep = resolveFinalCheckupItems(baseSettings(), { jobType: "DEEP_CLEAN" }, noExtras);
    expect(deep.map((i) => i.id)).toEqual(["s1"]);
  });

  it("appends a guest auto-item when a guest summary is present", () => {
    const items = resolveFinalCheckupItems(
      baseSettings({ items: [] }),
      { jobType: "AIRBNB_TURNOVER" },
      { ...noExtras, guestSummary: "4" }
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(GUEST_CHECKUP_ITEM_ID);
    expect(items[0].title).toBe("Guests this stay: 4 — confirm setup");
    expect(items[0].source).toBe("GUESTS");
  });

  it("appends one auto-item per admin special-request task, in order", () => {
    const items = resolveFinalCheckupItems(
      baseSettings({ items: [] }),
      { jobType: "DEEP_CLEAN" },
      { adminRequests: [{ id: "t1", title: "Restock coffee" }, { id: "t2", title: "Flip mattress" }] }
    );
    expect(items.map((i) => i.id)).toEqual([
      adminRequestCheckupItemId("t1"),
      adminRequestCheckupItemId("t2"),
    ]);
    expect(items[0].title).toBe("Admin request: Restock coffee");
    expect(items.every((i) => i.source === "ADMIN_REQUEST")).toBe(true);
  });

  it("orders settings items, then guests, then admin requests", () => {
    const items = resolveFinalCheckupItems(
      baseSettings(),
      { jobType: "AIRBNB_TURNOVER" },
      { guestSummary: "2", adminRequests: [{ id: "t1", title: "Extra towels" }] }
    );
    expect(items.map((i) => i.source)).toEqual(["SETTINGS", "SETTINGS", "GUESTS", "ADMIN_REQUEST"]);
  });
});

describe("validateFinalCheckupAck", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("passes when every item is acknowledged (extra acks ignored)", () => {
    expect(
      validateFinalCheckupAck(items, [
        { itemId: "a", at: "2026-07-25T00:00:00Z" },
        { itemId: "b" },
        { itemId: "c" },
        { itemId: "unknown" },
      ])
    ).toEqual({ ok: true });
  });

  it("reports the missing ids", () => {
    expect(validateFinalCheckupAck(items, [{ itemId: "b" }])).toEqual({
      ok: false,
      missingIds: ["a", "c"],
    });
  });

  it("treats a malformed ack as nothing acknowledged", () => {
    expect(validateFinalCheckupAck(items, undefined)).toEqual({
      ok: false,
      missingIds: ["a", "b", "c"],
    });
    expect(validateFinalCheckupAck(items, "yes")).toEqual({
      ok: false,
      missingIds: ["a", "b", "c"],
    });
    expect(validateFinalCheckupAck(items, [{ nope: true }, null])).toEqual({
      ok: false,
      missingIds: ["a", "b", "c"],
    });
  });

  it("always passes for an empty item list (no gate)", () => {
    expect(validateFinalCheckupAck([], undefined)).toEqual({ ok: true });
  });
});

describe("guestSummaryFromReservation", () => {
  it("returns undefined without guest data", () => {
    expect(guestSummaryFromReservation(undefined)).toBeUndefined();
    expect(guestSummaryFromReservation({})).toBeUndefined();
  });

  it("uses preparationGuestCount with a breakdown when available", () => {
    expect(
      guestSummaryFromReservation({ preparationGuestCount: 4, adults: 2, children: 2 })
    ).toBe("4 (2 adults, 2 children)");
  });

  it("falls back to summing adults/children/infants", () => {
    expect(guestSummaryFromReservation({ adults: 1, infants: 1 })).toBe("2 (1 adult, 1 infant)");
    expect(guestSummaryFromReservation({ preparationGuestCount: 3 })).toBe("3");
  });
});
