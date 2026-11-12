import "server-only";
/**
 * Cases "Create repair quote": the new-quote page reads `?fromCase=<caseId>`
 * on the server and pre-fills client, service address (the case's property),
 * a title and description, and reference images from the case's attachments.
 * Nothing is sent to the client by pre-filling; the quote is a normal draft.
 *
 * The link between quote and case is stored without a schema change, as a
 * `FROM_CASE` QuoteEvent ({ caseId, caseTitle }) written with the quote, plus
 * an internal case note. The case's details panel lists "Quote Q-… created"
 * from those events and the quote shows "From case …".
 *
 * Reference images: office staff may attach the case's own evidence (any
 * attachment on that case, which the office can already see) to the quote;
 * any other key must pass the upload-ownership rule (own upload, or an office
 * account's upload).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { findForeignUploadKeys } from "@/lib/uploads/ownership-server";
import { FOREIGN_UPLOAD_MESSAGE } from "@/lib/uploads/ownership";

export const QUOTE_FROM_CASE_EVENT = "FROM_CASE";
const MAX_REFERENCE_IMAGES = 12;
const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i;

export type CaseQuotePrefill = {
  caseId: string;
  caseTitle: string;
  client: { id: string; name: string } | null;
  property: { id: string; name: string; address: string | null; suburb: string | null } | null;
  title: string;
  description: string;
  referenceImages: Array<{ key: string; url: string; label?: string }>;
};

export type CaseQuoteLink = { quoteId: string; reference: string; createdAt: string; href: string };

/** The short reference shown for a quote ("Q-1A2B3C"); quotes have no number column. */
export function quoteReference(quoteId: string): string {
  return `Q-${quoteId.slice(-6).toUpperCase()}`;
}

function isImage(attachment: { mimeType: string | null; s3Key: string }): boolean {
  if (attachment.mimeType) return attachment.mimeType.toLowerCase().startsWith("image/");
  return IMAGE_EXTENSION.test(attachment.s3Key);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Null when the case does not exist. */
export async function loadCaseQuotePrefill(caseId: string): Promise<CaseQuotePrefill | null> {
  const row = await db.issueTicket.findUnique({
    where: { id: caseId },
    select: {
      id: true, title: true, description: true, caseType: true,
      client: { select: { id: true, name: true } },
      property: { select: { id: true, name: true, address: true, suburb: true, client: { select: { id: true, name: true } } } },
      job: { select: { jobNumber: true, property: { select: { id: true, name: true, address: true, suburb: true, client: { select: { id: true, name: true } } } } } },
      attachments: { orderBy: { createdAt: "asc" }, select: { s3Key: true, url: true, mimeType: true, label: true } },
    },
  });
  if (!row) return null;
  const property = row.property ?? row.job?.property ?? null;
  const client = row.client ?? property?.client ?? null;
  const lines = [
    `Repair arising from case "${row.title}".`,
    row.job?.jobNumber ? `Reported on job ${row.job.jobNumber}.` : null,
    row.description?.trim() || null,
  ].filter((line): line is string => Boolean(line));
  return {
    caseId: row.id,
    caseTitle: row.title,
    client: client ? { id: client.id, name: client.name } : null,
    property: property ? { id: property.id, name: property.name, address: property.address ?? null, suburb: property.suburb ?? null } : null,
    title: `Repair: ${row.title}`.slice(0, 160),
    description: lines.join("\n\n").slice(0, 4000),
    referenceImages: row.attachments
      .filter((attachment) => isImage(attachment) && isHttpUrl(attachment.url))
      .slice(0, MAX_REFERENCE_IMAGES)
      .map((attachment) => ({ key: attachment.s3Key, url: attachment.url, ...(attachment.label ? { label: attachment.label.slice(0, 160) } : {}) })),
  };
}

export class QuoteReferenceError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/**
 * Refuses reference-image keys the caller may not attach. Keys stored on the
 * linked case are allowed (office-visible case evidence); every other key must
 * be the caller's own upload or an office account's upload.
 */
export async function assertQuoteReferenceKeys(input: { keys: readonly string[]; callerId: string; caseId?: string | null }): Promise<void> {
  if (input.keys.length === 0) return;
  const caseKeys = input.caseId
    ? (await db.caseAttachment.findMany({ where: { caseId: input.caseId }, select: { s3Key: true } })).map((row) => row.s3Key)
    : [];
  const foreign = await findForeignUploadKeys({ keys: input.keys, callerId: input.callerId, knownKeys: caseKeys });
  if (foreign.length > 0) throw new QuoteReferenceError(403, FOREIGN_UPLOAD_MESSAGE);
}

/** Checks the case exists before a quote is linked to it. */
export async function caseForQuote(caseId: string): Promise<{ id: string; title: string }> {
  const row = await db.issueTicket.findUnique({ where: { id: caseId }, select: { id: true, title: true } });
  if (!row) throw new QuoteReferenceError(404, "The case this quote was started from no longer exists.");
  return row;
}

/**
 * Records the link inside the quote's own transaction: the FROM_CASE event on
 * the quote and an internal note on the case (the client never sees it).
 */
export async function linkQuoteToCase(
  tx: Prisma.TransactionClient,
  input: { quoteId: string; caseId: string; caseTitle: string; actorId: string },
): Promise<void> {
  await tx.quoteEvent.create({ data: { quoteId: input.quoteId, type: QUOTE_FROM_CASE_EVENT, detail: { caseId: input.caseId, caseTitle: input.caseTitle, actorId: input.actorId } } });
  await tx.caseComment.create({ data: {
    caseId: input.caseId,
    authorUserId: input.actorId,
    isInternal: true,
    body: `Repair quote ${quoteReference(input.quoteId)} created from this case as a draft. Nothing has been sent to the client.`,
  } });
}

export async function quotesFromCase(caseId: string): Promise<CaseQuoteLink[]> {
  const events = await db.quoteEvent.findMany({
    where: { type: QUOTE_FROM_CASE_EVENT, detail: { path: ["caseId"], equals: caseId } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { quoteId: true, createdAt: true },
  });
  return events.map((event) => ({ quoteId: event.quoteId, reference: quoteReference(event.quoteId), createdAt: event.createdAt.toISOString(), href: `/v2/admin/quotes/${event.quoteId}` }));
}

export async function caseForQuoteDetail(quoteId: string): Promise<{ caseId: string; caseTitle: string; href: string } | null> {
  const event = await db.quoteEvent.findFirst({ where: { quoteId, type: QUOTE_FROM_CASE_EVENT }, orderBy: { createdAt: "asc" }, select: { detail: true } });
  const detail = (event?.detail ?? null) as { caseId?: unknown; caseTitle?: unknown } | null;
  if (!detail || typeof detail.caseId !== "string") return null;
  return { caseId: detail.caseId, caseTitle: typeof detail.caseTitle === "string" ? detail.caseTitle : "Case", href: `/v2/admin/cases?open=${encodeURIComponent(detail.caseId)}` };
}
