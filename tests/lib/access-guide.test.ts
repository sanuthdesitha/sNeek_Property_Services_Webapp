import { describe, it, expect } from "vitest";
import {
  ACCESS_GUIDE_KINDS,
  ACCESS_GUIDE_KIND_LABELS,
  cleanAccessGuideForSave,
  entriesForAudience,
  hasWaypoint,
  orderedRoute,
  sanitizeAccessGuide,
  type AccessGuideEntry,
} from "@/lib/properties/access-guide";

const BIN_ROOM: AccessGuideEntry = {
  id: "access-bins",
  kind: "BIN_ROOM",
  label: "Bin room",
  instructions: "Fob opens the gate on the left",
  images: [{ url: "https://example.test/bins.jpg", key: "property-access/bins.jpg" }],
  level: "Basement 2",
  locationNote: "behind the lift lobby",
  lat: -33.8688,
  lng: 151.2093,
  sequence: 3,
};

describe("kinds", () => {
  it("carries both bin kinds — the room and the chute are different places", () => {
    expect(ACCESS_GUIDE_KINDS).toContain("BIN_ROOM");
    expect(ACCESS_GUIDE_KINDS).toContain("BIN_CHUTE");
  });

  it("labels every kind, so no surface ever renders a raw enum", () => {
    for (const kind of ACCESS_GUIDE_KINDS) {
      expect(ACCESS_GUIDE_KIND_LABELS[kind]).toBeTruthy();
    }
  });
});

describe("sanitizeAccessGuide", () => {
  it("keeps a full entry including the ACCESS-2 fields", () => {
    const [entry] = sanitizeAccessGuide([BIN_ROOM]);
    expect(entry.level).toBe("Basement 2");
    expect(entry.locationNote).toBe("behind the lift lobby");
    expect(entry.lat).toBeCloseTo(-33.8688);
    expect(entry.sequence).toBe(3);
  });

  it("accepts a legacy entry that predates the new fields", () => {
    // Existing stored rows have no level/lat/lng and must stay valid — this is
    // why every ACCESS-2 field is optional and nothing was backfilled.
    const [entry] = sanitizeAccessGuide([{ id: "a", kind: "KEYS", label: "Keys", images: [] }]);
    expect(entry.label).toBe("Keys");
    expect(entry.level).toBeUndefined();
  });

  it("drops only the bad entry, never the whole guide", () => {
    const result = sanitizeAccessGuide([
      BIN_ROOM,
      { id: "b", kind: "NOT_A_KIND", label: "Nope", images: [] },
      null,
      "garbage",
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("access-bins");
  });

  it("returns an empty array for a non-array column", () => {
    expect(sanitizeAccessGuide(null)).toEqual([]);
    expect(sanitizeAccessGuide({ nope: true })).toEqual([]);
  });

  it("rejects out-of-range coordinates rather than storing a bad pin", () => {
    expect(sanitizeAccessGuide([{ ...BIN_ROOM, lat: 999 }])).toEqual([]);
  });
});

describe("entriesForAudience (ACCESS-1 per-role guides)", () => {
  const cleanerOnly: AccessGuideEntry = { ...BIN_ROOM, id: "c", audience: "CLEANER" };
  const laundryOnly: AccessGuideEntry = { ...BIN_ROOM, id: "l", audience: "LAUNDRY" };
  const both: AccessGuideEntry = { ...BIN_ROOM, id: "b", audience: "BOTH" };
  const legacy: AccessGuideEntry = { ...BIN_ROOM, id: "legacy", audience: undefined };
  const all = [cleanerOnly, laundryOnly, both, legacy];

  it("shows a legacy entry with no audience to everyone", () => {
    // Entries written before per-role guides existed must not vanish from a
    // portal just because nobody has re-tagged them.
    expect(entriesForAudience([legacy], "CLEANER").map((e) => e.id)).toEqual(["legacy"]);
    expect(entriesForAudience([legacy], "LAUNDRY").map((e) => e.id)).toEqual(["legacy"]);
  });

  it("gives the cleaner cleaner-only and shared entries, never laundry-only", () => {
    expect(entriesForAudience(all, "CLEANER").map((e) => e.id)).toEqual(["c", "b", "legacy"]);
  });

  it("gives laundry only laundry and shared entries when the flag is off", () => {
    expect(entriesForAudience(all, "LAUNDRY", false).map((e) => e.id)).toEqual(["l", "b", "legacy"]);
  });

  it("adds the cleaner's entries for laundry when 'same as cleaner' is on", () => {
    expect(entriesForAudience(all, "LAUNDRY", true).map((e) => e.id)).toEqual([
      "c",
      "l",
      "b",
      "legacy",
    ]);
  });

  it("keeps laundry-specific entries even under 'same as cleaner'", () => {
    // "Same as cleaner, PLUS here is where the bags go" must work without
    // duplicating the whole guide.
    const result = entriesForAudience([cleanerOnly, laundryOnly], "LAUNDRY", true);
    expect(result.map((e) => e.id)).toContain("l");
  });

  it("never leaks cleaner-only entries to laundry with the flag off", () => {
    expect(entriesForAudience([cleanerOnly], "LAUNDRY", false)).toEqual([]);
  });
});

describe("hasWaypoint", () => {
  it("is true only when both coordinates are present", () => {
    expect(hasWaypoint(BIN_ROOM)).toBe(true);
    expect(hasWaypoint({ lat: -33.8, lng: undefined })).toBe(false);
    expect(hasWaypoint({ lat: undefined, lng: undefined })).toBe(false);
  });
});

describe("orderedRoute", () => {
  const chute: AccessGuideEntry = { ...BIN_ROOM, id: "chute", kind: "BIN_CHUTE", sequence: 1 };
  const unsequenced: AccessGuideEntry = { ...BIN_ROOM, id: "spare", sequence: undefined };

  it("orders by sequence, not array position", () => {
    expect(orderedRoute([BIN_ROOM, chute]).map((e) => e.id)).toEqual(["chute", "access-bins"]);
  });

  it("omits entries with no sequence rather than inventing an order", () => {
    // A made-up order is worse than none when someone is following it around a
    // building at 7am.
    expect(orderedRoute([unsequenced, chute]).map((e) => e.id)).toEqual(["chute"]);
  });

  it("breaks ties deterministically on original order", () => {
    const a = { ...BIN_ROOM, id: "a", sequence: 2 };
    const b = { ...BIN_ROOM, id: "b", sequence: 2 };
    expect(orderedRoute([a, b]).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("is empty when nothing is sequenced", () => {
    expect(orderedRoute([unsequenced])).toEqual([]);
  });
});

describe("cleanAccessGuideForSave", () => {
  it("keeps an entry that only carries a level — that alone is worth storing", () => {
    const result = cleanAccessGuideForSave([
      { id: "x", kind: "BIN_CHUTE", label: "Chute", images: [], level: "Level 3" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].level).toBe("Level 3");
  });

  it("trims whitespace-only optional text to undefined", () => {
    const [entry] = cleanAccessGuideForSave([
      { ...BIN_ROOM, level: "   ", locationNote: "  ", instructions: "  " },
    ]);
    expect(entry.level).toBeUndefined();
    expect(entry.locationNote).toBeUndefined();
    expect(entry.instructions).toBeUndefined();
  });

  it("preserves the waypoint and sequence through a save round-trip", () => {
    const [entry] = cleanAccessGuideForSave([BIN_ROOM]);
    expect(entry.lat).toBeCloseTo(-33.8688);
    expect(entry.lng).toBeCloseTo(151.2093);
    expect(entry.sequence).toBe(3);
  });
});
