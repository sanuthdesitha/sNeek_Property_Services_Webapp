/**
 * Stock → Stock counts → "Counts from job forms": the count observations from
 * job forms (lib/inventory/stock-count-observations.ts) with their state and
 * reason, newest first, and the office's "Mark reviewed" for a count that
 * could not be matched to the property's stock (it stays in the list; it is
 * never deleted or applied to a guessed item).
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { CountObservationStatus } from "./stock-count-observations";

export const FORM_COUNT_FILTERS = ["review", "pending", "all"] as const;
export type FormCountFilter = (typeof FORM_COUNT_FILTERS)[number];

export type FormCountRow = {
  id: string;
  status: CountObservationStatus;
  reason: string | null;
  propertyName: string;
  itemName: string;
  label: string;
  count: number;
  unit: string | null;
  previousOnHand: number | null;
  observedAt: string;
  resolvedAt: string | null;
  job: { id: string; jobNumber: string | null } | null;
};

export type FormCountList = { rows: FormCountRow[]; counts: Record<FormCountFilter, number> };

const FILTER_WHERE: Record<FormCountFilter, Prisma.StockCountObservationWhereInput> = {
  review: { status: "NEEDS_REVIEW" },
  pending: { status: "PENDING" },
  all: {},
};

export async function listFormCountObservations(filter: FormCountFilter, take = 100): Promise<FormCountList> {
  const [rows, review, pending, all] = await Promise.all([
    db.stockCountObservation.findMany({ where: FILTER_WHERE[filter], orderBy: [{ createdAt: "desc" }, { id: "asc" }], take, include: { job: { select: { id: true, jobNumber: true } } } }),
    db.stockCountObservation.count({ where: FILTER_WHERE.review }),
    db.stockCountObservation.count({ where: FILTER_WHERE.pending }),
    db.stockCountObservation.count(),
  ]);
  const properties = await db.property.findMany({ where: { id: { in: Array.from(new Set(rows.map((row) => row.propertyId))) } }, select: { id: true, name: true } });
  const names = new Map(properties.map((property) => [property.id, property.name]));
  return {
    counts: { review, pending, all },
    rows: rows.map((row) => ({
      id: row.id, status: row.status as CountObservationStatus, reason: row.reason, propertyName: names.get(row.propertyId) ?? "Property not found",
      itemName: row.itemName ?? row.itemId, label: row.label, count: row.count, unit: row.unit, previousOnHand: row.previousOnHand,
      observedAt: row.observedAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null, job: row.job,
    })),
  };
}

export const markReviewedInput = z.object({ id: z.string().min(1).max(200), note: z.string().trim().min(1, "Say what you did about it.").max(1000) }).strict();

/** NEEDS_REVIEW -> REVIEWED with the office's note; on-hand is not changed. */
export async function markFormCountReviewed(actorId: string, raw: unknown) {
  const input = markReviewedInput.parse(raw);
  return db.$transaction(async (tx) => {
    const row = await tx.stockCountObservation.findUnique({ where: { id: input.id }, select: { status: true, reason: true } });
    if (!row) throw new Error("NOT_FOUND");
    if (row.status !== "NEEDS_REVIEW") throw new Error("CONFLICT: Only a count waiting for review can be marked reviewed.");
    const now = new Date();
    await tx.stockCountObservation.update({ where: { id: input.id }, data: { status: "REVIEWED", reason: `${row.reason ?? ""} Reviewed: ${input.note}`.trim(), resolvedAt: now } });
    await tx.auditLog.create({ data: { userId: actorId, action: "STOCK_COUNT_OBSERVATION_REVIEWED", entity: "StockCountObservation", entityId: input.id, after: { note: input.note } } });
    return { id: input.id, status: "REVIEWED" as const };
  });
}
