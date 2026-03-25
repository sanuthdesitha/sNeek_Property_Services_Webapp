import { addMinutes, endOfDay } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { AppSettings } from "@/lib/settings";

export type ClockLimitSource =
  | "ESTIMATED_HOURS"
  | "MAX_JOB_LENGTH"
  | "DUE_TIME"
  | "END_TIME"
  | "MIDNIGHT";

export interface ClockRuleJobInput {
  scheduledDate: Date;
  dueTime?: string | null;
  endTime?: string | null;
  estimatedHours?: number | null;
}

export interface ClockRuleResult {
  cutoffAt: Date | null;
  source: ClockLimitSource | null;
  allowedDurationMinutes: number | null;
}

function localCutoffUtc(scheduledDate: Date, timeValue: string, timezone: string) {
  const scheduledLocal = toZonedTime(scheduledDate, timezone);
  const datePart = scheduledLocal.toISOString().slice(0, 10);
  return fromZonedTime(`${datePart}T${timeValue}:00`, timezone);
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

export function resolveClockRuleForLog(params: {
  job: ClockRuleJobInput;
  startedAt: Date;
  settings: AppSettings;
  completedDurationMinutes?: number;
}) : ClockRuleResult {
  const { job, startedAt, settings } = params;
  const completedDurationMinutes = Math.max(0, params.completedDurationMinutes ?? 0);
  const timezone = settings.timezone || "Australia/Sydney";
  const candidates: Array<{ at: Date; source: ClockLimitSource }> = [];

  if (typeof job.estimatedHours === "number" && Number.isFinite(job.estimatedHours) && job.estimatedHours > 0) {
    const totalAllowedMinutes = Math.max(0, Math.round(job.estimatedHours * 60) - completedDurationMinutes);
    candidates.push({
      at: addMinutes(startedAt, totalAllowedMinutes),
      source: "ESTIMATED_HOURS",
    });
  } else if (
    typeof settings.autoClockOut.maxJobLengthHours === "number" &&
    Number.isFinite(settings.autoClockOut.maxJobLengthHours) &&
    settings.autoClockOut.maxJobLengthHours > 0
  ) {
    const totalAllowedMinutes = Math.max(
      0,
      Math.round(settings.autoClockOut.maxJobLengthHours * 60) - completedDurationMinutes
    );
    candidates.push({
      at: addMinutes(startedAt, totalAllowedMinutes),
      source: "MAX_JOB_LENGTH",
    });
  }

  if (job.dueTime) {
    candidates.push({
      at: addMinutes(localCutoffUtc(job.scheduledDate, job.dueTime, timezone), settings.autoClockOut.graceMinutes),
      source: "DUE_TIME",
    });
  } else if (job.endTime) {
    candidates.push({
      at: addMinutes(localCutoffUtc(job.scheduledDate, job.endTime, timezone), settings.autoClockOut.graceMinutes),
      source: "END_TIME",
    });
  } else if (settings.autoClockOut.fallbackAtMidnight) {
    candidates.push({
      at: fromZonedTime(endOfDay(toZonedTime(job.scheduledDate, timezone)), timezone),
      source: "MIDNIGHT",
    });
  }

  if (candidates.length === 0) {
    return {
      cutoffAt: null,
      source: null,
      allowedDurationMinutes: null,
    };
  }

  const winner = candidates.sort((left, right) => left.at.getTime() - right.at.getTime())[0];
  const effectiveCutoffAt =
    winner.at.getTime() < startedAt.getTime() ? startedAt : winner.at;
  return {
    cutoffAt: effectiveCutoffAt,
    source: winner.source,
    allowedDurationMinutes: minutesBetween(startedAt, effectiveCutoffAt),
  };
}

export function buildClockReview(params: {
  job: ClockRuleJobInput;
  startedAt: Date;
  completedDurationMinutes: number;
  settings: AppSettings;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const rule = resolveClockRuleForLog({
    job: params.job,
    startedAt: params.startedAt,
    settings: params.settings,
  });
  const runningDurationMinutes = minutesBetween(params.startedAt, now);
  const cappedRunningDurationMinutes =
    rule.allowedDurationMinutes != null
      ? Math.min(runningDurationMinutes, rule.allowedDurationMinutes)
      : runningDurationMinutes;

  return {
    ...rule,
    runningDurationMinutes,
    cappedRunningDurationMinutes,
    currentTotalDurationMinutes: params.completedDurationMinutes + runningDurationMinutes,
    cappedTotalDurationMinutes: params.completedDurationMinutes + cappedRunningDurationMinutes,
    suggestedStoppedAt:
      rule.cutoffAt && now.getTime() > rule.cutoffAt.getTime() ? rule.cutoffAt : now,
    exceedsAllowedDuration:
      rule.allowedDurationMinutes != null && runningDurationMinutes > rule.allowedDurationMinutes,
  };
}
