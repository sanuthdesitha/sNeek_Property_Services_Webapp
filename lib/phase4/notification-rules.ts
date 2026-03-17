import { randomUUID } from "crypto";
import { NotificationChannel, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { readSettingStore, writeSettingStore } from "@/lib/phase4/store";

const RULES_KEY = "phase4_notification_rules_v1";

export type NotificationRuleEvent =
  | "JOB_ASSIGNED"
  | "JOB_STATUS_CHANGED"
  | "QA_FAILED"
  | "APPROVAL_REQUESTED"
  | "DISPUTE_OPENED"
  | "STOCK_LOW"
  | "LAUNDRY_READY"
  | "PAY_ADJUSTMENT_REQUESTED";

export interface NotificationRule {
  id: string;
  name: string;
  event: NotificationRuleEvent;
  isActive: boolean;
  channels: NotificationChannel[];
  roles: Role[];
  userIds: string[];
  throttleMinutes: number;
  conditions: Record<string, unknown> | null;
  templateSubject: string | null;
  templateBody: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

interface RuleStore {
  rules: NotificationRule[];
}

const DEFAULT_STORE: RuleStore = { rules: [] };

function sanitizeRule(input: unknown): NotificationRule | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const name = String(row.name ?? "").trim().slice(0, 140);
  const createdByUserId = String(row.createdByUserId ?? "").trim();
  if (!id || !name || !createdByUserId) return null;
  const event = String(row.event ?? "").trim();
  const events: NotificationRuleEvent[] = [
    "JOB_ASSIGNED",
    "JOB_STATUS_CHANGED",
    "QA_FAILED",
    "APPROVAL_REQUESTED",
    "DISPUTE_OPENED",
    "STOCK_LOW",
    "LAUNDRY_READY",
    "PAY_ADJUSTMENT_REQUESTED",
  ];
  if (!events.includes(event as NotificationRuleEvent)) return null;
  const channels = Array.isArray(row.channels)
    ? row.channels.filter((item): item is NotificationChannel =>
        item === NotificationChannel.EMAIL ||
        item === NotificationChannel.SMS ||
        item === NotificationChannel.PUSH
      )
    : [NotificationChannel.PUSH];
  const roles = Array.isArray(row.roles)
    ? row.roles.filter((item): item is Role =>
        item === Role.ADMIN ||
        item === Role.OPS_MANAGER ||
        item === Role.CLEANER ||
        item === Role.CLIENT ||
        item === Role.LAUNDRY
      )
    : [];
  const userIds = Array.isArray(row.userIds)
    ? row.userIds
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  return {
    id,
    name,
    event: event as NotificationRuleEvent,
    isActive: row.isActive !== false,
    channels: channels.length ? channels : [NotificationChannel.PUSH],
    roles,
    userIds: Array.from(new Set(userIds)),
    throttleMinutes: Math.max(0, Math.min(1440, Number(row.throttleMinutes ?? 0))),
    conditions:
      row.conditions && typeof row.conditions === "object" && !Array.isArray(row.conditions)
        ? (row.conditions as Record<string, unknown>)
        : null,
    templateSubject: row.templateSubject ? String(row.templateSubject).slice(0, 250) : null,
    templateBody: row.templateBody ? String(row.templateBody).slice(0, 4000) : null,
    createdByUserId,
    createdAt: String(row.createdAt ?? new Date().toISOString()),
    updatedAt: String(row.updatedAt ?? new Date().toISOString()),
  };
}

function sanitizeStore(input: unknown, fallback: RuleStore): RuleStore {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fallback;
  const row = input as Record<string, unknown>;
  const rules = Array.isArray(row.rules)
    ? row.rules.map(sanitizeRule).filter((rule): rule is NotificationRule => Boolean(rule))
    : [];
  return { rules };
}

async function readStore() {
  return readSettingStore(RULES_KEY, DEFAULT_STORE, sanitizeStore);
}

async function writeStore(version: number, data: RuleStore) {
  return writeSettingStore(RULES_KEY, { version, data });
}

export async function listNotificationRules() {
  const store = await readStore();
  return [...store.data.rules].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createNotificationRule(input: {
  name: string;
  event: NotificationRuleEvent;
  channels?: NotificationChannel[];
  roles?: Role[];
  userIds?: string[];
  throttleMinutes?: number;
  conditions?: Record<string, unknown> | null;
  templateSubject?: string | null;
  templateBody?: string | null;
  createdByUserId: string;
}) {
  const store = await readStore();
  const now = new Date().toISOString();
  const created: NotificationRule = {
    id: randomUUID(),
    name: input.name.trim().slice(0, 140) || "Notification rule",
    event: input.event,
    isActive: true,
    channels:
      input.channels && input.channels.length > 0 ? Array.from(new Set(input.channels)) : [NotificationChannel.PUSH],
    roles: input.roles ? Array.from(new Set(input.roles)) : [],
    userIds: input.userIds
      ? Array.from(new Set(input.userIds.map((item) => item.trim()).filter(Boolean)))
      : [],
    throttleMinutes: Math.max(0, Math.min(1440, Math.round(Number(input.throttleMinutes ?? 0)))),
    conditions: input.conditions ?? null,
    templateSubject: input.templateSubject?.trim().slice(0, 250) || null,
    templateBody: input.templateBody?.trim().slice(0, 4000) || null,
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
  };
  const rules = [created, ...store.data.rules].slice(0, 500);
  await writeStore(store.version + 1, { rules });
  return created;
}

export async function patchNotificationRule(
  id: string,
  patch: Partial<
    Pick<
      NotificationRule,
      | "name"
      | "isActive"
      | "channels"
      | "roles"
      | "userIds"
      | "throttleMinutes"
      | "conditions"
      | "templateSubject"
      | "templateBody"
      | "event"
    >
  >
) {
  const store = await readStore();
  const index = store.data.rules.findIndex((row) => row.id === id);
  if (index < 0) return null;
  const current = store.data.rules[index];
  const next: NotificationRule = {
    ...current,
    name: patch.name !== undefined ? patch.name.trim().slice(0, 140) || current.name : current.name,
    event: patch.event ?? current.event,
    isActive: patch.isActive ?? current.isActive,
    channels:
      patch.channels && patch.channels.length > 0
        ? Array.from(new Set(patch.channels))
        : current.channels,
    roles: patch.roles ? Array.from(new Set(patch.roles)) : current.roles,
    userIds: patch.userIds
      ? Array.from(new Set(patch.userIds.map((item) => item.trim()).filter(Boolean)))
      : current.userIds,
    throttleMinutes:
      patch.throttleMinutes !== undefined
        ? Math.max(0, Math.min(1440, Math.round(Number(patch.throttleMinutes))))
        : current.throttleMinutes,
    conditions:
      patch.conditions !== undefined
        ? patch.conditions && typeof patch.conditions === "object"
          ? patch.conditions
          : null
        : current.conditions,
    templateSubject:
      patch.templateSubject !== undefined
        ? patch.templateSubject?.trim().slice(0, 250) || null
        : current.templateSubject,
    templateBody:
      patch.templateBody !== undefined
        ? patch.templateBody?.trim().slice(0, 4000) || null
        : current.templateBody,
    updatedAt: new Date().toISOString(),
  };
  const rules = [...store.data.rules];
  rules[index] = next;
  await writeStore(store.version + 1, { rules });
  return next;
}

export async function deleteNotificationRule(id: string) {
  const store = await readStore();
  const rules = store.data.rules.filter((row) => row.id !== id);
  if (rules.length === store.data.rules.length) return false;
  await writeStore(store.version + 1, { rules });
  return true;
}

function matchPrimitive(current: unknown, expected: unknown): boolean {
  if (expected === undefined) return true;
  if (typeof expected === "boolean") return (current === true || current === "true") === expected;
  if (typeof expected === "number") return Number(current) === expected;
  if (Array.isArray(expected)) {
    return expected.some((value) => matchPrimitive(current, value));
  }
  return String(current ?? "").toLowerCase() === String(expected ?? "").toLowerCase();
}

function matchesConditions(rule: NotificationRule, payload: Record<string, unknown>) {
  const conditions = rule.conditions;
  if (!conditions) return true;
  for (const [key, expected] of Object.entries(conditions)) {
    if (!matchPrimitive(payload[key], expected)) return false;
  }
  return true;
}

export async function resolveNotificationRuleRecipients(input: {
  event: NotificationRuleEvent;
  payload: Record<string, unknown>;
}) {
  const rules = (await listNotificationRules()).filter(
    (rule) => rule.isActive && rule.event === input.event && matchesConditions(rule, input.payload)
  );
  if (rules.length === 0) {
    return {
      rules: [] as NotificationRule[],
      recipients: [] as Array<{ userId: string; email: string | null; phone: string | null }>,
    };
  }
  const userIds = new Set<string>();
  const roles = new Set<Role>();
  for (const rule of rules) {
    for (const userId of rule.userIds) userIds.add(userId);
    for (const role of rule.roles) roles.add(role);
  }

  const users = await db.user.findMany({
    where:
      userIds.size === 0 && roles.size === 0
        ? { id: "__none__", isActive: true }
        : {
            isActive: true,
            OR: [
              userIds.size ? { id: { in: Array.from(userIds) } } : undefined,
              roles.size ? { role: { in: Array.from(roles) } } : undefined,
            ].filter(Boolean) as any,
          },
    select: {
      id: true,
      email: true,
      phone: true,
    },
  });

  return {
    rules,
    recipients: users.map((user) => ({ userId: user.id, email: user.email, phone: user.phone })),
  };
}
