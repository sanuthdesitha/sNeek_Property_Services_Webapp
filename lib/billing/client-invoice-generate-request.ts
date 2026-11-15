/**
 * New invoice → From finished jobs, once per request key.
 *
 * The draft itself is made by the EXISTING generator (generateClientInvoice)
 * with exactly the options the old "Generate invoice" dialog sent, so the
 * same selection produces the same draft (tests/db/new-invoice-panel.test.ts
 * compares them). What this adds:
 *
 *   - A request key. The first request records a RUNNING row and, when done,
 *     a FINISHED row with the invoice id (AuditLog, append-only, under an
 *     advisory lock per key). A repeat of the same key (a double click, or a
 *     retry after a lost answer) returns that same draft and creates nothing.
 *     A key reused with other options is refused. A refused generation
 *     records FAILED, so the same key may try again once the reason is fixed
 *     (nothing was created).
 *   - Unrated jobs left off on purpose (owner default, pending confirmation):
 *     the ids the office saw in the preview. Any other unrated job still
 *     refuses the draft with the generator's own message.
 *
 * Nothing is approved, sent or pushed to Xero.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateClientInvoice } from "./client-invoices";
import { recordInvoiceAudit } from "./client-invoice-audit";
import { sydneyDayBoundary } from "./period";
import type { GenerateRequestResponse } from "./client-invoice-generate-preview-types";

const REQUEST_ACTION = "CLIENT_INVOICE_GENERATE_REQUEST";
const CREATED_ACTION = "CLIENT_INVOICE_GENERATED";
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);

export const generateRequestSchema = z
  .object({
    requestKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9:_-]+$/),
    clientId: z.string().trim().min(1).max(200),
    propertyId: z.string().trim().max(200).nullable().optional(),
    periodStart: day.nullable().optional(),
    periodEnd: day.nullable().optional(),
    periodBasis: z.enum(["SERVICE", "SCHEDULED"]).default("SCHEDULED"),
    gstEnabled: z.boolean().optional(),
    leaveOutUnratedJobIds: z.array(z.string().trim().min(1).max(200)).max(500).default([]),
  })
  .strict()
  .refine((value) => !value.periodStart || !value.periodEnd || value.periodStart <= value.periodEnd, {
    message: "The period start must be on or before the period end.",
  });

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export type GenerateRequestResult =
  | { status: 200; body: GenerateRequestResponse }
  | { status: 400 | 409; body: { error: string } };

type StoredRow =
  | { state: "RUNNING"; fingerprint: string }
  | { state: "FINISHED"; fingerprint: string; invoiceId: string; notBilled: GenerateRequestResponse["notBilled"] }
  | { state: "FAILED"; fingerprint: string; reason: string };

export function generateRequestFingerprint(request: GenerateRequest): string {
  return JSON.stringify([
    request.clientId,
    request.propertyId || null,
    request.periodStart ?? null,
    request.periodEnd ?? null,
    request.periodBasis,
    request.gstEnabled ?? null,
    [...request.leaveOutUnratedJobIds].sort(),
  ]);
}

function entityIdFor(requestKey: string): string {
  return `generate:${requestKey}`;
}

async function claimKey(request: GenerateRequest, actorId: string): Promise<StoredRow | null> {
  const entityId = entityIdFor(request.requestKey);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-generate:${request.requestKey}`}))`;
    const latest = await tx.auditLog.findFirst({
      where: { action: REQUEST_ACTION, entity: "ClientInvoice", entityId },
      orderBy: { createdAt: "desc" },
      select: { after: true },
    });
    const stored = latest?.after && typeof latest.after === "object" ? (latest.after as unknown as StoredRow) : null;
    if (stored && stored.state !== "FAILED") return stored;
    const running: StoredRow = { state: "RUNNING", fingerprint: generateRequestFingerprint(request) };
    await tx.auditLog.create({
      data: { userId: actorId, action: REQUEST_ACTION, entity: "ClientInvoice", entityId, after: running as unknown as Prisma.InputJsonObject },
    });
    return null;
  });
}

async function writeOutcome(actorId: string, requestKey: string, row: StoredRow): Promise<void> {
  await db.auditLog
    .create({ data: { userId: actorId, action: REQUEST_ACTION, entity: "ClientInvoice", entityId: entityIdFor(requestKey), after: row as unknown as Prisma.InputJsonObject } })
    .catch((error) => logger.error({ error }, "[invoice] generate request outcome could not be recorded"));
}

/** The draft a finished key points to, read back as it is stored now. */
async function replay(invoiceId: string, notBilled: GenerateRequestResponse["notBilled"]): Promise<GenerateRequestResult> {
  const invoice = await db.clientInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, invoiceNumber: true, totalAmount: true, _count: { select: { lines: true } } } });
  if (!invoice) return { status: 409, body: { error: "The draft this request made no longer exists. Start a new invoice." } };
  return { status: 200, body: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount, lineCount: invoice._count.lines, notBilled, replayed: true } };
}

/** A RUNNING key whose draft was made but whose FINISHED row was lost. */
async function createdUnderKey(requestKey: string): Promise<string | null> {
  const row = await db.auditLog.findFirst({
    where: { action: CREATED_ACTION, entity: "ClientInvoice", after: { path: ["requestKey"], equals: requestKey } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true },
  });
  return row?.entityId ?? null;
}

export async function runGenerateRequest(input: { request: GenerateRequest; actorId: string }): Promise<GenerateRequestResult> {
  const { request, actorId } = input;
  const fingerprint = generateRequestFingerprint(request);
  const stored = await claimKey(request, actorId);
  if (stored) {
    if (stored.fingerprint !== fingerprint) {
      return { status: 409, body: { error: "This request key was already used with a different selection. Start again." } };
    }
    if (stored.state === "FINISHED") return replay(stored.invoiceId, stored.notBilled);
    const madeId = await createdUnderKey(request.requestKey);
    if (madeId) return replay(madeId, []);
    return { status: 409, body: { error: "This draft is still being created. Reload the invoice list in a moment to see it." } };
  }

  try {
    const invoice = await generateClientInvoice({
      clientId: request.clientId,
      propertyId: request.propertyId || null,
      periodStart: sydneyDayBoundary(request.periodStart ?? null, "start"),
      periodEnd: sydneyDayBoundary(request.periodEnd ?? null, "end"),
      gstEnabled: request.gstEnabled,
      periodBasis: request.periodBasis,
      ...(request.leaveOutUnratedJobIds.length > 0 ? { leaveOutUnratedJobIds: request.leaveOutUnratedJobIds } : {}),
    });
    const notBilled = invoice.notBilled.map((job) => ({ jobId: job.jobId, jobNumber: job.jobNumber }));
    await recordInvoiceAudit({
      actorId,
      invoiceId: invoice.id,
      action: CREATED_ACTION,
      after: { requestKey: request.requestKey, includedJobCount: invoice.generationSummary.includedJobCount, notBilledJobIds: invoice.notBilled.map((job) => job.jobId) },
    });
    await writeOutcome(actorId, request.requestKey, { state: "FINISHED", fingerprint, invoiceId: invoice.id, notBilled });
    return {
      status: 200,
      body: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, totalAmount: invoice.totalAmount, lineCount: invoice.lines.length, notBilled, replayed: false },
    };
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : "The draft could not be created.";
    await writeOutcome(actorId, request.requestKey, { state: "FAILED", fingerprint, reason });
    return { status: 400, body: { error: reason } };
  }
}
