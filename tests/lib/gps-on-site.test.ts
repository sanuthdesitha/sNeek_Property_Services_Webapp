import { describe, it, expect } from "vitest";
import {
  ON_SITE_RADIUS_M,
  UNRELIABLE_ACCURACY_M,
  classifyCheckInLocation,
  resolveOnSiteRadius,
} from "@/lib/gps/distance";
import {
  OFF_SITE_REASON_CODES,
  isValidOffSiteReason,
  offSiteReasonLabel,
  reasonClaimsOnSite,
} from "@/lib/gps/off-site-reasons";

describe("resolveOnSiteRadius", () => {
  it("falls back to the default radius", () => {
    expect(resolveOnSiteRadius(null)).toBe(ON_SITE_RADIUS_M);
    expect(resolveOnSiteRadius(undefined)).toBe(ON_SITE_RADIUS_M);
  });

  it("honours a per-property override", () => {
    expect(resolveOnSiteRadius(400)).toBe(400);
  });

  it("ignores a nonsensical override", () => {
    // A zero or negative radius would make every check-in off-site.
    expect(resolveOnSiteRadius(0)).toBe(ON_SITE_RADIUS_M);
    expect(resolveOnSiteRadius(-50)).toBe(ON_SITE_RADIUS_M);
  });
});

describe("classifyCheckInLocation", () => {
  it("treats a fix inside the radius as on site", () => {
    expect(classifyCheckInLocation({ distanceM: 0, accuracyM: 10 })).toBe("ON_SITE");
    expect(classifyCheckInLocation({ distanceM: 149, accuracyM: 10 })).toBe("ON_SITE");
  });

  it("treats the boundary itself as on site", () => {
    expect(classifyCheckInLocation({ distanceM: ON_SITE_RADIUS_M, accuracyM: 10 })).toBe("ON_SITE");
  });

  it("treats a fix beyond the radius as off site", () => {
    expect(classifyCheckInLocation({ distanceM: 151, accuracyM: 10 })).toBe("OFF_SITE");
    expect(classifyCheckInLocation({ distanceM: 40_219, accuracyM: 25 })).toBe("OFF_SITE");
  });

  it("refuses to judge a fix with no distance", () => {
    // A property with no coordinates cannot produce a distance — that must not
    // read as an off-site start.
    expect(classifyCheckInLocation({ distanceM: null, accuracyM: 10 })).toBe("UNRELIABLE");
    expect(classifyCheckInLocation({ distanceM: Number.NaN, accuracyM: 10 })).toBe("UNRELIABLE");
  });

  it("refuses to judge a coarse fix in either direction", () => {
    // The whole point: a kilometre-wide fix is not evidence of presence when it
    // lands inside, nor of absence when it lands outside.
    expect(classifyCheckInLocation({ distanceM: 20, accuracyM: UNRELIABLE_ACCURACY_M + 1 })).toBe(
      "UNRELIABLE"
    );
    expect(
      classifyCheckInLocation({ distanceM: 3_000, accuracyM: UNRELIABLE_ACCURACY_M + 1 })
    ).toBe("UNRELIABLE");
  });

  it("still judges a fix exactly at the accuracy limit", () => {
    expect(classifyCheckInLocation({ distanceM: 20, accuracyM: UNRELIABLE_ACCURACY_M })).toBe(
      "ON_SITE"
    );
  });

  it("judges against the per-property radius when one is set", () => {
    // A large complex whose pin sits at the street entrance.
    expect(classifyCheckInLocation({ distanceM: 300, accuracyM: 10, radiusM: 500 })).toBe("ON_SITE");
    expect(classifyCheckInLocation({ distanceM: 300, accuracyM: 10 })).toBe("OFF_SITE");
  });

  it("accepts a missing accuracy rather than discarding the fix", () => {
    expect(classifyCheckInLocation({ distanceM: 20 })).toBe("ON_SITE");
    expect(classifyCheckInLocation({ distanceM: 900 })).toBe("OFF_SITE");
  });
});

describe("off-site reasons", () => {
  it("validates only known codes", () => {
    expect(isValidOffSiteReason("POOR_SIGNAL")).toBe(true);
    expect(isValidOffSiteReason("poor_signal")).toBe(false);
    expect(isValidOffSiteReason("")).toBe(false);
    expect(isValidOffSiteReason(null)).toBe(false);
    expect(isValidOffSiteReason(42)).toBe(false);
  });

  it("labels every code", () => {
    for (const reason of OFF_SITE_REASON_CODES) {
      expect(offSiteReasonLabel(reason.code)).toBe(reason.label);
    }
    expect(offSiteReasonLabel(null)).toBeNull();
  });

  it("separates data-quality reasons from genuine off-site starts", () => {
    // Admin-facing wording depends on this split, so it must not drift.
    expect(reasonClaimsOnSite("POOR_SIGNAL")).toBe(true);
    expect(reasonClaimsOnSite("UNDERGROUND_PARKING")).toBe(true);
    expect(reasonClaimsOnSite("ON_THE_WAY")).toBe(false);
    expect(reasonClaimsOnSite("KEY_PICKUP")).toBe(false);
    expect(reasonClaimsOnSite(null)).toBe(false);
  });

  it("has unique codes", () => {
    const codes = OFF_SITE_REASON_CODES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
