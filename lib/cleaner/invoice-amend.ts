import "server-only";
/**
 * Amend a submitted cleaner (payee) invoice (2026-11-23). Rules in
 * invoice-amend-rules.ts. One transaction, under the same per-payee advisory
 * lock and row lock as every other decision on the invoice:
 *
 * - a retry with the same request key returns the amendment it made (a key
 *   reused with different changes is refused);
 * - refused when the invoice changed since the office opened it (its
 *   updatedAt and amendment count are both checked);
 * - the stored lines, total and hours are replaced by the amended ones and the
 *   amendment is appended to CleanerInvoiceRevision with the lines, totals and
 *   hours before and after, the per-line changes, the reason and the actual
 *   person; revision 1's "before" is the payee's original submission;
 * - an invoice already pushed to Xero is flagged `xeroOutOfDateSince` (the
 *   Xero client cannot update a bill, so nothing is sent there);
 * - one audit row, then the payee's notice after the commit; its outcome is
 *   stored on the revision. A retry whose notice was never recorded sends it
 *   (the notice's event id is per revision, so it is never sent twice).
 *
 * Refused while testing as someone else: the amendment changes money and
 * notifies a real payee.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { amendPermission, describeAmendment, planAmendment, type AmendmentPlan, type LineChange } from "./invoice-amend-rules";
import { notifyPayeeOfAmendment, type AmendNoticeRecord } from "./invoice-amend-notify";

export const amendRequestSchema = z.object({
  requestKey: z.string().trim().min(8).max(120),
  expectedUpdatedAt: z.string().trim().min(1).max(40),
  expectedRevision: z.number().int().min(0),
  reason: z.string().trim().min(3, "Say why the invoice is being amended; the payee is told.").max(2000),
  note: z.string().trim().max(1000).nullable().optional(),
  hours: z.number().min(0).max(10_000).nullable().optional(),
  lines: z
    .array(
      z.object({
        sourceIndex: z.number().int().min(0).nullable(),
        description: z.string().max(500),
        quantity: z.number(),
        unitAmount: z.number(),
        category: z.enum(["LABOUR", "INSPECTION", "REIMBURSEMENT"]).optional(),
      }),
    )
    .min(1, "An amended invoice needs at least one line.")
    .max(500),
});

export type AmendRequest = z.infer<typeof amendRequestSchema>;

export type AmendActor = {
  /** The signed-in person (the actual actor). */
  userId: string;
  /** The role the request runs as. */
  role: string;
  /** True while testing as someone else. */
  impersonating: boolean;
};

export type AmendOutcome =
  | {
      ok: true;
      status: 200;
      replayed: boolean;
      revision: number;
      beforeTotal: number;
      afterTotal: number;
      changes: string[];
      needsXeroUpdate: boolean;
      notice: AmendNoticeRecord | null;
    }
  | { ok: false; status: 400 | 403 | 404 | 409; reason: string };

function requestHash(request: AmendRequest): string {
  const { requestKey: _key, ...body } = request;
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

type Committed = {
  revisionId: string;
  revision: number;
  plan: Pick<AmendmentPlan, "changes" | "beforeTotal" | "afterTotal" | "beforeHours" | "afterHours">;
  reason: string;
  needsXeroUpdate: boolean;
  notice: AmendNoticeRecord | null;
  replayed: boolean;
};

function storedPlan(row: { changes: unknown; beforeTotal: number; afterTotal: number; beforeHours: number; afterHours: number }) {
  return { changes: (Array.isArray(row.changes) ? row.changes : []) as LineChange[], beforeTotal: row.beforeTotal, afterTotal: row.afterTotal, beforeHours: row.beforeHours, afterHours: row.afterHours };
}

async function commitAmendment(id: string, request: AmendRequest, actor: AmendActor): Promise<Committed | { ok: false; status: 400 | 403 | 404 | 409; reason: string }> {
  const hash = requestHash(request);
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const first = await tx.cleanerInvoiceSubmission.findUnique({ where: { id }, select: { cleanerId: true } });
    if (!first) return { ok: false as const, status: 404 as const, reason: "Invoice not found." };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${first.cleanerId}))`;
    await tx.$queryRaw`SELECT "id" FROM "CleanerInvoiceSubmission" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await tx.cleanerInvoiceRevision.findUnique({ where: { requestKey: request.requestKey } });
    if (existing) {
      if (existing.submissionId !== id || existing.requestHash !== hash) {
        return { ok: false as const, status: 409 as const, reason: "This save was already used for different changes. Reload the invoice and amend it again." };
      }
      return {
        revisionId: existing.id,
        revision: existing.revision,
        plan: storedPlan(existing),
        reason: existing.reason,
        needsXeroUpdate: Boolean(existing.xeroBillId),
        notice: (existing.notification as AmendNoticeRecord | null) ?? null,
        replayed: true,
      };
    }
    const current = await tx.cleanerInvoiceSubmission.findUnique({ where: { id } });
    if (!current) return { ok: false as const, status: 404 as const, reason: "Invoice not found." };
    if (current.updatedAt.toISOString() !== request.expectedUpdatedAt || current.amendmentCount !== request.expectedRevision) {
      return { ok: false as const, status: 409 as const, reason: "This invoice changed since you opened it. Reload it; your changes are kept on screen so you can apply them again." };
    }
    const permission = amendPermission(current, actor.role);
    if (!permission.ok) return permission;
    const result = planAmendment({
      lineData: current.lineData,
      storedTotal: current.totalAmount,
      storedHours: current.hours,
      lines: request.lines,
      hours: request.hours ?? null,
      note: request.note?.trim() || null,
    });
    if (!result.ok) return { ok: false as const, status: 400 as const, reason: result.reason };
    const { plan } = result;
    const revision = current.amendmentCount + 1;
    const now = new Date();
    const previousLines = ((current.lineData as { lines?: unknown } | null)?.lines ?? []) as Prisma.InputJsonValue;
    const lineData = {
      ...((current.lineData as Record<string, unknown> | null) ?? {}),
      lines: plan.afterLines,
      amendment: { revision, at: now.toISOString(), note: request.note?.trim() || null },
    };
    const updated = await tx.cleanerInvoiceSubmission.updateMany({
      where: { id, updatedAt: current.updatedAt, amendmentCount: current.amendmentCount },
      data: {
        lineData: lineData as Prisma.InputJsonValue,
        totalAmount: plan.afterTotal,
        hours: plan.afterHours,
        amendmentCount: revision,
        amendedAt: now,
        xeroOutOfDateSince: permission.needsXeroUpdate ? current.xeroOutOfDateSince ?? now : current.xeroOutOfDateSince,
      },
    });
    if (updated.count !== 1) return { ok: false as const, status: 409 as const, reason: "This invoice changed while saving. Reload it and apply your changes again." };
    const row = await tx.cleanerInvoiceRevision.create({
      data: {
        submissionId: id,
        revision,
        requestKey: request.requestKey,
        requestHash: hash,
        actorUserId: actor.userId,
        actorRole: actor.role,
        reason: request.reason.trim(),
        note: request.note?.trim() || null,
        statusBefore: current.status,
        statusAfter: current.status,
        beforeLines: previousLines,
        afterLines: plan.afterLines as Prisma.InputJsonValue,
        changes: plan.changes as unknown as Prisma.InputJsonValue,
        beforeTotal: plan.beforeTotal,
        afterTotal: plan.afterTotal,
        beforeHours: plan.beforeHours,
        afterHours: plan.afterHours,
        xeroBillId: permission.needsXeroUpdate ? current.xeroBillId : null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "CLEANER_INVOICE_AMENDED",
        entity: "CleanerInvoiceSubmission",
        entityId: id,
        before: { totalAmount: plan.beforeTotal, hours: plan.beforeHours, status: current.status, revision: current.amendmentCount },
        after: {
          totalAmount: plan.afterTotal,
          hours: plan.afterHours,
          status: current.status,
          revision,
          revisionId: row.id,
          reason: request.reason.trim(),
          changes: plan.changes.length,
          effectiveRole: actor.role,
          needsXeroUpdate: permission.needsXeroUpdate,
        } as Prisma.InputJsonValue,
      },
    });
    return { revisionId: row.id, revision, plan, reason: request.reason.trim(), needsXeroUpdate: permission.needsXeroUpdate, notice: null, replayed: false };
  });
}

export async function amendCleanerInvoice(input: { id: string; actor: AmendActor; request: AmendRequest }): Promise<AmendOutcome> {
  if (input.actor.impersonating) {
    return { ok: false, status: 403, reason: "Amending an invoice is not available while testing as someone else: it changes money and notifies a real payee." };
  }
  const committed = await commitAmendment(input.id, input.request, input.actor);
  if ("ok" in committed) return committed;
  const changeLines = describeAmendment(committed.plan);
  let notice = committed.notice;
  if (!notice) {
    let record = true;
    try {
      notice = await notifyPayeeOfAmendment({
        submissionId: input.id,
        revision: committed.revision,
        actorId: input.actor.userId,
        changeLines,
        reason: committed.reason,
        beforeTotal: committed.plan.beforeTotal,
        afterTotal: committed.plan.afterTotal,
      });
    } catch (error) {
      logger.error({ err: error, submissionId: input.id, revision: committed.revision }, "[cleaner-invoice] amended, but the payee's notice could not be sent");
      notice = { status: "not-sent", at: new Date().toISOString(), reason: "The notice could not be sent. Save again with the same changes to retry; the amendment is already stored." };
      // Left unrecorded so the retry the message offers really sends it.
      record = false;
    }
    // A "not sent" record says why (an inactive payee). A retry with the same
    // request key sends again only when nothing was recorded.
    if (record) await db.cleanerInvoiceRevision
      .update({ where: { id: committed.revisionId }, data: { notification: notice as unknown as Prisma.InputJsonValue } })
      .catch((error: unknown) => logger.error({ err: error, revisionId: committed.revisionId }, "[cleaner-invoice] the notice outcome could not be recorded"));
  }
  return {
    ok: true,
    status: 200,
    replayed: committed.replayed,
    revision: committed.revision,
    beforeTotal: committed.plan.beforeTotal,
    afterTotal: committed.plan.afterTotal,
    changes: changeLines,
    needsXeroUpdate: committed.needsXeroUpdate,
    notice,
  };
}

/** The office records that it updated the Xero bill by hand after an amendment. */
export async function markXeroBillUpdated(input: { id: string; actor: AmendActor; expectedUpdatedAt: string; note: string }): Promise<{ ok: true } | { ok: false; status: 403 | 404 | 409; reason: string }> {
  if (input.actor.impersonating) return { ok: false, status: 403, reason: "Not available while testing as someone else." };
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    const current = await tx.cleanerInvoiceSubmission.findUnique({ where: { id: input.id }, select: { id: true, updatedAt: true, xeroOutOfDateSince: true, xeroBillId: true } });
    if (!current) return { ok: false as const, status: 404 as const, reason: "Invoice not found." };
    if (!current.xeroOutOfDateSince) return { ok: false as const, status: 409 as const, reason: "The Xero bill is not marked as out of date." };
    if (current.updatedAt.toISOString() !== input.expectedUpdatedAt) return { ok: false as const, status: 409 as const, reason: "This invoice changed since you opened it. Reload it first." };
    const changed = await tx.cleanerInvoiceSubmission.updateMany({ where: { id: input.id, updatedAt: current.updatedAt }, data: { xeroOutOfDateSince: null } });
    if (changed.count !== 1) return { ok: false as const, status: 409 as const, reason: "This invoice changed while saving. Reload it first." };
    await tx.auditLog.create({
      data: {
        userId: input.actor.userId,
        action: "CLEANER_INVOICE_XERO_MARKED_UPDATED",
        entity: "CleanerInvoiceSubmission",
        entityId: input.id,
        before: { xeroOutOfDateSince: current.xeroOutOfDateSince.toISOString(), xeroBillId: current.xeroBillId },
        after: { xeroOutOfDateSince: null, note: input.note, effectiveRole: input.actor.role } as Prisma.InputJsonValue,
      },
    });
    return { ok: true as const };
  });
}
