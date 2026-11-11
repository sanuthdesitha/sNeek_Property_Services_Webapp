// @vitest-environment node
import { describe, expect, it } from "vitest";
import { accessWindowEnd, accessWindowMessage, cleanerAccessWindow } from "@/lib/properties/access-window";
import { withoutPropertyAccess } from "@/lib/jobs/cleaner-redaction";

// The clean is on Wednesday 11 November 2026 (Sydney is UTC+11 in November).
const scheduledDate = new Date("2026-11-11T00:00:00.000Z");
const at = (iso: string) => new Date(iso);
const job = (overrides = {}) => ({ responseStatus: "ACCEPTED", scheduledDate, jobStatus: "ASSIGNED", ...overrides });

describe("when a cleaner may read access details", () => {
  it("closes at the end of the day after the clean, Sydney time", () => {
    // Midnight starting Friday 13 November in Sydney = 13:00 UTC on Thursday 12th.
    expect(accessWindowEnd(scheduledDate).toISOString()).toBe("2026-11-12T13:00:00.000Z");
  });

  it("is closed for an offer that has not been accepted", () => {
    expect(cleanerAccessWindow(job({ responseStatus: "PENDING" }), at("2026-11-11T01:00:00Z"))).toBe("NOT_ACCEPTED");
    expect(cleanerAccessWindow(job({ responseStatus: undefined }), at("2026-11-11T01:00:00Z"))).toBe("NOT_ACCEPTED");
    expect(cleanerAccessWindow(job({ responseStatus: "DECLINED" }), at("2026-11-11T01:00:00Z"))).toBe("NOT_ACCEPTED");
  });

  it("opens on acceptance, however far ahead the clean is", () => {
    expect(cleanerAccessWindow(job(), at("2026-09-01T00:00:00Z"))).toBe("OPEN");
  });

  it("stays open on the day and the day after, then closes", () => {
    expect(cleanerAccessWindow(job(), at("2026-11-11T05:00:00Z"))).toBe("OPEN");
    expect(cleanerAccessWindow(job(), at("2026-11-12T12:59:59Z"))).toBe("OPEN");
    expect(cleanerAccessWindow(job(), at("2026-11-12T13:00:00Z"))).toBe("EXPIRED");
    expect(cleanerAccessWindow(job({ jobStatus: "COMPLETED" }), at("2026-11-20T00:00:00Z"))).toBe("EXPIRED");
  });

  it.each(["EN_ROUTE", "IN_PROGRESS", "PAUSED", "WAITING_CONTINUATION_APPROVAL"])(
    "never locks out a clean that is under way (%s)",
    (jobStatus) => {
      expect(cleanerAccessWindow(job({ jobStatus }), at("2026-12-01T00:00:00Z"))).toBe("OPEN");
      expect(cleanerAccessWindow(job({ jobStatus, responseStatus: "PENDING" }), at("2026-11-11T01:00:00Z"))).toBe("OPEN");
    },
  );

  it("explains itself when closed and says nothing when open", () => {
    expect(accessWindowMessage("OPEN")).toBeNull();
    expect(accessWindowMessage("NOT_ACCEPTED")).toMatch(/once you accept/);
    expect(accessWindowMessage("EXPIRED")).toMatch(/no longer shown/);
  });
});

describe("a job payload outside the window", () => {
  it("carries no lockbox, codes or instructions, only non-secret flags", () => {
    const payload = {
      id: "job",
      property: { name: "Bondi", accessInfo: { lockbox: "4729", codes: "1234#", instructions: "Side gate", laundrySameAsCleaner: true } },
    };
    expect(withoutPropertyAccess(payload)).toEqual({
      id: "job", property: { name: "Bondi", accessInfo: { laundrySameAsCleaner: true } },
    });
    expect(payload.property.accessInfo.lockbox).toBe("4729");
  });
});
