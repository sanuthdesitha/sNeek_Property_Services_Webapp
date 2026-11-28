import "server-only";
/**
 * The office's hand-written property reminders (smart property reminders,
 * slice A, 2026-11-28): list, add, edit and end, audited with the actual
 * actor. Routes check the live role and pack; this module checks the data.
 */
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { loadPilotState } from "@/lib/pilots/state";
import { pilotApplies } from "@/lib/pilots/registry";
import { REMINDER_ROOM_KEYS, REMINDER_ROOM_LABEL, isReminderRoomKey } from "./sections";
import {
  NEXT_JOBS_MAX,
  REMINDER_LIFETIMES,
  REMINDER_MOMENTS,
  REMINDER_TEXT_MAX,
  describeLifetime,
  lifetimeFinished,
  officeReminderKey,
  type ReminderLifetime,
  type ReminderMoment,
} from "./model";
import { claimsByKey, dateKey, officeReminderWhy, organisationTodayKey } from "./load";

export class ReminderServiceError extends Error {
  constructor(public readonly status: number, message: string, public readonly code: string) {
    super(message);
  }
}

export type ReminderActor = { id: string; role: Role };

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const reminderInput = z
  .object({
    text: z.string().trim().min(1).max(REMINDER_TEXT_MAX),
    moment: z.enum(REMINDER_MOMENTS),
    roomKey: z.enum(REMINDER_ROOM_KEYS).nullable().default(null),
    cleanerId: z.string().trim().min(1).max(128).nullable().default(null),
    lifetime: z.enum(REMINDER_LIFETIMES),
    jobsCount: z.number().int().min(1).max(NEXT_JOBS_MAX).nullable().default(null),
    untilDate: z.string().regex(DATE_KEY).nullable().default(null),
    mustConfirm: z.boolean().default(false),
    reason: z.string().trim().max(500).nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.moment === "ROOM" && !value.roomKey) ctx.addIssue({ code: "custom", path: ["roomKey"], message: "Choose the room." });
    if (value.lifetime === "NEXT_JOBS" && !value.jobsCount) ctx.addIssue({ code: "custom", path: ["jobsCount"], message: "Say how many jobs." });
    if (value.lifetime === "UNTIL_DATE" && !value.untilDate) ctx.addIssue({ code: "custom", path: ["untilDate"], message: "Choose the last day." });
  });
export type ReminderInput = z.infer<typeof reminderInput>;

export const reminderPatch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("end"), expectedUpdatedAt: z.string().datetime() }),
  z.object({ action: z.literal("edit"), expectedUpdatedAt: z.string().datetime(), reminder: reminderInput }),
]);

export type OfficeReminderView = {
  id: string;
  text: string;
  moment: ReminderMoment;
  roomKey: string | null;
  roomLabel: string | null;
  cleaner: { id: string; name: string } | null;
  lifetime: ReminderLifetime;
  jobsCount: number | null;
  untilDate: string | null;
  /** "When it ends", in plain words. */
  endsLabel: string;
  /** Lifetime ran out (next N jobs used, or past the date), though not ended by hand. */
  finished: boolean;
  mustConfirm: boolean;
  reason: string | null;
  /** What the cleaner reads under it. */
  why: string;
  origin: string;
  usedOnJobs: number;
  confirmations: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
  endedBy: string | null;
};

export type ReminderPilotStatus = "ON" | "OFF" | "SCOPED_NOT_THIS_PROPERTY" | "SCOPED_THIS_PROPERTY" | "UNREADABLE";

export type PropertyRemindersView = {
  active: OfficeReminderView[];
  ended: OfficeReminderView[];
  cleaners: Array<{ id: string; name: string }>;
  pilot: ReminderPilotStatus;
  todayKey: string;
};

function normalise(input: ReminderInput) {
  return {
    text: input.text,
    moment: input.moment,
    roomKey: input.moment === "ROOM" ? input.roomKey : null,
    cleanerId: input.cleanerId,
    lifetime: input.lifetime,
    jobsCount: input.lifetime === "NEXT_JOBS" ? input.jobsCount : null,
    untilDate: input.lifetime === "UNTIL_DATE" && input.untilDate ? new Date(`${input.untilDate}T00:00:00.000Z`) : null,
    mustConfirm: input.mustConfirm,
    reason: input.reason ? input.reason : null,
  };
}

async function assertInputAllowed(input: ReminderInput, todayKey: string): Promise<void> {
  if (input.lifetime === "UNTIL_DATE" && input.untilDate && input.untilDate < todayKey) {
    throw new ReminderServiceError(400, "The last day cannot be in the past.", "DATE_IN_PAST");
  }
  if (input.cleanerId) {
    const cleaner = await db.user.findFirst({ where: { id: input.cleanerId, role: Role.CLEANER, isActive: true }, select: { id: true } });
    if (!cleaner) throw new ReminderServiceError(400, "Choose an active cleaner, or every cleaner.", "CLEANER_NOT_FOUND");
  }
}

async function pilotStatusFor(propertyId: string): Promise<ReminderPilotStatus> {
  const state = await loadPilotState();
  if (!state.readable || state.unreadable.includes("property-reminders")) return "UNREADABLE";
  const setting = state.pilots["property-reminders"];
  if (setting.mode === "OFF") return "OFF";
  if (setting.mode === "ON") return "ON";
  return pilotApplies(state, "property-reminders", { propertyId }) ? "SCOPED_THIS_PROPERTY" : "SCOPED_NOT_THIS_PROPERTY";
}

async function names(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name ?? user.email ?? user.id] as const));
}

export async function listPropertyReminders(propertyId: string): Promise<PropertyRemindersView> {
  const property = await db.property.findUnique({ where: { id: propertyId }, select: { id: true } });
  if (!property) throw new ReminderServiceError(404, "Property not found.", "NOT_FOUND");
  const [rows, todayKey, pilot, cleaners] = await Promise.all([
    db.propertyReminder.findMany({
      where: { propertyId, OR: [{ endedAt: null }, { endedAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } }] },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 120,
    }),
    organisationTodayKey(),
    pilotStatusFor(propertyId),
    db.user.findMany({ where: { role: Role.CLEANER, isActive: true }, select: { id: true, name: true, email: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 500 }),
  ]);
  const keys = rows.map((row) => officeReminderKey(row.id));
  const [claims, ackCounts, people] = await Promise.all([
    claimsByKey(db, keys),
    keys.length ? db.propertyReminderAck.groupBy({ by: ["reminderKey"], where: { reminderKey: { in: keys } }, _count: { _all: true } }) : Promise.resolve([]),
    names(rows.flatMap((row) => [row.createdById, row.endedById, row.cleanerId])),
  ]);
  const acks = new Map(ackCounts.map((row) => [row.reminderKey, row._count._all] as const));
  const views = rows.map<OfficeReminderView>((row) => {
    const usedOnJobs = new Set(claims.get(officeReminderKey(row.id)) ?? []).size;
    const untilDate = dateKey(row.untilDate);
    const lifetimeInput = { lifetime: row.lifetime as ReminderLifetime, jobsCount: row.jobsCount, untilDate, usedOnJobs };
    return {
      id: row.id,
      text: row.text,
      moment: row.moment as ReminderMoment,
      roomKey: row.roomKey,
      roomLabel: isReminderRoomKey(row.roomKey) ? REMINDER_ROOM_LABEL[row.roomKey] : null,
      cleaner: row.cleanerId ? { id: row.cleanerId, name: people.get(row.cleanerId) ?? "Unknown cleaner" } : null,
      lifetime: row.lifetime as ReminderLifetime,
      jobsCount: row.jobsCount,
      untilDate,
      endsLabel: describeLifetime(lifetimeInput),
      finished: lifetimeFinished({ ...lifetimeInput, todayKey }),
      mustConfirm: row.mustConfirm,
      reason: row.reason,
      why: officeReminderWhy(row),
      origin: row.origin,
      usedOnJobs,
      confirmations: acks.get(officeReminderKey(row.id)) ?? 0,
      createdBy: people.get(row.createdById) ?? "Unknown",
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      endedAt: row.endedAt ? row.endedAt.toISOString() : null,
      endedBy: row.endedById ? people.get(row.endedById) ?? "Unknown" : null,
    };
  });
  return {
    active: views.filter((view) => !view.endedAt),
    ended: views.filter((view) => view.endedAt),
    cleaners: cleaners.map((user) => ({ id: user.id, name: user.name ?? user.email ?? user.id })),
    pilot,
    todayKey,
  };
}

function auditValue(row: object): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(row)) as Prisma.InputJsonValue;
}

export async function createPropertyReminder(actor: ReminderActor, propertyId: string, raw: unknown, origin = "OFFICE"): Promise<{ id: string }> {
  const input = reminderInput.parse(raw);
  const property = await db.property.findUnique({ where: { id: propertyId }, select: { id: true } });
  if (!property) throw new ReminderServiceError(404, "Property not found.", "NOT_FOUND");
  await assertInputAllowed(input, await organisationTodayKey());
  return db.$transaction(async (tx) => {
    const created = await tx.propertyReminder.create({ data: { propertyId, ...normalise(input), origin, createdById: actor.id } });
    await tx.auditLog.create({
      data: { userId: actor.id, action: "PROPERTY_REMINDER_CREATED", entity: "PropertyReminder", entityId: created.id, after: auditValue({ ...created, actorRole: actor.role }) },
    });
    return { id: created.id };
  });
}

/**
 * Edit or end one reminder. `expectedUpdatedAt` is the version the office
 * saw: a reminder changed meanwhile is refused (409) rather than overwritten.
 */
export async function patchPropertyReminder(actor: ReminderActor, propertyId: string, reminderId: string, raw: unknown): Promise<{ id: string; updatedAt: string }> {
  const patch = reminderPatch.parse(raw);
  if (patch.action === "edit") await assertInputAllowed(patch.reminder, await organisationTodayKey());
  return db.$transaction(async (tx) => {
    const current = await tx.propertyReminder.findFirst({ where: { id: reminderId, propertyId } });
    if (!current) throw new ReminderServiceError(404, "Reminder not found.", "NOT_FOUND");
    if (current.endedAt) throw new ReminderServiceError(409, "This reminder has already ended.", "ENDED");
    const changed = await tx.propertyReminder.updateMany({
      where: { id: reminderId, updatedAt: new Date(patch.expectedUpdatedAt), endedAt: null },
      data: patch.action === "end" ? { endedAt: new Date(), endedById: actor.id } : { ...normalise(patch.reminder), updatedById: actor.id },
    });
    if (changed.count !== 1) throw new ReminderServiceError(409, "Someone changed this reminder. Reload to see the latest version.", "CONFLICT");
    const after = await tx.propertyReminder.findUniqueOrThrow({ where: { id: reminderId } });
    await tx.auditLog.create({
      data: {
        userId: actor.id,
        action: patch.action === "end" ? "PROPERTY_REMINDER_ENDED" : "PROPERTY_REMINDER_EDITED",
        entity: "PropertyReminder",
        entityId: reminderId,
        before: auditValue(current),
        after: auditValue({ ...after, actorRole: actor.role }),
      },
    });
    return { id: reminderId, updatedAt: after.updatedAt.toISOString() };
  });
}
