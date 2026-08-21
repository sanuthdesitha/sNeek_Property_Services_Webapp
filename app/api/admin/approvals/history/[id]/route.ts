import { NextRequest, NextResponse } from "next/server";
import { PayAdjustmentStatus, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { roundCents } from "@/lib/finance/job-money";
import { adjustmentSignedAmount } from "@/lib/finance/pay-adjustments";
import { notifyPayAdjustmentOutcome } from "@/lib/notifications/pay-adjustments";
import {
  deleteClientApprovalById,
  getClientApprovalById,
  updateClientApprovalById,
} from "@/lib/commercial/client-approvals";
import {
  approvalCapabilities,
  parseApprovalDecisionPayload,
  type ApprovalItemState,
  type ApprovalQueueKey,
} from "@/lib/admin/approval-history";
import { recordApprovalDecision } from "@/lib/admin/approval-history-write";

/**
 * POST /api/admin/approvals/history/[id]
 *
 * Per-item actions on an ALREADY-DECIDED Approval Center item, addressed by its
 * history row: edit (re-price), undo (return to pending / reverse), delete.
 *
 * The capability map (lib/admin/approval-history.ts) is the contract, and it is
 * re-evaluated HERE against live state before anything is written — the UI's
 * copy of it can be stale, and in particular an item can become settled between
 * the page render and the click. Settled money is refused with 409 and the
 * "raise a correcting adjustment instead" message, exactly as the underlying
 * pay-adjustment route does.
 *
 * Every action is itself recorded in the history, and every money change
 * notifies the affected person through notifyPayAdjustmentOutcome.
 */
const bodySchema = z.object({
  action: z.enum(["edit", "undo", "delete"]),
  /** New amount for `edit` (money queues). */
  amount: z.number().positive().optional(),
  note: z.string().trim().max(4000).optional(),
});

const MONEY_QUEUES: ApprovalQueueKey[] = [
  "payAdjustments",
  "rectificationAdjustments",
  "bonusProposals",
];

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json().catch(() => ({})));

    const historyRow = await db.auditLog.findUnique({ where: { id: params.id } });
    if (!historyRow) {
      return NextResponse.json({ error: "History entry not found." }, { status: 404 });
    }
    const payload = parseApprovalDecisionPayload(historyRow.after);
    if (!payload) {
      return NextResponse.json(
        { error: "This audit entry is not an approval decision." },
        { status: 400 }
      );
    }

    const queue = payload.approvalQueue;
    const entityId = historyRow.entityId;

    // ── Live state, then the capability gate ───────────────────────────
    let state: ApprovalItemState = {};
    if (MONEY_QUEUES.includes(queue)) {
      const live = await db.cleanerPayAdjustment.findUnique({
        where: { id: entityId },
        select: {
          id: true,
          status: true,
          includedInPayrollRunId: true,
          includedInCleanerInvoiceId: true,
        },
      });
      state = live
        ? {
            status: live.status,
            includedInPayrollRunId: live.includedInPayrollRunId,
            includedInCleanerInvoiceId: live.includedInCleanerInvoiceId,
          }
        : { missing: true };
    } else if (queue === "clientApprovals") {
      const live = await getClientApprovalById(entityId);
      state = live ? { status: (live as any).status } : { missing: true };
    } else if (queue === "skipRequests") {
      const job = await db.job.findUnique({
        where: { id: entityId },
        select: { id: true, cleanSkipStatus: true },
      });
      state = job ? { status: job.cleanSkipStatus ?? undefined } : { missing: true };
    }

    const caps = approvalCapabilities(queue, state);
    const allowed =
      body.action === "edit" ? caps.canEdit : body.action === "undo" ? caps.canUndo : caps.canDelete;
    if (!allowed) {
      const reason =
        caps.reasons[body.action] ?? `This item does not support "${body.action}".`;
      // 409 for "the state forbids it" (settled/approved), 400 for "the domain
      // never allowed it". The UI shows the reason either way.
      const status = state.includedInPayrollRunId || state.includedInCleanerInvoiceId ? 409 : 400;
      return NextResponse.json({ error: reason }, { status });
    }

    // ── Money queues ───────────────────────────────────────────────────
    if (MONEY_QUEUES.includes(queue)) {
      const existing = await db.cleanerPayAdjustment.findUnique({
        where: { id: entityId },
        include: { cleaner: { select: { id: true, name: true, email: true } } },
      });
      if (!existing) {
        return NextResponse.json({ error: "The underlying request no longer exists." }, { status: 404 });
      }

      if (body.action === "delete") {
        await db.cleanerPayAdjustment.delete({ where: { id: entityId } });
        await recordApprovalDecision({
          queue,
          decision: "DELETED",
          userId: session.user.id,
          entity: "CleanerPayAdjustment",
          entityId,
          jobId: existing.jobId,
          label: existing.title ?? "Pay adjustment",
          amount: Number(existing.approvedAmount ?? existing.requestedAmount ?? 0),
          note: body.note ?? null,
          subjectUserId: existing.cleanerId,
          fromStatus: existing.status,
          before: { status: existing.status, approvedAmount: existing.approvedAmount } as any,
        });
        return NextResponse.json({ ok: true, action: "delete" });
      }

      const previousAmount = existing.approvedAmount;
      const nextAmount =
        body.action === "edit" ? roundCents(Number(body.amount)) : null;
      if (body.action === "edit" && (nextAmount == null || !Number.isFinite(nextAmount))) {
        return NextResponse.json({ error: "A valid amount is required." }, { status: 400 });
      }

      const updated = await db.cleanerPayAdjustment.update({
        where: { id: entityId },
        data:
          body.action === "undo"
            ? {
                status: PayAdjustmentStatus.PENDING,
                approvedAmount: null,
                reviewedAt: null,
                reviewedById: null,
                ...(body.note ? { adminNote: body.note } : {}),
              }
            : {
                approvedAmount: nextAmount,
                reviewedAt: new Date(),
                reviewedById: session.user.id,
                ...(body.note ? { adminNote: body.note } : {}),
              },
      });

      // The person whose pay just changed must hear about it — this is the same
      // notifier the Approval Center decisions use, so the wording and delivery
      // preferences are identical.
      void notifyPayAdjustmentOutcome({
        payeeUserId: existing.cleanerId,
        kind: body.action === "undo" ? "REVERSED_TO_PENDING" : "AMOUNT_CHANGED",
        amount: adjustmentSignedAmount({
          status: PayAdjustmentStatus.APPROVED,
          approvedAmount: updated.approvedAmount,
          requestedAmount: updated.requestedAmount,
        }),
        previousAmount: previousAmount ?? null,
        reason: updated.title?.trim() || "Pay adjustment",
        jobId: updated.jobId,
        adminNote: updated.adminNote,
        source: updated.source,
      }).catch(console.error);

      await recordApprovalDecision({
        queue,
        decision: body.action === "undo" ? "REVERSED" : "EDITED",
        userId: session.user.id,
        entity: "CleanerPayAdjustment",
        entityId,
        jobId: updated.jobId,
        label: updated.title ?? "Pay adjustment",
        amount: Number(updated.approvedAmount ?? updated.requestedAmount ?? 0),
        note: body.note ?? null,
        subjectUserId: updated.cleanerId,
        subjectName: existing.cleaner.name ?? existing.cleaner.email,
        fromStatus: existing.status,
        toStatus: updated.status,
        before: { status: existing.status, approvedAmount: previousAmount } as any,
      });

      return NextResponse.json({ ok: true, action: body.action, item: updated });
    }

    // ── Client approvals ───────────────────────────────────────────────
    if (queue === "clientApprovals") {
      const existing = await getClientApprovalById(entityId);
      if (!existing) {
        return NextResponse.json({ error: "The underlying approval no longer exists." }, { status: 404 });
      }
      if (body.action === "delete") {
        await deleteClientApprovalById(entityId);
      } else {
        await updateClientApprovalById(
          entityId,
          body.action === "undo"
            ? { status: "PENDING", responseNote: body.note ?? null }
            : { amount: Number(body.amount), responseNote: body.note ?? null }
        );
      }
      await recordApprovalDecision({
        queue,
        decision:
          body.action === "delete" ? "DELETED" : body.action === "undo" ? "REVERSED" : "EDITED",
        userId: session.user.id,
        entity: "ClientApproval",
        entityId,
        jobId: (existing as any)?.jobId ?? null,
        label: (existing as any)?.title ?? "Client approval",
        amount: body.action === "edit" ? Number(body.amount) : (existing as any)?.amount ?? null,
        note: body.note ?? null,
        fromStatus: (existing as any)?.status ?? null,
        toStatus: body.action === "undo" ? "PENDING" : (existing as any)?.status ?? null,
        before: existing as any,
      });
      return NextResponse.json({ ok: true, action: body.action });
    }

    // ── Skip requests: undo restores the clean ─────────────────────────
    if (queue === "skipRequests" && body.action === "undo") {
      const job = await db.job.findUnique({
        where: { id: entityId },
        select: { id: true, cleanSkipStatus: true },
      });
      if (!job) {
        return NextResponse.json({ error: "Job not found." }, { status: 404 });
      }
      await db.job.update({
        where: { id: entityId },
        data: {
          cleanSkipStatus: "NONE",
          cleanSkipReason: null,
          cleanSkipRequestedById: null,
          cleanSkipDecidedById: null,
          cleanSkipAt: new Date(),
        },
      });
      await recordApprovalDecision({
        queue,
        decision: "REVERSED",
        userId: session.user.id,
        entity: "Job",
        entityId,
        jobId: entityId,
        label: "Skip clean",
        note: body.note ?? null,
        fromStatus: job.cleanSkipStatus,
        toStatus: "NONE",
      });
      return NextResponse.json({ ok: true, action: "undo" });
    }

    // The capability gate above should make this unreachable; it exists so a
    // future queue gaining a capability without a handler fails loudly rather
    // than silently reporting success.
    return NextResponse.json(
      { error: `No handler for "${body.action}" on the ${queue} queue.` },
      { status: 501 }
    );
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Action failed." }, { status });
  }
}
