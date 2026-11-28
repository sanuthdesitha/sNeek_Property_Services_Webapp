/**
 * PILOT FEATURES (owner requirement 2026-11-28): every new cleaner-flow
 * behaviour ships as a pilot that an administrator can switch off at once,
 * back to the previous behaviour, which stays in the code unchanged.
 *
 * A pilot is Off, On for everyone, or On for selected people and/or selected
 * properties. Default after deploy: Off. A state that cannot be read counts
 * as Off (the previous behaviour) and the settings screen says so.
 *
 * Plain module (no server imports): the registry, the stored shape and the
 * pure decision. The database read lives in lib/pilots/state.ts.
 *
 * Adding a pilot: add a key to PILOT_KEYS and an entry to PILOTS, then branch
 * at the seam with `isPilotOn(key, subject)` (server) — never trust a value
 * from the browser. Keep the old path as it was; the pilot only chooses.
 */
import { z } from "zod";

export const PILOT_KEYS = [
  "cleaner-job-flow",
  "checkin-location",
  "unused-check",
  "property-reminders",
  "before-start-extras",
  "review-flags",
  "qa-fix-reminders",
  "issues-register",
] as const;

export type PilotKey = (typeof PILOT_KEYS)[number];

export type PilotDefinition = {
  key: PilotKey;
  name: string;
  /** What it does, in one or two plain sentences. */
  description: string;
  /** Who sees a difference. */
  affects: string;
  /** What switching it off does. */
  whenOff: string;
  /** False while the behaviour behind it is not built yet: the switch exists but changes nothing. */
  built: boolean;
};

export const PILOTS: readonly PilotDefinition[] = [
  {
    key: "cleaner-job-flow",
    name: "New cleaner job flow",
    description: "The checklist stays locked until the arrival video is uploaded, sections are worked one at a time with what is still missing, the submit screen lists missing items by section, and the office can allow one job to submit without specific photos.",
    affects: "Cleaners on jobs started after it was switched on for them or their property; the office (override requests).",
    whenOff: "The existing checklist and submit screen. Answers, photos and drafts are kept. Jobs started before it was switched on keep the existing flow.",
    built: false,
  },
  {
    key: "checkin-location",
    name: "Check-in location",
    description: "Clock-in records the phone's location; outside 150 m, or with no location, the cleaner gives a reason and the office sees a flag. Never blocks clock-in.",
    affects: "Cleaners clocking in; the office review list.",
    whenOff: "The existing clock-in location step.",
    built: false,
  },
  {
    key: "unused-check",
    name: "Looks unused — ask the office",
    description: "Cleaners on Airbnb turnovers can ask the office from the job + menu when nobody seems to have stayed; the office answers in Approvals.",
    affects: "Cleaners on Airbnb turnovers (the + menu row); the office (Approvals queue).",
    whenOff: "The + menu row is hidden and new questions are refused. Questions already asked can still be answered, and every question and answer stays on the job.",
    built: true,
  },
  {
    key: "property-reminders",
    name: "Property reminders",
    description: "Automatic reminders from the property's facts in the start briefing (live plants: check the soil, water only if dry), acknowledged like the other items and listed in Read first.",
    affects: "Cleaners starting a job at a property with live plants.",
    whenOff: "The start briefing and Read first are as before. The property's live plants flag and the form's plant questions are not affected.",
    built: true,
  },
  {
    key: "before-start-extras",
    name: "Before-you-start extras",
    description: "Open QA issues at the property in the start briefing, and \"I can't attend\" / \"Running late\" actions that tell the office at once.",
    affects: "Cleaners before a job; the office.",
    whenOff: "The existing start briefing and job actions.",
    built: false,
  },
  {
    key: "review-flags",
    name: "Review flags and Needs review list",
    description: "Submitted jobs much shorter than expected, check-in location reasons and office overrides are flagged into a Needs review list with a random sample.",
    affects: "The office (Quality).",
    whenOff: "No new flags are made; flags already recorded stay readable.",
    built: false,
  },
  {
    key: "qa-fix-reminders",
    name: "QA fix reminders",
    description: "A reminder at 36 hours and an overdue alert at 48 hours for an open QA fix, to the cleaner and the office.",
    affects: "Cleaners with open QA fixes; the office.",
    whenOff: "No reminders are queued.",
    built: false,
  },
  {
    key: "issues-register",
    name: "All issues register",
    description: "One list of issues from every source with history and figures, in Quality.",
    affects: "The office.",
    whenOff: "The register is hidden; the existing Quality pages are unchanged.",
    built: false,
  },
];

export const PILOT_MODES = ["OFF", "ON", "SCOPED"] as const;
export type PilotMode = (typeof PILOT_MODES)[number];

export const PILOT_MODE_LABELS: Record<PilotMode, string> = {
  OFF: "Off",
  ON: "On for everyone",
  SCOPED: "On for selected people or properties",
};

const pilotSettingSchema = z.object({
  mode: z.enum(PILOT_MODES),
  userIds: z.array(z.string().min(1).max(128)).max(200).default([]),
  propertyIds: z.array(z.string().min(1).max(128)).max(200).default([]),
  /** Set whenever it is switched on or its scope changes: jobs started earlier keep the old flow. */
  onSince: z.string().datetime().nullable().default(null),
  changedAt: z.string().datetime().nullable().default(null),
  changedById: z.string().nullable().default(null),
});

export type PilotSetting = z.infer<typeof pilotSettingSchema>;

export type PilotState = {
  /** False when the stored state could not be read: every pilot then counts as Off. */
  readable: boolean;
  /** Pilots whose own stored entry could not be read (each counts as Off). */
  unreadable: PilotKey[];
  pilots: Record<PilotKey, PilotSetting>;
};

export const OFF_SETTING: PilotSetting = { mode: "OFF", userIds: [], propertyIds: [], onSince: null, changedAt: null, changedById: null };

export function isPilotKey(value: unknown): value is PilotKey {
  return typeof value === "string" && (PILOT_KEYS as readonly string[]).includes(value);
}

export function allOff(readable: boolean): PilotState {
  const pilots = Object.fromEntries(PILOT_KEYS.map((key) => [key, { ...OFF_SETTING }])) as Record<PilotKey, PilotSetting>;
  return { readable, unreadable: readable ? [] : [...PILOT_KEYS], pilots };
}

/**
 * The stored AppSetting value → the state. Missing = nothing switched on yet
 * (readable, all Off). Not an object = unreadable (all Off). One malformed
 * pilot counts as Off on its own; unknown keys are ignored.
 */
export function parsePilotState(raw: unknown): PilotState {
  if (raw === undefined || raw === null) return allOff(true);
  if (typeof raw !== "object" || Array.isArray(raw)) return allOff(false);
  const state = allOff(true);
  for (const key of PILOT_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const parsed = pilotSettingSchema.safeParse(value);
    if (parsed.success) state.pilots[key] = parsed.data;
    else state.unreadable.push(key);
  }
  return state;
}

/** Who and where an action is for. Unknown ids never match a scoped pilot. */
export type PilotSubject = {
  userId?: string | null;
  propertyId?: string | null;
  /**
   * When the job was first started (first clock-in). A job started before
   * the pilot was switched on (or its scope last changed) keeps the old flow.
   * Leave out for actions that are not gates on a job in progress.
   */
  jobStartedAt?: Date | null;
};

export function pilotSettingApplies(setting: PilotSetting, subject: PilotSubject): boolean {
  if (setting.mode === "OFF") return false;
  if (setting.mode === "SCOPED") {
    const byUser = Boolean(subject.userId) && setting.userIds.includes(String(subject.userId));
    const byProperty = Boolean(subject.propertyId) && setting.propertyIds.includes(String(subject.propertyId));
    if (!byUser && !byProperty) return false;
  }
  if (subject.jobStartedAt && setting.onSince) {
    const since = new Date(setting.onSince).getTime();
    if (Number.isFinite(since) && subject.jobStartedAt.getTime() < since) return false;
  }
  return true;
}

export function pilotApplies(state: PilotState, key: PilotKey, subject: PilotSubject): boolean {
  if (!state.readable) return false;
  return pilotSettingApplies(state.pilots[key] ?? OFF_SETTING, subject);
}

export const pilotUpdateInput = z.object({
  key: z.enum(PILOT_KEYS),
  mode: z.enum(PILOT_MODES),
  userIds: z.array(z.string().trim().min(1).max(128)).max(200).default([]),
  propertyIds: z.array(z.string().trim().min(1).max(128)).max(200).default([]),
});
export type PilotUpdateInput = z.infer<typeof pilotUpdateInput>;
