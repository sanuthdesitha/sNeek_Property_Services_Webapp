/**
 * "Create N drafts" (Wave D): the EXISTING generator, run once per client with
 * finished unbilled work, one client after another.
 *
 *   - The clients are the "Ready to bill" card's (lib/billing/ready-to-bill.ts).
 *   - Each client goes through generateClientInvoice with the options of the
 *     single generator (period, bill-by basis, GST) and `completedOnly`, so
 *     only finished work is billed, as the card counts it. No billing
 *     arithmetic lives here.
 *   - Each client reports its own outcome: created (with the INV- number),
 *     refused with the generator's own reason (missing rates, work invoiced by
 *     another request), nothing billable in the period, or failed.
 *   - Nothing is approved, sent or pushed.
 *   - Idempotent per request key: the first request records a RUNNING row and,
 *     when done, a FINISHED row with every outcome (AuditLog, append-only). A
 *     repeat of the same key returns the stored outcomes and runs nothing; a
 *     repeat while it is still running is refused. A key reused with other
 *     options is refused.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { generateClientInvoice } from "./client-invoices";
import { recordInvoiceAudit } from "./client-invoice-audit";
import { sydneyDayBoundary } from "./period";
import { getReadyToBill } from "./ready-to-bill";

export const BATCH_GENERATE_MAX_CLIENTS = 200;
const AUDIT_ACTION = "CLIENT_INVOICE_BATCH_DRAFTS";

const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);

export const batchGenerateSchema = z
  .object({
    requestKey: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9:_-]+$/),
    periodStart: day.nullable().optional(),
    periodEnd: day.nullable().optional(),
    periodBasis: z.enum(["SERVICE", "SCHEDULED"]).default("SCHEDULED"),
    gstEnabled: z.boolean().optional(),
  })
  .refine((value) => !value.periodStart || !value.periodEnd || value.periodStart <= value.periodEnd, {
    message: "The period start must be on or before the period end.",
  });

export type BatchGenerateRequest = z.infer<typeof batchGenerateSchema>;

export type BatchClientOutcome = {
  clientId: string;
  clientName: string;
  outcome: "created" | "refused" | "nothing" | "failed";
  invoiceId?: string;
  invoiceNumber?: string;
  includedJobCount?: number;
  reason?: string;
};

export type BatchGenerateResponse = {
  requestKey: string;
  /** True when these outcomes were stored by an earlier request with the same key. */
  replayed: boolean;
  results: BatchClientOutcome[];
  summary: { created: number; refused: number; nothing: number; failed: number };
};

export type BatchGenerateResult =
  | { status: 200; body: BatchGenerateResponse }
  | { status: 409 | 400; body: { error: string } };

type StoredRow = { state: "RUNNING" | "FINISHED"; fingerprint: string; response?: BatchGenerateResponse };

function fingerprintOf(request: BatchGenerateRequest): string {
  return JSON.stringify([request.periodStart ?? null, request.periodEnd ?? null, request.periodBasis, request.gstEnabled ?? null]);
}

function summarise(results: BatchClientOutcome[]): BatchGenerateResponse["summary"] {
  const count = (outcome: BatchClientOutcome["outcome"]) => results.filter((row) => row.outcome === outcome).length;
  return { created: count("created"), refused: count("refused"), nothing: count("nothing"), failed: count("failed") };
}

/** The generator's refusal, classified by its own wording (auto-invoice reads the same sentence). */
export function classifyGeneratorError(message: string): BatchClientOutcome["outcome"] {
  if (/No billable completed jobs/i.test(message)) return "nothing";
  if (/Missing client rates|invoiced by another request|changed while|already paid these shopping/i.test(message)) return "refused";
  return "failed";
}

function entityIdFor(requestKey: string): string {
  return `batch:${requestKey}`;
}

/** Claim the key under an advisory lock, or answer with what it already holds. */
async function claimKey(request: BatchGenerateRequest, actorId: string): Promise<StoredRow | null> {
  const entityId = entityIdFor(request.requestKey);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-batch:${request.requestKey}`}))`;
    const latest = await tx.auditLog.findFirst({
      where: { action: AUDIT_ACTION, entity: "ClientInvoice", entityId },
      orderBy: { createdAt: "desc" },
      select: { after: true },
    });
    if (latest?.after && typeof latest.after === "object") return latest.after as unknown as StoredRow;
    const running: StoredRow = { state: "RUNNING", fingerprint: fingerprintOf(request) };
    await tx.auditLog.create({
      data: { userId: actorId, action: AUDIT_ACTION, entity: "ClientInvoice", entityId, after: running as unknown as Prisma.InputJsonObject },
    });
    return null;
  });
}

async function generateFor(
  client: { clientId: string; clientName: string },
  request: BatchGenerateRequest,
  actorId: string,
): Promise<BatchClientOutcome> {
  try {
    const invoice = await generateClientInvoice({
      clientId: client.clientId,
      periodStart: sydneyDayBoundary(request.periodStart ?? null, "start"),
      periodEnd: sydneyDayBoundary(request.periodEnd ?? null, "end"),
      gstEnabled: request.gstEnabled,
      periodBasis: request.periodBasis,
      completedOnly: true,
    });
    await recordInvoiceAudit({
      actorId,
      invoiceId: invoice.id,
      action: "CLIENT_INVOICE_BATCH_CREATED",
      after: { requestKey: request.requestKey, includedJobCount: invoice.generationSummary.includedJobCount },
    });
    return {
      ...client,
      outcome: "created",
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      includedJobCount: invoice.generationSummary.includedJobCount,
    };
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : "The generator failed.";
    return { ...client, outcome: classifyGeneratorError(reason), reason };
  }
}

export async function runBatchGenerate(input: { request: BatchGenerateRequest; actorId: string }): Promise<BatchGenerateResult> {
  const { request } = input;
  const stored = await claimKey(request, input.actorId);
  if (stored) {
    if (stored.fingerprint !== fingerprintOf(request)) {
      return { status: 409, body: { error: "This request key was already used with different options. Start again." } };
    }
    if (stored.state === "RUNNING" || !stored.response) {
      return { status: 409, body: { error: "These drafts are still being created. Reload the list in a moment to see them." } };
    }
    return { status: 200, body: { ...stored.response, replayed: true } };
  }

  const ready = await getReadyToBill();
  const clients = ready.byClient.slice(0, BATCH_GENERATE_MAX_CLIENTS);
  const results: BatchClientOutcome[] = [];
  // One client at a time: the generator takes a per-client advisory lock and
  // a later client must see what an earlier one committed.
  for (const client of clients) {
    results.push(await generateFor({ clientId: client.clientId, clientName: client.clientName }, request, input.actorId));
  }
  const response: BatchGenerateResponse = { requestKey: request.requestKey, replayed: false, results, summary: summarise(results) };
  const finished: StoredRow = { state: "FINISHED", fingerprint: fingerprintOf(request), response };
  await db.auditLog
    .create({
      data: {
        userId: input.actorId,
        action: AUDIT_ACTION,
        entity: "ClientInvoice",
        entityId: entityIdFor(request.requestKey),
        after: finished as unknown as Prisma.InputJsonObject,
      },
    })
    .catch((error) => logger.error({ error }, "[invoice] batch drafts created but the outcome record could not be written"));
  if (ready.byClient.length > clients.length) {
    logger.warn({ skipped: ready.byClient.length - clients.length }, "[invoice] batch drafts capped; run again for the rest");
  }
  return { status: 200, body: response };
}
