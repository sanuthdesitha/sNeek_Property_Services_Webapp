/**
 * THE ORIGINAL SCHEDULING VALUES (owner decision 2026-11-14: "do not change
 * any rules at all as they are exactly as I need").
 *
 * Every literal below was moved here, unchanged, from the module that used it
 * (named beside each). Those modules now import these names, so behaviour is
 * byte-identical; tests/lib/scheduling-rules-parity.test.ts pins every value.
 *
 * These are the values of version 1 ("Original (current behaviour)") for the
 * rules that were hard-coded. Rules that were already settings take their
 * version-1 value from the LIVE stored settings, never from code defaults.
 *
 * Plain module: no imports, no "use client". Server and client code may read it.
 */

// ── Laundry planner (lib/laundry/planner.ts computeDraftItem) ──────────────
/** Pickup is this many days after the clean. */
export const LAUNDRY_PICKUP_OFFSET_DAYS = 1;
/** The drop-off is never earlier than pickup + this many days (24h laundering minimum). */
export const LAUNDRY_MIN_TURNAROUND_DAYS = 1;
/** Gap to the next clean at or below this is "back-to-back". */
export const LAUNDRY_BACK_TO_BACK_MAX_GAP_DAYS = 1;
/** Gap to the next clean at or below this (and above back-to-back) is a "micro-cycle". */
export const LAUNDRY_MICRO_CYCLE_MAX_GAP_DAYS = 3;
/** Back-to-back with buffer linen sets at or below this is flagged "express or extra linen required". */
export const LAUNDRY_BUFFER_FLAG_AT_OR_BELOW_SETS = 0;
/** The drop-off is planned this many days before the next known clean. */
export const LAUNDRY_DROP_DAYS_BEFORE_NEXT_CLEAN = 1;

// ── Key-lost mode and clean start (lib/laundry/clean-start.ts) ─────────────
/** Clean start when nothing else is known, and the key-lost service time without a late checkout. */
export const LAUNDRY_DEFAULT_CLEAN_START = "10:00";
/** Key-lost service time when the job has a late-checkout rule. */
export const LAUNDRY_KEY_LOST_LATE_CHECKOUT_TIME = "12:30";

// ── Laundry reminders (lib/laundry/reminders.ts) ───────────────────────────
/** A run picked up longer than this is chased in the 15:00 driver nudge. */
export const LAUNDRY_PICKED_UP_STALE_HOURS = 24;
/** A run not delivered or skipped and untouched longer than this is an admin attention item. */
export const LAUNDRY_ADMIN_ATTENTION_STALE_HOURS = 48;
/** Cool-down between manual nudges / supplier chases (lib/laundry/nudge-rules.ts, supplier-chase-rules.ts). */
export const LAUNDRY_NUDGE_COOL_DOWN_MINUTES = 30;
/** Fallback run when ensureLaundryTaskForJob creates nothing (lib/laundry/cleaner-status.ts). */
export const LAUNDRY_CLEANER_FALLBACK_PICKUP_HOURS = 24;
export const LAUNDRY_CLEANER_FALLBACK_DROPOFF_HOURS = 48;

// ── Laundry route builder (lib/laundry/route-candidates.ts, route-plan.ts) ─
export const LAUNDRY_ROUTE_OVERDUE_CAP = 20;
export const LAUNDRY_ROUTE_ARRIVAL_RADIUS_M = 120;
export const LAUNDRY_ROUTE_NAIVE_SPEED_KMH = 35;
export const LAUNDRY_ROUTE_NAIVE_PER_STOP_MIN = 7;

// ── iCal turnovers (lib/ical/sync.ts, lib/jobs/turnover-readiness.ts, lib/jobs/priority.ts) ──
/** A turnover must be ready by this time at the latest (earlier when a check-in or early-check-in rule says so). */
export const TURNOVER_READY_BY_TIME = "15:00";
/** Same-day check-in at or before this time is priority 1. */
export const PRIORITY_EARLY_CHECKIN_TIME = "12:30";
/** Same-day check-in at or before this time (after the above) is priority 2. */
export const PRIORITY_SAME_DAY_CHECKIN_TIME = "15:00";
export const ICAL_FEED_TIMEOUT_MS = 15_000;
export const ICAL_SYNC_CONCURRENCY = 4;
export const ICAL_INTERRUPTED_RUN_AFTER_MS = 20 * 60_000;
export const ICAL_LEGACY_DUE_INTERVAL_MS = 40 * 60_000;
export const ICAL_TERMINAL_JOB_STATUSES = ["COMPLETED", "INVOICED", "CANCELLED"] as const;
export const ICAL_PRUNABLE_JOB_STATUSES = ["UNASSIGNED", "OFFERED", "ASSIGNED"] as const;

// ── Job sweeps and reminders (lib/ops/*) ───────────────────────────────────
/** IN_PROGRESS longer than this is auto-paused (lib/ops/auto-pause.ts). */
export const AUTO_PAUSE_AFTER_HOURS = 24;
export const AUTO_PAUSE_MAX_JOBS_PER_RUN = 50;
/** EN_ROUTE longer than this goes back to ASSIGNED (lib/ops/stale-en-route.ts). */
export const STALE_EN_ROUTE_HOURS = 6;
/** Sydney hour the day-of reminder unlocks (lib/ops/cleaner-day-reminders.ts). */
export const DAY_REMINDER_UNLOCK_HOUR = 6;
/** The day-of reminder also goes once the job is within this many hours. */
export const DAY_REMINDER_LEAD_HOURS = 2;
/** Time assumed for a job with no time when working out reminders. */
export const REMINDER_DEFAULT_JOB_TIME = "09:00";
/** Unfinished-job push de-duplication window (lib/ops/unfinished-reminders.ts). */
export const UNFINISHED_PUSH_DEDUP_HOURS = 20;
/** Client job-task requests auto-approve this long before the job (lib/job-tasks/service.ts). */
export const CLIENT_TASK_AUTO_APPROVE_LEAD_MINUTES = 60;
/** Missed clock-in grace and maximum backdate (lib/jobs/missed-clock-in.ts). */
export const MISSED_CLOCK_IN_GRACE_MINUTES = 12;
export const MISSED_CLOCK_IN_MAX_BACKDATE_HOURS = 10;

// ── Deep clean (lib/properties/deep-clean-planning.ts) ─────────────────────
/** A verified deep clean is due again this many calendar months later. */
export const DEEP_CLEAN_CADENCE_MONTHS = 3;

// ── Suggestions and dispatch (lib/ops/dispatch.ts) ─────────────────────────
export const DISPATCH_DEFAULT_QA_SCORE = 70;
export const DISPATCH_AVAILABLE_BONUS = 12;
export const DISPATCH_UNAVAILABLE_PENALTY = -25;
export const DISPATCH_SAME_SUBURB_TRAVEL_MIN = 8;
export const DISPATCH_OTHER_SUBURB_TRAVEL_MIN = 22;

// ── GPS departure (lib/gps/departure.ts) ───────────────────────────────────
export const DEPARTURE_CONFIRM_PINGS_VALUE = 3;
export const DEPARTURE_MIN_SPAN_MINUTES = 2;
export const DEPARTURE_MAX_ACCURACY_M_VALUE = 60;
