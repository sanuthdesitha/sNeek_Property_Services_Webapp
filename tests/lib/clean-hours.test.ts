import { describe, it, expect } from "vitest";
import {
  cleanHoursDisagree,
  cleanHoursSource,
  legacyAccessInfoHours,
  resolveJobCleanHours,
  resolvePropertyCleanHours,
} from "@/lib/properties/clean-hours";

/**
 * Three fields hold "how long does a clean take here", nothing keeps them in
 * step, and the damage was always that DIFFERENT CODE READ DIFFERENT ONES — a
 * property edited to 4 hours on its own page still producing 3-hour jobs from
 * iCal. These tests pin the single answer every reader now gets.
 */
describe("resolvePropertyCleanHours", () => {
  it("prefers assignedCleaningHours — the field the property page edits", () => {
    expect(
      resolvePropertyCleanHours({
        assignedCleaningHours: 4,
        cleaningDurationMinutes: 180,
        accessInfo: { defaultCleanDurationHours: 3 },
      })
    ).toBe(4);
  });

  it("falls back to cleaningDurationMinutes, converted to hours", () => {
    expect(
      resolvePropertyCleanHours({
        cleaningDurationMinutes: 90,
        accessInfo: { defaultCleanDurationHours: 3 },
      })
    ).toBe(1.5);
  });

  it("falls back LAST to the legacy onboarding value", () => {
    // The property CREATE form defaults this to "3". It is the value most
    // likely to be stale, and it is where the three-hour jobs came from.
    expect(resolvePropertyCleanHours({ accessInfo: { defaultCleanDurationHours: 3 } })).toBe(3);
  });

  it("returns null when nobody has said, rather than inventing a default", () => {
    // "We have not been told" and "it takes three hours" are different
    // statements, and only one should quietly become somebody's pay.
    expect(resolvePropertyCleanHours({})).toBeNull();
    expect(
      resolvePropertyCleanHours({ assignedCleaningHours: null, cleaningDurationMinutes: null })
    ).toBeNull();
  });

  it("treats a ZERO at any level as an empty box, not as an answer", () => {
    // No form offers a way to mean "this clean takes no time", and a job with no
    // allocated hours pays nothing.
    expect(
      resolvePropertyCleanHours({
        assignedCleaningHours: 0,
        cleaningDurationMinutes: 0,
        accessInfo: { defaultCleanDurationHours: 3 },
      })
    ).toBe(3);
    expect(resolvePropertyCleanHours({ assignedCleaningHours: 0 })).toBeNull();
  });

  it("ignores negative and non-numeric values", () => {
    expect(resolvePropertyCleanHours({ assignedCleaningHours: -2, cleaningDurationMinutes: 120 })).toBe(
      2
    );
    expect(
      resolvePropertyCleanHours({ assignedCleaningHours: Number.NaN, cleaningDurationMinutes: null })
    ).toBeNull();
  });
});

describe("legacyAccessInfoHours", () => {
  it("digs the value out of the accessInfo blob", () => {
    expect(legacyAccessInfoHours({ defaultCleanDurationHours: 2.5 })).toBe(2.5);
  });

  it("survives anything that is not an object", () => {
    // accessInfo is a Json column and has held all of these at some point.
    for (const junk of [null, undefined, "3", 3, [], [{ defaultCleanDurationHours: 3 }]]) {
      expect(legacyAccessInfoHours(junk), JSON.stringify(junk)).toBeNull();
    }
  });

  it("accepts a numeric string, which is what a form field sends", () => {
    expect(legacyAccessInfoHours({ defaultCleanDurationHours: "3" })).toBe(3);
  });
});

describe("resolveJobCleanHours", () => {
  it("lets the job's own hours win over the property default", () => {
    // An admin editing one clean's hours must not have it quietly reverted by
    // the property's default on the next read.
    expect(resolveJobCleanHours({ estimatedHours: 5 }, { assignedCleaningHours: 3 })).toBe(5);
  });

  it("falls back to the property when the job has none", () => {
    expect(resolveJobCleanHours({ estimatedHours: null }, { assignedCleaningHours: 3 })).toBe(3);
    expect(resolveJobCleanHours({}, { accessInfo: { defaultCleanDurationHours: 2 } })).toBe(2);
  });

  it("does NOT treat a job's zero hours as a decision", () => {
    expect(resolveJobCleanHours({ estimatedHours: 0 }, { assignedCleaningHours: 3 })).toBe(3);
  });
});

describe("cleanHoursSource", () => {
  it("names which field the answer came from", () => {
    expect(cleanHoursSource({ assignedCleaningHours: 4 })).toBe("ASSIGNED");
    expect(cleanHoursSource({ cleaningDurationMinutes: 180 })).toBe("DURATION_MINUTES");
    expect(cleanHoursSource({ accessInfo: { defaultCleanDurationHours: 3 } })).toBe(
      "LEGACY_ACCESS_INFO"
    );
    expect(cleanHoursSource({})).toBe("NONE");
  });
});

describe("cleanHoursDisagree", () => {
  it("is false when only one field is set", () => {
    expect(cleanHoursDisagree({ assignedCleaningHours: 4 })).toBe(false);
    expect(cleanHoursDisagree({})).toBe(false);
  });

  it("is false when the same duration is expressed two ways", () => {
    // 90 minutes and 1.5 hours are one answer, not a disagreement.
    expect(cleanHoursDisagree({ assignedCleaningHours: 1.5, cleaningDurationMinutes: 90 })).toBe(
      false
    );
  });

  it("SPOTS a genuine disagreement", () => {
    // A property whose page says 4 hours while its onboarding value says 3 is
    // one somebody will eventually argue about.
    expect(
      cleanHoursDisagree({ assignedCleaningHours: 4, accessInfo: { defaultCleanDurationHours: 3 } })
    ).toBe(true);
  });

  it("ignores empty boxes when deciding whether there is a conflict", () => {
    expect(cleanHoursDisagree({ assignedCleaningHours: 4, cleaningDurationMinutes: 0 })).toBe(false);
  });
});
