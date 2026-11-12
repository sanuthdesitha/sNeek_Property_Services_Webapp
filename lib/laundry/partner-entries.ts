import "server-only";
import { LaundryStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { publicUrl } from "@/lib/s3";
import { findForeignUploadKeys } from "@/lib/uploads/ownership-server";
import { FOREIGN_UPLOAD_MESSAGE } from "@/lib/uploads/ownership";
import { propertyIsVisibleToLaundry } from "./teams";
import {
  DROPOFF_PHOTO_ADDED_EVENT,
  PARTNER_WEIGHT_PRICE_EVENT,
  READY_TO_RETURN_EVENT,
  canAddDropoffPhoto,
  canAddWeightPrice,
  canMarkReadyToReturn,
  dropoffPhotoAddSchema,
  partnerMayWriteRun,
  partnerWeightPriceSchema,
  readyToReturnSchema,
} from "./partner-entry-rules";

/**
 * Laundry partner portal write paths (owner decision 2026-11-13): weight and
 * price before drop-off, photos added to a finished drop-off, and "Ready to
 * return". Rules shared by all three, re-checked inside one transaction with
 * the run row locked:
 *  - LAUNDRY accounts only, the real person (the route refuses impersonation);
 *  - the account is active; the run's property is visible to them under the
 *    laundry visibility rule (`propertyIsVisibleToLaundry`, as every portal
 *    action); and the run is not held by ANOTHER laundry partner;
 *  - stale-write guard: the run's `updatedAt` must be the one the screen saw;
 *  - audited: a LaundryConfirmation event (the run's trail, actor =
 *    confirmedById) and an AuditLog row with the actor.
 * Nothing here touches invoices, client charges, dates or planned times.
 */
export class PartnerEntryError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type PartnerEntryViewer = { id: string; role: Role | string };

export type PartnerEntryResult = { taskId: string; status: LaundryStatus; updatedAt: string; bagWeightKg: number | null; dropoffCostAud: number | null };

type LockedRun = {
  id: string;
  jobId: string;
  status: LaundryStatus;
  updatedAt: Date;
  bagWeightKg: number | null;
  dropoffCostAud: number | null;
  supplierId: string | null;
};

function toResult(row: LockedRun): PartnerEntryResult {
  return { taskId: row.id, status: row.status, updatedAt: row.updatedAt.toISOString(), bagWeightKg: row.bagWeightKg, dropoffCostAud: row.dropoffCostAud };
}

/** Lock the run, then check the viewer, scope, partner and version. */
async function lockWritableRun(tx: Prisma.TransactionClient, viewer: PartnerEntryViewer, taskId: string, expectedUpdatedAt: string): Promise<LockedRun> {
  if (viewer.role !== Role.LAUNDRY) throw new PartnerEntryError(403, "Only the laundry team adds these details.");
  await tx.$queryRaw`SELECT "id" FROM "LaundryTask" WHERE "id" = ${taskId} FOR UPDATE`;
  const run = await tx.laundryTask.findUnique({
    where: { id: taskId },
    select: {
      id: true, jobId: true, status: true, updatedAt: true, bagWeightKg: true, dropoffCostAud: true, supplierId: true,
      property: { select: { accessInfo: true, laundryEnabled: true } },
    },
  });
  if (!run) throw new PartnerEntryError(404, "That run was not found.");
  const me = await tx.user.findUnique({ where: { id: viewer.id }, select: { isActive: true, role: true, laundrySupplierId: true } });
  if (!me?.isActive) throw new PartnerEntryError(403, "This account is not active.");
  if (!propertyIsVisibleToLaundry(run.property, viewer.id)) throw new PartnerEntryError(404, "That run is not one you can see.");
  if (!partnerMayWriteRun(run.supplierId, me.laundrySupplierId)) throw new PartnerEntryError(403, "This run belongs to another laundry partner.");
  if (run.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()) {
    throw new PartnerEntryError(409, "This run changed since you opened it. Refresh and check it before saving again.");
  }
  return { id: run.id, jobId: run.jobId, status: run.status, updatedAt: run.updatedAt, bagWeightKg: run.bagWeightKg, dropoffCostAud: run.dropoffCostAud, supplierId: run.supplierId };
}

/** Weight (kg) and/or price for a run at the laundry. Optional fields; at least one. */
export async function recordPartnerWeightPrice(viewer: PartnerEntryViewer, taskId: string, raw: unknown): Promise<PartnerEntryResult> {
  const input = partnerWeightPriceSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const run = await lockWritableRun(tx, viewer, taskId, input.expectedUpdatedAt);
    if (!canAddWeightPrice(run.status)) {
      throw new PartnerEntryError(409, "Weight and price can be added only while the set is at the laundry, before drop-off.");
    }
    const data: Prisma.LaundryTaskUpdateInput = {};
    if (input.weightKg !== undefined) data.bagWeightKg = Number(input.weightKg.toFixed(2));
    if (input.price !== undefined) data.dropoffCostAud = Number(input.price.toFixed(2));
    const updated = await tx.laundryTask.update({
      where: { id: run.id },
      data,
      select: { id: true, jobId: true, status: true, updatedAt: true, bagWeightKg: true, dropoffCostAud: true, supplierId: true },
    });
    const before = { weightKg: run.bagWeightKg, price: run.dropoffCostAud };
    const after = { weightKg: updated.bagWeightKg, price: updated.dropoffCostAud };
    await tx.laundryConfirmation.create({
      data: {
        laundryTaskId: run.id,
        confirmedById: viewer.id,
        laundryReady: true,
        notes: JSON.stringify({
          event: PARTNER_WEIGHT_PRICE_EVENT,
          loadWeightKg: input.weightKg !== undefined ? after.weightKg : undefined,
          totalPrice: input.price !== undefined ? after.price : undefined,
          before,
          notes: input.note || undefined,
        }),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: viewer.id, jobId: run.jobId, action: "LAUNDRY_PARTNER_WEIGHT_PRICE", entity: "LaundryTask", entityId: run.id,
        before: before as Prisma.InputJsonObject,
        after: { ...after, note: input.note ?? null, source: "LAUNDRY_PORTAL" } as Prisma.InputJsonObject,
      },
    });
    return toResult(updated);
  });
}

/** Photos added to a finished drop-off. Append only; one confirmation row per photo. */
export async function addDropoffPhotos(viewer: PartnerEntryViewer, taskId: string, raw: unknown): Promise<PartnerEntryResult & { added: number }> {
  const input = dropoffPhotoAddSchema.parse(raw);
  const keys = Array.from(new Set(input.photoKeys));
  const foreign = await findForeignUploadKeys({ keys, callerId: viewer.id });
  if (foreign.length > 0) throw new PartnerEntryError(403, FOREIGN_UPLOAD_MESSAGE);
  return db.$transaction(async (tx) => {
    const run = await lockWritableRun(tx, viewer, taskId, input.expectedUpdatedAt);
    if (!canAddDropoffPhoto(run.status)) throw new PartnerEntryError(409, "A photo can be added here only after the drop-off is recorded.");
    const batchAt = new Date().toISOString();
    for (const key of keys) {
      await tx.laundryConfirmation.create({
        data: {
          laundryTaskId: run.id,
          confirmedById: viewer.id,
          laundryReady: true,
          s3Key: key,
          photoUrl: publicUrl(key),
          notes: JSON.stringify({ event: DROPOFF_PHOTO_ADDED_EVENT, dropoffPhotoKey: key, addedAt: batchAt, notes: input.note || undefined }),
        },
      });
    }
    // Touch the run so other screens see a new version (nothing else changes).
    const updated = await tx.laundryTask.update({
      where: { id: run.id },
      data: { updatedAt: new Date() },
      select: { id: true, jobId: true, status: true, updatedAt: true, bagWeightKg: true, dropoffCostAud: true, supplierId: true },
    });
    await tx.auditLog.create({
      data: {
        userId: viewer.id, jobId: run.jobId, action: "LAUNDRY_DROPOFF_PHOTO_ADDED", entity: "LaundryTask", entityId: run.id,
        after: { photoKeys: keys, note: input.note ?? null, source: "LAUNDRY_PORTAL" } as Prisma.InputJsonObject,
      },
    });
    return { ...toResult(updated), added: keys.length };
  });
}

/** Mark a picked-up set "Ready to return". Optional: a run may still go straight to dropped. */
export async function markReadyToReturn(viewer: PartnerEntryViewer, taskId: string, raw: unknown): Promise<PartnerEntryResult> {
  const input = readyToReturnSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const run = await lockWritableRun(tx, viewer, taskId, input.expectedUpdatedAt);
    if (!canMarkReadyToReturn(run.status)) {
      throw new PartnerEntryError(409, run.status === LaundryStatus.READY_TO_RETURN ? "This set is already marked ready to return." : "Only a set that is picked up can be marked ready to return.");
    }
    const updated = await tx.laundryTask.update({
      where: { id: run.id },
      data: { status: LaundryStatus.READY_TO_RETURN },
      select: { id: true, jobId: true, status: true, updatedAt: true, bagWeightKg: true, dropoffCostAud: true, supplierId: true },
    });
    await tx.laundryConfirmation.create({
      data: {
        laundryTaskId: run.id,
        confirmedById: viewer.id,
        laundryReady: true,
        notes: JSON.stringify({ event: READY_TO_RETURN_EVENT, notes: input.note || undefined }),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: viewer.id, jobId: run.jobId, action: "LAUNDRY_READY_TO_RETURN", entity: "LaundryTask", entityId: run.id,
        before: { status: run.status } as Prisma.InputJsonObject,
        after: { status: updated.status, note: input.note ?? null, source: "LAUNDRY_PORTAL" } as Prisma.InputJsonObject,
      },
    });
    return toResult(updated);
  });
}
