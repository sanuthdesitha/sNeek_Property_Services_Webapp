import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { publicUrl, resolveS3 } from "@/lib/s3";
import { isAllowedUploadContentType } from "@/lib/uploads/validate";
import { propertyIsVisibleToLaundry } from "./teams";
import { enqueueNotificationIntent } from "@/lib/notifications/intent-store";

export class FailedPickupError extends Error { constructor(public status: number, message: string) { super(message); } }
export function validFailurePhotoKey(key: string, taskId: string, actorId: string) {
  const prefix = `laundry/failed-pickup/${taskId}/${actorId}/`;
  return key.startsWith(prefix) && /^[a-f0-9-]+\.[a-z0-9]+$/i.test(key.slice(prefix.length));
}
export async function recordFailedPickup(input: { taskId: string; actorId: string; role: Role; status: "FAILED_PICKUP_RESCHEDULE" | "FAILED_PICKUP_REQUEST"; reason: string; notes?: string; photoKey?: string; date?: string; requestedAction?: "SKIP" | "DELETE" }) {
  const reason = input.reason.trim();
  if (!reason) throw new FailedPickupError(400, "A failed pickup reason is required.");
  if (input.photoKey) {
    if (!validFailurePhotoKey(input.photoKey, input.taskId, input.actorId)) throw new FailedPickupError(400, "The failure photo does not belong to this task and uploader.");
    const { client, bucket } = await resolveS3();
    let object;
    try { object = await client.headObject({ Bucket: bucket, Key: input.photoKey }).promise(); }
    catch { throw new FailedPickupError(409, "The failure photo could not be verified. Keep the original and retry verification."); }
    if (!object.ContentLength || !object.ContentType?.startsWith("image/") || !isAllowedUploadContentType(object.ContentType, input.photoKey)) throw new FailedPickupError(400, "Failure proof must be a verified image.");
  }
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "LaundryTask" WHERE "id" = ${input.taskId} FOR UPDATE`;
    const task = await tx.laundryTask.findUnique({ where: { id: input.taskId }, include: { property: true } });
    if (!task) throw new FailedPickupError(404, "Laundry task not found.");
    await tx.$queryRaw`SELECT "id" FROM "Property" WHERE "id" = ${task.propertyId} FOR SHARE`;
    const property = await tx.property.findUnique({ where: { id: task.propertyId } });
    if (input.role === Role.LAUNDRY && !propertyIsVisibleToLaundry(property, input.actorId)) throw new FailedPickupError(403, "You cannot access this property's laundry schedule.");
    if (!["PENDING", "CONFIRMED"].includes(task.status)) throw new FailedPickupError(409, "Task status changed. Refresh before reporting a failed pickup.");
    const reschedule = input.status === "FAILED_PICKUP_RESCHEDULE";
    const date = input.date ? new Date(input.date) : null;
    if (reschedule && (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) <= task.pickupDate.toISOString().slice(0, 10) || date.toISOString().slice(0, 10) > task.dropoffDate.toISOString().slice(0, 10))) throw new FailedPickupError(400, "New pickup date must be later than the current pickup and no later than drop-off. Request office approval if no date fits.");
    if (!reschedule && !input.requestedAction) throw new FailedPickupError(400, "Choose skip or delete approval.");
    const after = reschedule ? { status: "CONFIRMED" as const, pickupDate: date! } : { status: "FLAGGED" as const, flagNotes: `Failed pickup - ${input.requestedAction!.toLowerCase()} approval requested: ${reason}` };
    const updated = await tx.laundryTask.update({ where: { id: task.id }, data: after });
    const confirmation = await tx.laundryConfirmation.create({ data: { laundryTaskId: task.id, confirmedById: input.actorId, laundryReady: true,
      s3Key: input.photoKey ?? null, photoUrl: input.photoKey ? publicUrl(input.photoKey) : null,
      notes: JSON.stringify({ event: input.status, reason, notes: input.notes, previousStatus: task.status, previousPickupDate: task.pickupDate.toISOString(),
        ...(reschedule ? { rescheduledPickupDate: date!.toISOString() } : { requestedAction: input.requestedAction, approvalStatus: "PENDING" }) }) } });
    await tx.auditLog.create({ data: { userId: input.actorId, jobId: task.jobId, action: reschedule ? "LAUNDRY_FAILED_PICKUP_RESCHEDULED" : "LAUNDRY_FAILED_PICKUP_APPROVAL_REQUESTED", entity: "LaundryTask", entityId: task.id,
      before: { status: task.status, pickupDate: task.pickupDate.toISOString() }, after: { status: after.status, reason, ...(reschedule ? { pickupDate: date!.toISOString() } : { requestedAction: input.requestedAction }), ...(input.photoKey ? { failurePhotoKey: input.photoKey } : {}) } } });
    const recipients = await tx.user.findMany({ where: { role: { in: [Role.ADMIN, Role.OPS_MANAGER] }, isActive: true, id: { not: input.actorId } }, select: { id: true, role: true } });
    for (const recipient of recipients) await enqueueNotificationIntent(tx, {
      version: 1, eventId: confirmation.id, eventKey: "laundry.failed_pickup", entity: { type: "LaundryTask", id: task.id },
      actorId: input.actorId, recipient: { userId: recipient.id, role: recipient.role, scope: { kind: "ADMIN_OPERATIONS" } },
      severity: "ACTION", transport: "INBOX", jobId: task.jobId,
      subject: reschedule ? "Laundry pickup rescheduled" : "Laundry pickup approval requested",
      body: `${property?.name ?? task.property.name}: ${reschedule ? "pickup rescheduled after failed attempt" : `${input.requestedAction?.toLowerCase()} approval requested after failed pickup`}.`,
    });
    return { ...updated, notificationStatus: recipients.length ? "QUEUED" as const : "NO_RECIPIENTS" as const };
  });
}
