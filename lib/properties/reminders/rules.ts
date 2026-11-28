/**
 * AUTOMATIC REMINDER RULES (smart property reminders, slice B, 2026-11-28).
 *
 * Each rule is named, off by default, and turns stored facts into reminders
 * deterministically (no AI): the same facts always give the same reminders,
 * with the same keys, and every reminder states its facts in `why`. Only an
 * ADMIN switches a rule on, after a live preview. Rules run only where the
 * "Property reminders" pilot shows reminders to the cleaner.
 *
 * This module is PURE: definitions, the stored switch shape, and the builders
 * from fact rows. The reads are in lib/properties/reminders/rules-load.ts.
 */
import { z } from "zod";
import { REMINDER_ROOM_LABEL, type ReminderRoomKey } from "./sections";
import type { ReminderCandidate, ReminderLifetime, ReminderMoment } from "./model";

export const REMINDER_RULE_KEYS = [
  "device-charging",
  "issue-room",
  "repeat-issue-room",
  "cleaner-repeat",
  "stock-not-delivered",
  "open-maintenance",
] as const;
export type ReminderRuleKey = (typeof REMINDER_RULE_KEYS)[number];

export type ReminderRuleDefinition = {
  key: ReminderRuleKey;
  name: string;
  /** What it does, plainly. */
  description: string;
  /** Where the cleaner sees it and for how long. */
  creates: string;
  /** The records it reads. */
  reads: string;
};

export const REMINDER_RULES: readonly ReminderRuleDefinition[] = [
  {
    key: "device-charging",
    name: "Device needs charging",
    description: "A battery device at the property (Ring, Minut or added by hand) is marked as needing a charge.",
    creates: "Before start, on every job until the device is charged. Not shown on the job that already carries the device's charge task.",
    reads: "Property devices: the charge condition, the last battery reading and when it was taken.",
  },
  {
    key: "issue-room",
    name: "Open or recently fixed QA issue → that room",
    description: "A QA issue at this property is still open, or was closed in the last 14 days, and its category belongs to a room.",
    creates: "At the top of that room: every job while the issue is open; the next job after it was closed.",
    reads: "QA issues: category, property, status, when raised and last changed. Categories with no room are skipped.",
  },
  {
    key: "repeat-issue-room",
    name: "Repeat issue at a property → that room",
    description: "The same QA category was raised at least twice in 60 days at one property.",
    creates: "At the top of that room on every job, until 30 days pass with no new issue of that category there.",
    reads: "QA issues: category, property and when raised. Categories with no room are skipped.",
  },
  {
    key: "cleaner-repeat",
    name: "Same cleaner, same category at different properties",
    description: "One cleaner had QA issues of the same category at two or more properties in 60 days.",
    creates: "That cleaner's next 3 jobs (any property): at the top of the matching room, or before start when the category has no room.",
    reads: "QA issues: cleaner, category, property and when raised.",
  },
  {
    key: "stock-not-delivered",
    name: "Stock reported low, not delivered yet",
    description: "A stock item was reported low or out at the property and the report is not delivered, confirmed or resolved.",
    creates: "Before leaving, on every job until the report moves on: check what is left.",
    reads: "Urgent stock reports: item, stage and when reported. Ordering or a shopping run does not count as delivered.",
  },
  {
    key: "open-maintenance",
    name: "Open maintenance item",
    description: "A maintenance item at the property is open, acknowledged, in progress or ordered.",
    creates: "Before start, on every job until it is resolved or dismissed. No record says whether an item affects cleaning, so every open item is listed.",
    reads: "Maintenance items: title, area, priority, status and when reported. The title and area are shown to the cleaner (never costs, quotes or who is assigned).",
  },
];

export function isReminderRuleKey(value: unknown): value is ReminderRuleKey {
  return typeof value === "string" && (REMINDER_RULE_KEYS as readonly string[]).includes(value);
}

/* ── Stored switches (AppSetting `propertyReminderRules`) ───────────────── */

const ruleSettingSchema = z.object({
  enabled: z.boolean(),
  changedAt: z.string().datetime().nullable().default(null),
  changedById: z.string().nullable().default(null),
});
export type ReminderRuleSetting = z.infer<typeof ruleSettingSchema>;
export const RULE_OFF: ReminderRuleSetting = { enabled: false, changedAt: null, changedById: null };

export type ReminderRuleState = {
  /** False when the stored value could not be read: every rule then counts as off. */
  readable: boolean;
  rules: Record<ReminderRuleKey, ReminderRuleSetting>;
};

export function allRulesOff(readable: boolean): ReminderRuleState {
  return { readable, rules: Object.fromEntries(REMINDER_RULE_KEYS.map((key) => [key, { ...RULE_OFF }])) as Record<ReminderRuleKey, ReminderRuleSetting> };
}

/** Missing = nothing switched on; not an object = unreadable (all off); one bad rule = that rule off. */
export function parseRuleState(raw: unknown): ReminderRuleState {
  if (raw === undefined || raw === null) return allRulesOff(true);
  if (typeof raw !== "object" || Array.isArray(raw)) return allRulesOff(false);
  const state = allRulesOff(true);
  for (const key of REMINDER_RULE_KEYS) {
    const parsed = ruleSettingSchema.safeParse((raw as Record<string, unknown>)[key]);
    if (parsed.success) state.rules[key] = parsed.data;
  }
  return state;
}

export function enabledRules(state: ReminderRuleState): ReminderRuleKey[] {
  return state.readable ? REMINDER_RULE_KEYS.filter((key) => state.rules[key].enabled) : [];
}

/* ── Facts → reminders ───────────────────────────────────────────────────── */

export const ISSUE_RECENT_CLOSE_DAYS = 14;
export const REPEAT_WINDOW_DAYS = 60;
export const REPEAT_CLEAN_DAYS = 30;
export const CLEANER_REPEAT_JOBS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * QA issue category key (frozen settings keys) → room. Categories not listed
 * have no room: the room rules skip them.
 */
export const CATEGORY_ROOM: Readonly<Record<string, ReminderRoomKey>> = {
  kitchen_reset: "kitchen",
  coffee_machine: "kitchen",
  bathroom_detail: "bathroom",
  bed_setup: "bedroom",
  furniture_reset: "living",
  balcony_setup: "balcony",
  laundry_bag: "laundry",
  laundry_linen: "laundry",
  restock: "supplies",
};

/** A reminder a rule made, with the property it belongs to (null = follows a cleaner anywhere). */
export type RuleReminder = { rule: ReminderRuleKey; propertyId: string | null; candidate: ReminderCandidate };

export type RuleContext = {
  now: Date;
  /** Organisation calendar day formatter for facts (yyyy-mm-dd → "3 Nov"). */
  formatDay: (value: Date) => string;
  categoryLabel: (key: string) => string;
};

function ruleCandidate(input: {
  rule: ReminderRuleKey;
  evidence: string;
  text: string;
  why: string;
  moment: ReminderMoment;
  roomKey?: ReminderRoomKey | null;
  rank: number;
  createdAt: Date;
  cleanerId?: string | null;
  lifetime?: ReminderLifetime;
  jobsCount?: number | null;
  skipJobIds?: string[];
}): ReminderCandidate {
  const evidence = input.evidence.replace(/[^A-Za-z0-9_-]/g, "_");
  return {
    key: `rule:${input.rule}:${evidence}`,
    briefingId: `property-reminder-rule-${input.rule}-${evidence}`,
    text: input.text,
    why: input.why,
    moment: input.moment,
    roomKey: input.moment === "ROOM" ? input.roomKey ?? null : null,
    mustConfirm: false,
    rank: input.rank,
    createdAt: input.createdAt.toISOString(),
    cleanerId: input.cleanerId ?? null,
    lifetime: input.lifetime ?? "EVERY_JOB",
    jobsCount: input.jobsCount ?? null,
    untilDate: null,
    claimedJobIds: [],
    ...(input.skipJobIds && input.skipJobIds.length > 0 ? { skipJobIds: input.skipJobIds } : {}),
  };
}

export type DeviceFact = {
  id: string;
  propertyId: string;
  name: string;
  kindLabel: string;
  lastBatteryPercent: number | null;
  lastReadingAt: Date | null;
  conditionOpenedAt: Date | null;
  /** The job carrying the device's open charge task, if any. */
  chargeTaskJobId: string | null;
};

export function deviceChargingReminders(devices: readonly DeviceFact[], context: RuleContext): RuleReminder[] {
  return devices.map((device) => {
    const battery = device.lastBatteryPercent === null ? "battery not known" : `battery ${device.lastBatteryPercent}%`;
    const reading = device.lastReadingAt ? ` (reading ${context.formatDay(device.lastReadingAt)})` : "";
    return {
      rule: "device-charging",
      propertyId: device.propertyId,
      candidate: ruleCandidate({
        rule: "device-charging",
        evidence: device.id,
        text: `Charge the ${device.kindLabel.toLowerCase()} "${device.name}" before you leave.`,
        why: `Device needs charging: ${battery}${reading}.`,
        moment: "BEFORE_START",
        rank: 3,
        createdAt: device.conditionOpenedAt ?? device.lastReadingAt ?? context.now,
        skipJobIds: device.chargeTaskJobId ? [device.chargeTaskJobId] : [],
      }),
    };
  });
}

export type IssueFact = {
  id: string;
  propertyId: string;
  cleanerId: string;
  category: string;
  createdAt: Date;
  updatedAt: Date;
  open: boolean;
};

/** Open issues (every job) and issues closed in the last 14 days (next job), for categories with a room. */
export function issueRoomReminders(issues: readonly IssueFact[], context: RuleContext): RuleReminder[] {
  const recent = context.now.getTime() - ISSUE_RECENT_CLOSE_DAYS * DAY_MS;
  const out: RuleReminder[] = [];
  for (const issue of issues) {
    const room = CATEGORY_ROOM[issue.category];
    if (!room) continue;
    if (!issue.open && issue.updatedAt.getTime() < recent) continue;
    const label = context.categoryLabel(issue.category);
    out.push({
      rule: "issue-room",
      propertyId: issue.propertyId,
      candidate: ruleCandidate({
        rule: "issue-room",
        evidence: issue.id,
        text: `${REMINDER_ROOM_LABEL[room]}: check ${label.toLowerCase()} carefully this time.`,
        why: issue.open
          ? `QA issue "${label}" raised here on ${context.formatDay(issue.createdAt)} is still open.`
          : `QA issue "${label}" raised here on ${context.formatDay(issue.createdAt)} was closed on ${context.formatDay(issue.updatedAt)}.`,
        moment: "ROOM",
        roomKey: room,
        rank: issue.open ? 3 : 2,
        createdAt: issue.createdAt,
        lifetime: issue.open ? "EVERY_JOB" : "NEXT_JOBS",
        jobsCount: issue.open ? null : 1,
      }),
    });
  }
  return out;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
  return map;
}

function byNewest(a: IssueFact, b: IssueFact): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id);
}

/**
 * Same category 2+ times within 60 days at one property → that room on every
 * job until 30 days pass with no new issue of that category there.
 */
export function repeatIssueRoomReminders(issues: readonly IssueFact[], context: RuleContext): RuleReminder[] {
  const out: RuleReminder[] = [];
  const cleanSince = context.now.getTime() - REPEAT_CLEAN_DAYS * DAY_MS;
  for (const [, group] of Array.from(groupBy(issues, (issue) => `${issue.propertyId}|${issue.category}`))) {
    const room = CATEGORY_ROOM[group[0].category];
    if (!room) continue;
    const sorted = [...group].sort(byNewest);
    const latest = sorted[0];
    if (latest.createdAt.getTime() < cleanSince) continue;
    const inWindow = sorted.filter((issue) => latest.createdAt.getTime() - issue.createdAt.getTime() <= REPEAT_WINDOW_DAYS * DAY_MS);
    if (inWindow.length < 2) continue;
    const label = context.categoryLabel(latest.category);
    const dates = inWindow.slice(0, 4).map((issue) => context.formatDay(issue.createdAt)).reverse().join(", ");
    out.push({
      rule: "repeat-issue-room",
      propertyId: latest.propertyId,
      candidate: ruleCandidate({
        rule: "repeat-issue-room",
        evidence: `${latest.propertyId}-${latest.category}-${latest.id}`,
        text: `${REMINDER_ROOM_LABEL[room]}: ${label.toLowerCase()} keeps coming up here. Check it before you finish this room.`,
        why: `QA issue "${label}" raised ${inWindow.length} times here in 60 days (${dates}).`,
        moment: "ROOM",
        roomKey: room,
        rank: 4,
        createdAt: latest.createdAt,
      }),
    });
  }
  return out;
}

/** One cleaner, same category, 2+ properties within 60 days → that cleaner's next 3 jobs. */
export function cleanerRepeatReminders(issues: readonly IssueFact[], context: RuleContext): RuleReminder[] {
  const out: RuleReminder[] = [];
  const since = context.now.getTime() - REPEAT_WINDOW_DAYS * DAY_MS;
  const recent = issues.filter((issue) => issue.createdAt.getTime() >= since);
  for (const [, group] of Array.from(groupBy(recent, (issue) => `${issue.cleanerId}|${issue.category}`))) {
    const properties = new Set(group.map((issue) => issue.propertyId));
    if (properties.size < 2) continue;
    const latest = [...group].sort(byNewest)[0];
    const room = CATEGORY_ROOM[latest.category] ?? null;
    const label = context.categoryLabel(latest.category);
    out.push({
      rule: "cleaner-repeat",
      propertyId: null,
      candidate: ruleCandidate({
        rule: "cleaner-repeat",
        evidence: `${latest.cleanerId}-${latest.category}-${latest.id}`,
        text: room ? `${REMINDER_ROOM_LABEL[room]}: take extra care with ${label.toLowerCase()} today.` : `Take extra care with ${label.toLowerCase()} today.`,
        why: `You had QA issues for "${label}" at ${properties.size} properties in the last 60 days (latest ${context.formatDay(latest.createdAt)}).`,
        moment: room ? "ROOM" : "BEFORE_START",
        roomKey: room,
        rank: 2,
        createdAt: latest.createdAt,
        cleanerId: latest.cleanerId,
        lifetime: "NEXT_JOBS",
        jobsCount: CLEANER_REPEAT_JOBS,
      }),
    });
  }
  return out;
}

export type StockFact = { id: string; propertyId: string; itemName: string; stage: string; observedCount: number | null; unit: string; createdAt: Date };

/** Stages that mean "reported, not delivered yet". */
export const STOCK_OPEN_STAGES = ["REPORTED", "ACKNOWLEDGED", "ORDERED"] as const;

export function stockNotDeliveredReminders(needs: readonly StockFact[], context: RuleContext): RuleReminder[] {
  return needs
    .filter((need) => (STOCK_OPEN_STAGES as readonly string[]).includes(need.stage))
    .map((need) => {
      const counted = need.observedCount === null ? "count not recorded" : `${need.observedCount} ${need.unit} counted`;
      return {
        rule: "stock-not-delivered" as const,
        propertyId: need.propertyId,
        candidate: ruleCandidate({
          rule: "stock-not-delivered",
          evidence: need.id,
          text: `Check how much ${need.itemName} is left and note it before you leave.`,
          why: `${need.itemName} reported low on ${context.formatDay(need.createdAt)} (${counted}); stage ${need.stage.toLowerCase()}, not delivered yet.`,
          moment: "BEFORE_LEAVING",
          rank: 2,
          createdAt: need.createdAt,
        }),
      };
    });
}

export type MaintenanceFact = { id: string; propertyId: string; title: string; area: string | null; priority: string; status: string; createdAt: Date };

export const MAINTENANCE_OPEN_STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ORDERED"] as const;

export function openMaintenanceReminders(items: readonly MaintenanceFact[], context: RuleContext): RuleReminder[] {
  return items
    .filter((item) => (MAINTENANCE_OPEN_STATUSES as readonly string[]).includes(item.status))
    .map((item) => ({
      rule: "open-maintenance" as const,
      propertyId: item.propertyId,
      candidate: ruleCandidate({
        rule: "open-maintenance",
        evidence: item.id,
        text: `Open maintenance: ${item.title}${item.area ? ` (${item.area})` : ""}. Work around it and report anything new.`,
        why: `Maintenance item reported ${context.formatDay(item.createdAt)}, priority ${item.priority.toLowerCase()}, status ${item.status.toLowerCase().replace(/_/g, " ")}.`,
        moment: "BEFORE_START",
        rank: item.priority === "URGENT" || item.priority === "HIGH" ? 3 : 2,
        createdAt: item.createdAt,
      }),
    }));
}

/** "Would currently create N reminders at M properties" (+ cleaner-wide ones counted apart). */
export type RulePreview = { rule: ReminderRuleKey; reminders: number; properties: number; cleaners: number; examples: Array<{ text: string; why: string }> };

export function previewOf(rule: ReminderRuleKey, reminders: readonly RuleReminder[]): RulePreview {
  const own = reminders.filter((entry) => entry.rule === rule);
  return {
    rule,
    reminders: own.length,
    properties: new Set(own.map((entry) => entry.propertyId).filter(Boolean)).size,
    cleaners: new Set(own.map((entry) => entry.candidate.cleanerId).filter(Boolean)).size,
    examples: own.slice(0, 3).map((entry) => ({ text: entry.candidate.text, why: entry.candidate.why })),
  };
}

export function describePreview(preview: Pick<RulePreview, "reminders" | "properties" | "cleaners">): string {
  const reminders = `${preview.reminders} reminder${preview.reminders === 1 ? "" : "s"}`;
  if (preview.cleaners > 0 && preview.properties === 0) return `Would currently create ${reminders} for ${preview.cleaners} cleaner${preview.cleaners === 1 ? "" : "s"}`;
  return `Would currently create ${reminders} at ${preview.properties} propert${preview.properties === 1 ? "y" : "ies"}`;
}
