import "server-only";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { isKeyLostNotes } from "./key-lost";
import { dayKeyOf } from "./pipeline";
import { extractLaundryTeamUserIds } from "./teams";
import {
  normalizeSchedule,
  partnerScheduleInput,
  prefillPlannedTimes,
  scheduleFromRow,
  scheduleStated,
  type PartnerSchedule,
} from "./partner-schedule";

/**
 * Server side of the laundry partner schedule (descriptive defaults; see
 * ./partner-schedule.ts). Two jobs:
 *  - `partnerTimesForNewRuns`: the planned times a NEW run gets from its
 *    partner's schedule. The partner is the run's own supplier when one is
 *    given, else the single partner of the property's assigned laundry team
 *    (every active LAUNDRY member linked to the same partner). No supplier is
 *    written to the run; an empty team, mixed partners or no schedule mean
 *    nothing is prefilled. Dates are never touched.
 *  - `updatePartnerSchedule`: the office edits the schedule (stale-write guard,
 *    audited `LAUNDRY_PARTNER_SCHEDULE_UPDATED`). Existing runs never change.
 */
export const PARTNER_SCHEDULE_SELECT = {
  id: true,
  isActive: true,
  pickupWeekdays: true,
  pickupWindowStart: true,
  pickupWindowEnd: true,
  dropWeekdays: true,
  dropWindowStart: true,
  dropWindowEnd: true,
} satisfies Prisma.LaundrySupplierSelect;

type Client = Prisma.TransactionClient | typeof db;

export type NewRunTimingInput = {
  propertyId: string;
  supplierId?: string | null;
  pickupDate: Date;
  dropoffDate: Date;
  flagNotes?: string | null;
  pickupTime?: string | null;
  dropoffTime?: string | null;
};

export class PartnerScheduleError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** The single partner of each property's assigned laundry team, if there is exactly one. */
async function partnerOfPropertyTeams(client: Client, propertyIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!propertyIds.length) return out;
  const properties = await client.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true, accessInfo: true } });
  const teamByProperty = new Map(properties.map((property) => [property.id, extractLaundryTeamUserIds(property.accessInfo)]));
  const allIds = Array.from(new Set(Array.from(teamByProperty.values()).flat()));
  if (!allIds.length) return out;
  const users = await client.user.findMany({ where: { id: { in: allIds }, role: Role.LAUNDRY, isActive: true }, select: { id: true, laundrySupplierId: true } });
  const partnerByUser = new Map(users.map((user) => [user.id, user.laundrySupplierId]));
  teamByProperty.forEach((team, propertyId) => {
    const partners = new Set<string | null>();
    for (const id of team) if (partnerByUser.has(id)) partners.add(partnerByUser.get(id) ?? null);
    const [only] = Array.from(partners);
    if (partners.size === 1 && only) out.set(propertyId, only);
  });
  return out;
}

/** Planned times for new runs, in input order. Never a date, never a supplier. */
export async function partnerTimesForNewRuns(client: Client, runs: readonly NewRunTimingInput[]): Promise<Array<{ pickupTime: string | null; dropoffTime: string | null }>> {
  const needsTeam = Array.from(new Set(runs.filter((run) => !run.supplierId).map((run) => run.propertyId)));
  const teamPartner = await partnerOfPropertyTeams(client, needsTeam);
  const partnerIds = Array.from(new Set(runs.map((run) => run.supplierId || teamPartner.get(run.propertyId) || null).filter((id): id is string => Boolean(id))));
  const suppliers = partnerIds.length
    ? await client.laundrySupplier.findMany({ where: { id: { in: partnerIds } }, select: PARTNER_SCHEDULE_SELECT })
    : [];
  const scheduleById = new Map<string, PartnerSchedule | null>(suppliers.map((row) => [row.id, row.isActive ? scheduleFromRow(row) : null]));
  return runs.map((run) => {
    const partnerId = run.supplierId || teamPartner.get(run.propertyId) || null;
    const schedule = partnerId ? scheduleById.get(partnerId) ?? null : null;
    if (!scheduleStated(schedule)) return { pickupTime: run.pickupTime ?? null, dropoffTime: run.dropoffTime ?? null };
    return prefillPlannedTimes(schedule, {
      pickupDayKey: dayKeyOf(run.pickupDate),
      dropDayKey: dayKeyOf(run.dropoffDate),
      pickupTime: run.pickupTime ?? null,
      dropoffTime: run.dropoffTime ?? null,
      keyLost: isKeyLostNotes(run.flagNotes ?? null),
    });
  });
}

/** One new run (the single-create paths). */
export async function partnerTimesForNewRun(client: Client, run: NewRunTimingInput): Promise<{ pickupTime: string | null; dropoffTime: string | null }> {
  const [times] = await partnerTimesForNewRuns(client, [run]);
  return times;
}

export type PartnerScheduleRecord = PartnerSchedule & { supplierId: string; updatedAt: string };

export async function updatePartnerSchedule(actorId: string, supplierId: string, raw: unknown): Promise<PartnerScheduleRecord> {
  const input = partnerScheduleInput.parse(raw);
  const next = normalizeSchedule(input);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "LaundrySupplier" WHERE "id" = ${supplierId} FOR UPDATE`;
    const current = await tx.laundrySupplier.findUnique({ where: { id: supplierId }, select: { ...PARTNER_SCHEDULE_SELECT, updatedAt: true } });
    if (!current) throw new PartnerScheduleError(404, "That laundry partner was not found.");
    if (input.expectedUpdatedAt && current.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime()) {
      throw new PartnerScheduleError(409, "This partner changed since you opened it. Refresh and check it before saving again.");
    }
    const before = scheduleFromRow(current);
    const updated = await tx.laundrySupplier.update({ where: { id: supplierId }, data: next, select: { ...PARTNER_SCHEDULE_SELECT, updatedAt: true } });
    await tx.auditLog.create({
      data: {
        userId: actorId, action: "LAUNDRY_PARTNER_SCHEDULE_UPDATED", entity: "LaundrySupplier", entityId: supplierId,
        before: before as unknown as Prisma.InputJsonObject,
        after: next as unknown as Prisma.InputJsonObject,
      },
    });
    return { supplierId, ...(scheduleFromRow(updated) as PartnerSchedule), updatedAt: updated.updatedAt.toISOString() };
  });
}

/** The partner schedule a LAUNDRY login works to (its linked partner), or null. */
export async function scheduleForLaundryUser(userId: string): Promise<{ partnerName: string; schedule: PartnerSchedule } | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { laundrySupplier: { select: { name: true, isActive: true, ...PARTNER_SCHEDULE_SELECT } } },
  });
  const partner = user?.laundrySupplier;
  if (!partner?.isActive) return null;
  const schedule = scheduleFromRow(partner);
  return schedule ? { partnerName: partner.name, schedule } : null;
}
