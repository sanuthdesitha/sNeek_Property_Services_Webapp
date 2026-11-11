/**
 * Xero status and payment pull for client invoices and credit notes.
 *
 * For each local invoice that is in Xero (has a xeroInvoiceId) and is not PAID
 * or VOID here, and each issued credit note that is in Xero and not yet fully
 * allocated there: read Xero, then let `decideXeroSync` say what that means.
 * New Xero payments are recorded through `patchClientInvoice` (the function
 * "Record payment" uses), so the transition graph, credits and PAID settlement
 * are the existing rules, with source XERO and the Xero payment id as the
 * idempotency key. Everything else is stored as a state on the invoice's
 * metadata (`xeroSync`), shown on the list and the editor.
 *
 * A read that fails changes nothing on the invoice except that state: UNKNOWN
 * with the reason. Never "synced", never zero.
 */
import { ClientInvoiceStatus, Role, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { REDUCING_CREDIT_NOTES_SELECT, creditedAmountOf } from "@/lib/finance/receivables";
import {
  XERO_READ_BATCH_SIZE,
  hasActiveXeroConnection,
  readXeroCreditNote,
  readXeroInvoices,
  type XeroReadOptions,
} from "@/lib/xero/client";
import type { XeroDocumentRead, XeroPayment } from "@/lib/xero/xero-documents";
import { recordInvoiceAudit } from "./client-invoice-audit";
import { XERO_PAYMENT_EXCEEDS_OWING, patchClientInvoice } from "./client-invoice-patch";
import {
  decideXeroSync,
  readStoredXeroSync,
  recordedXeroPaymentIds,
  syncedState,
  unknownState,
  type StoredXeroSync,
  type XeroSyncState,
} from "./client-invoice-xero-sync-rules";
import { actionError, isActionSuccess, type InvoiceActor } from "./invoice-action-result";
import type { XeroSyncOutcome, XeroSyncRowResult, XeroSyncRunSummary } from "./client-invoice-xero-sync-types";

/** Bounded work per run; the rest waits for the next run (oldest-checked first). */
export const XERO_SYNC_MAX_INVOICES_PER_RUN = 200;
export const XERO_SYNC_MAX_CREDIT_NOTES_PER_RUN = 20;
/** Where the last whole run is remembered (for the header badge). */
export const XERO_SYNC_SETTING_KEY = "xeroInvoiceSync";

const CANDIDATE_SELECT = {
  id: true,
  invoiceNumber: true,
  kind: true,
  status: true,
  xeroInvoiceId: true,
  totalAmount: true,
  paidAmount: true,
  metadata: true,
  creditNotes: REDUCING_CREDIT_NOTES_SELECT,
} satisfies Prisma.ClientInvoiceSelect;

type Candidate = Prisma.ClientInvoiceGetPayload<{ select: typeof CANDIDATE_SELECT }>;

type RunContext = {
  trigger: "scheduled" | "manual";
  actor: InvoiceActor | null;
  now: Date;
};

function row(candidate: Pick<Candidate, "id" | "invoiceNumber">, outcome: XeroSyncOutcome, extra: Partial<XeroSyncRowResult> = {}): XeroSyncRowResult {
  return { id: candidate.id, invoiceNumber: candidate.invoiceNumber, outcome, paymentsRecorded: 0, ...extra };
}

/** Why a selected invoice is not read at all, or null when it should be. */
function notEligibleReason(candidate: Candidate): string | null {
  if (!candidate.xeroInvoiceId) return "Not in Xero yet. Push it first.";
  if (candidate.status === ClientInvoiceStatus.VOID) return "Void here, so it is not checked against Xero.";
  if (candidate.kind === "INVOICE" && candidate.status === ClientInvoiceStatus.PAID) {
    return "Already paid here, so it is not checked against Xero.";
  }
  return null;
}

/** Store the state under the invoice's row lock, keeping every other metadata key. */
async function writeSyncState(invoiceId: string, state: StoredXeroSync): Promise<StoredXeroSync | null> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ClientInvoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const current = await tx.clientInvoice.findUnique({ where: { id: invoiceId }, select: { metadata: true } });
    if (!current) return null;
    const metadata = current.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata) ? current.metadata : {};
    const previous = readStoredXeroSync(metadata);
    await tx.clientInvoice.update({
      where: { id: invoiceId },
      data: { metadata: { ...(metadata as Prisma.JsonObject), xeroSync: state as unknown as Prisma.JsonObject } },
    });
    return previous;
  });
}

/** Audit only when something happened: payments recorded or the state changed. */
async function auditSync(candidate: Candidate, state: StoredXeroSync, previous: StoredXeroSync | null, context: RunContext) {
  const changed = !previous || previous.state !== state.state || previous.reason !== state.reason || previous.xeroStatus !== state.xeroStatus;
  if (!changed && state.recordedPayments === 0) return;
  await recordInvoiceAudit({
    actorId: context.actor?.id,
    invoiceId: candidate.id,
    action: "CLIENT_INVOICE_XERO_SYNC",
    after: {
      state: state.state,
      reason: state.reason,
      xeroStatus: state.xeroStatus,
      paymentsRecorded: state.recordedPayments,
      trigger: context.trigger,
    },
  });
}

async function store(candidate: Candidate, state: StoredXeroSync, context: RunContext, outcome: XeroSyncOutcome): Promise<XeroSyncRowResult> {
  const previous = await writeSyncState(candidate.id, state);
  await auditSync(candidate, state, previous, context);
  return row(candidate, outcome, { reason: state.reason ?? undefined, paymentsRecorded: state.recordedPayments, state: state.state });
}

const OUTCOME_FOR_STATE: Record<XeroSyncState, XeroSyncOutcome> = {
  IN_XERO: "in-xero",
  PAID_IN_XERO: "paid-in-xero",
  NEEDS_REVIEW: "needs-review",
  UNKNOWN: "unknown",
};

/** Record each new Xero payment, oldest first, stopping at the first refusal. */
async function recordPayments(
  candidate: Candidate,
  payments: XeroPayment[],
  context: RunContext,
): Promise<{ recorded: number; refusal: string | null }> {
  let recorded = 0;
  for (const payment of payments) {
    const result = await patchClientInvoice({
      invoiceId: candidate.id,
      actor: context.actor!,
      xeroPayment: { paymentId: payment.paymentId, trigger: context.trigger },
      body: {
        recordPayment: {
          amount: payment.amount,
          method: "XERO",
          paidDate: payment.date,
          reference: payment.reference ?? `Xero payment ${payment.paymentId}`,
        },
      },
    });
    if (!isActionSuccess(result)) {
      const code = (result.body as { code?: unknown }).code;
      const refusal = code === XERO_PAYMENT_EXCEEDS_OWING
        ? "A Xero payment is more than this invoice still owes here (perhaps it was also recorded by hand)."
        : `A Xero payment could not be recorded: ${actionError(result, "it was refused.")}`;
      return { recorded, refusal };
    }
    if (!(result.body as { alreadyRecorded?: boolean }).alreadyRecorded) recorded += 1;
  }
  return { recorded, refusal: null };
}

async function applyRead(candidate: Candidate, read: XeroDocumentRead, context: RunContext): Promise<XeroSyncRowResult> {
  const previous = readStoredXeroSync(candidate.metadata);
  if (!read.ok) return store(candidate, unknownState(previous, `Xero state unknown: ${read.failure.reason}`, context.now), context, "unknown");
  const document = read.document;
  const decision = decideXeroSync(
    {
      kind: candidate.kind === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE",
      status: candidate.status,
      totalAmount: Number(candidate.totalAmount ?? 0),
      paidAmount: Number(candidate.paidAmount ?? 0),
      creditedAmount: candidate.kind === "CREDIT_NOTE" ? 0 : creditedAmountOf(candidate.creditNotes),
      recordedXeroPaymentIds: recordedXeroPaymentIds(candidate.metadata),
    },
    document,
  );
  const synced = (state: XeroSyncState, reason: string | null, recordedPayments = 0) =>
    syncedState({ state, reason, document, now: context.now, recordedPayments });

  if (decision.action === "review") return store(candidate, synced("NEEDS_REVIEW", decision.reason), context, "needs-review");
  if (decision.action === "settled") return store(candidate, synced(decision.state, null), context, OUTCOME_FOR_STATE[decision.state]);

  if (!context.actor) {
    return store(candidate, unknownState(previous, "Xero state unknown: no active administrator account to record Xero's payments under.", context.now), context, "unknown");
  }
  const { recorded, refusal } = await recordPayments(candidate, decision.payments, context);
  if (refusal) return store(candidate, synced("NEEDS_REVIEW", refusal, recorded), context, "needs-review");
  const after = await db.clientInvoice.findUnique({ where: { id: candidate.id }, select: { status: true } });
  const paidHere = after?.status === ClientInvoiceStatus.PAID;
  let state: StoredXeroSync;
  if (document.status === "PAID" && !paidHere) {
    state = synced("NEEDS_REVIEW", "Xero says this invoice is paid, but the payments it reports do not settle it here.", recorded);
  } else {
    state = synced(paidHere && document.status === "PAID" ? "PAID_IN_XERO" : "IN_XERO", null, recorded);
  }
  const result = await store(candidate, state, context, OUTCOME_FOR_STATE[state.state]);
  return recorded > 0 && state.state !== "NEEDS_REVIEW" ? { ...result, outcome: "recorded" } : result;
}

async function readAll(candidates: Candidate[], options: XeroReadOptions): Promise<Map<string, XeroDocumentRead>> {
  const reads = new Map<string, XeroDocumentRead>();
  const invoices = candidates.filter((candidate) => candidate.kind !== "CREDIT_NOTE");
  for (let start = 0; start < invoices.length; start += XERO_READ_BATCH_SIZE) {
    const batch = invoices.slice(start, start + XERO_READ_BATCH_SIZE);
    const answer = await readXeroInvoices(batch.map((candidate) => candidate.xeroInvoiceId!), options);
    for (const candidate of batch) reads.set(candidate.id, answer.get(candidate.xeroInvoiceId!)!);
  }
  for (const candidate of candidates.filter((item) => item.kind === "CREDIT_NOTE")) {
    reads.set(candidate.id, await readXeroCreditNote(candidate.xeroInvoiceId!, options));
  }
  return reads;
}

/** The oldest-checked invoices first; a credit note fully allocated in Xero is done. */
async function scheduledCandidates(): Promise<{ candidates: Candidate[]; eligible: number }> {
  const invoiceWhere: Prisma.ClientInvoiceWhereInput = {
    kind: "INVOICE",
    xeroInvoiceId: { not: null },
    status: { notIn: [ClientInvoiceStatus.PAID, ClientInvoiceStatus.VOID] },
  };
  const creditWhere: Prisma.ClientInvoiceWhereInput = {
    kind: "CREDIT_NOTE",
    xeroInvoiceId: { not: null },
    status: { in: [ClientInvoiceStatus.APPROVED, ClientInvoiceStatus.SENT] },
  };
  const [invoiceCount, invoices, credits] = await Promise.all([
    db.clientInvoice.count({ where: invoiceWhere }),
    db.clientInvoice.findMany({ where: invoiceWhere, select: CANDIDATE_SELECT, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: XERO_SYNC_MAX_INVOICES_PER_RUN }),
    db.clientInvoice.findMany({ where: creditWhere, select: CANDIDATE_SELECT, orderBy: [{ updatedAt: "asc" }, { id: "asc" }] }),
  ]);
  const openCredits = credits.filter((note) => readStoredXeroSync(note.metadata)?.xeroStatus !== "PAID");
  return {
    candidates: [...invoices, ...openCredits.slice(0, XERO_SYNC_MAX_CREDIT_NOTES_PER_RUN)],
    eligible: invoiceCount + openCredits.length,
  };
}

/** The earliest active administrator: the account a scheduled run records payments under. */
async function scheduledActor(): Promise<InvoiceActor | null> {
  const admin = await db.user.findFirst({
    where: { role: Role.ADMIN, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, name: true, email: true },
  });
  return admin ? { id: admin.id, role: admin.role, name: admin.name, email: admin.email } : null;
}

function summarize(results: XeroSyncRowResult[], remaining: number, skipped?: "not-connected"): XeroSyncRunSummary {
  const counts: Record<XeroSyncOutcome, number> = { recorded: 0, "in-xero": 0, "paid-in-xero": 0, "needs-review": 0, unknown: 0, skipped: 0 };
  for (const result of results) counts[result.outcome] += 1;
  return { ...(skipped ? { skipped } : {}), results, counts, remaining };
}

async function rememberRun(summary: XeroSyncRunSummary, now: Date) {
  const existing = await db.appSetting.findUnique({ where: { key: XERO_SYNC_SETTING_KEY } });
  const previous = (existing?.value ?? {}) as { lastSuccessAt?: string | null };
  // A run is successful only when every read succeeded.
  const success = summary.counts.unknown === 0;
  const value = {
    lastRunAt: now.toISOString(),
    lastSuccessAt: success ? now.toISOString() : previous.lastSuccessAt ?? null,
    lastRunCounts: summary.counts,
  };
  await db.appSetting.upsert({ where: { key: XERO_SYNC_SETTING_KEY }, create: { key: XERO_SYNC_SETTING_KEY, value }, update: { value } });
}

/**
 * The scheduled job: every eligible invoice and credit note up to the per-run
 * bound. A no-op with a clear log when Xero is not connected.
 */
export async function runScheduledXeroSync(options: { now?: Date; readOptions?: XeroReadOptions } = {}): Promise<XeroSyncRunSummary> {
  const now = options.now ?? new Date();
  if (!(await hasActiveXeroConnection())) {
    logger.info("[xero-invoice-sync] Xero is not connected; nothing to check.");
    return summarize([], 0, "not-connected");
  }
  const [{ candidates, eligible }, actor] = await Promise.all([scheduledCandidates(), scheduledActor()]);
  const context: RunContext = { trigger: "scheduled", actor, now };
  const reads = await readAll(candidates, options.readOptions ?? {});
  const results: XeroSyncRowResult[] = [];
  for (const candidate of candidates) results.push(await applyRead(candidate, reads.get(candidate.id)!, context));
  const summary = summarize(results, Math.max(0, eligible - candidates.length));
  await rememberRun(summary, now);
  logger.info({ counts: summary.counts, remaining: summary.remaining }, "[xero-invoice-sync] run complete");
  return summary;
}

/** "Refresh from Xero" for chosen invoices: one row result per id, in the order asked. */
export async function refreshInvoicesFromXero(input: {
  ids: string[];
  actor: InvoiceActor;
  now?: Date;
  readOptions?: XeroReadOptions;
}): Promise<XeroSyncRunSummary> {
  const now = input.now ?? new Date();
  const found = await db.clientInvoice.findMany({ where: { id: { in: input.ids } }, select: CANDIDATE_SELECT });
  const byId = new Map(found.map((candidate) => [candidate.id, candidate]));
  const connected = await hasActiveXeroConnection();
  const eligible = found.filter((candidate) => !notEligibleReason(candidate));
  const reads = connected ? await readAll(eligible, input.readOptions ?? {}) : new Map<string, XeroDocumentRead>();
  const context: RunContext = { trigger: "manual", actor: input.actor, now };
  const results: XeroSyncRowResult[] = [];
  for (const id of input.ids) {
    const candidate = byId.get(id);
    if (!candidate) {
      results.push({ id, invoiceNumber: null, outcome: "skipped", reason: "Invoice not found.", paymentsRecorded: 0 });
      continue;
    }
    const reason = notEligibleReason(candidate);
    if (reason) results.push(row(candidate, "skipped", { reason }));
    else if (!connected) results.push(row(candidate, "skipped", { reason: "Xero is not connected, so nothing was checked." }));
    else results.push(await applyRead(candidate, reads.get(candidate.id)!, context));
  }
  return summarize(results, 0, connected ? undefined : "not-connected");
}

/** The last whole scheduled run, for the page header. Null fields when never stored. */
export async function readXeroSyncStatus(): Promise<{ lastRunAt: string | null; lastSuccessAt: string | null }> {
  const row = await db.appSetting.findUnique({ where: { key: XERO_SYNC_SETTING_KEY } });
  const value = (row?.value ?? {}) as { lastRunAt?: unknown; lastSuccessAt?: unknown };
  return {
    lastRunAt: typeof value.lastRunAt === "string" ? value.lastRunAt : null,
    lastSuccessAt: typeof value.lastSuccessAt === "string" ? value.lastSuccessAt : null,
  };
}
