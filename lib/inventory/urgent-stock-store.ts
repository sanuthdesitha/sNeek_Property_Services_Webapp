/**
 * Table storage for urgent stock needs and their history.
 *
 * Needs and events used to live in `urgent_stock_v1:*` AppSetting JSON. The
 * migration 20261111200000 copied every readable row into UrgentStockNeed /
 * UrgentStockEvent with its id; the old rows stay in AppSetting for this
 * release and are no longer read. These mappers return EXACTLY the JSON shapes
 * the old store returned (same keys, same order, same ISO strings), so every
 * existing caller of lib/inventory/urgent-stock.ts sees the same responses.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, UrgentStockEvent, UrgentStockNeed } from "@prisma/client";
import type { UrgentStockStage } from "./urgent-stock-policy";
import { URGENT_STOCK_STAGES } from "./urgent-stock-policy";

type Tx = Prisma.TransactionClient;

/** The record shape callers have always received (formerly the JSON value). */
export type UrgentNeed = {
  id: string; propertyId: string; itemId: string; propertyName: string; itemName: string; unit: string;
  stage: UrgentStockStage; createdAt: string; updatedAt: string; version: number;
  observedCount: number | null; purchaseQuantity: number | null; observedAt: string | null;
  observationDisposition: string; note: string; lastReminderAt: string | null; remindersSent: number;
};

/** The history entry shape callers have always received. */
export type UrgentNeedEventRecord = {
  reportId: string;
  propertyId: string;
  actorId: string | null;
  actorName: string;
  kind: string;
  at: string;
  detail: unknown;
};

export function needFromRow(row: UrgentStockNeed): UrgentNeed {
  return {
    id: row.id,
    propertyId: row.propertyId,
    itemId: row.itemId,
    propertyName: row.propertyName,
    itemName: row.itemName,
    unit: row.unit,
    stage: row.stage as UrgentStockStage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    observedCount: row.observedCount,
    purchaseQuantity: row.purchaseQuantity,
    observedAt: row.observedAt,
    observationDisposition: row.observationDisposition,
    note: row.note,
    lastReminderAt: row.lastReminderAt ? row.lastReminderAt.toISOString() : null,
    remindersSent: row.remindersSent,
  };
}

export function eventFromRow(row: UrgentStockEvent): UrgentNeedEventRecord {
  return {
    reportId: row.needId,
    propertyId: row.propertyId,
    actorId: row.actorId,
    actorName: row.actorName,
    kind: row.kind,
    at: row.at.toISOString(),
    detail: row.detail,
  };
}

/** The columns a need write sets, from the record shape. */
function needColumns(need: UrgentNeed) {
  return {
    propertyId: need.propertyId,
    itemId: need.itemId,
    propertyName: need.propertyName,
    itemName: need.itemName,
    unit: need.unit,
    stage: need.stage,
    version: need.version,
    observedCount: need.observedCount,
    purchaseQuantity: need.purchaseQuantity,
    observedAt: need.observedAt,
    observationDisposition: need.observationDisposition,
    note: need.note,
    lastReminderAt: need.lastReminderAt ? new Date(need.lastReminderAt) : null,
    remindersSent: need.remindersSent,
    createdAt: new Date(need.createdAt),
    updatedAt: new Date(need.updatedAt),
  };
}

/** Wave F: where a need was reported from (job, and the form submission when it came from one). */
export type NeedSource = { jobId: string; submissionId: string | null };

export type NeedWriteOptions = {
  /** Set while the need is open; null closes the property+item slot. */
  openPairKey: string | null;
  /** Only on the first write of a need. */
  reporter?: { id: string; name: string | null };
  /** Only on the first write of a need. */
  source?: NeedSource;
};

export async function writeNeed(tx: Tx, need: UrgentNeed, options: NeedWriteOptions) {
  const columns = { ...needColumns(need), openPairKey: options.openPairKey };
  await tx.urgentStockNeed.upsert({
    where: { id: need.id },
    create: {
      id: need.id,
      ...columns,
      reportedById: options.reporter?.id ?? null,
      reportedByName: options.reporter?.name ?? null,
      sourceJobId: options.source?.jobId ?? null,
      sourceSubmissionId: options.source?.submissionId ?? null,
    },
    update: columns,
  });
}

export async function readNeed(tx: Tx, id: string): Promise<UrgentNeed | undefined> {
  const row = await tx.urgentStockNeed.findUnique({ where: { id } });
  return row ? needFromRow(row) : undefined;
}

export async function readOpenNeed(tx: Tx, openPairKey: string): Promise<UrgentNeed | undefined> {
  const row = await tx.urgentStockNeed.findUnique({ where: { openPairKey } });
  return row ? needFromRow(row) : undefined;
}

const STAGE_SET = new Set<string>(URGENT_STOCK_STAGES);

/** The note a person gave for this entry, for the history column. */
function eventNote(kind: string, detail: Record<string, unknown>): string | null {
  const value = STAGE_SET.has(kind) ? detail.reason : kind === "REPORTED" || kind === "REPORT_UPDATED" ? detail.note : null;
  return typeof value === "string" ? value : null;
}

export type NeedEventInput = {
  actorId: string | null;
  actorName: string;
  kind: string;
  fromStage: UrgentStockStage | null;
  detail: Record<string, unknown>;
};

/** Append-only history. `at` is the need's updatedAt, as before. */
export async function appendNeedEvent(tx: Tx, need: UrgentNeed, input: NeedEventInput) {
  await tx.urgentStockEvent.create({
    data: {
      id: randomUUID(),
      needId: need.id,
      propertyId: need.propertyId,
      actorId: input.actorId,
      actorName: input.actorName,
      kind: input.kind,
      fromStage: input.fromStage,
      toStage: STAGE_SET.has(input.kind) ? input.kind : null,
      note: eventNote(input.kind, input.detail),
      detail: input.detail as Prisma.InputJsonValue,
      at: new Date(need.updatedAt),
    },
  });
}
