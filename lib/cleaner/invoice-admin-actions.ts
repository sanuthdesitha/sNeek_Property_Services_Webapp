/**
 * Admin actions on one cleaner (payee) invoice, shared by the single-row
 * routes and the bulk route so both run the same guards: the transition table
 * (lib/cleaner/invoice-transitions.ts), the per-payee advisory lock plus row
 * lock, the re-check under lock, the releases, the payee emails and one audit
 * row per transition. Moved out of app/api/admin/cleaner-invoices/[id]/route.ts
 * and .../xero-push/route.ts; the money rules are unchanged.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { pushCleanerBillToXero } from "@/lib/xero/client";
import { releaseCleanerInvoiceConsumables } from "@/lib/cleaner/invoice-release";
import { clearsChangesNote, clearsPaymentRecord, releasesPayeeWork, requiresChangesNote } from "@/lib/cleaner/invoice-status";
import { payeeKindFromSnapshot, payeeKindLabel, xeroLineFallbackDescription } from "@/lib/invoicing/payee-kind";
import { actionForTargetStatus, cleanerInvoiceTransition, SETTLED_REFUSAL } from "./invoice-transitions";
import { notifyPayeeOfChangeRequest, sendPayeeRemittance } from "./invoice-admin-notify";

export type CleanerInvoiceActor = { id: string; role: string };
export type CleanerActionResult = { status: number; body: Record<string, unknown> };

const result = (body: Record<string, unknown>, status = 200): CleanerActionResult => ({ status, body });

export const cleanerInvoicePatchSchema = z
  .object({
    status: z.enum(["SUBMITTED", "APPROVED", "CHANGES_REQUESTED", "XERO_PUSHED", "PAID", "VOID"]),
    /** CHANGES_REQUESTED only — what the payee is meant to fix. Required. */
    changesNote: z.string().trim().min(1).max(2000).optional(),
    // Payment settlement — supplied when status === "PAID".
    paidAmount: z.number().nonnegative().optional(),
    paidBankAccount: z.string().trim().max(200).optional(),
    paidNote: z.string().trim().max(2000).optional(),
    paymentMethod: z.enum(["BANK_TRANSFER", "CARD", "CASH", "XERO", "OTHER"]).optional(),
    paidDate: z.string().optional(),
  })
  .refine((v) => v.status !== "PAID" || Boolean(v.paymentMethod), {
    message: "A payment method is required when marking an invoice paid.",
    path: ["paymentMethod"],
  })
  .refine((v) => !requiresChangesNote(v.status) || Boolean(v.changesNote), {
    message: "Say what needs changing — the payee cannot guess which line is wrong.",
    path: ["changesNote"],
  });

export type CleanerInvoicePatch = z.infer<typeof cleanerInvoicePatchSchema>;

type PaymentData = {
  paidAt?: Date | null;
  paidAmount?: number | null;
  paidBankAccount?: string | null;
  paidNote?: string | null;
  paymentMethod?: string | null;
  paidDate?: Date | null;
};

function paymentDataFor(body: CleanerInvoicePatch, totalAmount: number, target: string): PaymentData {
  if (target === "PAID") {
    return {
      paidAt: new Date(),
      paidAmount: body.paidAmount ?? totalAmount ?? 0,
      paidBankAccount: body.paidBankAccount || null,
      paidNote: body.paidNote || null,
      paymentMethod: body.paymentMethod || null,
      paidDate: body.paidDate ? new Date(body.paidDate) : new Date(),
    };
  }
  // Only an explicit reversal clears the payment record (see invoice-status.ts).
  if (clearsPaymentRecord(target)) {
    return { paidAt: null, paidAmount: null, paidBankAccount: null, paidNote: null, paymentMethod: null, paidDate: null };
  }
  return {};
}

function jobIdsOf(lineData: unknown): string[] {
  const ids = (lineData as { jobIds?: unknown } | null)?.jobIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

/** Apply one status decision (approve, request changes, pay, reverse, reject claim). */
export async function applyCleanerInvoiceStatus(input: { id: string; body: CleanerInvoicePatch; actor: CleanerInvoiceActor }): Promise<CleanerActionResult> {
  const { id, body, actor } = input;
  const current = await db.cleanerInvoiceSubmission.findUnique({ where: { id } });
  if (!current) return result({ error: "Submission not found." }, 404);
  if (current.status === body.status) return result({ ok: true, status: current.status });

  const action = actionForTargetStatus(current.status, body.status);
  if (!action) return result({ error: SETTLED_REFUSAL }, 409);
  const answer = cleanerInvoiceTransition(action, current, actor.role);
  if (!answer.ok) return result({ error: answer.reason }, answer.status);
  const target = answer.to ?? body.status;
  const paymentData = paymentDataFor(body, current.totalAmount, target);

  let released: Awaited<ReturnType<typeof releaseCleanerInvoiceConsumables>> | null = null;
  const updated = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${current.cleanerId}))`;
    await tx.$queryRaw`SELECT "id" FROM "CleanerInvoiceSubmission" WHERE "id" = ${id} FOR UPDATE`;
    const locked = await tx.cleanerInvoiceSubmission.findUnique({ where: { id } });
    if (!locked || locked.status !== current.status || locked.xeroBillId !== current.xeroBillId ||
        locked.paidAmount !== current.paidAmount || Boolean(locked.paidAt) !== Boolean(current.paidAt)) {
      throw new Error("Invoice changed while reviewing. Refresh before applying a decision.");
    }
    const jobIds = jobIdsOf(locked.lineData);
    if (target === "PAID" && jobIds.length) {
      await tx.job.updateMany({ where: { id: { in: jobIds } }, data: { cleanerPaidAt: new Date() } });
    }
    // Both a void and a send-back hand the work back (see invoice-status.ts).
    if (releasesPayeeWork(target)) released = await releaseCleanerInvoiceConsumables(tx, id);
    return tx.cleanerInvoiceSubmission.update({
      where: { id },
      data: {
        status: target,
        ...paymentData,
        ...(requiresChangesNote(target) ? { changesRequestedAt: new Date(), changesRequestedNote: body.changesNote ?? null } : {}),
        ...(clearsChangesNote(target) ? { changesRequestedAt: null, changesRequestedNote: null } : {}),
      },
    });
  });

  if (released) logger.info({ submissionId: id, ...(released as object) }, "[cleaner-invoice] voided; the payee's items are billable again");
  if (target === "PAID") {
    void sendPayeeRemittance(id).catch((err) =>
      logger.error({ err, submissionId: id }, "[cleaner-invoice] marked paid but the remittance advice could not be sent"),
    );
  }
  if (requiresChangesNote(target)) {
    await notifyPayeeOfChangeRequest(id, body.changesNote ?? "").catch((err) =>
      logger.error({ err, submissionId: id }, "[cleaner-invoice] changes requested but the payee could not be emailed"),
    );
  }
  await db.auditLog.create({
    data: {
      userId: actor.id,
      action: "CLEANER_INVOICE_STATUS_UPDATE",
      entity: "CleanerInvoiceSubmission",
      entityId: id,
      before: { status: current.status },
      after: { status: target, action, ...(requiresChangesNote(target) ? { changesNote: body.changesNote ?? null } : {}), ...paymentData } as object,
    },
  });
  return result({ ok: true, status: updated.status });
}

type SnapshotLine = { kind?: string; description?: string; quantity?: number; unitAmount?: number };

/** Push an approved invoice to Xero as a DRAFT bill, exactly once. */
export async function pushCleanerInvoiceOnce(id: string, actor: CleanerInvoiceActor): Promise<CleanerActionResult> {
  const sub = await db.cleanerInvoiceSubmission.findUnique({ where: { id } });
  if (!sub) return result({ error: "Submission not found." }, 404);
  if (sub.xeroBillId) return result({ error: "This invoice is already in Xero." }, 409);
  const answer = cleanerInvoiceTransition("push-xero", sub, actor.role);
  if (!answer.ok) return result({ error: answer.reason }, answer.status);

  const data = (sub.lineData ?? {}) as { contact?: Record<string, string | null>; lines?: SnapshotLine[]; payeeRole?: string };
  const contact = data.contact ?? {};
  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (lines.length === 0) return result({ error: "This invoice has no line items to push." }, 400);

  const cleaner = await db.user.findUnique({ where: { id: sub.cleanerId }, select: { name: true, email: true, phone: true, role: true } });
  // What this bill CONTAINS, read off the snapshot written at send time.
  const payeeKind = payeeKindFromSnapshot(data.payeeRole ?? cleaner?.role ?? null);
  const payeeLabel = payeeKindLabel(payeeKind);

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sub.cleanerId}))`;
    await tx.$queryRaw`SELECT "id" FROM "CleanerInvoiceSubmission" WHERE "id" = ${sub.id} FOR UPDATE`;
    const current = await tx.cleanerInvoiceSubmission.findUnique({ where: { id: sub.id } });
    if (!current || !cleanerInvoiceTransition("push-xero", current, actor.role).ok) {
      throw new Error("Invoice changed before export. Refresh and review it.");
    }
    await tx.cleanerInvoiceSubmission.update({ where: { id: sub.id }, data: { status: "XERO_EXPORTING" } });
  });

  const isoDate = (d: Date) => d.toISOString().slice(0, 10);
  const pushed = await pushCleanerBillToXero({
    idempotencyKey: `cleaner-invoice-${sub.id}`,
    cleanerName: contact.name || cleaner?.name || payeeLabel,
    cleanerEmail: contact.email || cleaner?.email || "no-reply@sneekops.com.au",
    cleanerPhone: contact.phone || cleaner?.phone || undefined,
    cleanerAddress: contact.address || undefined,
    reference: `${payeeLabel} invoice ${isoDate(sub.periodStart)} – ${isoDate(sub.periodEnd)}`,
    lineItems: lines.map((line) => ({
      // Per line, from the tag the send route stamped (older lines fall back to
      // the invoice-level kind).
      description: String(
        line.description ??
          xeroLineFallbackDescription(line.kind === "INSPECTION" || (!line.kind && payeeKind === "INSPECTIONS") ? "INSPECTION" : "CLEANING"),
      ),
      quantity: Number(line.quantity ?? 1),
      unitAmount: Number(line.unitAmount ?? 0),
    })),
  });

  await db.cleanerInvoiceSubmission.update({
    where: { id: sub.id },
    data: { status: "XERO_PUSHED", xeroBillId: pushed.xeroBillId, xeroExportedAt: new Date() },
  });
  // Best effort: the bill is already in Xero and stored; failing now would
  // tell the admin the push did not happen when it did.
  try {
    await db.auditLog.create({
      data: {
        userId: actor.id,
        action: "CLEANER_INVOICE_STATUS_UPDATE",
        entity: "CleanerInvoiceSubmission",
        entityId: sub.id,
        before: { status: sub.status },
        after: { status: "XERO_PUSHED", action: "push-xero", xeroBillId: pushed.xeroBillId },
      },
    });
  } catch (err) {
    logger.error({ err, submissionId: sub.id }, "[cleaner-invoice] pushed to Xero but the audit entry could not be written");
  }
  return result({ ok: true, xeroBillId: pushed.xeroBillId });
}

/** Hard-delete an unexported, unpaid invoice and hand its work back. */
export async function deleteCleanerInvoice(id: string, actor: CleanerInvoiceActor): Promise<CleanerActionResult> {
  const existing = await db.cleanerInvoiceSubmission.findUnique({ where: { id } });
  if (!existing) return result({ error: "Submission not found." }, 404);
  const answer = cleanerInvoiceTransition("delete", existing, actor.role);
  if (!answer.ok) return result({ error: answer.reason }, answer.status);
  const released = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${existing.cleanerId}))`;
    await tx.$queryRaw`SELECT "id" FROM "CleanerInvoiceSubmission" WHERE "id" = ${id} FOR UPDATE`;
    const locked = await tx.cleanerInvoiceSubmission.findUnique({ where: { id } });
    if (!locked || locked.status !== existing.status || locked.xeroBillId || locked.paidAt || locked.paidAmount != null) {
      throw new Error("Invoice changed or has payment evidence. Refresh before deleting.");
    }
    const counts = await releaseCleanerInvoiceConsumables(tx, id);
    await tx.cleanerInvoiceSubmission.delete({ where: { id } });
    return counts;
  });
  logger.info({ submissionId: id, ...released }, "[cleaner-invoice] deleted; the payee's items are billable again");
  await db.auditLog.create({
    data: {
      userId: actor.id,
      action: "CLEANER_INVOICE_DELETE",
      entity: "CleanerInvoiceSubmission",
      entityId: id,
      before: { status: existing.status, totalAmount: existing.totalAmount },
    },
  });
  return result({ ok: true });
}

/** Errors thrown inside the actions, in the status codes the routes always used. */
export function cleanerActionError(err: unknown, fallback: string): CleanerActionResult {
  const message = err instanceof Error && err.message ? err.message : fallback;
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 400;
  return result({ error: message }, status);
}
