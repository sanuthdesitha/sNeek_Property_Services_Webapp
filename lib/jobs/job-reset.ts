/**
 * Job reset planning — the single source of truth for "what does resetting this
 * job actually touch?".
 *
 * Both the admin confirm dialog (preview) and the server endpoint (execution)
 * call `planJobReset`, so what the admin is shown before confirming is exactly
 * what runs. Keep this module pure (no Prisma, no I/O) — it is unit tested.
 *
 * Two separate concerns live here:
 *
 *  1. `startArtifactResetFields()` — the job-level "someone started this" scalars.
 *     These MUST be cleared whenever a started job is moved back to a
 *     pre-start status, because they are job-global while the cleaner start gate
 *     is per-cleaner. Leaving them behind is what made a reassigned job
 *     unstartable for the new cleaner (see lib/cleaner/team-state.ts).
 *  2. `planJobReset()` — the option-driven admin reset (status only by default,
 *     with opt-in destructive extras).
 */

/** Statuses a reset may land the job on. */
export const JOB_RESET_TARGET_STATUSES = ["ASSIGNED", "OFFERED", "UNASSIGNED"] as const;
export type JobResetTargetStatus = (typeof JOB_RESET_TARGET_STATUSES)[number];

/** Statuses that mean work had already begun (or finished) on the job. */
export const STARTED_JOB_STATUSES = [
  "EN_ROUTE",
  "IN_PROGRESS",
  "PAUSED",
  "WAITING_CONTINUATION_APPROVAL",
  "SUBMITTED",
  "QA_REVIEW",
  "COMPLETED",
  "INVOICED",
] as const;

/** Pre-start statuses — nothing has been started once a job is back here. */
export const PRE_START_JOB_STATUSES = ["UNASSIGNED", "OFFERED", "ASSIGNED"] as const;

/**
 * True when moving `from` → `to` is a "restart" — a job that had been started
 * (or finished) going back to a pre-start status. Every such transition has to
 * clear the job-level start artifacts.
 */
export function isRestartTransition(from: string | null | undefined, to: string | null | undefined): boolean {
  const fromStatus = String(from ?? "");
  const toStatus = String(to ?? "");
  if (!(STARTED_JOB_STATUSES as readonly string[]).includes(fromStatus)) return false;
  return (PRE_START_JOB_STATUSES as readonly string[]).includes(toStatus);
}

/**
 * The job-scalar patch that erases "this job was started" — GPS check-in/out,
 * arrival/departure, and the whole en-route/driving block. Deliberately does NOT
 * touch time logs, submissions, assignments or pay: those are opt-in.
 */
export function startArtifactResetFields() {
  return {
    // Arrival evidence (immutable during a clean, cleared only on a restart).
    gpsCheckInAt: null,
    gpsCheckInLat: null,
    gpsCheckInLng: null,
    gpsDistanceMeters: null,
    gpsCheckInAccuracyM: null,
    gpsCheckInConfirmed: false,
    gpsCheckInAdjusted: false,
    gpsCheckInNote: null,
    gpsCheckOutAt: null,
    gpsCheckOutLat: null,
    gpsCheckOutLng: null,
    // Presence.
    arrivedAt: null,
    departedAt: null,
    safetyCheckinAt: null,
    // En-route / driving.
    enRouteStartedAt: null,
    enRouteEtaMinutes: null,
    enRouteEtaUpdatedAt: null,
    drivingPausedAt: null,
    drivingPauseReason: null,
    drivingDelayedAt: null,
    drivingDelayedReason: null,
    lastEtaNotificationAt: null,
    lastEtaNotifiedMinutes: null,
    lastDelayedNotificationAt: null,
    // Early clock-out parking.
    formPendingAfterClockOut: false,
    clockedOutEarlyAt: null,
  } as const;
}

/** Option flags the admin ticks in the reset dialog. */
export interface JobResetOptions {
  /** Where the job lands. Defaults to ASSIGNED (keeps the crew on the job). */
  targetStatus: JobResetTargetStatus;
  /** Delete every clock record on the job. */
  clearTimeLogs: boolean;
  /** Delete the submitted form/checklist, its photos and stock movements. */
  clearFormData: boolean;
  /** Remove every cleaner from the job. */
  unassignCleaners: boolean;
  /** Delete QA reviews / assignments for the job. */
  clearQa: boolean;
  /** Put the laundry task back to PENDING. */
  resetLaundry: boolean;
}

export const DEFAULT_JOB_RESET_OPTIONS: JobResetOptions = {
  targetStatus: "ASSIGNED",
  clearTimeLogs: false,
  clearFormData: false,
  unassignCleaners: false,
  clearQa: false,
  resetLaundry: false,
};

/** What the job currently looks like — supplied by the server (and the dialog). */
export interface JobResetContext {
  status: string;
  /** Job.payrollRunId — cleaner pay committed to a payroll run. */
  payrollRunId?: string | null;
  /** Job.cleanerPaidAt — cleaner invoice covering this job was paid. */
  cleanerPaidAt?: string | Date | null;
  timeLogCount?: number;
  assigneeCount?: number;
  submissionCount?: number;
  photoCount?: number;
  qaReviewCount?: number;
  hasLaundryTask?: boolean;
  /** The job already has a client invoice line. */
  invoicedLineCount?: number;
}

export interface JobResetMutation {
  key:
    | "status"
    | "startArtifacts"
    | "timeLogs"
    | "formData"
    | "assignments"
    | "qa"
    | "laundry";
  /** One-line description of what will happen, shown in the dialog summary. */
  label: string;
  /** Irreversible data loss. */
  destructive: boolean;
}

export interface JobResetPlan {
  allowed: boolean;
  /** Present when `allowed` is false — why the reset is refused. */
  blockedReason?: string;
  /** The admin must type the confirm phrase / re-confirm before this runs. */
  requiresExtraConfirm: boolean;
  /** True when any option destroys data (drives the PIN requirement). */
  destructive: boolean;
  /** Affected cleaners should be told their records were cleared. */
  notifyCleaners: boolean;
  targetStatus: JobResetTargetStatus;
  mutations: JobResetMutation[];
  /** Flat, human-readable summary lines (dialog preview + audit log). */
  summary: string[];
}

function isPayCommitted(context: JobResetContext): boolean {
  return Boolean(context.payrollRunId) || Boolean(context.cleanerPaidAt);
}

/**
 * Turn the ticked options into the exact set of mutations, plus the guards.
 *
 * Guards:
 *  · INVOICED jobs, or jobs whose cleaner pay is already committed to a payroll
 *    run / paid invoice, may NEVER have their data cleared — the money is
 *    downstream of those records. The status-only reset is still allowed but
 *    demands an explicit extra confirmation.
 *  · COMPLETED jobs allow the destructive options but demand the extra confirm.
 */
export function planJobReset(options: JobResetOptions, context: JobResetContext): JobResetPlan {
  const status = String(context.status ?? "");
  const payCommitted = isPayCommitted(context);
  const locked = status === "INVOICED" || payCommitted;

  const wantsTimeLogs = options.clearTimeLogs && (context.timeLogCount ?? 0) > 0;
  const wantsFormData = options.clearFormData && (context.submissionCount ?? 0) > 0;
  const wantsUnassign = options.unassignCleaners && (context.assigneeCount ?? 0) > 0;
  const wantsQa = options.clearQa && (context.qaReviewCount ?? 0) > 0;
  const wantsLaundry = options.resetLaundry && context.hasLaundryTask === true;

  // Requested-but-inapplicable options are silently dropped above; the guard
  // below looks at what was REQUESTED so an admin can't sneak past by ticking a
  // box that happens to be empty right now.
  const anyDestructiveRequested =
    options.clearTimeLogs || options.clearFormData || options.unassignCleaners || options.clearQa;

  const mutations: JobResetMutation[] = [
    {
      key: "status",
      label: `Job status set to ${options.targetStatus.replace(/_/g, " ").toLowerCase()}`,
      destructive: false,
    },
    {
      key: "startArtifacts",
      label:
        "Start/progress markers cleared (GPS check-in + check-out, arrival, en-route and driving state) so the assigned cleaner gets a fresh start verification",
      destructive: false,
    },
  ];

  if (wantsTimeLogs) {
    mutations.push({
      key: "timeLogs",
      label: `Deletes ${context.timeLogCount} clock record${context.timeLogCount === 1 ? "" : "s"} — logged hours and the pay derived from them are lost`,
      destructive: true,
    });
  }
  if (wantsFormData) {
    const photos = context.photoCount ?? 0;
    mutations.push({
      key: "formData",
      label: `Deletes ${context.submissionCount} submitted form${context.submissionCount === 1 ? "" : "s"}${photos > 0 ? ` and ${photos} photo${photos === 1 ? "" : "s"}` : ""}, and reverses the stock used — the cleaner must refill the checklist`,
      destructive: true,
    });
  }
  if (wantsUnassign) {
    mutations.push({
      key: "assignments",
      label: `Removes ${context.assigneeCount} assigned cleaner${context.assigneeCount === 1 ? "" : "s"} — the job needs re-dispatching`,
      destructive: true,
    });
  }
  if (wantsQa) {
    mutations.push({
      key: "qa",
      label: `Deletes ${context.qaReviewCount} QA review${context.qaReviewCount === 1 ? "" : "s"} and reopens the QA assignment`,
      destructive: true,
    });
  }
  if (wantsLaundry) {
    mutations.push({
      key: "laundry",
      label: "Laundry task returns to Pending (pickup/drop-off timestamps and confirmations cleared)",
      destructive: true,
    });
  }

  const destructive = mutations.some((m) => m.destructive);

  if (locked && anyDestructiveRequested) {
    return {
      allowed: false,
      blockedReason:
        status === "INVOICED"
          ? "This job is invoiced — its time logs, forms, photos and QA are the evidence behind the invoice and cannot be cleared. Reset the status only, or reverse the invoice first."
          : "This job's cleaner pay is already committed to a payroll run or a paid invoice — its records cannot be cleared. Reset the status only.",
      requiresExtraConfirm: true,
      destructive,
      notifyCleaners: false,
      targetStatus: options.targetStatus,
      mutations,
      summary: mutations.map((m) => m.label),
    };
  }

  const requiresExtraConfirm = locked || (status === "COMPLETED" && destructive);

  return {
    allowed: true,
    requiresExtraConfirm,
    destructive,
    notifyCleaners: wantsTimeLogs || wantsFormData,
    targetStatus: options.targetStatus,
    mutations,
    summary: mutations.map((m) => m.label),
  };
}

/** Normalize a partial/untrusted option payload into a full option set. */
export function normalizeJobResetOptions(input: unknown): JobResetOptions {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const target = String(raw.targetStatus ?? "");
  return {
    targetStatus: (JOB_RESET_TARGET_STATUSES as readonly string[]).includes(target)
      ? (target as JobResetTargetStatus)
      : DEFAULT_JOB_RESET_OPTIONS.targetStatus,
    clearTimeLogs: raw.clearTimeLogs === true,
    clearFormData: raw.clearFormData === true,
    unassignCleaners: raw.unassignCleaners === true,
    clearQa: raw.clearQa === true,
    resetLaundry: raw.resetLaundry === true,
  };
}
