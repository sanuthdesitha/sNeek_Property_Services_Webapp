import { describe, it, expect } from "vitest";
import {
  DEFAULT_JOB_RESET_OPTIONS,
  isRestartTransition,
  normalizeJobResetOptions,
  planJobReset,
  startArtifactResetFields,
  type JobResetContext,
} from "@/lib/jobs/job-reset";

const richJob: JobResetContext = {
  status: "IN_PROGRESS",
  timeLogCount: 3,
  assigneeCount: 2,
  submissionCount: 1,
  photoCount: 12,
  qaReviewCount: 0,
  hasLaundryTask: true,
};

function keys(plan: ReturnType<typeof planJobReset>) {
  return plan.mutations.map((m) => m.key);
}

describe("isRestartTransition", () => {
  it("started → pre-start is a restart", () => {
    expect(isRestartTransition("IN_PROGRESS", "ASSIGNED")).toBe(true);
    expect(isRestartTransition("PAUSED", "ASSIGNED")).toBe(true);
    expect(isRestartTransition("EN_ROUTE", "UNASSIGNED")).toBe(true);
    expect(isRestartTransition("COMPLETED", "OFFERED")).toBe(true);
  });

  it("forward moves and pre-start shuffles are not restarts", () => {
    expect(isRestartTransition("ASSIGNED", "IN_PROGRESS")).toBe(false);
    expect(isRestartTransition("ASSIGNED", "UNASSIGNED")).toBe(false);
    expect(isRestartTransition("IN_PROGRESS", "SUBMITTED")).toBe(false);
    expect(isRestartTransition(null, "ASSIGNED")).toBe(false);
  });
});

describe("startArtifactResetFields", () => {
  it("clears the job-level 'someone started this' scalars", () => {
    const fields = startArtifactResetFields() as Record<string, unknown>;
    for (const key of [
      "gpsCheckInAt",
      "gpsCheckInLat",
      "gpsCheckInLng",
      "gpsDistanceMeters",
      "arrivedAt",
      "departedAt",
      "drivingPausedAt",
      "enRouteStartedAt",
      "enRouteEtaMinutes",
      "clockedOutEarlyAt",
    ]) {
      expect(fields[key]).toBeNull();
    }
    expect(fields.gpsCheckInConfirmed).toBe(false);
    expect(fields.formPendingAfterClockOut).toBe(false);
  });

  it("never touches time logs, assignments, forms or pay", () => {
    const fields = startArtifactResetFields() as Record<string, unknown>;
    for (const key of ["actualHours", "payrollRunId", "cleanerPaidAt", "completedAt", "status"]) {
      expect(fields).not.toHaveProperty(key);
    }
  });
});

describe("planJobReset — the safe default", () => {
  const plan = planJobReset(DEFAULT_JOB_RESET_OPTIONS, richJob);

  it("targets ASSIGNED and only resets status + start artifacts", () => {
    expect(plan.allowed).toBe(true);
    expect(plan.targetStatus).toBe("ASSIGNED");
    expect(keys(plan)).toEqual(["status", "startArtifacts"]);
  });

  it("is non-destructive, needs no extra confirm, and notifies nobody", () => {
    expect(plan.destructive).toBe(false);
    expect(plan.requiresExtraConfirm).toBe(false);
    expect(plan.notifyCleaners).toBe(false);
  });
});

describe("planJobReset — opt-in extras", () => {
  it("each flag adds exactly its own mutation", () => {
    expect(keys(planJobReset({ ...DEFAULT_JOB_RESET_OPTIONS, clearTimeLogs: true }, richJob))).toContain(
      "timeLogs"
    );
    expect(keys(planJobReset({ ...DEFAULT_JOB_RESET_OPTIONS, clearFormData: true }, richJob))).toContain(
      "formData"
    );
    expect(
      keys(planJobReset({ ...DEFAULT_JOB_RESET_OPTIONS, unassignCleaners: true }, richJob))
    ).toContain("assignments");
    expect(keys(planJobReset({ ...DEFAULT_JOB_RESET_OPTIONS, resetLaundry: true }, richJob))).toContain(
      "laundry"
    );
  });

  it("drops options with nothing to act on (no QA data, no laundry task)", () => {
    const plan = planJobReset(
      { ...DEFAULT_JOB_RESET_OPTIONS, clearQa: true, resetLaundry: true },
      { ...richJob, qaReviewCount: 0, hasLaundryTask: false }
    );
    expect(keys(plan)).toEqual(["status", "startArtifacts"]);
    expect(plan.destructive).toBe(false);
  });

  it("QA clearing plans when reviews exist", () => {
    const plan = planJobReset({ ...DEFAULT_JOB_RESET_OPTIONS, clearQa: true }, { ...richJob, qaReviewCount: 2 });
    expect(keys(plan)).toContain("qa");
    expect(plan.destructive).toBe(true);
  });

  it("notifies cleaners only when their own records are cleared", () => {
    expect(planJobReset({ ...DEFAULT_JOB_RESET_OPTIONS, clearTimeLogs: true }, richJob).notifyCleaners).toBe(true);
    expect(planJobReset({ ...DEFAULT_JOB_RESET_OPTIONS, clearFormData: true }, richJob).notifyCleaners).toBe(true);
    expect(planJobReset({ ...DEFAULT_JOB_RESET_OPTIONS, unassignCleaners: true }, richJob).notifyCleaners).toBe(
      false
    );
  });

  it("summary lines are human-readable and count the real records", () => {
    const plan = planJobReset({ ...DEFAULT_JOB_RESET_OPTIONS, clearTimeLogs: true, clearFormData: true }, richJob);
    expect(plan.summary.join(" ")).toContain("3 clock records");
    expect(plan.summary.join(" ")).toContain("12 photos");
  });
});

describe("planJobReset — guards", () => {
  const invoiced: JobResetContext = { ...richJob, status: "INVOICED" };

  it("refuses to clear data on an INVOICED job", () => {
    const plan = planJobReset({ ...DEFAULT_JOB_RESET_OPTIONS, clearTimeLogs: true }, invoiced);
    expect(plan.allowed).toBe(false);
    expect(plan.blockedReason).toMatch(/invoiced/i);
  });

  it("still allows a status-only reset on an INVOICED job, behind an extra confirm", () => {
    const plan = planJobReset(DEFAULT_JOB_RESET_OPTIONS, invoiced);
    expect(plan.allowed).toBe(true);
    expect(plan.requiresExtraConfirm).toBe(true);
  });

  it("refuses to clear data once cleaner pay is committed to a payroll run", () => {
    const plan = planJobReset(
      { ...DEFAULT_JOB_RESET_OPTIONS, clearFormData: true },
      { ...richJob, status: "COMPLETED", payrollRunId: "run_1" }
    );
    expect(plan.allowed).toBe(false);
    expect(plan.blockedReason).toMatch(/payroll|paid/i);
  });

  it("refuses when a cleaner invoice covering the job was paid", () => {
    const plan = planJobReset(
      { ...DEFAULT_JOB_RESET_OPTIONS, unassignCleaners: true },
      { ...richJob, status: "COMPLETED", cleanerPaidAt: new Date().toISOString() }
    );
    expect(plan.allowed).toBe(false);
  });

  it("a ticked-but-empty destructive option still trips the lock (no sneaking past)", () => {
    const plan = planJobReset(
      { ...DEFAULT_JOB_RESET_OPTIONS, clearTimeLogs: true },
      { ...invoiced, timeLogCount: 0 }
    );
    expect(plan.allowed).toBe(false);
  });

  it("COMPLETED + destructive requires the extra confirm but is allowed", () => {
    const plan = planJobReset(
      { ...DEFAULT_JOB_RESET_OPTIONS, clearTimeLogs: true },
      { ...richJob, status: "COMPLETED" }
    );
    expect(plan.allowed).toBe(true);
    expect(plan.requiresExtraConfirm).toBe(true);
    expect(plan.destructive).toBe(true);
  });
});

describe("normalizeJobResetOptions", () => {
  it("defaults to the safe status-only reset for junk input", () => {
    expect(normalizeJobResetOptions(undefined)).toEqual(DEFAULT_JOB_RESET_OPTIONS);
    expect(normalizeJobResetOptions({ targetStatus: "COMPLETED" }).targetStatus).toBe("ASSIGNED");
  });

  it("only accepts strict booleans and known target statuses", () => {
    expect(
      normalizeJobResetOptions({ targetStatus: "UNASSIGNED", clearTimeLogs: "yes", clearFormData: true })
    ).toEqual({
      targetStatus: "UNASSIGNED",
      clearTimeLogs: false,
      clearFormData: true,
      unassignCleaners: false,
      clearQa: false,
      resetLaundry: false,
    });
  });
});
