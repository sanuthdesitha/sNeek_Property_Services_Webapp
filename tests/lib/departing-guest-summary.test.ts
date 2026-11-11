import { describe, expect, it } from "vitest";
import { buildCleanerDepartingGuest } from "@/lib/jobs/guest-summary";

describe("departing guest summary for cleaners", () => {
  it("returns nothing when the job has no reservation", () => {
    expect(buildCleanerDepartingGuest(null)).toBeNull();
    expect(buildCleanerDepartingGuest(undefined)).toBeNull();
  });

  it("does not present a booking with no name and no phone as a guest", () => {
    expect(buildCleanerDepartingGuest({ guestName: "  ", guestPhone: null, endDate: new Date("2026-11-11T00:00:00Z") })).toBeNull();
  });

  it("gives the name, a dialable number, the check-out time and the party size", () => {
    const summary = buildCleanerDepartingGuest({
      guestName: " Priya Shah ",
      guestPhone: "+61 400 111 222",
      checkoutAtLocal: new Date("2026-11-11T00:00:00Z"),
      endDate: new Date("2026-11-11T00:00:00Z"),
      adults: 2,
      children: 1,
      infants: 0,
    });
    expect(summary).toEqual({
      name: "Priya Shah",
      phone: "+61400111222",
      phoneLabel: "+61 400 111 222",
      checkoutAtLocal: "2026-11-11T00:00:00.000Z",
      checkoutDate: "2026-11-11T00:00:00.000Z",
      guestCountLabel: "2 adults · 1 child",
      hasAnything: true,
    });
  });

  it("keeps an unusable phone as text but offers no dial link, and never carries email or code", () => {
    const summary = buildCleanerDepartingGuest({
      guestName: "Sam",
      guestPhone: "ask host",
      // Extra booking fields must not pass through.
      ...({ guestEmail: "sam@example.com", reservationCode: "HM123", guestProfileUrl: "https://x" } as object),
    });
    expect(summary?.phone).toBeNull();
    expect(summary?.phoneLabel).toBe("ask host");
    expect(JSON.stringify(summary)).not.toMatch(/sam@example\.com|HM123|https:\/\/x/);
  });

  it("shows a guest known by phone only", () => {
    expect(buildCleanerDepartingGuest({ guestPhone: "0400 111 222" })).toMatchObject({ name: null, phone: "0400111222" });
  });
});
