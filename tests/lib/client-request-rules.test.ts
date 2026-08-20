import { describe, it, expect } from "vitest";
import { JobStatus } from "@prisma/client";
import {
  checkClientJobRequest,
  isClientSchedulable,
  type ClientJobAction,
} from "@/lib/jobs/client-request-rules";

/**
 * The bug these cover: all three request routes blocked only COMPLETED and
 * INVOICED, so a client could ask to cancel a clean a cleaner was standing in
 * the middle of. The request was created, queued, and read by an admin after
 * the work had already finished.
 */

const ACTIONS: ClientJobAction[] = ["cancel", "reschedule", "skip"];

describe("checkClientJobRequest — still changeable", () => {
  it.each([JobStatus.UNASSIGNED, JobStatus.OFFERED, JobStatus.ASSIGNED])(
    "allows every action while the job is only %s",
    (status) => {
      for (const action of ACTIONS) {
        expect(checkClientJobRequest(action, { status }).allowed).toBe(true);
      }
    }
  );
});

describe("checkClientJobRequest — work under way", () => {
  it.each([
    JobStatus.EN_ROUTE,
    JobStatus.IN_PROGRESS,
    JobStatus.PAUSED,
    JobStatus.WAITING_CONTINUATION_APPROVAL,
    JobStatus.SUBMITTED,
    JobStatus.QA_REVIEW,
  ])("refuses every action once the job is %s", (status) => {
    for (const action of ACTIONS) {
      const verdict = checkClientJobRequest(action, { status });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBeTruthy();
    }
  });

  it("tells the client their cleaner is on the way, not just that it failed", () => {
    const verdict = checkClientJobRequest("cancel", { status: JobStatus.EN_ROUTE });
    // A fact they can act on beats a flat refusal, which only invites a retry.
    expect(verdict.reason).toMatch(/on the way/i);
    expect(verdict.reason).toMatch(/call us/i);
  });

  it("does not claim the cleaner is travelling once they have arrived", () => {
    const verdict = checkClientJobRequest("cancel", { status: JobStatus.IN_PROGRESS });
    expect(verdict.reason).not.toMatch(/on the way/i);
    expect(verdict.reason).toMatch(/under way/i);
  });
});

describe("checkClientJobRequest — finished work", () => {
  it.each([JobStatus.COMPLETED, JobStatus.INVOICED])(
    "refuses every action once the job is %s",
    (status) => {
      for (const action of ACTIONS) {
        const verdict = checkClientJobRequest(action, { status });
        expect(verdict.allowed).toBe(false);
        expect(verdict.reason).toMatch(/already been completed/i);
      }
    }
  );

  it("points a complaint at contact rather than at the form", () => {
    const verdict = checkClientJobRequest("cancel", { status: JobStatus.COMPLETED });
    expect(verdict.reason).toMatch(/contact us/i);
  });
});

describe("wording", () => {
  it("names the action the client actually attempted", () => {
    expect(checkClientJobRequest("cancel", { status: JobStatus.COMPLETED }).reason).toMatch(
      /cancelled/
    );
    expect(checkClientJobRequest("reschedule", { status: JobStatus.COMPLETED }).reason).toMatch(
      /rescheduled/
    );
    expect(checkClientJobRequest("skip", { status: JobStatus.COMPLETED }).reason).toMatch(/skipped/);
  });
});

describe("isClientSchedulable", () => {
  it("agrees with checkClientJobRequest for every status in the enum", () => {
    // Guards the drift this module exists to prevent: a status added later must
    // not be allowed by one helper and refused by the other.
    for (const status of Object.values(JobStatus)) {
      expect(isClientSchedulable(status)).toBe(checkClientJobRequest("cancel", { status }).allowed);
    }
  });
});
