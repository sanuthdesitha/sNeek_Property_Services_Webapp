import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { publicUrl, resolveS3 } from "@/lib/s3";
import { isAllowedUploadContentType } from "@/lib/uploads/validate";
import { propertyIsVisibleToLaundry } from "./teams";
import { cleanerBagBaseline } from "./quantity-baseline";
export class QuantityPickupError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function recordQuantityPickup(input: { taskId: string; actorId: string; role: Role; bagCount: number; pickupReadiness?: "READY" | "NOT_READY"; photoKey?: string; keyPhotoKey?: string; notes?: string; discrepancyReason?: string; baselineId?: string | null }) {
  if (!Number.isInteger(input.bagCount) || input.bagCount < 1 || input.bagCount > 50) throw new QuantityPickupError(400, "Record 1–50 actual bags. If none were collected, report a failed pickup.");
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "LaundryTask" WHERE "id" = ${input.taskId} FOR UPDATE`;
    const task = await tx.laundryTask.findUnique({ where: { id: input.taskId }, include: { confirmations: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
    if (!task) throw new QuantityPickupError(404, "Task not found.");
    await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ${task.propertyId} FOR SHARE`;
    const property = await tx.property.findUnique({ where: { id: task.propertyId } });
    if (input.role === Role.LAUNDRY && !propertyIsVisibleToLaundry(property, input.actorId)) throw new QuantityPickupError(403, "This laundry task is no longer available to you.");
    if (!["PENDING", "CONFIRMED"].includes(task.status)) throw new QuantityPickupError(409, "Task status changed. Refresh before confirming pickup.");
    if (task.status === "PENDING" && !input.pickupReadiness) throw new QuantityPickupError(400, "Tell us whether the linen was ready.");
    const baseline = cleanerBagBaseline(task.confirmations);
    if ((input.baselineId ?? null) !== (baseline?.confirmationId ?? null)) throw new QuantityPickupError(409, "The expected bag count changed. Refresh and review it before pickup.");
    const discrepancy = baseline !== null && baseline.count !== input.bagCount;
    if (discrepancy) {
      if (!input.discrepancyReason?.trim()) throw new QuantityPickupError(400, "Explain the difference between expected and actual bags.");
      const prefix = `laundry/pickup/${input.actorId}/`;
      if (!input.photoKey?.startsWith(prefix) || !/^[a-f0-9-]+\.[a-z0-9]+$/i.test(input.photoKey.slice(prefix.length))) throw new QuantityPickupError(400, "Add a pickup photo uploaded by you.");
      const { client, bucket } = await resolveS3(); let object;
      try { object = await client.headObject({ Bucket: bucket, Key: input.photoKey }).promise(); } catch { throw new QuantityPickupError(400, "Pickup photo could not be verified. Retry the photo upload."); }
      if (!object.ContentLength || !object.ContentType?.startsWith("image/") || !isAllowedUploadContentType(object.ContentType, input.photoKey)) throw new QuantityPickupError(400, "Discrepancy proof must be a verified image.");
    }
    const pickedUpAt = new Date();
    const updated = await tx.laundryTask.update({ where: { id: task.id }, data: { status: "PICKED_UP", pickedUpAt, pickupKeyPhotoUrl: input.keyPhotoKey ? publicUrl(input.keyPhotoKey) : null, ...(input.notes ? { flagNotes: input.notes } : {}) } });
    const confirmation = await tx.laundryConfirmation.create({ data: { laundryTaskId: task.id, confirmedById: input.actorId, laundryReady: true, s3Key: input.photoKey ?? null, photoUrl: input.photoKey ? publicUrl(input.photoKey) : null,
      notes: JSON.stringify({ event: "PICKED_UP", unit: "bags", bagCount: input.bagCount, expectedBagCount: baseline?.count ?? null, expectedBaseline: baseline, pickupReadiness: input.pickupReadiness, pickupPhotoKey: input.photoKey, pickupKeyPhotoKey: input.keyPhotoKey, notes: input.notes }) } });
    if (discrepancy && baseline) {
      const exception = await tx.laundryQuantityException.create({ data: { laundryTaskId: task.id, originalTaskId: task.id, propertyId: task.propertyId, jobId: task.jobId, pickupConfirmationId: confirmation.id, expectedCount: baseline.count, actualCount: input.bagCount, baseline, reason: input.discrepancyReason!.trim(), photoKey: input.photoKey!, photoUrl: publicUrl(input.photoKey!), reportedById: input.actorId } });
      await tx.auditLog.create({ data: { userId: input.actorId, jobId: task.jobId, action: "LAUNDRY_QUANTITY_EXCEPTION_OPENED", entity: "LaundryQuantityException", entityId: exception.id, after: { expectedCount: baseline.count, actualCount: input.bagCount, unit: "bags", pickupConfirmationId: confirmation.id } } });
    }
    return updated;
  }, { timeout: 15000 });
}
