import "server-only";
/**
 * Guest return requests for a lost item (2026-11-20): the guest's page, the
 * guest's submit / change / withdraw, and the office's and client's reads.
 * Decisions, completion and the job hooks are in ./return-decisions.
 *
 * Rules:
 * - The item comes from the token alone. One live request per item (PENDING
 *   or APPROVED). A change supersedes the pending request (a new row; the old
 *   one keeps what was asked); nothing is overwritten.
 * - A submit carries the browser's submission key: a double tap or a retry
 *   after a lost answer returns the same request, never a second one.
 * - Change and withdraw name the request and version the guest saw; anything
 *   else is refused with "reload", so a stale page cannot undo a newer choice.
 * - Every change writes a LostFoundEvent, so the item timeline shows it.
 */
import { Prisma, type LostFoundItem, type LostFoundReturnRequest } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { isValidExternalAddress } from "@/lib/notifications/external-recipient";
import { parsePhotos } from "./service";
import { guestLinkToken, guestLinkUrl, type ResolvedGuestLink } from "./guest-link";
import { readLostFoundSettings, type LostFoundSettings } from "./settings";
import { isOpenStatus } from "./status";
import {
  arrangementAttention,
  describeConfiguredFee,
  describeFee,
  describeRequestChoice,
  methodNeedsAddress,
  parseReturnAddress,
  RETURN_METHODS,
  type AttentionReason,
  type ReturnMethod,
  type ReturnStatus,
} from "./return-rules";
import { jobDay, upcomingCleansForGuest } from "./return-upcoming";
import type { GuestPageView, GuestRequestView } from "./return-view-types";
import { notifyClientOfReturn, notifyOfficeOfReturn, sendGuestAcknowledgement } from "./return-notices";

export class ReturnRequestError extends Error {
  constructor(readonly status: number, message: string, readonly code: string = "RULE") {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;
type OpenLink = Extract<ResolvedGuestLink, { state: "open" }>;

const LIVE_STATUSES: ReturnStatus[] = ["PENDING", "APPROVED"];

// ── Reading a request as the guest sees it ───────────────────────────────────

export function guestRequestView(row: LostFoundReturnRequest): GuestRequestView {
  const decided = row.status === "APPROVED" || row.status === "COMPLETED" || row.status === "DECLINED";
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    method: row.method,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    address: parseReturnAddress(row.address),
    requestedDate: row.requestedDate,
    requestedJobId: row.requestedJobId,
    proposedTime: row.proposedTime,
    otherDetails: row.otherDetails,
    guestNote: row.guestNote,
    submittedAt: row.createdAt.toISOString(),
    decision: decided && row.decidedAt
      ? {
          method: row.confirmedMethod,
          date: row.confirmedDate,
          time: row.confirmedTime,
          fee: describeFee(row.feeState, row.feeCents, row.feeNote),
          note: row.decisionNote,
          decidedAt: row.decidedAt.toISOString(),
        }
      : null,
  };
}

/** The calendar date the office holds the item until (found day + holding days), or null. */
function heldUntil(item: LostFoundItem, settings: LostFoundSettings, timeZone: string, now: Date): string | null {
  if (!isOpenStatus(item.status)) return null;
  const found = formatInTimeZone(item.createdAt, timeZone, "yyyy-MM-dd");
  const until = new Date(Date.parse(`${found}T00:00:00Z`) + settings.holdingDays * 86_400_000).toISOString().slice(0, 10);
  return until >= formatInTimeZone(now, timeZone, "yyyy-MM-dd") ? until : null;
}

async function propertyLabel(propertyId: string | null): Promise<string | null> {
  if (!propertyId) return null;
  const property = await db.property.findUnique({ where: { id: propertyId }, select: { name: true, suburb: true } });
  if (!property) return null;
  return property.suburb ? `${property.name}, ${property.suburb}` : property.name;
}

async function latestGuestRequest(itemId: string): Promise<LostFoundReturnRequest | null> {
  return db.lostFoundReturnRequest.findFirst({ where: { itemId, status: { not: "SUPERSEDED" } }, orderBy: { createdAt: "desc" } });
}

/** The guest's page: only what the guest may see, and records the open. */
export async function guestPageView(resolved: OpenLink, now: Date = new Date()): Promise<GuestPageView> {
  const { link, item, token } = resolved;
  await db.lostFoundGuestLink.update({ where: { id: link.id }, data: { lastOpenedAt: now, ...(link.firstOpenedAt ? {} : { firstOpenedAt: now }) } });
  const [settings, app, label, request] = await Promise.all([readLostFoundSettings(), getAppSettings(), propertyLabel(item.propertyId), latestGuestRequest(item.id)]);
  const timeZone = app.timezone || "Australia/Sydney";
  const open = isOpenStatus(item.status);
  const photos = parsePhotos(item.photos);
  return {
    companyName: app.companyName || "sNeek Property Services",
    officePhone: app.companyPhone?.trim() || null,
    officeEmail: null,
    item: {
      name: item.itemName,
      foundDate: formatInTimeZone(item.createdAt, timeZone, "yyyy-MM-dd"),
      foundWhere: item.foundLocation?.trim() || null,
      propertyLabel: label,
      photoUrls: photos.map((_photo, index) => `/api/public/lost-found/${token}/photo${index > 0 ? `?n=${index}` : ""}`),
      heldUntil: heldUntil(item, settings, timeZone, now),
    },
    itemState: open ? "open" : item.status === "RETURNED" ? "returned" : "closed",
    linkExpiresAt: link.expiresAt.toISOString(),
    linkExpiresOn: formatInTimeZone(link.expiresAt, timeZone, "yyyy-MM-dd"),
    options: {
      upcomingCleans: open ? await upcomingCleansForGuest(item.propertyId, settings.upcomingCleans, timeZone, now) : [],
      postFee: describeConfiguredFee(settings.postFee),
      dropOffFee: describeConfiguredFee(settings.dropOffFee),
    },
    request: request ? guestRequestView(request) : null,
  };
}

// ── The guest's submit, change and withdraw ──────────────────────────────────

const text = (max: number) => z.string().trim().max(max);

const addressSchema = z.object({
  line1: text(200).min(3, "Enter the street address."),
  line2: text(200).optional().nullable(),
  suburb: text(100).min(2, "Enter the suburb or town."),
  state: text(40).min(2, "Enter the state."),
  postcode: text(12).regex(/^[A-Za-z0-9 -]{3,12}$/, "Enter the postcode."),
}).strict();

export const guestSubmitSchema = z.object({
  action: z.literal("submit"),
  submissionKey: z.string().trim().regex(/^[A-Za-z0-9_-]{8,80}$/),
  replacesRequestId: z.string().trim().max(64).optional().nullable(),
  replacesVersion: z.number().int().min(1).optional().nullable(),
  method: z.enum(RETURN_METHODS),
  contactName: text(120).min(1, "Enter your name."),
  contactEmail: text(200).optional().nullable(),
  contactPhone: text(30).optional().nullable(),
  address: addressSchema.optional().nullable(),
  requestedJobId: z.string().trim().max(64).optional().nullable(),
  proposedTime: text(200).optional().nullable(),
  otherDetails: text(1000).optional().nullable(),
  guestNote: text(1000).optional().nullable(),
  /** The guest ticked "I understand this is a preference until the office confirms it". */
  understood: z.literal(true, { errorMap: () => ({ message: "Please confirm you understand this is not confirmed yet." }) }),
}).strict();

export const guestWithdrawSchema = z.object({
  action: z.literal("withdraw"),
  requestId: z.string().trim().min(1).max(64),
  version: z.number().int().min(1),
}).strict();

export type GuestSubmit = z.infer<typeof guestSubmitSchema>;

const blank = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

/** Field checks that depend on the method. Throws 400 with the first problem in words. */
export function validateGuestSubmit(input: GuestSubmit): void {
  const email = blank(input.contactEmail);
  const phone = blank(input.contactPhone);
  if (email && !isValidExternalAddress("EMAIL", email)) throw new ReturnRequestError(400, "Check your email address.", "INVALID");
  if (phone && !isValidExternalAddress("SMS", phone)) throw new ReturnRequestError(400, "Check your phone number (digits, spaces and + only).", "INVALID");
  if (!email && !phone) throw new ReturnRequestError(400, "Give an email address or a phone number so we can reach you.", "INVALID");
  if (methodNeedsAddress(input.method) && !input.address) throw new ReturnRequestError(400, "Enter the address to send it to.", "INVALID");
  if (input.method === "PICKUP_AT_CLEAN" && !blank(input.requestedJobId)) throw new ReturnRequestError(400, "Choose one of the offered dates.", "INVALID");
  if (input.method === "PICKUP_OTHER_TIME" && (blank(input.proposedTime)?.length ?? 0) < 3) throw new ReturnRequestError(400, "Tell us the day and time that suits you.", "INVALID");
  if (input.method === "OTHER" && (blank(input.otherDetails)?.length ?? 0) < 3) throw new ReturnRequestError(400, "Tell us how you would like it returned.", "INVALID");
}

async function lockItem(tx: Tx, itemId: string): Promise<LostFoundItem> {
  await tx.$queryRaw`SELECT "id" FROM "LostFoundItem" WHERE "id" = ${itemId} FOR UPDATE`;
  const item = await tx.lostFoundItem.findUnique({ where: { id: itemId } });
  if (!item) throw new ReturnRequestError(404, "This item no longer exists.", "NOT_FOUND");
  return item;
}

export type GuestSubmitResult = { request: GuestRequestView; replayed: boolean };

export async function submitGuestRequest(resolved: OpenLink, raw: unknown, now: Date = new Date()): Promise<GuestSubmitResult> {
  const input = guestSubmitSchema.parse(raw);
  validateGuestSubmit(input);
  const [settings, app] = await Promise.all([readLostFoundSettings(), getAppSettings()]);
  const timeZone = app.timezone || "Australia/Sydney";
  const { link, item: linkedItem } = resolved;

  const outcome = await db.$transaction(async (tx) => {
    const item = await lockItem(tx, linkedItem.id);
    const earlier = await tx.lostFoundReturnRequest.findUnique({ where: { itemId_submissionKey: { itemId: item.id, submissionKey: input.submissionKey } } });
    if (earlier) return { row: earlier, replayed: true as const, changed: false, item };
    if (!isOpenStatus(item.status)) throw new ReturnRequestError(409, "This item is no longer waiting to be returned. Please contact the office.", "CLOSED");

    let requestedDate: string | null = null;
    if (input.method === "PICKUP_AT_CLEAN") {
      const options = await upcomingCleansForGuest(item.propertyId, settings.upcomingCleans, timeZone, now, tx);
      const chosen = options.find((option) => option.jobId === input.requestedJobId);
      if (!chosen) throw new ReturnRequestError(409, "That date is no longer available. Please choose another.", "STALE_OPTION");
      requestedDate = chosen.date;
    }

    const live = await tx.lostFoundReturnRequest.findFirst({ where: { itemId: item.id, status: { in: LIVE_STATUSES } }, orderBy: { createdAt: "desc" } });
    if (live?.status === "APPROVED") throw new ReturnRequestError(409, "Your return is already arranged. To change it, please contact the office.", "APPROVED");
    if (live && (live.id !== input.replacesRequestId || live.version !== input.replacesVersion)) {
      throw new ReturnRequestError(409, "Your request changed since this page loaded. Reload the page to see it.", "STALE");
    }
    if (live) {
      await tx.lostFoundReturnRequest.update({ where: { id: live.id }, data: { status: "SUPERSEDED", version: { increment: 1 } } });
    }
    const row = await tx.lostFoundReturnRequest.create({
      data: {
        itemId: item.id,
        linkId: link.id,
        submissionKey: input.submissionKey,
        method: input.method,
        contactName: input.contactName.trim(),
        contactEmail: blank(input.contactEmail),
        contactPhone: blank(input.contactPhone),
        address: methodNeedsAddress(input.method) && input.address ? ({ ...input.address, line2: blank(input.address.line2) } as Prisma.InputJsonValue) : Prisma.DbNull,
        requestedJobId: input.method === "PICKUP_AT_CLEAN" ? input.requestedJobId ?? null : null,
        requestedDate,
        proposedTime: input.method === "PICKUP_OTHER_TIME" ? blank(input.proposedTime) : null,
        otherDetails: input.method === "OTHER" ? blank(input.otherDetails) : null,
        guestNote: blank(input.guestNote),
        supersedesId: live?.id ?? null,
        createdAt: now,
      },
    });
    const choice = describeRequestChoice(row);
    await tx.lostFoundEvent.create({
      data: {
        itemId: item.id,
        userId: null,
        action: live ? "RETURN_REQUEST_CHANGED" : "RETURN_REQUESTED",
        note: `${live ? "The guest changed their return request" : "The guest asked for the item back"}: ${choice}. A preference until the office approves it.`,
        meta: { requestId: row.id, supersedesId: live?.id ?? null, method: row.method, requestedJobId: row.requestedJobId, requestedDate, contactName: row.contactName, linkId: link.id } as Prisma.InputJsonValue,
      },
    });
    return { row, replayed: false as const, changed: Boolean(live), item };
  });

  if (!outcome.replayed) {
    const choice = describeRequestChoice(outcome.row);
    await notifyOfficeOfReturn({ itemId: outcome.item.id, requestId: outcome.row.id, eventSuffix: String(outcome.row.version), part: outcome.changed ? "changed" : "new", actorId: null, actorName: outcome.row.contactName, returnChoice: choice });
    await notifyClientOfReturn({ itemId: outcome.item.id, requestId: outcome.row.id, version: outcome.row.version, returnChoice: choice });
    await sendGuestAcknowledgement({
      settings,
      item: outcome.item,
      request: outcome.row,
      link: { id: link.id, createdById: link.createdById, token: guestLinkToken(link), url: guestLinkUrl(guestLinkToken(link)) },
    });
  }
  return { request: guestRequestView(outcome.row), replayed: outcome.replayed };
}

export async function withdrawGuestRequest(resolved: OpenLink, raw: unknown, now: Date = new Date()): Promise<GuestRequestView> {
  const input = guestWithdrawSchema.parse(raw);
  const result = await db.$transaction(async (tx) => {
    await lockItem(tx, resolved.item.id);
    const row = await tx.lostFoundReturnRequest.findUnique({ where: { id: input.requestId } });
    if (!row || row.itemId !== resolved.item.id) throw new ReturnRequestError(404, "That request was not found.", "NOT_FOUND");
    if (row.status === "WITHDRAWN") return { row, replayed: true };
    if (row.status !== "PENDING") throw new ReturnRequestError(409, "Only a request still waiting for the office can be withdrawn here. Please contact the office.", "NOT_PENDING");
    if (row.version !== input.version) throw new ReturnRequestError(409, "Your request changed since this page loaded. Reload the page to see it.", "STALE");
    const updated = await tx.lostFoundReturnRequest.update({ where: { id: row.id }, data: { status: "WITHDRAWN", version: { increment: 1 }, updatedAt: now } });
    await tx.lostFoundEvent.create({ data: { itemId: row.itemId, userId: null, action: "RETURN_REQUEST_WITHDRAWN", note: "The guest withdrew their return request.", meta: { requestId: row.id } } });
    return { row: updated, replayed: false };
  });
  if (!result.replayed) {
    await notifyOfficeOfReturn({ itemId: result.row.itemId, requestId: result.row.id, eventSuffix: String(result.row.version), part: "withdrawn", actorId: null, actorName: result.row.contactName });
  }
  return guestRequestView(result.row);
}

// ── Live arrangement checks (shared by the office and client reads) ──────────

export type ArrangementState = { attention: AttentionReason | null; job: { id: string; jobNumber: string | null; date: string; status: string } | null; taskStatus: string | null };

/** For each approved request with a job: the live job, task and whether it needs the office again. */
export async function liveArrangements(rows: Array<Pick<LostFoundReturnRequest, "id" | "status" | "confirmedJobId" | "confirmedDate" | "jobTaskId" | "taskCleanerIds">>): Promise<Map<string, ArrangementState>> {
  const jobIds = Array.from(new Set(rows.map((row) => row.confirmedJobId).filter((id): id is string => Boolean(id))));
  const taskIds = Array.from(new Set(rows.map((row) => row.jobTaskId).filter((id): id is string => Boolean(id))));
  const [jobs, tasks] = await Promise.all([
    jobIds.length ? db.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobNumber: true, status: true, scheduledDate: true, assignments: { where: { removedAt: null }, select: { userId: true } } } }) : Promise.resolve([]),
    taskIds.length ? db.jobTask.findMany({ where: { id: { in: taskIds } }, select: { id: true, executionStatus: true } }) : Promise.resolve([]),
  ]);
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const result = new Map<string, ArrangementState>();
  for (const row of rows) {
    const job = row.confirmedJobId ? jobById.get(row.confirmedJobId) : undefined;
    const task = row.jobTaskId ? taskById.get(row.jobTaskId) : undefined;
    const attention = arrangementAttention({
      status: row.status,
      confirmedDate: row.confirmedDate,
      taskCleanerIds: row.taskCleanerIds,
      hasTask: Boolean(row.jobTaskId),
      job: job ? { status: job.status, scheduledDay: jobDay(job.scheduledDate), cleanerIds: job.assignments.map((assignment) => assignment.userId) } : null,
      task: task ? { executionStatus: task.executionStatus } : null,
    });
    result.set(row.id, {
      attention,
      job: job ? { id: job.id, jobNumber: job.jobNumber ?? null, date: jobDay(job.scheduledDate), status: job.status } : null,
      taskStatus: task?.executionStatus ?? null,
    });
  }
  return result;
}
