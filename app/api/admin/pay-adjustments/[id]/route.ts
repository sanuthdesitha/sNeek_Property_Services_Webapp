import { mobilePendingMarker } from "@/lib/notifications/mobile-outbox-marker";
import { NextRequest, NextResponse } from "next/server";
import {
  NotificationChannel,
  NotificationStatus,
  PayAdjustmentStatus,
  PayAdjustmentType,
  Role,
} from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { getAppSettings } from "@/lib/settings";
import { listClientApprovals, deleteClientApprovalById } from "@/lib/commercial/client-approvals";
import { roundCents } from "@/lib/finance/job-money";
import { notifyBonusOutcomeToCleaner } from "@/lib/notifications/accountability";
import { notifyPayAdjustmentOutcome } from "@/lib/notifications/pay-adjustments";
import { adjustmentSignedAmount } from "@/lib/finance/pay-adjustments";
import { recordApprovalDecision } from "@/lib/admin/approval-history-write";
import type { ApprovalQueueKey } from "@/lib/admin/approval-history";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { isAdministrator } from "@/lib/rbac/access-evaluator";
import { BONUS_SOURCES, RECTIFICATION_SOURCES } from "@/lib/admin/approvals/sources";
import { decideCleanerPayAmount, type CleanerPayAmountDecision } from "@/lib/payroll/cleaner-pay-amount";
import { PAY_ADJUSTMENT_CATEGORY_VALUES, isTaxableCategory } from "@/lib/finance/pay-categories";
import { loadPayRequestDetails } from "@/lib/pay-adjustments/details";
import {
  clientBillingLock,
  clientConsentState,
  defaultBillToClient,
  isReductionAfterApproval,
  jobLinkRefusal,
  payRequestEditLock,
} from "@/lib/pay-adjustments/lifecycle";
import {
  clientLineFacts,
  latestApprovalByPayRequest,
  reconcilePayRequestClientBilling,
  type ClientBillingOutcome,
} from "@/lib/billing/pay-request-client-billing";

const updateSchema = z.object({
  // Status changes now include reversing back to PENDING (admins can undo a
  // previous decision "even after it has been sent").
  status: z.nativeEnum(PayAdjustmentStatus).optional(),
  approvedAmount: z.number().positive().optional(),
  /** PRIVATE — internal surfaces only. Never sent to the payee. */
  adminNote: z.string().trim().max(4000).optional(),
  /** The explanation the CLEANER reads. Goes out with the decision. */
  decisionMessage: z.string().trim().max(4000).optional(),
  propertyId: z.string().cuid().optional().nullable(),
  jobId: z.string().cuid().optional().nullable(),
  title: z.string().trim().min(1).max(160).optional(),
  // Full edit of the underlying request the cleaner/client both read.
  type: z.nativeEnum(PayAdjustmentType).optional(),
  requestedAmount: z.number().positive().optional(),
  requestedHours: z.number().positive().nullable().optional(),
  requestedRate: z.number().positive().nullable().optional(),
  /**
   * Pay a cleaner MORE than they requested (owner rule 2026-11-13). Honoured
   * only for an administrator in a real session, with a reason; audited.
   */
  overrideAboveRequest: z.boolean().optional(),
  overrideReason: z.string().trim().max(2000).optional(),
  /** Work vs money-back; `taxable` is derived from it, never accepted. */
  category: z.enum(PAY_ADJUSTMENT_CATEGORY_VALUES).optional(),
  /** Client billing (2026-11-18): whether, and for how much, the client pays. */
  billToClient: z.boolean().optional(),
  clientAmount: z.number().positive().nullable().optional(),
  clientDescription: z.string().trim().max(500).nullable().optional(),
  /**
   * Why the cleaner is getting less than was approved. Required when an
   * approved amount goes down (or an approved request is declined/reopened);
   * the cleaner reads it in the request's history.
   */
  changeReason: z.string().trim().max(2000).optional(),
});

/**
 * Everything about one request for the office: what was asked, the job, the
 * decision, where it was settled, the client billing state and the history —
 * with every lock already in words (lib/pay-adjustments/details.ts).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const details = await loadPayRequestDetails(params.id);
    if (!details) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    // Marking paid is ADMIN only and needs the person's own PIN, so it is not
    // offered to an operations manager or while testing as someone else. The
    // mark-paid route enforces the same; this only decides what is offered.
    const canMarkPaid = String(session.user.role) === "ADMIN" && !session.impersonation;
    return NextResponse.json({
      ...details,
      viewer: { canMarkPaid, markPaidUnavailable: canMarkPaid ? null : "Only an administrator, signed in as themselves, can record a payment made outside the system." },
    });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = updateSchema.parse(await req.json().catch(() => ({})));
    const existing = await db.cleanerPayAdjustment.findUnique({
      where: { id: params.id },
      include: {
        cleaner: { select: { id: true, name: true, email: true } },
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
          },
        },
        job: {
          select: {
            id: true,
            jobType: true,
            property: { select: { name: true } },
          },
        },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }

    const isStatusChange = Boolean(body.status) && body.status !== existing.status;
    // Reversing a previously-actioned request back to PENDING (admins can undo a
    // decision even after it was sent to the cleaner/client). This also removes it
    // from payroll automatically, because payroll filters on status === APPROVED.
    const isReverseToPending =
      body.status === PayAdjustmentStatus.PENDING &&
      existing.status !== PayAdjustmentStatus.PENDING;
    // Editing the approved amount on a request that has already been approved
    // (no status change, but a new approvedAmount supplied).
    const isAmountEdit =
      !isStatusChange &&
      body.approvedAmount !== undefined &&
      existing.status === PayAdjustmentStatus.APPROVED;
    // Editing the underlying request fields (the single source row both the
    // cleaner and client read). Allowed at any time / any status.
    const isFieldEdit =
      body.type !== undefined ||
      body.requestedAmount !== undefined ||
      body.requestedHours !== undefined ||
      body.requestedRate !== undefined ||
      body.jobId !== undefined ||
      body.category !== undefined;
    // Client-side fields are office business: audited, never announced to the
    // cleaner (the client amount must not reach them).
    const isClientEdit =
      body.billToClient !== undefined || body.clientAmount !== undefined || body.clientDescription !== undefined;

    if (
      !isStatusChange &&
      body.approvedAmount !== undefined &&
      existing.status !== PayAdjustmentStatus.APPROVED
    ) {
      return NextResponse.json(
        {
          error:
            "The approved amount can only be edited on a request that is already approved. Approve the request first.",
        },
        { status: 400 }
      );
    }

    // SETTLED MONEY IS IMMUTABLE. Once an approved adjustment has been paid by a
    // payroll run, billed on a cleaner invoice or marked paid outside the
    // system, reversing it or editing its money would desynchronise the books
    // from what was actually paid — raise a new, opposite adjustment instead.
    // One rule (lib/pay-adjustments/lifecycle.ts) says so, in words.
    const alreadySettledBy =
      existing.includedInPayrollRunId ?? existing.includedInCleanerInvoiceId ?? (existing.paidOutsideAt ? "paid-outside" : null);
    const touchesPay =
      Boolean(body.status) || body.approvedAmount !== undefined || body.requestedAmount !== undefined ||
      body.type !== undefined || body.requestedHours !== undefined || body.requestedRate !== undefined ||
      body.jobId !== undefined || body.propertyId !== undefined || body.category !== undefined;
    if (touchesPay) {
      const cleanerInvoice = existing.includedInCleanerInvoiceId
        ? await db.cleanerInvoiceSubmission.findUnique({ where: { id: existing.includedInCleanerInvoiceId }, select: { invoiceNumber: true, status: true } })
        : null;
      const lock = payRequestEditLock(existing, {
        cleanerInvoiceNumber: cleanerInvoice?.invoiceNumber ?? null,
        cleanerInvoiceStatus: cleanerInvoice?.status ?? null,
      });
      if (!lock.editable) {
        return NextResponse.json({ error: lock.reason, settledBy: alreadySettledBy }, { status: 409 });
      }
    }

    // THE CLIENT SIDE. Once the extra is on a client invoice that is no longer
    // a draft, nothing that would change what the client was billed may move:
    // the bill-to-client choice, the client amount or wording, the approval,
    // or the job it is billed under.
    const touchesClient =
      body.billToClient !== undefined || body.clientAmount !== undefined || body.clientDescription !== undefined ||
      (Boolean(body.status) && body.status !== existing.status) || body.jobId !== undefined;
    if (touchesClient && existing.clientInvoiceLineId) {
      const clientLock = clientBillingLock(await clientLineFacts(existing.clientInvoiceLineId));
      if (!clientLock.editable) return NextResponse.json({ error: clientLock.reason }, { status: 409 });
    }

    // LINKING TO A JOB is validated here, on the server: the payee must be on
    // the job, and a request tied to a property may only move to a job at that
    // property.
    let linkedJob: { id: string; propertyId: string } | null = null;
    if (body.jobId) {
      const job = await db.job.findUnique({
        where: { id: body.jobId },
        select: { id: true, propertyId: true, status: true, assignments: { select: { userId: true, removedAt: true } } },
      });
      const refusal = jobLinkRefusal({
        request: { ...existing, propertyId: body.propertyId !== undefined ? body.propertyId : existing.propertyId },
        job: job ? { ...job, status: String(job.status) } : null,
      });
      if (refusal) return NextResponse.json({ error: refusal }, { status: job ? 409 : 404 });
      linkedJob = { id: job!.id, propertyId: job!.propertyId };
    }

    // Which Approval Center tab this row lives in. Mirrors the RECTIFICATION_SOURCES
    // / BONUS_SOURCES split in /api/admin/all-approvals, so a history row lands in
    // the same queue the admin actually decided it in.
    const source = existing.source ?? null;
    const approvalQueue: ApprovalQueueKey =
      source && RECTIFICATION_SOURCES.includes(source)
        ? "rectificationAdjustments"
        : source && BONUS_SOURCES.includes(source)
        ? "bonusProposals"
        : "payAdjustments";

    // CLEANER PAY IS THE REQUESTED AMOUNT (owner rule 2026-11-13). On a cleaner
    // pay request the amount paid defaults to what the cleaner requested — never
    // the client charge on a linked client approval — and more than requested
    // needs an administrator (real session, not "test as") with an explicit
    // override and a reason. Lower than requested stays allowed as before.
    const decidesPayAmount =
      approvalQueue === "payAdjustments" &&
      ((isStatusChange && body.status === PayAdjustmentStatus.APPROVED) || isAmountEdit);
    let payDecision: CleanerPayAmountDecision | null = null;
    if (decidesPayAmount) {
      payDecision = decideCleanerPayAmount({
        requestedAmount: existing.requestedAmount,
        proposedAmount: body.approvedAmount,
        callerIsAdministrator:
          !session.impersonation &&
          isAdministrator({ id: session.user.id, role: String(session.user.role), heldRoles: (session.user.heldRoles ?? []).map(String) }),
        overrideAboveRequest: body.overrideAboveRequest,
        overrideReason: body.overrideReason,
      });
      if (!payDecision.ok) {
        return NextResponse.json(
          { error: payDecision.error, code: payDecision.code, requestedAmount: existing.requestedAmount },
          { status: payDecision.status }
        );
      }
    }
    const aboveRequestOverride =
      payDecision?.ok && payDecision.aboveRequest
        ? { requestedAmount: existing.requestedAmount, paidAmount: payDecision.amount, reason: payDecision.overrideReason }
        : null;

    const previousApprovedAmount = existing.approvedAmount;
    // Resolve the resulting request fields so we can recompute requestedAmount for
    // HOURLY edits (hours * rate) when only one side is supplied.
    const resolvedType = body.type ?? existing.type;
    const resolvedHours = body.requestedHours !== undefined ? body.requestedHours : existing.requestedHours;
    const resolvedRate = body.requestedRate !== undefined ? body.requestedRate : existing.requestedRate;
    let editedRequestedAmount: number | undefined;
    if (isFieldEdit) {
      if (resolvedType === PayAdjustmentType.HOURLY) {
        if (body.requestedAmount !== undefined) {
          editedRequestedAmount = body.requestedAmount;
        } else if (
          resolvedHours != null &&
          resolvedRate != null &&
          Number.isFinite(resolvedHours) &&
          Number.isFinite(resolvedRate)
        ) {
          editedRequestedAmount = roundCents(Number(resolvedHours) * Number(resolvedRate));
        }
      } else if (body.requestedAmount !== undefined) {
        editedRequestedAmount = body.requestedAmount;
      }
      if (editedRequestedAmount !== undefined && (!Number.isFinite(editedRequestedAmount) || editedRequestedAmount <= 0)) {
        return NextResponse.json(
          { error: "The edited request amount must be greater than zero." },
          { status: 400 }
        );
      }
    }
    // Reversing to PENDING clears the prior decision; an approve/reject sets it.
    const approvedAmountRaw = isReverseToPending
      ? null
      : payDecision?.ok
      ? payDecision.amount
      : body.status === PayAdjustmentStatus.APPROVED
      ? body.approvedAmount ?? existing.requestedAmount
      : isAmountEdit
      ? body.approvedAmount!
      : body.status === PayAdjustmentStatus.REJECTED
      ? null
      : existing.approvedAmount;
    // Round to whole cents so the stored amount can't carry >2 decimals (which
    // drift 1c against payroll/invoice totals that round on display).
    const approvedAmount =
      approvedAmountRaw == null || !Number.isFinite(Number(approvedAmountRaw))
        ? approvedAmountRaw
        : roundCents(Number(approvedAmountRaw));

    // A CLEANER IS NEVER SILENTLY UNDERPAID. Taking money away from an approved
    // request — a lower amount, a decline or a reopen — needs a reason the
    // cleaner reads in their request's history.
    const nextStatus = isReverseToPending ? PayAdjustmentStatus.PENDING : body.status ?? existing.status;
    const reduction = isReductionAfterApproval({
      previousStatus: existing.status,
      previousApprovedAmount: existing.approvedAmount,
      nextStatus,
      nextApprovedAmount: approvedAmount,
    });
    if (reduction && !body.changeReason?.trim()) {
      return NextResponse.json(
        { error: "Say why the cleaner gets less than was approved. They will see this reason.", code: "REDUCTION_REASON_REQUIRED" },
        { status: 400 }
      );
    }

    if (body.status === PayAdjustmentStatus.APPROVED) {
      // Self-approval guard: the payee of their OWN QA rectification pay cannot
      // approve it — a different ADMIN/OPS reviewer must. (Rectification pay is
      // paid to the QA who fixed the issue, so the reviewer must not be that QA.)
      if (existing.source === "QA_RECTIFICATION_PAY" && existing.cleanerId === session.user.id) {
        return NextResponse.json(
          {
            error:
              "You cannot approve your own QA rectification pay. Another admin or ops manager must review it.",
          },
          { status: 403 }
        );
      }
      const linkedApprovals = (await listClientApprovals()).filter((approval) => {
        const metadata = approval.metadata as Record<string, unknown> | null;
        return metadata?.source === "pay_adjustment" && metadata?.payAdjustmentId === existing.id;
      });
      if (linkedApprovals.length > 0) {
        const latest = linkedApprovals.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0];
        if (latest.status !== "APPROVED") {
          return NextResponse.json(
            {
              error:
                "Client approval is required before approving this cleaner payment request.",
              clientApprovalStatus: latest.status,
              clientApprovalId: latest.id,
            },
            { status: 409 }
          );
        }
      }
    }

    // CLIENT BILLING. On approval the office's choice wins; when the request
    // did not say (quick or bulk approve), the organisation default applies —
    // ON for a job-linked SERVICE request whose property has a client. The
    // client amount is its own stored figure: the office's, else what the
    // client agreed to when asked, else the approved amount.
    const settings = await getAppSettings();
    const latestApproval = latestApprovalByPayRequest(await listClientApprovals()).get(existing.id) ?? null;
    const consent = clientConsentState(latestApproval);
    const resultingJobId = body.jobId !== undefined ? body.jobId : existing.jobId;
    const resultingCategory = body.category ?? existing.category;
    const approving = isStatusChange && body.status === PayAdjustmentStatus.APPROVED;
    let billToClient: boolean | undefined = body.billToClient;
    if (billToClient === undefined && approving && approvalQueue === "payAdjustments" && !existing.clientBillingDecidedAt) {
      const propertyHasClient = Boolean(
        resultingJobId
          ? (await db.job.findUnique({ where: { id: resultingJobId }, select: { property: { select: { clientId: true } } } }))?.property?.clientId
          : null
      );
      billToClient = defaultBillToClient({
        settingOn: settings.invoicing?.payRequestsBillClientByDefault === true,
        jobId: resultingJobId,
        category: resultingCategory,
        propertyHasClient,
      });
    }
    let clientAmount: number | null | undefined = body.clientAmount === undefined ? undefined : body.clientAmount;
    if (billToClient && clientAmount === undefined && existing.clientAmount == null) {
      clientAmount =
        consent === "APPROVED" && latestApproval && Number.isFinite(Number(latestApproval.amount)) && Number(latestApproval.amount) > 0
          ? roundCents(Number(latestApproval.amount))
          : approvedAmount != null && Number(approvedAmount) > 0
            ? roundCents(Number(approvedAmount))
            : null;
    }
    if (clientAmount != null) clientAmount = roundCents(Number(clientAmount));
    const clientDecision = billToClient !== undefined || clientAmount !== undefined || body.clientDescription !== undefined;

    const billing: { outcome: ClientBillingOutcome | null } = { outcome: null };
    const updated = await db.$transaction(async (tx) => {
    const row = await tx.cleanerPayAdjustment.update({
      where: { id: params.id, updatedAt: existing.updatedAt,
        ...(!alreadySettledBy ? { includedInPayrollRunId: null, includedInCleanerInvoiceId: null, paidOutsideAt: null } : {}) },
      data: {
        ...(isReverseToPending
          ? {
              status: PayAdjustmentStatus.PENDING,
              approvedAmount: null,
              reviewedAt: null,
              reviewedById: null,
            }
          : isStatusChange
          ? { status: body.status, approvedAmount, reviewedAt: new Date(), reviewedById: session.user.id }
          : {}),
        ...(isAmountEdit
          ? { approvedAmount, reviewedAt: new Date(), reviewedById: session.user.id }
          : {}),
        ...(body.adminNote !== undefined ? { adminNote: body.adminNote.trim() || null } : {}),
        ...(body.decisionMessage !== undefined
          ? { decisionMessage: body.decisionMessage.trim() || null }
          : {}),
        ...(body.propertyId !== undefined ? { propertyId: body.propertyId } : {}),
        // Linking takes the job's property and scope; unlinking keeps the
        // property so the request still says where the work was.
        ...(body.jobId !== undefined
          ? linkedJob
            ? { jobId: linkedJob.id, propertyId: linkedJob.propertyId, scope: "JOB" as const, jobLinkedAt: new Date(), jobLinkedById: session.user.id }
            : { jobId: null, scope: (body.propertyId ?? existing.propertyId) ? ("PROPERTY" as const) : ("STANDALONE" as const), jobLinkedAt: null, jobLinkedById: null }
          : {}),
        ...(body.category !== undefined ? { category: body.category, taxable: isTaxableCategory(body.category) } : {}),
        ...(billToClient !== undefined ? { billToClient } : {}),
        ...(clientAmount !== undefined ? { clientAmount } : {}),
        ...(body.clientDescription !== undefined ? { clientDescription: body.clientDescription?.trim() || null } : {}),
        ...(clientDecision ? { clientBillingDecidedAt: new Date(), clientBillingDecidedById: session.user.id } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        // Full field edit of the underlying request both cleaner + client read.
        ...(body.type !== undefined ? { type: body.type } : {}),
        ...(body.requestedHours !== undefined ? { requestedHours: body.requestedHours } : {}),
        ...(body.requestedRate !== undefined ? { requestedRate: body.requestedRate } : {}),
        ...(editedRequestedAmount !== undefined ? { requestedAmount: editedRequestedAmount } : {}),
      },
      include: {
        cleaner: { select: { id: true, name: true, email: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
        property: {
          select: {
            id: true,
            name: true,
            suburb: true,
          },
        },
        job: {
          select: {
            id: true,
            jobType: true,
            property: { select: { id: true, name: true, suburb: true } },
          },
        },
      },
    });
    // The client side follows what is now stored: folded into the job's DRAFT
    // line, taken off it, or left waiting — never an issued invoice.
    if (row.billToClient || existing.billToClient || existing.clientInvoiceLineId) {
      billing.outcome = await reconcilePayRequestClientBilling(tx, row.id, consent);
    }
    return row;
    });

    // A cross-cleaner REWORK_DEDUCTION lands PENDING when the owner setting
    // `reworkDeductionsRequireApproval` is on, and lib/qa/rework-jobs.ts
    // deliberately leaves `Job.reworkDeductionApplied` false until the deduction
    // is actually feeding payroll ("applied" means APPROVED, not "created").
    // Nothing was flipping it on approval, so a later setReworkPayDecision read
    // `deductionWasApplied === false`, took the first-decision branch, and
    // applyReworkDeduction then bailed out on the (source, sourceKey) dedupe —
    // the changed amount was never reconciled. Keep the flag in step with the
    // decision here, in both directions.
    if (isStatusChange && existing.source === "REWORK_DEDUCTION" && existing.jobId) {
      await db.job
        .updateMany({
          where: { reworkOfJobId: existing.jobId, isRework: true },
          data: { reworkDeductionApplied: updated.status === PayAdjustmentStatus.APPROVED },
        })
        .catch(() => undefined);
    }

    if (isStatusChange || isAmountEdit) {
      const propertyName = updated.job?.property?.name ?? updated.property?.name ?? "Unlinked request";
      // The DECISION MESSAGE, not `adminNote`. This notification goes to the
      // cleaner, and `adminNote` is the reviewing admin's private record of the
      // decision — it was being read out to the person it was written about.
      // A reduction's reason is what the cleaner most needs to read.
      const cleanerReason = reduction && body.changeReason?.trim() ? body.changeReason.trim() : updated.decisionMessage;
      const note = cleanerReason ? ` ${cleanerReason}` : "";
      const newAmount = Number(updated.approvedAmount ?? 0).toFixed(2);

      const wording = await loadNotificationWording("job.cleaner_requests_decided");
      const approvedStatus = updated.status === PayAdjustmentStatus.APPROVED;
      const values = {
        propertyName,
        decisionSuffix: note,
        oldAmount: `$${Number(previousApprovedAmount ?? 0).toFixed(2)}`,
        newAmount: `$${newAmount}`,
        status: updated.status,
        decision: updated.status.toLowerCase(),
      };
      const pushPart = isReverseToPending ? "extra-pay-reopened" : isAmountEdit ? "extra-pay-updated" : approvedStatus ? "extra-pay-approved" : "extra-pay-rejected";
      const push = wording.render(pushPart, "INBOX", { ...values, status: updated.status.toLowerCase() });
      const pushSubject = push.title;
      const pushBody = push.body;
      const emailSubject = isReverseToPending
        ? wording.line("title-reopened", "EMAIL", {})
        : isAmountEdit ? wording.line("title-updated", "EMAIL", {}) : wording.line("title-decided", "EMAIL", { status: updated.status });
      const emailIntro = isReverseToPending
        ? wording.line("intro-reopened", "EMAIL", values)
        : isAmountEdit
          ? wording.line("intro-updated", "EMAIL", values)
          : wording.line("intro-decided", "EMAIL", { ...values, approvedAmountParagraph: wording.line("approved-amount", "EMAIL", values, approvedStatus) });

      await db.notification.create({
        data: {
          userId: updated.cleaner.id,
          jobId: updated.job?.id ?? undefined,
          externalId: mobilePendingMarker("billing"),
          channel: NotificationChannel.PUSH,
          subject: pushSubject,
          body: pushBody,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });

      // Addressed to `updated.cleaner.email`, so this must be the cleaner-facing
      // message. `adminNote` is private and was being emailed verbatim to the
      // person it was written about.
      const decisionEmail = wording.render("extra-pay-decision", "EMAIL", {
        companyName: settings.companyName,
        emailTitle: emailSubject,
        recipientName: updated.cleaner.name ?? updated.cleaner.email,
        intro: emailIntro,
        decisionParagraph: wording.line("decision-paragraph", "EMAIL", { message: cleanerReason }, Boolean(cleanerReason)),
      });
      await sendEmailDetailed({
        kind: "pay_adjustment",
        to: updated.cleaner.email,
        subject: decisionEmail.subject,
        html: decisionEmail.html,
      });

      // MONEY-CHANGE NOTICE (web push + preference-aware delivery). The block
      // above is the legacy in-app row + raw email and is kept so the cleaner's
      // existing "extra payment request" thread is unchanged; this adds the push
      // channel and, crucially, states the DIRECTION and AMOUNT explicitly — the
      // legacy copy always reads as an "extra payment", which is wrong for a
      // deduction (a QA rework/rectification deduction is stored negative).
      //
      // Guarded by `isStatusChange || isAmountEdit`, both of which require a real
      // transition (isStatusChange compares against the previous status), so a
      // retried or double-tapped approval fires nothing the second time.
      const signedAmount = adjustmentSignedAmount({
        status: PayAdjustmentStatus.APPROVED,
        approvedAmount: updated.approvedAmount,
        requestedAmount: updated.requestedAmount,
      });
      void notifyPayAdjustmentOutcome({
        payeeUserId: updated.cleaner.id,
        kind: isReverseToPending
          ? "REVERSED_TO_PENDING"
          : isAmountEdit
          ? "AMOUNT_CHANGED"
          : updated.status === PayAdjustmentStatus.APPROVED
          ? "APPROVED"
          : "REJECTED",
        amount: signedAmount,
        previousAmount: previousApprovedAmount ?? null,
        reason: updated.title?.trim() || propertyName,
        jobId: updated.job?.id ?? null,
        adminNote: updated.adminNote,
        // Decides whether the payee hears about this at all — a declined
        // proposal they never made is not news they need.
        source: existing.source,
      }).catch(console.error);
    }

    // Accountability bonus outcome (Phase 8b): when an auto-proposed streak /
    // monthly-ranking bonus is approved or rejected, additionally notify the
    // cleaner through the accountability channel. Fire-and-forget; the generic
    // notification above still stands, this just adds the bonus-specific message.
    // DECLINED is deliberately absent. These bonuses are proposed by the
    // system, not asked for, so telling a cleaner one was declined is the
    // first they hear of it — an email whose only content is that they
    // nearly had something. An APPROVED one changes their pay, so it stays.
    if (
      isStatusChange &&
      updated.status === PayAdjustmentStatus.APPROVED &&
      typeof existing.source === "string" &&
      (existing.source.startsWith("STREAK_") || existing.source.startsWith("MONTHLY_"))
    ) {
      void notifyBonusOutcomeToCleaner({
        cleanerId: updated.cleaner.id,
        title: updated.title ?? "Bonus proposal",
        approved: true,
        amount: updated.approvedAmount,
        jobId: updated.job?.id ?? null,
      }).catch(console.error);
    }

    // Notify the cleaner when the underlying request they can see changes
    // (amount/type/hours/rate) without a status change, so their view isn't stale.
    if (isFieldEdit && !isStatusChange && !isAmountEdit && !isReverseToPending) {
      const propertyName = updated.job?.property?.name ?? updated.property?.name ?? "Unlinked request";
      const edited = (await loadNotificationWording("job.cleaner_requests_decided")).render("extra-pay-edited", "INBOX", {
        propertyName,
        requestedAmount: `$${Number(updated.requestedAmount ?? 0).toFixed(2)}`,
      });
      await db.notification.create({
        data: {
          userId: updated.cleaner.id,
          jobId: updated.job?.id ?? undefined,
          externalId: mobilePendingMarker("billing"),
          channel: NotificationChannel.PUSH,
          subject: edited.title,
          body: edited.body,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        },
      });
    }

    if (isStatusChange || isAmountEdit || isFieldEdit || isClientEdit) {
      void recordApprovalDecision({
        queue: approvalQueue,
        decision: isReverseToPending
          ? "REVERSED"
          : isStatusChange
          ? updated.status === PayAdjustmentStatus.APPROVED
            ? "APPROVED"
            : "DECLINED"
          : "EDITED",
        userId: session.user.id,
        entity: "CleanerPayAdjustment",
        entityId: updated.id,
        jobId: updated.job?.id ?? null,
        label:
          updated.title?.trim() ||
          updated.job?.property?.name ||
          updated.property?.name ||
          "Pay adjustment",
        // Signed: a deduction stays negative in the history exactly as it does
        // in payroll.
        amount: adjustmentSignedAmount({
          status: PayAdjustmentStatus.APPROVED,
          approvedAmount: updated.approvedAmount,
          requestedAmount: updated.requestedAmount,
        }),
        note: updated.adminNote ?? null,
        subjectUserId: updated.cleaner.id,
        subjectName: updated.cleaner.name ?? updated.cleaner.email,
        fromStatus: existing.status,
        toStatus: updated.status,
      });
    }

    const auditAction = isReverseToPending
      ? "REVERSE_PAY_ADJUSTMENT"
      : isStatusChange
      ? "REVIEW_PAY_ADJUSTMENT"
      : isAmountEdit
      ? "EDIT_PAY_ADJUSTMENT_AMOUNT"
      : body.jobId !== undefined
      ? body.jobId
        ? "PAY_ADJUSTMENT_JOB_LINKED"
        : "PAY_ADJUSTMENT_JOB_UNLINKED"
      : isClientEdit && !isFieldEdit
      ? "PAY_ADJUSTMENT_CLIENT_BILLING_CHANGED"
      : "EDIT_PAY_ADJUSTMENT";

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: updated.job?.id ?? undefined,
        action: auditAction,
        entity: "CleanerPayAdjustment",
        entityId: updated.id,
        before: {
          status: existing.status,
          approvedAmount: previousApprovedAmount,
          requestedAmount: existing.requestedAmount,
          type: existing.type,
          requestedHours: existing.requestedHours,
          requestedRate: existing.requestedRate,
          jobId: existing.jobId,
          propertyId: existing.propertyId,
          title: existing.title,
          adminNote: existing.adminNote,
          decisionMessage: existing.decisionMessage,
          category: existing.category,
          billToClient: existing.billToClient,
          clientAmount: existing.clientAmount,
          clientDescription: existing.clientDescription,
        } as any,
        after: {
          status: updated.status,
          approvedAmount: updated.approvedAmount,
          requestedAmount: updated.requestedAmount,
          type: updated.type,
          requestedHours: updated.requestedHours,
          requestedRate: updated.requestedRate,
          jobId: updated.jobId,
          propertyId: updated.propertyId,
          title: updated.title,
          adminNote: updated.adminNote,
          decisionMessage: updated.decisionMessage,
          category: updated.category,
          billToClient: updated.billToClient,
          clientAmount: updated.clientAmount,
          clientDescription: updated.clientDescription,
          // Read back in the request's history; the reason is cleaner-facing.
          ...(body.changeReason?.trim() ? { changeReason: body.changeReason.trim() } : {}),
          ...(reduction ? { reduction: true } : {}),
          ...(billing.outcome ? { clientBilling: billing.outcome } : {}),
          ...(aboveRequestOverride ? { aboveRequestOverride } : {}),
        } as any,
      },
    });

    // Paying more than the cleaner requested is its own audited act: the actor
    // (real session — "test as" cannot override), both amounts and the reason.
    if (aboveRequestOverride) {
      await db.auditLog.create({
        data: {
          userId: session.user.id,
          jobId: updated.job?.id ?? undefined,
          action: "PAY_ADJUSTMENT_PAID_ABOVE_REQUEST",
          entity: "CleanerPayAdjustment",
          entityId: updated.id,
          before: { requestedAmount: existing.requestedAmount, approvedAmount: previousApprovedAmount } as any,
          after: {
            requestedAmount: aboveRequestOverride.requestedAmount,
            paidAmount: aboveRequestOverride.paidAmount,
            reason: aboveRequestOverride.reason,
            actorRole: String(session.user.role),
          } as any,
        },
      });
    }

    return NextResponse.json({ ...updated, clientBilling: billing.outcome });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const existing = await db.cleanerPayAdjustment.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        jobId: true,
        propertyId: true,
        cleanerId: true,
        status: true,
        type: true,
        title: true,
        requestedAmount: true,
        approvedAmount: true,
        adminNote: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Request not found." }, { status: 404 });
    }
    // Approved requests are immutable to deletion — they may already feed payroll.
    if (existing.status === PayAdjustmentStatus.APPROVED) {
      return NextResponse.json(
        {
          error:
            "Approved requests cannot be deleted. Reverse it back to pending first if you need to remove it.",
        },
        { status: 409 }
      );
    }

    // Clean up any linked client-approval records so it disappears from the
    // client portal too (delete everywhere).
    const linkedApprovals = (await listClientApprovals()).filter((approval) => {
      const metadata = approval.metadata as Record<string, unknown> | null;
      return metadata?.source === "pay_adjustment" && metadata?.payAdjustmentId === existing.id;
    });
    const deletedApprovalIds: string[] = [];
    for (const approval of linkedApprovals) {
      if (await deleteClientApprovalById(approval.id)) {
        deletedApprovalIds.push(approval.id);
      }
    }

    await db.cleanerPayAdjustment.delete({ where: { id: params.id } });

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        jobId: existing.jobId ?? undefined,
        action: "DELETE_PAY_ADJUSTMENT",
        entity: "CleanerPayAdjustment",
        entityId: existing.id,
        before: {
          status: existing.status,
          type: existing.type,
          title: existing.title,
          requestedAmount: existing.requestedAmount,
          approvedAmount: existing.approvedAmount,
          adminNote: existing.adminNote,
          cleanerId: existing.cleanerId,
          deletedClientApprovalIds: deletedApprovalIds,
        } as any,
      },
    });

    void recordApprovalDecision({
      queue: "payAdjustments",
      decision: "DELETED",
      userId: session.user.id,
      entity: "CleanerPayAdjustment",
      entityId: existing.id,
      jobId: existing.jobId ?? null,
      label: existing.title ?? "Pay adjustment",
      amount: Number(existing.approvedAmount ?? existing.requestedAmount ?? 0),
      note: existing.adminNote ?? null,
      subjectUserId: existing.cleanerId,
      fromStatus: existing.status,
      before: existing as any,
    });

    return NextResponse.json({ ok: true, deletedClientApprovalIds: deletedApprovalIds });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message ?? "Could not delete request." }, { status });
  }
}
