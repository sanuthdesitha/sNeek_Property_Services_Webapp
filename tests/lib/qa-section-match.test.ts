import { describe, it, expect } from "vitest";
import { matchCleanerSection, normalizeSectionTitle } from "@/lib/qa/section-match";

describe("normalizeSectionTitle", () => {
  it("lowercases, strips the QA suffix, punctuation and extra whitespace", () => {
    expect(normalizeSectionTitle("Bedrooms — QA Inspection")).toBe("bedrooms");
    expect(normalizeSectionTitle("Bedrooms - QA Inspection")).toBe("bedrooms");
    expect(normalizeSectionTitle("Kitchen & Appliances")).toBe("kitchen appliances");
    expect(normalizeSectionTitle("  Living   Room  ")).toBe("living room");
  });
});

describe("matchCleanerSection", () => {
  it("matches exact titles", () => {
    expect(matchCleanerSection("Bedrooms", ["Kitchen", "Bedrooms"])).toBe("Bedrooms");
  });

  it("matches after stripping the QA-inspection suffix", () => {
    expect(matchCleanerSection("Bedrooms — QA Inspection", ["Bedrooms", "Bathrooms"])).toBe("Bedrooms");
    expect(matchCleanerSection("Bathrooms QA Inspection", ["Bedrooms", "Bathrooms"])).toBe("Bathrooms");
  });

  it("matches by containment in both directions", () => {
    // QA title contained in cleaner title
    expect(matchCleanerSection("Kitchen", ["Kitchen & appliances", "Bedrooms"])).toBe("Kitchen & appliances");
    // Cleaner title contained in QA title
    expect(matchCleanerSection("Master Bedroom — QA Inspection", ["Bedroom", "Bathroom"])).toBe("Bedroom");
  });

  it("returns null when nothing matches", () => {
    expect(matchCleanerSection("Balcony — QA Inspection", ["Kitchen", "Bedrooms"])).toBeNull();
    expect(matchCleanerSection("", ["Kitchen"])).toBeNull();
    expect(matchCleanerSection("Kitchen", [])).toBeNull();
  });

  it("prefers the exact match when multiple candidates match", () => {
    expect(
      matchCleanerSection("Kitchen — QA Inspection", ["Kitchen & appliances", "Kitchen"])
    ).toBe("Kitchen");
  });

  it("picks the closest (longest-overlap) containment match when ambiguous", () => {
    // Both contain "bed", but "Master Bedroom" shares the longer overlap with
    // the QA title than plain "Bed".
    expect(
      matchCleanerSection("Master Bedroom — QA Inspection", ["Bed", "Master Bedroom & ensuite"])
    ).toBe("Master Bedroom & ensuite");
  });
});
