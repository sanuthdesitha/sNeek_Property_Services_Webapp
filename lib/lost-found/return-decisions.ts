import "server-only";
/**
 * Deciding a guest's return request (2026-11-20): approve (as asked or with
 * changes), decline, complete, the client's review, and the job hooks.
 *
 * Approve, in ONE transaction under the item and request locks:
 *  - the request (version checked) becomes APPROVED with what was confirmed;
 *  - when a job is chosen, one handover JobTask through the JobTask service
 *    (`syncAdminJobTasks`, deterministic id per approval, so a retry cannot add
 *    a second), visible to the cleaner, photo required;
 *  - the item moves to Return offered through the transition table.
 * After commit: the cleaner notice (explicit transports) and the guest message
 * (the exact text the office saw; one send per decision key). A retry with the
 * same decision key answers from the record and sends nothing again.
 *
 * A fee recorded here is the quote shown to the guest. It creates no invoice,
 * charge or payment; NOT_SET stays "not set", never $0.
 */
import { Prisma, type LostFoundReturnRequest } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { syncAdminJobTasks } from "@/lib/job-tasks/service";
import { sendGuestMessage, GuestMessageError } from "@/lib/notifications/guest-message";
import { isValidExternalAddress } from "@/lib/notifications/external-recipient";
import type { OfficeActorRole } from "@/lib/notifications/office-send-rules";
import type { OfficeSendTransport } from "@/lib/notifications/office-sends";
import { GUEST_SMS_MAX_CHARS, guestSendOutcome } from "./message";
import { LostFoundRuleError, statusChangeData } from "./mutations";
import { parsePhotos } from "./service";
import { lostFoundPhotoSrc } from "./photo-src";
import { activeGuestLink, guestLinkToken, guestPhotoUrl } from "./guest-link";
import { buildGuestItemEmail } from "./guest-email";
import { readLostFoundSettings } from "./settings";
import {
  ATTENTION_LABEL,
  cleanerTaskText,
  describeConfiguredFee,
  describeFee,
  describeRequestChoice,
  draftDecisionMessage,
  formatReturnAddress,
  parseFeeCents,
  parseReturnAddress,
  RETURN_METHODS,
  RETURN_METHOD_SHORT,
  type ReturnMethod,
} from "./return-rules";
import { guestRequestView, liveArrangements, ReturnRequestError } from "./return-requests";
import { isUpcomingJobAtProperty, jobDay, upcomingJobsForOffice } from "./return-upcoming";
import { LOST_FOUND_RETURN_TASK_KIND } from "./return-task-hook";
import { notifyCleanersOfTask, notifyOfficeOfReturn } from "./return-notices";
import type { GuestMessageRecord, OfficeReturnPanel, OfficeReturnRequestView } from "./return-view-types";

type Tx = Prisma.TransactionClient;

export { FEE_DISCLAIMER } from "./return-rules";

// ── Input ────────────────────────────────────────────────────────────────────

const decisionKeySchema = z.string().trim().regex(/^[A-Za-z0-9:_-]{8,80}$/);

const messageSchema = z.object({
  send: z.enum(["EMAIL", "SMS", "NONE"]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(1000),
}).strict();

export const approveSchema = z.object({
  action: z.literal("approve"),
  version: z.number().int().min(1),
  decisionKey: decisionKeySchema,
  method: z.enum(RETURN_METHODS),
  jobId: z.string().trim().max(64).optional().nullable(),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  time: z.string().trim().max(120).optional().nullable(),
  feeState: z.enum(["NOT_SET", "NO_FEE", "QUOTED"]),
  feeAmount: z.string().trim().max(20).optional().nullable(),
  feeNote: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  shareContactWithCleaner: z.boolean().default(false),
  cleanerTransports: z.array(z.enum(["INBOX", "PUSH", "EMAIL"])).max(3).default(["INBOX"]),
  message: messageSchema,
}).strict();

export const declineSchema = z.object({
  action: z.literal("decline"),
  version: z.number().int().min(1),
  decisionKey: decisionKeySchema,
  note: z.string().trim().min(3, "Give the guest a reason.").max(1000),
  message: messageSchema,
}).strict();

export const completeSchema = z.object({
  action: z.literal("complete"),
  version: z.number().int().min(1),
  note: z.string().trim().min(3, "Say how it went back (for the timeline).").max(1000),
  trackingReference: z.string().trim().max(120).optional().nullable(),
}).strict();

export type ApproveInput = z.infer<typeof approveSchema>;
export type DeclineInput = z.infer<typeof declineSchema>;

export type DecisionActor = { id: string; role: OfficeActorRole | "CLIENT"; name: string };

/** Whether the guest message may be sent from the app by this actor, with the reason when not. */
export type GuestSendPermission = { allowed: boolean; reason: string | null };

const blank = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

async function lockRequest(tx: Tx, itemId: string, requestId: string): Promise<LostFoundReturnRequest> {
  await tx.$queryRaw`SELECT "id" FROM "LostFoundItem" WHERE "id" = ${itemId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "LostFoundReturnRequest" WHERE "id" = ${requestId} FOR UPDATE`;
  const row = await tx.lostFoundReturnRequest.findUnique({ where: { id: requestId } });
  if (!row || row.itemId !== itemId) throw new ReturnRequestError(404, "That request was not found.", "NOT_FOUND");
  return row;
}

// ── The guest message for a decision ─────────────────────────────────────────

function guestAddress(row: LostFoundReturnRequest, transport: "EMAIL" | "SMS"): string | null {
  const value = transport === "EMAIL" ? row.contactEmail : row.contactPhone;
  return isValidExternalAddress(transport, value) ? value : null;
}

/**
 * Sends (or records not sending) the decision message, exactly as the office
 * saw it, and keeps the text and the answer on the request and the timeline.
 * One send per request + decision key: a retry is answered "already requested".
 */
export async function sendDecisionGuestMessage(input: {
  row: LostFoundReturnRequest;
  actor: DecisionActor;
  permission: GuestSendPermission;
  message: z.infer<typeof messageSchema>;
  decision: "approve" | "decline";
  decisionKey: string;
}): Promise<GuestMessageRecord> {
  const { row, actor, message } = input;
  const at = new Date().toISOString();
  const base = { subject: message.subject, body: message.body, at };
  let record: GuestMessageRecord;
  if (message.send === "NONE") {
    record = { ...base, transport: "NONE", to: null, state: "not_sent", note: "Not sent from the app: the office chose to contact the guest itself. Copy the message from here." };
  } else if (message.send === "SMS" && message.body.length > GUEST_SMS_MAX_CHARS) {
    record = { ...base, transport: "SMS", to: null, state: "not_sent", note: `Not sent: a text can be up to ${GUEST_SMS_MAX_CHARS} characters (this one has ${message.body.length}); longer texts are cut off. Copy the message from here, or send by email.` };
  } else if (!input.permission.allowed) {
    record = { ...base, transport: message.send, to: null, state: "not_sent", note: `Not sent: ${input.permission.reason ?? "you may not send guest messages from the app"} Copy the message from here.` };
  } else {
    const to = guestAddress(row, message.send);
    if (!to) {
      record = { ...base, transport: message.send, to: null, state: "not_sent", note: `Not sent: the guest gave no ${message.send === "EMAIL" ? "email address" : "phone number"}. Copy the message from here.` };
    } else {
      const item = await db.lostFoundItem.findUnique({ where: { id: row.itemId }, select: { photos: true } });
      const link = await activeGuestLink(row.itemId);
      const linkRow = link ? await db.lostFoundGuestLink.findUnique({ where: { id: link.id } }) : null;
      const token = linkRow ? guestLinkToken(linkRow) : null;
      const email = message.send === "EMAIL"
        ? await buildGuestItemEmail({ subject: message.subject, body: message.body, token, linkUrl: link?.url ?? null, hasPhoto: parsePhotos(item?.photos).length > 0 })
        : undefined;
      try {
        const result = await sendGuestMessage(actor.id, {
          lostFoundItemId: row.itemId,
          transport: message.send,
          to,
          subject: message.subject,
          body: message.body,
          idempotencyKey: `lfr-${input.decision}:${row.id}:${input.decisionKey}`.slice(0, 80),
        }, new Date(), actor.role === "CLIENT" ? null : actor.role, email);
        const outcome = guestSendOutcome(message.send, result);
        record = { ...base, transport: message.send, to, state: result.state, note: outcome.note };
      } catch (err) {
        const reason = err instanceof GuestMessageError ? err.message : "the message could not be sent";
        if (!(err instanceof GuestMessageError)) logger.error({ err, requestId: row.id }, "lost and found: decision message failed");
        record = { ...base, transport: message.send, to, state: "failed", note: `Not sent: ${reason} Copy the message from here.` };
      }
    }
  }
  const sent = record.state === "provider_accepted";
  await db.$transaction([
    db.lostFoundReturnRequest.update({ where: { id: row.id }, data: { guestMessage: record as unknown as Prisma.InputJsonValue } }),
    db.lostFoundEvent.create({
      data: {
        itemId: row.itemId,
        userId: actor.id,
        action: sent ? "RETURN_GUEST_MESSAGE" : record.state === "already_requested" ? "COMMENT" : "MESSAGE_NOT_SENT",
        note: `${record.note}\n\nMessage${sent ? " sent" : ""}:\nSubject: ${record.subject}\n\n${record.body}`.slice(0, 4000),
        meta: { requestId: row.id, decision: input.decision, transport: record.transport, state: record.state, sentByApp: sent, deliveryConfirmed: false } as Prisma.InputJsonValue,
      },
    }),
  ]);
  return record;
}

// ── Approve ──────────────────────────────────────────────────────────────────

export type DecisionResult = { request: OfficeReturnRequestView | null; replayed: boolean; guestMessage: GuestMessageRecord | null; cleanerNotice: Array<{ name: string; transport: string; state: string }> };

function feeFields(input: Pick<ApproveInput, "feeState" | "feeAmount" | "feeNote">) {
  if (input.feeState !== "QUOTED") return { feeState: input.feeState, feeCents: null, feeNote: blank(input.feeNote) };
  const cents = parseFeeCents(input.feeAmount);
  if (cents === null) throw new ReturnRequestError(400, "Enter the fee as dollars and cents (for example 15 or 15.50), or choose No fee or Not set.", "INVALID");
  return { feeState: "QUOTED" as const, feeCents: cents, feeNote: blank(input.feeNote) };
}

export async function approveReturnRequest(
  itemId: string,
  requestId: string,
  raw: unknown,
  actor: DecisionActor,
  permission: GuestSendPermission,
  now: Date = new Date(),
): Promise<DecisionResult> {
  const input = approveSchema.parse(raw);
  const fee = feeFields(input);
  const app = await getAppSettings();
  const timeZone = app.timezone || "Australia/Sydney";
  if (input.method === "PICKUP_AT_CLEAN" && !blank(input.jobId)) throw new ReturnRequestError(400, "Choose the clean for the pickup.", "INVALID");

  const outcome = await db.$transaction(async (tx) => {
    const row = await lockRequest(tx, itemId, requestId);
    if (row.decisionKey === input.decisionKey && (row.status === "APPROVED" || row.status === "COMPLETED")) return { row, replayed: true as const, taskId: row.jobTaskId, taskText: null as string | null };
    if (row.status !== "PENDING" && row.status !== "APPROVED") throw new ReturnRequestError(409, `This request is ${row.status.toLowerCase()}; it cannot be approved.`, "NOT_PENDING");
    if (row.version !== input.version) throw new ReturnRequestError(409, "This request changed (the guest or someone else updated it). Reload to see it.", "STALE");
    const item = await tx.lostFoundItem.findUniqueOrThrow({ where: { id: itemId } });

    let job: { id: string; scheduledDate: Date; jobNumber: string | null } | null = null;
    if (blank(input.jobId)) {
      if (!item.propertyId) throw new ReturnRequestError(409, "This item has no property, so no clean can be chosen.", "NO_PROPERTY");
      job = await isUpcomingJobAtProperty(tx, input.jobId!, item.propertyId, timeZone, now);
      if (!job) throw new ReturnRequestError(409, "That clean is no longer upcoming at this property. Choose another.", "STALE_JOB");
    }
    const confirmedDate = job ? jobDay(job.scheduledDate) : blank(input.date);

    // A re-arrangement takes the earlier handover task off its job (kept, cancelled).
    if (row.status === "APPROVED" && row.jobTaskId) {
      await tx.jobTask.updateMany({ where: { id: row.jobTaskId, executionStatus: "OPEN" }, data: { executionStatus: "CANCELLED", visibleToCleaner: false } });
      await tx.jobTaskEvent.create({ data: { taskId: row.jobTaskId, actorUserId: actor.id, action: "ADMIN_TASK_CANCELLED", note: "Lost property handover re-arranged by the office." } });
    }

    let taskId: string | null = null;
    let taskText: string | null = null;
    let cleanerIds: string[] = [];
    if (job && item.propertyId) {
      const property = await tx.property.findUnique({ where: { id: item.propertyId }, select: { clientId: true } });
      const contact = input.shareContactWithCleaner ? [row.contactPhone, row.contactEmail].filter(Boolean).join(", ") || null : null;
      const task = cleanerTaskText({ itemName: item.itemName, storageLocation: item.storageLocation, guestName: row.contactName, time: blank(input.time), date: confirmedDate, contact, note: null });
      const synced = await syncAdminJobTasks({
        jobId: job.id,
        propertyId: item.propertyId,
        clientId: property?.clientId ?? null,
        actorUserId: actor.id,
        database: tx,
        tasks: [{ id: `lfr-${row.id}-v${row.version + 1}`, title: task.title, description: task.description, requiresPhoto: true, requiresNote: false, metadata: { kind: LOST_FOUND_RETURN_TASK_KIND, lostFoundItemId: item.id, returnRequestId: row.id, highVisibility: true } }],
      });
      taskId = synced.canonicalTasks[0]?.id ?? null;
      taskText = `${task.title}\n${task.description}`;
      const first = parsePhotos(item.photos)[0];
      if (taskId && first) {
        await tx.jobTaskAttachment.create({ data: { taskId, uploadedByUserId: actor.id, kind: "REQUEST_REFERENCE", url: first.url, s3Key: first.key, label: "The item" } });
      }
      const assignments = await tx.jobAssignment.findMany({ where: { jobId: job.id, removedAt: null }, select: { userId: true } });
      cleanerIds = assignments.map((assignment) => assignment.userId);
    }

    const updated = await tx.lostFoundReturnRequest.update({
      where: { id: row.id },
      data: {
        status: "APPROVED",
        version: { increment: 1 },
        decisionKey: input.decisionKey,
        decidedById: actor.id,
        decidedByRole: actor.role,
        decidedAt: now,
        decisionNote: blank(input.note),
        confirmedMethod: input.method,
        confirmedJobId: job?.id ?? null,
        confirmedDate,
        confirmedTime: blank(input.time),
        ...fee,
        shareContactWithCleaner: input.shareContactWithCleaner,
        jobTaskId: taskId,
        taskCleanerIds: cleanerIds,
        attentionReason: null,
        attentionAt: null,
        guestMessage: Prisma.DbNull,
      },
    });

    let statusMove = "";
    try {
      const change = statusChangeData(item, { status: "RETURN_OFFERED", note: "Return approved." }, actor.id, now);
      if (change.kind !== "same") {
        await tx.lostFoundItem.update({ where: { id: item.id }, data: change.data });
        statusMove = " The item moved to Return arranged.";
      }
    } catch (err) {
      if (!(err instanceof LostFoundRuleError)) throw err;
      throw new ReturnRequestError(409, "This item is closed. Reopen it first, with a reason, to arrange a return.", "CLOSED");
    }
    const changed = input.method !== row.method || (row.requestedJobId ?? null) !== (job?.id ?? null);
    const arrangement = [
      RETURN_METHOD_SHORT[input.method],
      confirmedDate ? `on ${confirmedDate}` : null,
      blank(input.time),
      job ? `task on job ${job.jobNumber ?? job.id}` : null,
    ].filter(Boolean).join(", ");
    await tx.lostFoundEvent.create({
      data: {
        itemId: item.id,
        userId: actor.id,
        action: "RETURN_APPROVED",
        note: `${actor.role === "CLIENT" ? `Approved by the client (${actor.name})` : changed ? "Approved with changes" : "Approved as asked"}: ${arrangement}. Fee: ${describeFee(fee.feeState, fee.feeCents, fee.feeNote)} (a quote; nothing is charged).${statusMove}`,
        meta: { requestId: row.id, method: input.method, jobId: job?.id ?? null, confirmedDate, jobTaskId: taskId, feeState: fee.feeState, feeCents: fee.feeCents, changedFromRequest: changed, actorRole: actor.role } as Prisma.InputJsonValue,
      },
    });
    return { row: updated, replayed: false as const, taskId, taskText };
  });

  let cleanerNotice: DecisionResult["cleanerNotice"] = [];
  let guestMessage: GuestMessageRecord | null = (outcome.row.guestMessage as unknown as GuestMessageRecord | null) ?? null;
  if (!outcome.replayed) {
    if (outcome.taskId && outcome.taskText && outcome.row.confirmedJobId) {
      const transports = Array.from(new Set(input.cleanerTransports)) as OfficeSendTransport[];
      try {
        const results = await notifyCleanersOfTask({ jobId: outcome.row.confirmedJobId, taskId: outcome.taskId, requestId: outcome.row.id, actorId: actor.id, transports, taskText: outcome.taskText });
        cleanerNotice = results.map((result) => ({ name: result.name, transport: result.transport, state: result.state }));
      } catch (err) {
        logger.error({ err, requestId: outcome.row.id }, "lost and found: cleaner notice failed");
        cleanerNotice = [{ name: "Cleaners", transport: transports.join(", "), state: "failed" }];
      }
      await db.lostFoundEvent.create({
        data: {
          itemId,
          userId: actor.id,
          action: "COMMENT",
          note: cleanerNotice.length
            ? `Cleaner told about the handover task: ${cleanerNotice.map((row) => `${row.name} (${row.transport}): ${row.state.replace(/_/g, " ")}`).join("; ")}. None of these confirms it was read.`
            : "No cleaner is assigned to that clean yet, so nobody was told. The task is on the job for whoever is assigned.",
          meta: { requestId: outcome.row.id, jobTaskId: outcome.taskId, cleanerNotice } as Prisma.InputJsonValue,
        },
      });
    }
  }
  if (!guestMessage) {
    guestMessage = await sendDecisionGuestMessage({ row: outcome.row, actor, permission, message: input.message, decision: "approve", decisionKey: input.decisionKey });
  }
  return { request: await officeRequestView(itemId, outcome.row.id), replayed: outcome.replayed, guestMessage, cleanerNotice };
}

// ── Decline ──────────────────────────────────────────────────────────────────

export async function declineReturnRequest(itemId: string, requestId: string, raw: unknown, actor: DecisionActor, permission: GuestSendPermission, now: Date = new Date()): Promise<DecisionResult> {
  const input = declineSchema.parse(raw);
  const outcome = await db.$transaction(async (tx) => {
    const row = await lockRequest(tx, itemId, requestId);
    if (row.decisionKey === input.decisionKey && row.status === "DECLINED") return { row, replayed: true };
    if (row.status !== "PENDING") throw new ReturnRequestError(409, `This request is ${row.status.toLowerCase()}; only a waiting request can be declined.`, "NOT_PENDING");
    if (row.version !== input.version) throw new ReturnRequestError(409, "This request changed (the guest or someone else updated it). Reload to see it.", "STALE");
    const updated = await tx.lostFoundReturnRequest.update({
      where: { id: row.id },
      data: { status: "DECLINED", version: { increment: 1 }, decisionKey: input.decisionKey, decidedById: actor.id, decidedByRole: actor.role, decidedAt: now, decisionNote: input.note },
    });
    await tx.lostFoundEvent.create({ data: { itemId, userId: actor.id, action: "RETURN_DECLINED", note: `Return request declined. Reason given to the guest: ${input.note}`, meta: { requestId: row.id } } });
    return { row: updated, replayed: false };
  });
  const existing = (outcome.row.guestMessage as unknown as GuestMessageRecord | null) ?? null;
  const guestMessage = existing ?? (await sendDecisionGuestMessage({ row: outcome.row, actor, permission, message: input.message, decision: "decline", decisionKey: input.decisionKey }));
  return { request: await officeRequestView(itemId, outcome.row.id), replayed: outcome.replayed, guestMessage, cleanerNotice: [] };
}

// ── Complete by hand (post, drop-off, another time, something else) ─────────

export async function completeReturnRequest(itemId: string, requestId: string, raw: unknown, actor: DecisionActor, now: Date = new Date()): Promise<OfficeReturnRequestView | null> {
  const input = completeSchema.parse(raw);
  await db.$transaction(async (tx) => {
    const row = await lockRequest(tx, itemId, requestId);
    if (row.status === "COMPLETED") return;
    if (row.status !== "APPROVED") throw new ReturnRequestError(409, "Only an approved return can be marked done.", "NOT_APPROVED");
    if (row.version !== input.version) throw new ReturnRequestError(409, "This request changed. Reload to see it.", "STALE");
    const item = await tx.lostFoundItem.findUniqueOrThrow({ where: { id: itemId } });
    let taskNote = "";
    if (row.jobTaskId) {
      const closed = await tx.jobTask.updateMany({ where: { id: row.jobTaskId, executionStatus: "OPEN" }, data: { executionStatus: "CANCELLED", visibleToCleaner: false } });
      if (closed.count > 0) {
        await tx.jobTaskEvent.create({ data: { taskId: row.jobTaskId, actorUserId: actor.id, action: "ADMIN_TASK_CANCELLED", note: "The office recorded the lost property as returned." } });
        taskNote = " The cleaner's open handover task was taken off the job.";
      }
    }
    await tx.lostFoundReturnRequest.update({
      where: { id: row.id },
      data: { status: "COMPLETED", version: { increment: 1 }, completedAt: now, completedById: actor.id, completionNote: input.note, trackingReference: blank(input.trackingReference), attentionReason: null, attentionAt: null },
    });
    const change = statusChangeData(item, { status: "RETURNED", resolution: input.note }, actor.id, now);
    if (change.kind !== "same") await tx.lostFoundItem.update({ where: { id: itemId }, data: change.data });
    await tx.lostFoundEvent.create({
      data: {
        itemId,
        userId: actor.id,
        action: "RETURNED",
        note: `Returned as arranged (${RETURN_METHOD_SHORT[row.confirmedMethod ?? row.method]}). ${input.note}${blank(input.trackingReference) ? ` Tracking: ${blank(input.trackingReference)}.` : ""}${taskNote}`,
        meta: { requestId: row.id, trackingReference: blank(input.trackingReference), fromStatus: item.status, toStatus: "RETURNED" } as Prisma.InputJsonValue,
      },
    });
  }).catch((err) => {
    if (err instanceof LostFoundRuleError) throw new ReturnRequestError(409, "The item is closed with another decision. Reopen it first.", "CLOSED");
    throw err;
  });
  return officeRequestView(itemId, requestId);
}

// ── Reads for the office panel ───────────────────────────────────────────────

async function userNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (!unique.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((user) => [user.id, user.name?.trim() || user.email]));
}

async function evidenceFor(itemId: string, taskIds: string[]): Promise<Map<string, Array<{ key: string; src: string }>>> {
  if (!taskIds.length) return new Map();
  const rows = await db.jobTaskAttachment.findMany({ where: { taskId: { in: taskIds }, kind: "COMPLETION_PROOF" }, select: { taskId: true, s3Key: true }, orderBy: { createdAt: "asc" } });
  const map = new Map<string, Array<{ key: string; src: string }>>();
  for (const row of rows) map.set(row.taskId, [...(map.get(row.taskId) ?? []), { key: row.s3Key, src: lostFoundPhotoSrc(itemId, row.s3Key) }]);
  return map;
}

export async function officeRequestViews(itemId: string): Promise<OfficeReturnRequestView[]> {
  const rows = await db.lostFoundReturnRequest.findMany({ where: { itemId }, orderBy: { createdAt: "desc" } });
  const [names, arrangements, evidence] = await Promise.all([
    userNames(rows.flatMap((row) => [row.decidedById, row.completedById, row.clientReviewedById])),
    liveArrangements(rows),
    evidenceFor(itemId, rows.map((row) => row.jobTaskId).filter((id): id is string => Boolean(id))),
  ]);
  return rows.map((row) => {
    const live = arrangements.get(row.id);
    return {
      ...guestRequestView(row),
      itemId: row.itemId,
      supersedesId: row.supersedesId,
      clientReview: row.clientReview && row.clientReviewedAt ? { verdict: row.clientReview, note: row.clientReviewNote, byName: row.clientReviewedById ? names.get(row.clientReviewedById) ?? "A removed account" : null, at: row.clientReviewedAt.toISOString() } : null,
      decidedByName: row.decidedById ? names.get(row.decidedById) ?? "A removed account" : null,
      decidedByRole: row.decidedByRole,
      confirmedJob: live?.job ?? null,
      feeState: row.feeState,
      feeCents: row.feeCents,
      feeNote: row.feeNote,
      shareContactWithCleaner: row.shareContactWithCleaner,
      jobTaskId: row.jobTaskId,
      taskStatus: live?.taskStatus ?? null,
      attention: live?.attention ?? null,
      guestMessage: (row.guestMessage as unknown as GuestMessageRecord | null) ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      completedByName: row.completedById ? names.get(row.completedById) ?? "A removed account" : null,
      completionNote: row.completionNote,
      trackingReference: row.trackingReference,
      evidence: row.jobTaskId ? evidence.get(row.jobTaskId) ?? [] : [],
    };
  });
}

async function officeRequestView(itemId: string, requestId: string): Promise<OfficeReturnRequestView | null> {
  return (await officeRequestViews(itemId)).find((row) => row.id === requestId) ?? null;
}

async function linkPhotoUrl(linkId: string): Promise<string | null> {
  const row = await db.lostFoundGuestLink.findUnique({ where: { id: linkId } });
  return row ? guestPhotoUrl(guestLinkToken(row)) : null;
}

export type DraftContext = { officeName: string; officePhone: string | null; propertyLabel: string; link: string | null };

export async function officeReturnPanel(itemId: string, permissions: { canDecide: GuestSendPermission; canSendGuest: GuestSendPermission }): Promise<OfficeReturnPanel> {
  const item = await db.lostFoundItem.findUnique({ where: { id: itemId }, select: { id: true, propertyId: true, photos: true } });
  if (!item) throw new ReturnRequestError(404, "Item not found.", "NOT_FOUND");
  const [settings, app, requests, link] = await Promise.all([readLostFoundSettings(), getAppSettings(), officeRequestViews(itemId), activeGuestLink(itemId)]);
  const timeZone = app.timezone || "Australia/Sydney";
  const property = item.propertyId ? await db.property.findUnique({ where: { id: item.propertyId }, select: { name: true, suburb: true } }) : null;
  return {
    requests,
    link,
    publicRequestsEnabled: settings.publicReturnRequests,
    upcomingJobs: await upcomingJobsForOffice(item.propertyId, timeZone),
    configuredFees: { POST: describeConfiguredFee(settings.postFee), DROP_OFF: describeConfiguredFee(settings.dropOffFee) },
    canDecide: permissions.canDecide,
    canSendGuest: permissions.canSendGuest,
    hasGuestPhoto: parsePhotos(item.photos).length > 0,
    guestPhotoUrl: link && parsePhotos(item.photos).length > 0 ? await linkPhotoUrl(link.id) : null,
    draftContext: {
      officeName: app.companyName || "sNeek Property Services",
      officePhone: app.companyPhone?.trim() || null,
      propertyLabel: property ? (property.suburb ? `${property.name}, ${property.suburb}` : property.name) : "the property",
      link: link?.url ?? null,
    },
    addresses: Object.fromEntries(requests.map((row) => [row.id, formatReturnAddress(row.address)])),
  };
}

// ── Job changes: cancelled, moved, reassigned ────────────────────────────────

/**
 * After a job is cancelled, moved or its cleaners change: every approved
 * handover on that job is checked against the live job; a new problem is put
 * on the request, the timeline and the office inbox once. Best-effort (the job
 * change is already committed); the list and panel derive the same state on
 * every read, so nothing depends on this hook alone.
 */
export async function reviewReturnArrangementsForJob(jobId: string): Promise<number> {
  try {
    const rows = await db.lostFoundReturnRequest.findMany({ where: { confirmedJobId: jobId, status: "APPROVED", jobTaskId: { not: null } } });
    if (!rows.length) return 0;
    const live = await liveArrangements(rows);
    let flagged = 0;
    for (const row of rows) {
      const attention = live.get(row.id)?.attention ?? null;
      if (!attention || attention === row.attentionReason) continue;
      const claimed = await db.lostFoundReturnRequest.updateMany({ where: { id: row.id, status: "APPROVED", OR: [{ attentionReason: null }, { attentionReason: { not: attention } }] }, data: { attentionReason: attention, attentionAt: new Date() } });
      if (claimed.count === 0) continue;
      flagged += 1;
      await db.lostFoundEvent.create({ data: { itemId: row.itemId, userId: null, action: "RETURN_NEEDS_REARRANGING", note: ATTENTION_LABEL[attention], meta: { requestId: row.id, jobId, reason: attention } } });
      await notifyOfficeOfReturn({ itemId: row.itemId, requestId: row.id, eventSuffix: `${attention}:${Date.now()}`, part: "needs-rearranging", actorId: null, actorName: "The system", reason: ATTENTION_LABEL[attention] });
    }
    return flagged;
  } catch (err) {
    logger.error({ err, jobId }, "lost and found: arrangement review after a job change failed");
    return 0;
  }
}

// ── The client's review ──────────────────────────────────────────────────────

export const clientReviewSchema = z.object({
  verdict: z.enum(["recommend", "not_recommended", "approve"]),
  version: z.number().int().min(1),
  note: z.string().trim().max(1000).optional().nullable(),
  decisionKey: decisionKeySchema.optional(),
}).strict();

export function clientDecisionDraft(input: { itemName: string; row: LostFoundReturnRequest; officeName: string; officePhone: string | null; propertyLabel: string; link: string | null }) {
  return draftDecisionMessage({
    decision: "approve",
    guestName: input.row.contactName,
    itemName: input.itemName,
    officeName: input.officeName,
    officePhone: input.officePhone,
    method: input.row.method,
    confirmedDate: input.row.requestedDate,
    confirmedTime: input.row.proposedTime,
    address: formatReturnAddress(parseReturnAddress(input.row.address)),
    propertyLabel: input.propertyLabel,
    feeLine: describeFee("NOT_SET", null, null) + "; the office will confirm any cost before anything is charged",
    note: null,
    link: input.link,
  });
}

export const RETURN_METHOD_NAMES: Record<ReturnMethod, string> = RETURN_METHOD_SHORT;
export { describeRequestChoice };
