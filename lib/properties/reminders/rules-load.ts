import "server-only";
/**
 * Reads for the automatic reminder rules (lib/properties/reminders/rules.ts):
 * the stored switches, the facts each rule reads, the preview, and saving a
 * switch (ADMIN only, after the preview the person saw; audited with the
 * actual actor).
 */
import type { Prisma, Role } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { OPEN_RECTIFICATION_STATUSES } from "@/lib/quality/types";
import { KIND_LABEL, type DeviceKind } from "@/lib/property-devices/types";
import type { ReminderCandidate } from "./model";
import {
  ISSUE_RECENT_CLOSE_DAYS,
  MAINTENANCE_OPEN_STATUSES,
  REMINDER_RULE_KEYS,
  STOCK_OPEN_STAGES,
  cleanerRepeatReminders,
  deviceChargingReminders,
  enabledRules,
  issueRoomReminders,
  openMaintenanceReminders,
  parseRuleState,
  previewOf,
  repeatIssueRoomReminders,
  stockNotDeliveredReminders,
  type IssueFact,
  type ReminderRuleKey,
  type ReminderRuleSetting,
  type ReminderRuleState,
  type RuleContext,
  type RulePreview,
  type RuleReminder,
} from "./rules";

export const RULE_SETTING_KEY = "propertyReminderRules";
const ISSUE_LOOKBACK_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const FACT_LIMIT = 2000;

export async function loadRuleState(): Promise<ReminderRuleState> {
  try {
    const row = await db.appSetting.findUnique({ where: { key: RULE_SETTING_KEY } });
    return parseRuleState(row?.value ?? null);
  } catch {
    return parseRuleState("unreadable");
  }
}

async function ruleContext(now: Date): Promise<RuleContext> {
  const settings = await getAppSettings();
  const timeZone = settings.timezone || "Australia/Sydney";
  const labels = new Map((settings.accountability?.issueCategories ?? []).map((category) => [category.key, category.label] as const));
  return {
    now,
    formatDay: (value) => formatInTimeZone(value, timeZone, "d MMM yyyy"),
    categoryLabel: (key) => labels.get(key) ?? (key.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase()) || "Quality"),
  };
}

function isOpenIssue(status: string): boolean {
  return (OPEN_RECTIFICATION_STATUSES as readonly string[]).includes(status);
}

async function issueFacts(where: Prisma.QaIssueWhereInput): Promise<IssueFact[]> {
  const rows = await db.qaIssue.findMany({
    where,
    select: { id: true, propertyId: true, cleanerId: true, category: true, createdAt: true, updatedAt: true, rectificationStatus: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: FACT_LIMIT,
  });
  return rows.map((row) => ({ ...row, open: isOpenIssue(row.rectificationStatus) }));
}

/**
 * The reminders the given rules make now, at one property (with the
 * cleaner-wide ones that follow a cleaner anywhere) or, with null, everywhere.
 */
export async function evaluateRules(rules: readonly ReminderRuleKey[], propertyId: string | null, now: Date = new Date()): Promise<RuleReminder[]> {
  if (rules.length === 0) return [];
  const context = await ruleContext(now);
  const at = propertyId ? { propertyId } : {};
  const out: RuleReminder[] = [];
  const want = new Set(rules);

  if (want.has("device-charging")) {
    const devices = await db.propertyDevice.findMany({
      where: { ...at, isActive: true, batteryPowered: true, chargeCondition: "NEEDS_CHARGE" },
      select: { id: true, propertyId: true, name: true, kind: true, lastBatteryPercent: true, lastReadingAt: true, conditionOpenedAt: true, chargeTaskId: true },
      take: FACT_LIMIT,
    });
    const taskIds = devices.map((device) => device.chargeTaskId).filter((id): id is string => Boolean(id));
    const tasks = taskIds.length ? await db.jobTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, jobId: true } }) : [];
    const taskJob = new Map(tasks.map((task) => [task.id, task.jobId] as const));
    out.push(
      ...deviceChargingReminders(
        devices.map((device) => ({
          id: device.id,
          propertyId: device.propertyId,
          name: device.name,
          kindLabel: KIND_LABEL[device.kind as DeviceKind] ?? "Device",
          lastBatteryPercent: device.lastBatteryPercent,
          lastReadingAt: device.lastReadingAt,
          conditionOpenedAt: device.conditionOpenedAt,
          chargeTaskJobId: device.chargeTaskId ? taskJob.get(device.chargeTaskId) ?? null : null,
        })),
        context,
      ),
    );
  }

  if (want.has("issue-room")) {
    const recent = new Date(now.getTime() - ISSUE_RECENT_CLOSE_DAYS * DAY_MS);
    const issues = await issueFacts({ ...at, OR: [{ rectificationStatus: { in: [...OPEN_RECTIFICATION_STATUSES] } }, { updatedAt: { gte: recent } }] });
    out.push(...issueRoomReminders(issues, context));
  }

  if (want.has("repeat-issue-room") || want.has("cleaner-repeat")) {
    const since = new Date(now.getTime() - ISSUE_LOOKBACK_DAYS * DAY_MS);
    if (want.has("repeat-issue-room")) out.push(...repeatIssueRoomReminders(await issueFacts({ ...at, createdAt: { gte: since } }), context));
    // A cleaner's pattern spans properties, so it is read everywhere even for one property.
    if (want.has("cleaner-repeat")) out.push(...cleanerRepeatReminders(await issueFacts({ createdAt: { gte: since } }), context));
  }

  if (want.has("stock-not-delivered")) {
    const needs = await db.urgentStockNeed.findMany({
      where: { ...at, stage: { in: [...STOCK_OPEN_STAGES] } },
      select: { id: true, propertyId: true, itemName: true, stage: true, observedCount: true, unit: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: FACT_LIMIT,
    });
    out.push(...stockNotDeliveredReminders(needs, context));
  }

  if (want.has("open-maintenance")) {
    const items = await db.propertyMaintenanceItem.findMany({
      where: { ...at, status: { in: [...MAINTENANCE_OPEN_STATUSES] } },
      select: { id: true, propertyId: true, title: true, area: true, priority: true, status: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: FACT_LIMIT,
    });
    out.push(...openMaintenanceReminders(items.map((item) => ({ ...item, priority: String(item.priority), status: String(item.status) })), context));
  }
  return out;
}

/** Candidates from the switched-on rules for one property, with the jobs each already used. */
export async function loadRuleCandidates(propertyId: string): Promise<ReminderCandidate[]> {
  const rules = enabledRules(await loadRuleState());
  const reminders = await evaluateRules(rules, propertyId);
  const keys = reminders.filter((entry) => entry.candidate.lifetime === "NEXT_JOBS").map((entry) => entry.candidate.key);
  const claims = keys.length ? await db.propertyReminderClaim.findMany({ where: { reminderKey: { in: keys } }, select: { reminderKey: true, jobId: true } }) : [];
  const byKey = new Map<string, string[]>();
  for (const claim of claims) byKey.set(claim.reminderKey, [...(byKey.get(claim.reminderKey) ?? []), claim.jobId]);
  return reminders.map((entry) => ({ ...entry.candidate, claimedJobIds: byKey.get(entry.candidate.key) ?? [] }));
}

export async function previewRule(rule: ReminderRuleKey, now: Date = new Date()): Promise<RulePreview> {
  return previewOf(rule, await evaluateRules([rule], null, now));
}

export class RuleChangeError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string, public readonly preview?: RulePreview) {
    super(message);
  }
}

export type RuleActor = { id: string; role: Role };

/**
 * Switch one rule on or off. Switching on needs the preview the person saw
 * (`seen`): when the facts changed since, nothing is saved and the current
 * preview comes back (409). Switching off needs no preview.
 */
export async function saveRule(actor: RuleActor, input: { rule: ReminderRuleKey; enabled: boolean; seen?: { reminders: number; properties: number; cleaners: number } | null }, now = new Date()): Promise<ReminderRuleSetting> {
  if (input.enabled) {
    const preview = await previewRule(input.rule, now);
    const seen = input.seen;
    if (!seen || seen.reminders !== preview.reminders || seen.properties !== preview.properties || seen.cleaners !== preview.cleaners) {
      throw new RuleChangeError(409, "The preview changed. Check the new numbers before you switch it on.", "PREVIEW_CHANGED", preview);
    }
  }
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${RULE_SETTING_KEY}))`;
    const row = await tx.appSetting.findUnique({ where: { key: RULE_SETTING_KEY } });
    const raw = row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? (row.value as Record<string, unknown>) : {};
    const before = parseRuleState(row?.value ?? null).rules[input.rule];
    const next: ReminderRuleSetting = { enabled: input.enabled, changedAt: now.toISOString(), changedById: actor.id };
    const value = { ...raw, [input.rule]: next } as Prisma.InputJsonValue;
    await tx.appSetting.upsert({ where: { key: RULE_SETTING_KEY }, create: { key: RULE_SETTING_KEY, value }, update: { value } });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: input.enabled ? "PROPERTY_REMINDER_RULE_ON" : "PROPERTY_REMINDER_RULE_OFF",
        entity: "PropertyReminderRule",
        entityId: input.rule,
        before: before as unknown as Prisma.InputJsonValue,
        after: { ...next, actorRole: actor.role, seen: input.seen ?? null } as unknown as Prisma.InputJsonValue,
      },
    });
    return next;
  });
}

export { REMINDER_RULE_KEYS };
