/**
 * Office changes to one lost and found item: status (through the transition
 * table), guest details, storage, value and the linked booking. The item PATCH,
 * the workflow events route and the bulk endpoint all use these, so a bulk
 * action can never do what a single action may not.
 *
 * Each change re-reads the item under a row lock inside its transaction, so a
 * decision recorded by someone else a moment earlier is the one checked.
 */
import type { LostFoundItem, LostFoundStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { guestEditPatch, guestFieldsFromBooking, type GuestEdit } from "./guest";
import { isResolvedStatus } from "./status";
import { checkLostFoundTransition } from "./transitions";

type Tx = Prisma.TransactionClient;

export class LostFoundRuleError extends Error {
  readonly status = 409;
}

export type StatusChange = {
  status: LostFoundStatus;
  resolution?: string | null;
  note?: string | null;
  reopenReason?: string | null;
};

export type DetailChange = GuestEdit & {
  estimatedValue?: number | null;
  storageLocation?: string | null;
  /** Office picks a different booking at the item's property. */
  reservationId?: string;
};

export type ItemChange = { status?: StatusChange; details?: DetailChange };

const clean = (value: string | null | undefined) => value?.trim() || null;

async function lockItem(tx: Tx, id: string): Promise<LostFoundItem> {
  await tx.$queryRaw`SELECT "id" FROM "LostFoundItem" WHERE "id" = ${id} FOR UPDATE`;
  const item = await tx.lostFoundItem.findUnique({ where: { id } });
  if (!item) throw new Error("NOT_FOUND");
  return item;
}

function previousResolution(item: LostFoundItem) {
  return item.resolvedAt || isResolvedStatus(item.status)
    ? { status: item.status, resolution: item.resolution, resolvedAt: item.resolvedAt?.toISOString() ?? null, resolvedByUserId: item.resolvedByUserId }
    : null;
}

/** The column changes and timeline action for one status change. Pure apart from `now`. */
export function statusChangeData(item: LostFoundItem, change: StatusChange, actorId: string, now: Date) {
  const check = checkLostFoundTransition(item.status, change.status, change.reopenReason);
  if (!check.ok) throw new LostFoundRuleError(check.reason);
  const data: Prisma.LostFoundItemUpdateInput = { status: change.status };
  const resolutionText = clean(change.resolution) ?? clean(change.note);
  let action = "STATUS_CHANGE";
  if (check.kind === "reopen") {
    action = "REOPENED";
    data.resolvedAt = null;
    data.resolvedByUserId = null;
    data.resolution = null;
  } else if (isResolvedStatus(change.status)) {
    action = change.status;
    if (check.kind === "same") {
      // Editing the note of the decision already recorded keeps its stamp.
      if (resolutionText !== null) data.resolution = resolutionText;
    } else {
      data.resolvedAt = now;
      data.resolvedByUserId = actorId;
      data.resolution = resolutionText;
    }
  }
  // Archiving a decided item keeps the decision; nothing else touches the stamp.
  const keepsHistory = check.kind === "reopen" || (isResolvedStatus(item.status) && check.kind === "direct" && change.status !== "ARCHIVED");
  const meta: Record<string, unknown> = {
    fromStatus: item.status,
    toStatus: change.status,
    ...(keepsHistory ? { previousResolution: previousResolution(item) } : {}),
  };
  const note = check.kind === "reopen" ? clean(change.reopenReason) : clean(change.note) ?? (isResolvedStatus(change.status) ? clean(change.resolution) : null);
  return { data, action, meta, note, kind: check.kind };
}

async function detailData(tx: Tx, item: LostFoundItem, details: DetailChange) {
  const data: Prisma.LostFoundItemUpdateInput = {};
  const notes: string[] = [];
  const meta: Record<string, unknown> = {};
  if (details.reservationId !== undefined) {
    const booking = await tx.reservation.findUnique({ where: { id: details.reservationId }, select: { id: true, propertyId: true, guestName: true, guestPhone: true, guestEmail: true, reservationCode: true } });
    if (!booking || booking.propertyId !== item.propertyId) throw new LostFoundRuleError("Choose a booking at this item's property.");
    const fields = guestFieldsFromBooking(booking)!;
    Object.assign(data, { guestName: fields.guestName, guestContact: fields.guestContact, guestEmail: fields.guestEmail, guestSource: fields.guestSource, reservation: { connect: { id: booking.id } } });
    notes.push(`Guest details taken from booking${booking.reservationCode ? ` ${booking.reservationCode}` : ""}, chosen by the office.`);
    meta.reservationId = booking.id;
    meta.previousGuest = { guestName: item.guestName, guestContact: item.guestContact, guestEmail: item.guestEmail, guestSource: item.guestSource, reservationId: item.reservationId };
  }
  const guest = guestEditPatch(details);
  if (guest) {
    Object.assign(data, guest);
    meta.guestName = guest.guestName;
    meta.guestContact = guest.guestContact;
    meta.guestEmail = guest.guestEmail;
  }
  if (details.estimatedValue !== undefined) data.estimatedValue = details.estimatedValue;
  if (details.storageLocation !== undefined) data.storageLocation = clean(details.storageLocation);
  return { data, notes, meta };
}

/** Applies one office change to one item, with one timeline entry. */
export async function applyLostFoundChange(itemId: string, actorId: string, change: ItemChange, now = new Date()) {
  return db.$transaction(async (tx) => {
    const item = await lockItem(tx, itemId);
    const details = change.details ? await detailData(tx, item, change.details) : null;
    const status = change.status ? statusChangeData(item, change.status, actorId, now) : null;
    const data = { ...(details?.data ?? {}), ...(status?.data ?? {}) };
    if (Object.keys(data).length === 0) throw new LostFoundRuleError("Nothing to update.");
    const updated = await tx.lostFoundItem.update({ where: { id: item.id }, data });
    const note = status?.note ?? (details?.notes.length ? details.notes.join(" ") : status ? null : "Details updated");
    await tx.lostFoundEvent.create({
      data: {
        itemId: item.id,
        userId: actorId,
        action: status?.action ?? "STATUS_CHANGE",
        note,
        meta: { fromStatus: item.status, toStatus: updated.status, ...(details?.meta ?? {}), ...(status?.meta ?? {}) } as Prisma.InputJsonValue,
      },
    });
    return updated;
  });
}

export const CONTACT_CHANNELS = ["EMAIL", "PHONE", "SMS", "IN_PERSON", "OTHER"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export type WorkflowEvent = {
  action: "OFFER_RETURN" | "GUEST_CONTACTED" | "CLIENT_CONTACTED";
  note?: string | null;
  guest?: GuestEdit;
  /** How the office says it made contact. The app itself sent nothing. */
  channel?: ContactChannel | null;
};

const WORKFLOW_TARGET: Record<WorkflowEvent["action"], LostFoundStatus | null> = {
  OFFER_RETURN: "RETURN_OFFERED",
  GUEST_CONTACTED: "GUEST_CONTACTED",
  CLIENT_CONTACTED: null,
};

/**
 * Office workflow entries. Offer return and guest contacted move the status
 * through the transition table (a closed item must be reopened first); telling
 * the client records the office's statement without changing the status.
 */
export async function recordLostFoundWorkflow(itemId: string, actorId: string, input: WorkflowEvent) {
  return db.$transaction(async (tx) => {
    const item = await lockItem(tx, itemId);
    const target = WORKFLOW_TARGET[input.action];
    const data: Prisma.LostFoundItemUpdateInput = {};
    if (target) {
      const check = checkLostFoundTransition(item.status, target, null);
      // Only a closed item can fail here: reopening is its own explicit step.
      if (!check.ok) throw new LostFoundRuleError("This item is closed. Reopen it first, with a reason.");
      data.status = target;
    }
    const guest = input.action === "GUEST_CONTACTED" && input.guest ? guestEditPatch(input.guest) : null;
    if (guest) Object.assign(data, guest);
    if (Object.keys(data).length) await tx.lostFoundItem.update({ where: { id: item.id }, data });
    const meta: Record<string, unknown> = {
      fromStatus: item.status,
      toStatus: target ?? item.status,
      ...(guest ? { guestName: guest.guestName, guestContact: guest.guestContact, guestEmail: guest.guestEmail } : {}),
      ...(input.channel ? { channel: input.channel, recordedByOffice: true, sentByApp: false } : {}),
    };
    await tx.lostFoundEvent.create({ data: { itemId: item.id, userId: actorId, action: input.action, note: clean(input.note), meta: meta as Prisma.InputJsonValue } });
    return tx.lostFoundItem.findUniqueOrThrow({ where: { id: item.id } });
  });
}
