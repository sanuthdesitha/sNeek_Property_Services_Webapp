import { describe, it, expect } from "vitest";
import { JobStatus } from "@prisma/client";
import { TRACKED_STATUSES, isTrackedStatus } from "@/lib/gps/tracked-statuses";

/**
 * The bug this guards: the tracking window was written out by hand in four
 * places and one copy said EN_ROUTE only. The server then rejected every ping
 * from the moment a cleaner checked in, the client cleared its queue on the
 * 400, and ops saw an empty map — which reads as "no signal", not as a bug.
 */
describe("TRACKED_STATUSES", () => {
  it("tracks a cleaner who has checked in", () => {
    // The whole bug, in one assertion.
    expect(isTrackedStatus(JobStatus.IN_PROGRESS)).toBe(true);
  });

  it("tracks a cleaner on the way", () => {
    expect(isTrackedStatus(JobStatus.EN_ROUTE)).toBe(true);
  });

  it("keeps tracking a paused job", () => {
    // A paused job is someone who stepped out for supplies. Dropping them off
    // the map is how a person gets marked missing for an hour.
    expect(isTrackedStatus(JobStatus.PAUSED)).toBe(true);
  });

  it("stops once the job is finished with", () => {
    expect(isTrackedStatus(JobStatus.SUBMITTED)).toBe(false);
    expect(isTrackedStatus(JobStatus.COMPLETED)).toBe(false);
    expect(isTrackedStatus(JobStatus.INVOICED)).toBe(false);
  });

  it("does not track a job nobody has taken", () => {
    expect(isTrackedStatus(JobStatus.UNASSIGNED)).toBe(false);
    expect(isTrackedStatus(JobStatus.OFFERED)).toBe(false);
    expect(isTrackedStatus(JobStatus.ASSIGNED)).toBe(false);
  });

  it("treats an unknown status as not tracked", () => {
    expect(isTrackedStatus("SOMETHING_NEW")).toBe(false);
  });

  it("classifies every JobStatus member, so a new one is a deliberate decision", () => {
    const all = [
      JobStatus.UNASSIGNED,
      JobStatus.OFFERED,
      JobStatus.ASSIGNED,
      JobStatus.EN_ROUTE,
      JobStatus.IN_PROGRESS,
      JobStatus.PAUSED,
      JobStatus.WAITING_CONTINUATION_APPROVAL,
      JobStatus.SUBMITTED,
      JobStatus.QA_REVIEW,
      JobStatus.COMPLETED,
      JobStatus.INVOICED,
    ];
    expect(new Set(all).size).toBe(all.length);
    for (const status of all) {
      expect(typeof isTrackedStatus(status), `${status} unclassified`).toBe("boolean");
    }
    // Nothing is tracked that is not a real status.
    expect(TRACKED_STATUSES.every((status) => all.includes(status))).toBe(true);
  });
});
