import { describe, it, expect } from "vitest";
import {
  jobProgress,
  statusBlockStyle,
  JOB_STATUS_TONES,
  LAUNDRY_STATUS_TONES,
} from "@/lib/jobs/status-presentation";
import { JobStatus, LaundryStatus } from "@prisma/client";
describe("operational status presentation", () => {
  it("covers every persisted job and laundry status", () => {
    for (const status of Object.values(JobStatus))
      expect(JOB_STATUS_TONES[status]).toBeDefined();
    for (const status of Object.values(LaundryStatus))
      expect(LAUNDRY_STATUS_TONES[status]).toBeDefined();
  });
  it("does not portray a pause or approval wait as completed work", () => {
    expect(jobProgress("PAUSED").step).toBe(jobProgress("IN_PROGRESS").step);
    expect(jobProgress("WAITING_CONTINUATION_APPROVAL").step).toBe(3);
    expect(jobProgress("INVOICED").step).toBe(6);
    expect(jobProgress("UNKNOWN").step).toBeNull();
  });
  it("distinguishes flagged, pending and delivered whole blocks", () => {
    expect(statusBlockStyle("FLAGGED", "laundry")).not.toEqual(
      statusBlockStyle("DROPPED", "laundry"),
    );
    expect(statusBlockStyle("PENDING", "laundry")).not.toEqual(
      statusBlockStyle("DROPPED", "laundry"),
    );
  });
});
