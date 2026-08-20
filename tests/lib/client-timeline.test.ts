import { describe, it, expect } from "vitest";
import { CLIENT_TIMELINE_STEPS, resolveClientTimelinePosition } from "@/lib/jobs/client-timeline";

/**
 * The bar looked its status up with indexOf and fell back to 0 on a miss. Three
 * of the eleven JobStatus members are not on the ladder, so a client whose
 * clean was PAUSED mid-way saw a timeline claiming nobody had been assigned
 * yet. Not a missing step — a wrong one.
 */
describe("resolveClientTimelinePosition", () => {
  it("places every ladder status at its own step", () => {
    CLIENT_TIMELINE_STEPS.forEach((step, i) => {
      expect(resolveClientTimelinePosition(step)).toEqual({
        index: i,
        note: null,
        unknown: false,
      });
    });
  });

  it("keeps a paused job at in-progress, not back at the start", () => {
    const paused = resolveClientTimelinePosition("PAUSED");
    expect(paused.index).toBe(CLIENT_TIMELINE_STEPS.indexOf("IN_PROGRESS"));
    expect(paused.note).toBe("Paused");
    // The whole bug: this used to be 0.
    expect(paused.index).not.toBe(0);
  });

  it("treats waiting-for-continuation as paused at in-progress", () => {
    const waiting = resolveClientTimelinePosition("WAITING_CONTINUATION_APPROVAL");
    expect(waiting.index).toBe(CLIENT_TIMELINE_STEPS.indexOf("IN_PROGRESS"));
    expect(waiting.note).toMatch(/approval/i);
  });

  it("keeps an offered job before assigned — nobody has accepted it", () => {
    const offered = resolveClientTimelinePosition("OFFERED");
    expect(offered.index).toBe(CLIENT_TIMELINE_STEPS.indexOf("UNASSIGNED"));
    expect(offered.note).toBe("Offered to a cleaner");
  });

  it("does not add off-ladder statuses as steps", () => {
    // A job does not pass THROUGH paused on its way to finishing; showing it as
    // a ninth step would say it does.
    expect(CLIENT_TIMELINE_STEPS).not.toContain("PAUSED");
    expect(CLIENT_TIMELINE_STEPS).not.toContain("OFFERED");
    expect(CLIENT_TIMELINE_STEPS).not.toContain("WAITING_CONTINUATION_APPROVAL");
  });

  it("reports an unrecognised status instead of confidently showing step one", () => {
    const out = resolveClientTimelinePosition("SOMETHING_NEW");
    expect(out.unknown).toBe(true);
    // Still a usable index, but the caller can say it does not know.
    expect(out.index).toBe(0);
  });

  it("covers every JobStatus member", () => {
    // If someone adds a status and forgets this map, it should surface here
    // rather than as a client seeing the wrong step.
    const all = [
      "UNASSIGNED",
      "OFFERED",
      "ASSIGNED",
      "EN_ROUTE",
      "IN_PROGRESS",
      "PAUSED",
      "WAITING_CONTINUATION_APPROVAL",
      "SUBMITTED",
      "QA_REVIEW",
      "COMPLETED",
      "INVOICED",
    ];
    for (const status of all) {
      expect(resolveClientTimelinePosition(status).unknown, `${status} is unmapped`).toBe(false);
    }
  });
});
