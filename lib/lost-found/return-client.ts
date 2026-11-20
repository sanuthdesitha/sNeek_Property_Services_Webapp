import "server-only";
/**
 * Lost and found for the client portal (2026-11-20): the items found at the
 * client's own properties and the guests' return requests, and the client's
 * review.
 *
 * Scope is read from the database on every request (`propertyScopeWhere`): a
 * client sees only their own properties' items, an assistant only the
 * properties their team was given; an item elsewhere answers 404, the same as
 * one that does not exist. The client never sees internal notes, storage, the
 * estimated value, cleaner names, the guest's contact or address, or other
 * clients' data. The guest's name is shown because the office's "Tell client"
 * message already includes it.
 *
 * Review (`lostFound.clientsCanApproveReturns`, default off):
 * - off: the client can recommend (or not recommend) a waiting request; the
 *   office is told and still decides, sends the guest message and sets the task;
 * - on: the account holder (not an assistant) may also approve it as asked;
 *   the standard approval message (shown to them first) goes to the guest, the
 *   cleaner task is set when a clean was chosen, and the office is told with
 *   the exact text.
 */
import { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { propertyScopeWhere, auditClientPortalAction, type ClientPortalContext } from "@/lib/auth/client-portal";
import { readLostFoundSettings } from "./settings";
import { loadStayDetailsForItem } from "./stay-details-server";
import { lostFoundStatusLabel } from "./status";
import { parsePhotos } from "./service";
import { activeGuestLink } from "./guest-link";
import { describeFee, describeRequestChoice, type ReturnMethod } from "./return-rules";
import { liveArrangements, ReturnRequestError } from "./return-requests";
import { approveReturnRequest, clientDecisionDraft, clientReviewSchema, type DecisionResult } from "./return-decisions";
import { notifyOfficeOfReturn } from "./return-notices";
import type { ClientLostFoundView } from "./return-view-types";

type Portal = ClientPortalContext;

async function scopedPropertyIds(portal: Portal): Promise<Map<string, { name: string; suburb: string | null }>> {
  const properties = await db.property.findMany({ where: propertyScopeWhere(portal), select: { id: true, name: true, suburb: true } });
  return new Map(properties.map((property) => [property.id, { name: property.name, suburb: property.suburb }]));
}

export async function listClientLostFound(portal: Portal): Promise<ClientLostFoundView> {
  const [properties, settings] = await Promise.all([scopedPropertyIds(portal), readLostFoundSettings()]);
  const timeZone = portal.settings.timezone || "Australia/Sydney";
  if (properties.size === 0) return { items: [], clientsCanApprove: settings.clientsCanApproveReturns && portal.actor === "CLIENT", timeZone };
  const items = await db.lostFoundItem.findMany({
    where: { propertyId: { in: Array.from(properties.keys()) } },
    select: { id: true, itemName: true, createdAt: true, foundLocation: true, propertyId: true, status: true, photos: true, guestName: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const requests = items.length
    ? await db.lostFoundReturnRequest.findMany({ where: { itemId: { in: items.map((item) => item.id) }, status: { not: "SUPERSEDED" } }, orderBy: { createdAt: "desc" } })
    : [];
  const live = await liveArrangements(requests);
  return {
    clientsCanApprove: settings.clientsCanApproveReturns && portal.actor === "CLIENT",
    timeZone,
    items: items.map((item) => {
      const property = item.propertyId ? properties.get(item.propertyId) : null;
      return {
        id: item.id,
        itemName: item.itemName,
        foundDate: formatInTimeZone(item.createdAt, timeZone, "yyyy-MM-dd"),
        foundWhere: item.foundLocation?.trim() || null,
        propertyLabel: property ? (property.suburb ? `${property.name}, ${property.suburb}` : property.name) : null,
        status: item.status,
        statusLabel: lostFoundStatusLabel(item.status),
        photoCount: parsePhotos(item.photos).length,
        guestName: item.guestName,
        requests: requests.filter((row) => row.itemId === item.id).map((row) => ({
          id: row.id,
          version: row.version,
          status: row.status,
          method: row.method as ReturnMethod,
          summary: describeRequestChoice(row),
          submittedAt: row.createdAt.toISOString(),
          clientReview: row.clientReview && row.clientReviewedAt ? { verdict: row.clientReview, note: row.clientReviewNote, at: row.clientReviewedAt.toISOString() } : null,
          decision: row.decidedAt && (row.status === "APPROVED" || row.status === "COMPLETED" || row.status === "DECLINED")
            ? { fee: describeFee(row.feeState, row.feeCents, row.feeNote), date: row.confirmedDate, time: row.confirmedTime, note: row.decisionNote }
            : null,
          attention: live.get(row.id)?.attention ?? null,
        })),
      };
    }),
  };
}

/** A request inside the caller's scope, or 404 (the same answer as one that does not exist). */
async function scopedRequest(portal: Portal, requestId: string) {
  const row = await db.lostFoundReturnRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new ReturnRequestError(404, "That request was not found.", "NOT_FOUND");
  const item = await db.lostFoundItem.findUnique({ where: { id: row.itemId }, select: { id: true, itemName: true, propertyId: true } });
  if (!item?.propertyId) throw new ReturnRequestError(404, "That request was not found.", "NOT_FOUND");
  const inScope = await db.property.findFirst({ where: { id: item.propertyId, ...propertyScopeWhere(portal) }, select: { id: true, name: true, suburb: true } });
  if (!inScope) throw new ReturnRequestError(404, "That request was not found.", "NOT_FOUND");
  return { row, item, property: inScope };
}

/** The approval message the client would send (shown before they approve fully). */
export async function clientApprovalPreview(portal: Portal, requestId: string): Promise<{ subject: string; body: string }> {
  const { row, item, property } = await scopedRequest(portal, requestId);
  const link = await activeGuestLink(item.id);
  return clientDecisionDraft({ itemName: item.itemName, row, officeName: portal.settings.companyName || "sNeek Property Services", officePhone: portal.settings.companyPhone?.trim() || null, propertyLabel: property.suburb ? `${property.name}, ${property.suburb}` : property.name, stay: await loadStayDetailsForItem(item.id, portal.settings.timezone || "Australia/Sydney"), link: link?.url ?? null });
}

export type ClientReviewResult = { verdict: string; decision: DecisionResult | null };

export async function clientReviewReturnRequest(portal: Portal, requestId: string, raw: unknown, now: Date = new Date()): Promise<ClientReviewResult> {
  const input = clientReviewSchema.parse(raw);
  const { row, item } = await scopedRequest(portal, requestId);
  const settings = await readLostFoundSettings();
  const actorName = portal.userName?.trim() || (portal.actor === "VA" ? "The client's assistant" : "The client");

  if (input.verdict === "approve") {
    if (!settings.clientsCanApproveReturns) throw new ReturnRequestError(403, "Approving is done by the office. You can recommend the request instead.", "CLIENT_APPROVAL_OFF");
    if (portal.actor !== "CLIENT") throw new ReturnRequestError(403, "Only the account holder can approve a return.", "ASSISTANT");
    if (!input.decisionKey) throw new ReturnRequestError(400, "Missing request key.", "INVALID");
    if (row.status !== "PENDING") throw new ReturnRequestError(409, "This request is no longer waiting.", "NOT_PENDING");
    const message = await clientApprovalPreview(portal, requestId);
    const decision = await approveReturnRequest(item.id, row.id, {
      action: "approve",
      version: input.version,
      decisionKey: input.decisionKey,
      method: row.method,
      jobId: row.requestedJobId,
      date: row.requestedDate,
      time: row.method === "PICKUP_OTHER_TIME" ? row.proposedTime : null,
      feeState: "NOT_SET",
      note: input.note ?? null,
      shareContactWithCleaner: false,
      cleanerTransports: ["INBOX"],
      message: { send: row.contactEmail ? "EMAIL" : row.contactPhone ? "SMS" : "NONE", subject: message.subject, body: message.body },
    }, { id: portal.userId, role: "CLIENT", name: actorName }, { allowed: true, reason: null }, now);
    await auditClientPortalAction({ ctx: portal, action: "LOST_FOUND_RETURN_APPROVED_BY_CLIENT", entity: "LostFoundItem", entityId: item.id, after: { requestId: row.id } });
    await notifyOfficeOfReturn({ itemId: item.id, requestId: row.id, eventSuffix: `client-approve:${input.decisionKey}`, part: "client-reviewed", actorId: portal.userId, actorName, returnChoice: describeRequestChoice(row), reason: `approved (guest message: ${decision.guestMessage?.state.replace(/_/g, " ") ?? "not recorded"})` });
    return { verdict: "approve", decision };
  }

  const verdict = input.verdict === "recommend" ? "RECOMMENDED" : "NOT_RECOMMENDED";
  const updated = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "LostFoundReturnRequest" WHERE "id" = ${row.id} FOR UPDATE`;
    const current = await tx.lostFoundReturnRequest.findUniqueOrThrow({ where: { id: row.id } });
    if (current.status !== "PENDING") throw new ReturnRequestError(409, "This request is no longer waiting.", "NOT_PENDING");
    if (current.version !== input.version) throw new ReturnRequestError(409, "This request changed. Reload to see it.", "STALE");
    const next = await tx.lostFoundReturnRequest.update({ where: { id: row.id }, data: { clientReview: verdict, clientReviewNote: input.note?.trim() || null, clientReviewedById: portal.userId, clientReviewedAt: now, version: { increment: 1 } } });
    await tx.lostFoundEvent.create({
      data: {
        itemId: item.id,
        userId: portal.userId,
        action: "RETURN_CLIENT_REVIEWED",
        note: `${actorName} ${verdict === "RECOMMENDED" ? "recommended" : "did not recommend"} the guest's request${input.note?.trim() ? `: ${input.note.trim()}` : "."} The office still decides.`,
        meta: { requestId: row.id, verdict, actor: portal.actor } as Prisma.InputJsonValue,
      },
    });
    await auditClientPortalAction({ ctx: portal, action: "LOST_FOUND_RETURN_CLIENT_REVIEW", entity: "LostFoundItem", entityId: item.id, after: { requestId: row.id, verdict } }, tx);
    return next;
  });
  await notifyOfficeOfReturn({ itemId: item.id, requestId: row.id, eventSuffix: `client-${verdict}:${updated.version}`, part: "client-reviewed", actorId: portal.userId, actorName, returnChoice: describeRequestChoice(row), reason: verdict === "RECOMMENDED" ? "recommended" : "did not recommend" });
  return { verdict, decision: null };
}
