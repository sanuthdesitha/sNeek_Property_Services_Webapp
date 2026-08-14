import { describe, it, expect } from "vitest";
import {
  buildCleanerGuestSummary,
  buildGuestCountLabel,
  buildGuestSummary,
  extractCountry,
  telHref,
} from "@/lib/jobs/guest-summary";

const INCOMING = {
  guestName: "A. Guest",
  locationText: "Sydney, Australia",
  guestPhone: "+61 400 000 000",
  guestEmail: "guest@example.test",
  guestProfileUrl: "https://example.test/u/1",
  reservationCode: "HMABC123",
  adults: 2,
  children: 1,
  infants: 0,
  checkinAtLocal: "2026-08-14T14:00:00.000Z",
  preparationGuestCount: 3,
  preparationSource: "INCOMING_BOOKING" as const,
};

describe("extractCountry", () => {
  it("takes the last segment of a City, Country string", () => {
    expect(extractCountry("Sydney, Australia")).toBe("Australia");
  });

  it("handles a bare country", () => {
    expect(extractCountry("Japan")).toBe("Japan");
  });

  it("handles a longer path and stray spacing", () => {
    expect(extractCountry("  Shibuya , Tokyo ,  Japan ")).toBe("Japan");
  });

  it("returns null for nothing useful", () => {
    expect(extractCountry(null)).toBeNull();
    expect(extractCountry("   ")).toBeNull();
    expect(extractCountry(",,")).toBeNull();
  });
});

describe("telHref", () => {
  it("strips spacing but keeps a leading plus", () => {
    expect(telHref("+61 400 000 000")).toBe("+61400000000");
  });

  it("strips punctuation from a local number", () => {
    expect(telHref("(02) 9999-1234")).toBe("0299991234");
  });

  it("rejects anything too short to dial", () => {
    expect(telHref("n/a")).toBeNull();
    expect(telHref("12345")).toBeNull();
    expect(telHref(null)).toBeNull();
  });
});

describe("buildGuestCountLabel", () => {
  it("pluralises and joins only the counts supplied", () => {
    expect(buildGuestCountLabel({ adults: 2, children: 1, infants: 0 })).toBe("2 adults · 1 child");
    expect(buildGuestCountLabel({ adults: 1 })).toBe("1 adult");
    expect(buildGuestCountLabel({ infants: 2 })).toBe("2 infants");
  });

  it("returns null when the feed gave no counts", () => {
    expect(buildGuestCountLabel({})).toBeNull();
    expect(buildGuestCountLabel({ adults: 0, children: 0, infants: 0 })).toBeNull();
  });
});

describe("buildGuestSummary", () => {
  it("summarises the incoming guest for admin", () => {
    const s = buildGuestSummary(INCOMING);
    expect(s.name).toBe("A. Guest");
    expect(s.country).toBe("Australia");
    expect(s.origin).toBe("Sydney, Australia");
    expect(s.phone).toBe("+61400000000");
    expect(s.phoneLabel).toBe("+61 400 000 000");
    expect(s.guestCountLabel).toBe("2 adults · 1 child");
    expect(s.reservationCode).toBe("HMABC123");
    expect(s.preparationGuestCount).toBe(3);
    expect(s.preparationIsFallback).toBe(false);
    expect(s.hasAnything).toBe(true);
  });

  it("flags a property-max fallback count as not from the booking", () => {
    const s = buildGuestSummary({ preparationGuestCount: 4, preparationSource: "PROPERTY_MAX" });
    expect(s.preparationIsFallback).toBe(true);
    // A fallback count alone is not real guest information.
    expect(s.hasAnything).toBe(false);
  });

  it("reports nothing to show for an empty or missing context", () => {
    expect(buildGuestSummary(undefined).hasAnything).toBe(false);
    expect(buildGuestSummary({}).hasAnything).toBe(false);
    expect(buildGuestSummary({ guestName: "   " }).hasAnything).toBe(false);
  });
});

describe("buildCleanerGuestSummary", () => {
  it("withholds guest email, profile and reservation code from cleaners", () => {
    const s = buildCleanerGuestSummary(INCOMING);
    expect(s.email).toBeNull();
    expect(s.profileUrl).toBeNull();
    expect(s.reservationCode).toBeNull();
  });

  it("keeps what a cleaner actually needs, including a dialable number", () => {
    const s = buildCleanerGuestSummary(INCOMING);
    expect(s.name).toBe("A. Guest");
    expect(s.country).toBe("Australia");
    expect(s.phone).toBe("+61400000000");
    expect(s.guestCountLabel).toBe("2 adults · 1 child");
    expect(s.checkinAtLocal).toBe("2026-08-14T14:00:00.000Z");
    expect(s.hasAnything).toBe(true);
  });

  it("shows nothing when only withheld fields are present", () => {
    const s = buildCleanerGuestSummary({
      guestEmail: "guest@example.test",
      reservationCode: "HMABC123",
    });
    expect(s.hasAnything).toBe(false);
  });
});
