import "server-only";
/**
 * Reads for smart property reminders (lib/properties/reminders/model.ts):
 * the office's active reminders at a property with the jobs each was used
 * on, recording use at clock-in, and per-job confirmations.
 */
import type { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { isReminderRoomKey } from "./sections";
import {
  OFFICE_REMINDER_ITEM_PREFIX,
  officeReminderKey,
  remindersForJob,
  type ReminderCandidate,
  type ReminderItem,
  type ReminderLifetime,
  type ReminderMoment,
} from "./model";

type Reader = Pick<Prisma.TransactionClient, "propertyReminder" | "propertyReminderClaim">;

export type StoredReminderRow = {
  id: string;
  cleanerId: string | null;
  text: string;
  moment: ReminderMoment;
  roomKey: string | null;
  lifetime: ReminderLifetime;
  jobsCount: number | null;
  untilDate: Date | null;
  mustConfirm: boolean;
  reason: string | null;
  createdAt: Date;
};

export function dateKey(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** Why an office reminder exists, as the cleaner reads it (stable: part of the briefing fingerprint). */
export function officeReminderWhy(row: Pick<StoredReminderRow, "reason" | "cleanerId">): string {
  const reason = row.reason?.trim();
  if (reason) return `From the office: ${reason}`;
  return row.cleanerId ? "From the office, for you at this property." : "From the office, for every clean at this property.";
}

export function officeCandidate(row: StoredReminderRow, claimedJobIds: readonly string[]): ReminderCandidate {
  return {
    key: officeReminderKey(row.id),
    briefingId: `${OFFICE_REMINDER_ITEM_PREFIX}${row.id}`,
    text: row.text,
    why: officeReminderWhy(row),
    moment: row.moment,
    roomKey: row.moment === "ROOM" && isReminderRoomKey(row.roomKey) ? row.roomKey : null,
    mustConfirm: row.mustConfirm,
    rank: 1,
    createdAt: row.createdAt.toISOString(),
    cleanerId: row.cleanerId,
    lifetime: row.lifetime,
    jobsCount: row.jobsCount,
    untilDate: dateKey(row.untilDate),
    claimedJobIds,
  };
}

/** Claimed job ids per reminder key. */
export async function claimsByKey(reader: Pick<Reader, "propertyReminderClaim">, keys: readonly string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (keys.length === 0) return map;
  const claims = await reader.propertyReminderClaim.findMany({ where: { reminderKey: { in: [...keys] } }, select: { reminderKey: true, jobId: true } });
  for (const claim of claims) map.set(claim.reminderKey, [...(map.get(claim.reminderKey) ?? []), claim.jobId]);
  return map;
}

/** The office's active (not ended) reminders at a property, as candidates. */
export async function loadOfficeCandidates(propertyId: string, reader: Reader = db): Promise<ReminderCandidate[]> {
  const rows = await reader.propertyReminder.findMany({
    where: { propertyId, endedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 200,
  });
  const claims = await claimsByKey(reader, rows.map((row) => officeReminderKey(row.id)));
  return rows.map((row) => officeCandidate(row as StoredReminderRow, claims.get(officeReminderKey(row.id)) ?? []));
}

export async function organisationTodayKey(now: Date = new Date()): Promise<string> {
  const settings = await getAppSettings();
  return formatInTimeZone(now, settings.timezone || "Australia/Sydney", "yyyy-MM-dd");
}

/**
 * Every candidate reminder at a property (office reminders now; automatic
 * rules join here). One read for every caller that must agree on a job's
 * list (the start gate, the re-confirm route, the job payload, the office proof).
 */
export async function loadReminderCandidates(propertyId: string): Promise<ReminderCandidate[]> {
  return loadOfficeCandidates(propertyId);
}

/** The reminders that apply to this job and person now. */
export async function loadJobReminders(input: { propertyId: string; jobId: string | null; userId: string | null }): Promise<ReminderItem[]> {
  const [candidates, todayKey] = await Promise.all([loadReminderCandidates(input.propertyId), organisationTodayKey()]);
  return remindersForJob(candidates, { jobId: input.jobId, userId: input.userId, todayKey });
}

/**
 * At a cleaner's first clock-in: record that the job used each reminder that
 * applies (counts "next N jobs") and the before-start confirmations the
 * briefing just collected. Under a per-reminder lock so two jobs starting at
 * once never use a "next job" reminder twice; a reminder whose count filled
 * meanwhile is simply not recorded for this job.
 */
export async function recordReminderStart(input: {
  jobId: string;
  propertyId: string;
  userId: string;
  reminders: readonly ReminderItem[];
  /** Briefing item ids the cleaner acknowledged with this start. */
  acknowledgedBriefingIds: readonly string[];
}): Promise<void> {
  if (input.reminders.length === 0) return;
  const acknowledged = new Set(input.acknowledgedBriefingIds);
  const candidates = await loadReminderCandidates(input.propertyId);
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate] as const));
  for (const reminder of input.reminders) {
    const candidate = byKey.get(reminder.key);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`property-reminder:${reminder.key}`}))`;
      if (candidate?.lifetime === "NEXT_JOBS") {
        const used = await tx.propertyReminderClaim.findMany({ where: { reminderKey: reminder.key }, select: { jobId: true } });
        const already = used.some((claim) => claim.jobId === input.jobId);
        if (!already && used.length >= (candidate.jobsCount ?? 0)) return;
      }
      await tx.propertyReminderClaim.upsert({
        where: { reminderKey_jobId: { reminderKey: reminder.key, jobId: input.jobId } },
        create: { reminderKey: reminder.key, jobId: input.jobId, propertyId: input.propertyId },
        update: {},
      });
      if (reminder.moment === "BEFORE_START" && acknowledged.has(reminder.briefingId)) {
        await tx.propertyReminderAck.upsert({
          where: { reminderKey_jobId_userId: { reminderKey: reminder.key, jobId: input.jobId, userId: input.userId } },
          create: { reminderKey: reminder.key, jobId: input.jobId, userId: input.userId, moment: reminder.moment, text: reminder.text },
          update: {},
        });
      }
    });
  }
}

/** Reminder keys this person confirmed on this job. */
export async function confirmedReminderKeys(jobId: string, userId: string): Promise<Set<string>> {
  const rows = await db.propertyReminderAck.findMany({ where: { jobId, userId }, select: { reminderKey: true } });
  return new Set(rows.map((row) => row.reminderKey));
}
