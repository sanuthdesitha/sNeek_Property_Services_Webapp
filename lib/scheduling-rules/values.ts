/**
 * The EDITABLE scheduling rule values: their names, types, bounds and where
 * each one is stored. Plain module (no "use client", no server imports).
 *
 * Two kinds of editable value:
 *  - "code"    was hard-coded; version 1 takes the original literal from
 *              ./constants.ts. The engine reads the published value through
 *              the rule book (./book.ts).
 *  - "setting" was already an AppSettings field; version 1 takes the LIVE
 *              stored value. The published value is mirrored into that field
 *              when the version becomes live, so every existing reader keeps
 *              reading the same place. Only the rule service may write it.
 *
 * Bounds for "setting" values are exactly the clamps of the existing
 * sanitizers in lib/settings.ts, so a published value always survives them.
 */
import { z } from "zod";
import * as C from "./constants";

export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type RuleValueType = "integer" | "boolean" | "time";

export type EditableRuleSpec = {
  type: RuleValueType;
  min?: number;
  max?: number;
  unit?: string;
  storage: { kind: "code" } | { kind: "setting"; path: readonly [string, string] };
};

export const EDITABLE_RULE_SPECS = {
  // Laundry planner — hard-coded until now.
  "laundry.pickupOffsetDays": { type: "integer", min: 1, max: 3, unit: "days", storage: { kind: "code" } },
  "laundry.minTurnaroundDays": { type: "integer", min: 1, max: 3, unit: "days", storage: { kind: "code" } },
  "laundry.backToBackMaxGapDays": { type: "integer", min: 0, max: 7, unit: "days", storage: { kind: "code" } },
  "laundry.microCycleMaxGapDays": { type: "integer", min: 1, max: 14, unit: "days", storage: { kind: "code" } },
  "laundry.bufferFlagAtOrBelowSets": { type: "integer", min: 0, max: 5, unit: "sets", storage: { kind: "code" } },
  "laundry.keyLostServiceTime": { type: "time", storage: { kind: "code" } },
  "laundry.keyLostLateCheckoutTime": { type: "time", storage: { kind: "code" } },
  "laundry.defaultCleanStartTime": { type: "time", storage: { kind: "code" } },
  "laundry.pickedUpStaleHours": { type: "integer", min: 1, max: 168, unit: "hours", storage: { kind: "code" } },
  // Laundry — already settings.
  "laundry.maxOutdoorDays": { type: "integer", min: 1, max: 14, unit: "days", storage: { kind: "setting", path: ["laundryOperations", "maxOutdoorDays"] } },
  "laundry.fastReturnWhenNoNextClean": { type: "boolean", storage: { kind: "setting", path: ["laundryOperations", "fastReturnWhenNoNextClean"] } },
  "laundry.fastReturnDaysWhenNoNextClean": { type: "integer", min: 1, max: 7, unit: "days", storage: { kind: "setting", path: ["laundryOperations", "fastReturnDaysWhenNoNextClean"] } },
  "laundry.pickupCutoffTime": { type: "time", storage: { kind: "setting", path: ["laundryOperations", "pickupCutoffTime"] } },
  "laundry.defaultPickupTime": { type: "time", storage: { kind: "setting", path: ["laundryOperations", "defaultPickupTime"] } },
  "laundry.defaultDropoffTime": { type: "time", storage: { kind: "setting", path: ["laundryOperations", "defaultDropoffTime"] } },
  "laundry.autoApproveSyncDrafts": { type: "boolean", storage: { kind: "setting", path: ["scheduledNotifications", "autoApproveLaundrySyncDrafts"] } },
  "laundry.syncNotificationHorizonDays": { type: "integer", min: 1, max: 120, unit: "days", storage: { kind: "setting", path: ["scheduledNotifications", "laundrySyncNotificationHorizonDays"] } },
  // Jobs — hard-coded until now.
  "jobs.turnoverReadyByTime": { type: "time", storage: { kind: "code" } },
  "jobs.autoPauseAfterHours": { type: "integer", min: 2, max: 168, unit: "hours", storage: { kind: "code" } },
  "jobs.staleEnRouteHours": { type: "integer", min: 1, max: 48, unit: "hours", storage: { kind: "code" } },
  "jobs.dayReminderUnlockHour": { type: "integer", min: 0, max: 23, unit: "hour", storage: { kind: "code" } },
  "jobs.dayReminderLeadHours": { type: "integer", min: 0, max: 12, unit: "hours", storage: { kind: "code" } },
  // Jobs — already settings.
  "jobs.recurringEnabled": { type: "boolean", storage: { kind: "setting", path: ["recurringJobs", "enabled"] } },
  "jobs.recurringLookaheadDays": { type: "integer", min: 1, max: 60, unit: "days", storage: { kind: "setting", path: ["recurringJobs", "lookaheadDays"] } },
  "jobs.autoAssignEnabled": { type: "boolean", storage: { kind: "setting", path: ["autoAssign", "enabled"] } },
  "jobs.autoAssignMaxDailyJobs": { type: "integer", min: 1, max: 20, unit: "jobs", storage: { kind: "setting", path: ["autoAssign", "maxDailyJobsPerCleaner"] } },
  "jobs.autoAssignWeightSuburbHistory": { type: "integer", min: 0, max: 100, unit: "%", storage: { kind: "setting", path: ["autoAssign", "weightSuburbHistory"] } },
  "jobs.autoAssignWeightQaScore": { type: "integer", min: 0, max: 100, unit: "%", storage: { kind: "setting", path: ["autoAssign", "weightQaScore"] } },
  "jobs.autoAssignWeightCurrentLoad": { type: "integer", min: 0, max: 100, unit: "%", storage: { kind: "setting", path: ["autoAssign", "weightCurrentLoad"] } },
  "jobs.routeEnabled": { type: "boolean", storage: { kind: "setting", path: ["routeOptimization", "enabled"] } },
  "jobs.routeGroupBySuburb": { type: "boolean", storage: { kind: "setting", path: ["routeOptimization", "groupBySuburb"] } },
  "jobs.routeMaxStopsPerRun": { type: "integer", min: 1, max: 30, unit: "stops", storage: { kind: "setting", path: ["routeOptimization", "maxStopsPerRun"] } },
  "jobs.autoClockOutEnabled": { type: "boolean", storage: { kind: "setting", path: ["autoClockOut", "enabled"] } },
  "jobs.autoClockOutStopAtEstimate": { type: "boolean", storage: { kind: "setting", path: ["autoClockOut", "stopAtEstimatedDuration"] } },
  "jobs.autoClockOutGraceMinutes": { type: "integer", min: 0, max: 240, unit: "minutes", storage: { kind: "setting", path: ["autoClockOut", "graceMinutes"] } },
  "jobs.autoClockOutFallbackAtMidnight": { type: "boolean", storage: { kind: "setting", path: ["autoClockOut", "fallbackAtMidnight"] } },
  "jobs.autoClockOutMaxJobLengthHours": { type: "integer", min: 1, max: 24, unit: "hours", storage: { kind: "setting", path: ["autoClockOut", "maxJobLengthHours"] } },
  "jobs.autoClockOutGeofenceExit": { type: "boolean", storage: { kind: "setting", path: ["autoClockOut", "geofenceExit"] } },
  "jobs.qaFailureThreshold": { type: "integer", min: 0, max: 100, unit: "score", storage: { kind: "setting", path: ["qaAutomation", "failureThreshold"] } },
  "jobs.qaOfferReworkOnFail": { type: "boolean", storage: { kind: "setting", path: ["qaAutomation", "autoCreateReworkJob"] } },
  "jobs.qaReworkDelayHours": { type: "integer", min: 1, max: 168, unit: "hours", storage: { kind: "setting", path: ["qaAutomation", "reworkDelayHours"] } },
  "jobs.qaAutoScoreEnabled": { type: "boolean", storage: { kind: "setting", path: ["qaAutomation", "autoScoreEnabled"] } },
  "jobs.qaAutoScoreAfterHours": { type: "integer", min: 1, max: 720, unit: "hours", storage: { kind: "setting", path: ["qaAutomation", "autoScoreAfterHours"] } },
  "jobs.reminderDayBeforeEnabled": { type: "boolean", storage: { kind: "setting", path: ["scheduledNotifications", "reminder24hEnabled"] } },
  "jobs.reminderTwoHourEnabled": { type: "boolean", storage: { kind: "setting", path: ["scheduledNotifications", "reminder2hEnabled"] } },
} as const satisfies Record<string, EditableRuleSpec>;

export type EditableRuleKey = keyof typeof EDITABLE_RULE_SPECS;
export const EDITABLE_RULE_KEYS = Object.keys(EDITABLE_RULE_SPECS) as EditableRuleKey[];

type ValueOf<S> = S extends { type: "boolean" } ? boolean : S extends { type: "time" } ? string : number;
export type SchedulingRuleValues = { [K in EditableRuleKey]: ValueOf<(typeof EDITABLE_RULE_SPECS)[K]> };

export type CodeRuleKey = { [K in EditableRuleKey]: (typeof EDITABLE_RULE_SPECS)[K]["storage"]["kind"] extends "code" ? K : never }[EditableRuleKey];
export type SettingRuleKey = Exclude<EditableRuleKey, CodeRuleKey>;

export const SETTING_RULE_KEYS = EDITABLE_RULE_KEYS.filter((key) => EDITABLE_RULE_SPECS[key].storage.kind === "setting") as SettingRuleKey[];
export const CODE_RULE_KEYS = EDITABLE_RULE_KEYS.filter((key) => EDITABLE_RULE_SPECS[key].storage.kind === "code") as CodeRuleKey[];

/** The original literals of the rules that were hard-coded (version 1 of them). */
export const ORIGINAL_CODE_VALUES: Pick<SchedulingRuleValues, CodeRuleKey> = {
  "laundry.pickupOffsetDays": C.LAUNDRY_PICKUP_OFFSET_DAYS,
  "laundry.minTurnaroundDays": C.LAUNDRY_MIN_TURNAROUND_DAYS,
  "laundry.backToBackMaxGapDays": C.LAUNDRY_BACK_TO_BACK_MAX_GAP_DAYS,
  "laundry.microCycleMaxGapDays": C.LAUNDRY_MICRO_CYCLE_MAX_GAP_DAYS,
  "laundry.bufferFlagAtOrBelowSets": C.LAUNDRY_BUFFER_FLAG_AT_OR_BELOW_SETS,
  "laundry.keyLostServiceTime": C.LAUNDRY_DEFAULT_CLEAN_START,
  "laundry.keyLostLateCheckoutTime": C.LAUNDRY_KEY_LOST_LATE_CHECKOUT_TIME,
  "laundry.defaultCleanStartTime": C.LAUNDRY_DEFAULT_CLEAN_START,
  "laundry.pickedUpStaleHours": C.LAUNDRY_PICKED_UP_STALE_HOURS,
  "jobs.turnoverReadyByTime": C.TURNOVER_READY_BY_TIME,
  "jobs.autoPauseAfterHours": C.AUTO_PAUSE_AFTER_HOURS,
  "jobs.staleEnRouteHours": C.STALE_EN_ROUTE_HOURS,
  "jobs.dayReminderUnlockHour": C.DAY_REMINDER_UNLOCK_HOUR,
  "jobs.dayReminderLeadHours": C.DAY_REMINDER_LEAD_HOURS,
};

/**
 * What lib/settings.ts sanitizeSettings uses when the stored settings row has
 * no value for a field (its DEFAULT_SETTINGS). Only consulted for a field the
 * settings object does not carry at all — i.e. exactly where the live engine
 * already runs on this default. tests/lib/scheduling-rules-parity.test.ts pins
 * it to DEFAULT_SETTINGS so the two can never drift.
 */
export const SETTINGS_FIELD_DEFAULTS: Pick<SchedulingRuleValues, SettingRuleKey> = {
  "laundry.maxOutdoorDays": 3,
  "laundry.fastReturnWhenNoNextClean": true,
  "laundry.fastReturnDaysWhenNoNextClean": 1,
  "laundry.pickupCutoffTime": "10:00",
  "laundry.defaultPickupTime": "09:00",
  "laundry.defaultDropoffTime": "16:00",
  "laundry.autoApproveSyncDrafts": false,
  "laundry.syncNotificationHorizonDays": 30,
  "jobs.recurringEnabled": true,
  "jobs.recurringLookaheadDays": 14,
  "jobs.autoAssignEnabled": true,
  "jobs.autoAssignMaxDailyJobs": 4,
  "jobs.autoAssignWeightSuburbHistory": 40,
  "jobs.autoAssignWeightQaScore": 35,
  "jobs.autoAssignWeightCurrentLoad": 25,
  "jobs.routeEnabled": true,
  "jobs.routeGroupBySuburb": true,
  "jobs.routeMaxStopsPerRun": 12,
  "jobs.autoClockOutEnabled": true,
  "jobs.autoClockOutStopAtEstimate": false,
  "jobs.autoClockOutGraceMinutes": 30,
  "jobs.autoClockOutFallbackAtMidnight": true,
  "jobs.autoClockOutMaxJobLengthHours": 8,
  "jobs.autoClockOutGeofenceExit": true,
  "jobs.qaFailureThreshold": 80,
  "jobs.qaOfferReworkOnFail": true,
  "jobs.qaReworkDelayHours": 24,
  "jobs.qaAutoScoreEnabled": true,
  "jobs.qaAutoScoreAfterHours": 24,
  "jobs.reminderDayBeforeEnabled": true,
  "jobs.reminderTwoHourEnabled": true,
};

function valueSchema(spec: EditableRuleSpec) {
  if (spec.type === "boolean") return z.boolean();
  if (spec.type === "time") return z.string().regex(CLOCK_TIME_PATTERN, "Use a 24-hour time such as 10:00.");
  return z.number().int().min(spec.min ?? Number.MIN_SAFE_INTEGER).max(spec.max ?? Number.MAX_SAFE_INTEGER);
}

const shape = Object.fromEntries(EDITABLE_RULE_KEYS.map((key) => [key, valueSchema(EDITABLE_RULE_SPECS[key])])) as Record<EditableRuleKey, z.ZodTypeAny>;

/**
 * The full value set: every key present, every value in bounds, plus the
 * cross-rule checks. `.strict()` so a backup file or stored row with an
 * unknown key is refused rather than half-read.
 */
export const schedulingRuleValuesSchema = z
  .object(shape)
  .strict()
  .superRefine((value, ctx) => {
    if (value["laundry.microCycleMaxGapDays"] < value["laundry.backToBackMaxGapDays"]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["laundry.microCycleMaxGapDays"], message: "The micro-cycle limit cannot be below the back-to-back limit." });
    }
  });

export type RuleValidation = { ok: true; values: SchedulingRuleValues } | { ok: false; problems: string[] };

export function validateRuleValues(input: unknown): RuleValidation {
  const parsed = schedulingRuleValuesSchema.safeParse(input);
  if (parsed.success) return { ok: true, values: parsed.data as SchedulingRuleValues };
  return { ok: false, problems: parsed.error.issues.map((issue) => `${issue.path.join(".") || "values"}: ${issue.message}`) };
}

/** Stable JSON: keys in registry order, so checksums and diffs never depend on insertion order. */
export function canonicalRuleValues(values: SchedulingRuleValues): Record<EditableRuleKey, number | boolean | string> {
  const out = {} as Record<EditableRuleKey, number | boolean | string>;
  for (const key of EDITABLE_RULE_KEYS) out[key] = values[key];
  return out;
}

export type RuleChange = { key: EditableRuleKey; from: number | boolean | string; to: number | boolean | string };

export function diffRuleValues(from: SchedulingRuleValues, to: SchedulingRuleValues): RuleChange[] {
  return EDITABLE_RULE_KEYS.filter((key) => from[key] !== to[key]).map((key) => ({ key, from: from[key], to: to[key] }));
}

/** Read one AppSettings-like object's value for a setting-backed rule (undefined when absent). */
export function readSettingPath(settings: unknown, path: readonly [string, string]): unknown {
  if (!settings || typeof settings !== "object") return undefined;
  const group = (settings as Record<string, unknown>)[path[0]];
  if (!group || typeof group !== "object") return undefined;
  return (group as Record<string, unknown>)[path[1]];
}

/** The planner's view of the laundry rules (lib/laundry/planner.ts computeDraftItem). */
export type LaundryPlanningRules = {
  pickupOffsetDays: number;
  minTurnaroundDays: number;
  backToBackMaxGapDays: number;
  microCycleMaxGapDays: number;
  bufferFlagAtOrBelowSets: number;
  keyLostServiceTime: string;
  keyLostLateCheckoutTime: string;
};

export const ORIGINAL_LAUNDRY_PLANNING: LaundryPlanningRules = {
  pickupOffsetDays: C.LAUNDRY_PICKUP_OFFSET_DAYS,
  minTurnaroundDays: C.LAUNDRY_MIN_TURNAROUND_DAYS,
  backToBackMaxGapDays: C.LAUNDRY_BACK_TO_BACK_MAX_GAP_DAYS,
  microCycleMaxGapDays: C.LAUNDRY_MICRO_CYCLE_MAX_GAP_DAYS,
  bufferFlagAtOrBelowSets: C.LAUNDRY_BUFFER_FLAG_AT_OR_BELOW_SETS,
  keyLostServiceTime: C.LAUNDRY_DEFAULT_CLEAN_START,
  keyLostLateCheckoutTime: C.LAUNDRY_KEY_LOST_LATE_CHECKOUT_TIME,
};

export function laundryPlanningFrom(values: SchedulingRuleValues): LaundryPlanningRules {
  return {
    pickupOffsetDays: values["laundry.pickupOffsetDays"],
    minTurnaroundDays: values["laundry.minTurnaroundDays"],
    backToBackMaxGapDays: values["laundry.backToBackMaxGapDays"],
    microCycleMaxGapDays: values["laundry.microCycleMaxGapDays"],
    bufferFlagAtOrBelowSets: values["laundry.bufferFlagAtOrBelowSets"],
    keyLostServiceTime: values["laundry.keyLostServiceTime"],
    keyLostLateCheckoutTime: values["laundry.keyLostLateCheckoutTime"],
  };
}

/** The planner's laundry operations (the same shape LaundryOperationsSettings has). */
export function laundryOperationsFrom(values: SchedulingRuleValues) {
  return {
    pickupCutoffTime: values["laundry.pickupCutoffTime"],
    defaultPickupTime: values["laundry.defaultPickupTime"],
    defaultDropoffTime: values["laundry.defaultDropoffTime"],
    maxOutdoorDays: values["laundry.maxOutdoorDays"],
    fastReturnWhenNoNextClean: values["laundry.fastReturnWhenNoNextClean"],
    fastReturnDaysWhenNoNextClean: values["laundry.fastReturnDaysWhenNoNextClean"],
  };
}

/** Run-time thresholds the worker passes to the sweeps and reminders. */
export type RunTimeRules = {
  autoPauseAfterHours: number;
  staleEnRouteHours: number;
  dayReminderUnlockHour: number;
  dayReminderLeadHours: number;
  laundryPickedUpStaleHours: number;
};

export const ORIGINAL_RUN_TIME_RULES: RunTimeRules = {
  autoPauseAfterHours: C.AUTO_PAUSE_AFTER_HOURS,
  staleEnRouteHours: C.STALE_EN_ROUTE_HOURS,
  dayReminderUnlockHour: C.DAY_REMINDER_UNLOCK_HOUR,
  dayReminderLeadHours: C.DAY_REMINDER_LEAD_HOURS,
  laundryPickedUpStaleHours: C.LAUNDRY_PICKED_UP_STALE_HOURS,
};

export function runTimeRulesFrom(values: SchedulingRuleValues): RunTimeRules {
  return {
    autoPauseAfterHours: values["jobs.autoPauseAfterHours"],
    staleEnRouteHours: values["jobs.staleEnRouteHours"],
    dayReminderUnlockHour: values["jobs.dayReminderUnlockHour"],
    dayReminderLeadHours: values["jobs.dayReminderLeadHours"],
    laundryPickedUpStaleHours: values["laundry.pickedUpStaleHours"],
  };
}
