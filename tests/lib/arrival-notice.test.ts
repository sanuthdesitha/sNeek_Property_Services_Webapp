import { describe, it, expect } from "vitest";
import { resolveArrivalNotice } from "@/lib/jobs/arrival-notice";

/**
 * A cleaner opening a job with an early check-in saw two banners: "Same-day
 * check-in — guest arrives 15:00" sitting directly above "Early check-in —
 * finish before 12:00". Two notices for one event, giving two different
 * deadlines, one of which was wrong.
 *
 * 15:00 is the property's standard arrival off the iCal sync. Once an admin has
 * moved this guest earlier, that number describes a time nobody is arriving.
 */
describe("resolveArrivalNotice", () => {
  it("lets the early check-in time win over the property default", () => {
    const notice = resolveArrivalNotice({
      earlyCheckinTime: "12:00",
      sameDayActive: true,
      sameDayTime: "15:00",
    });

    // Showing 15:00 tells a cleaner they have three hours they do not have.
    expect(notice).toEqual({ time: "12:00", sameDay: true, early: true });
  });

  it("treats an early check-in as same-day even without the iCal flag", () => {
    // The sync can be late or missing; an early check-in still means a guest
    // is arriving today.
    const notice = resolveArrivalNotice({ earlyCheckinTime: "11:30" });
    expect(notice).toEqual({ time: "11:30", sameDay: true, early: true });
  });

  it("keeps the property default when nothing was moved", () => {
    const notice = resolveArrivalNotice({ sameDayActive: true, sameDayTime: "15:00" });
    expect(notice).toEqual({ time: "15:00", sameDay: true, early: false });
  });

  it("reports same-day with no time rather than inventing one", () => {
    const notice = resolveArrivalNotice({ sameDayActive: true, sameDayTime: null });
    expect(notice).toEqual({ time: null, sameDay: true, early: false });
  });

  it("returns nothing when no guest is arriving", () => {
    expect(resolveArrivalNotice({})).toBeNull();
    expect(resolveArrivalNotice({ sameDayActive: false })).toBeNull();
    expect(resolveArrivalNotice({ earlyCheckinTime: null, sameDayActive: false })).toBeNull();
  });

  it("ignores blank times rather than rendering an empty deadline", () => {
    expect(resolveArrivalNotice({ earlyCheckinTime: "   " })).toBeNull();

    const notice = resolveArrivalNotice({
      earlyCheckinTime: "  ",
      sameDayActive: true,
      sameDayTime: "15:00",
    });
    expect(notice).toEqual({ time: "15:00", sameDay: true, early: false });
  });

  it("trims a padded time", () => {
    expect(resolveArrivalNotice({ earlyCheckinTime: " 12:00 " })?.time).toBe("12:00");
  });

  it("survives junk without throwing", () => {
    expect(
      resolveArrivalNotice({ earlyCheckinTime: 1200 as unknown as string, sameDayActive: true })
    ).toEqual({ time: null, sameDay: true, early: false });
  });
});
