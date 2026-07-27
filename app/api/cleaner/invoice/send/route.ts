import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { sendEmailDetailed } from "@/lib/notifications/email";
import { renderEmailTemplate } from "@/lib/email-templates";
import {
  buildCleanerInvoiceHtml,
  getCleanerInvoiceData,
  renderCleanerInvoicePdf,
} from "@/lib/cleaner/invoice";
import {
  markCleanerShoppingRunsInvoiced,
  stampShoppingSettlementsForCleanerInvoice,
} from "@/lib/inventory/shopping-runs";
import {
  invoicePayeeMissingFields,
  invoicePayeeProfileHref,
} from "@/lib/profile/completeness";
import {
  adaptInvoiceEmailForPayee,
  invoiceErrorMessage,
  invoiceErrorStatus,
  invoiceFileStem,
  requireInvoicePayeeSession,
} from "@/lib/invoicing/access";

const schema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  showSpentHours: z.boolean().optional(),
  showHours: z.boolean().optional(),
  jobComments: z.record(z.string(), z.string()).optional(),
  jobHourOverrides: z.record(z.string(), z.number().nonnegative()).optional(),
  excludedJobIds: z.array(z.string().min(1)).max(500).optional(),
  excludedRunIds: z.array(z.string().min(1)).max(500).optional(),
  confirmEmail: z.literal(true),
});

export async function POST(req: NextRequest) {
  try {
    // CLEANER or QA_INSPECTOR. Everything below keys off session.user.id, so a
    // payee can only ever bill their OWN work — the widened role gate grants no
    // access to anyone else's jobs, inspections, adjustments or submissions.
    const session = await requireInvoicePayeeSession();
    const settings = await getAppSettings();
    const body = schema.parse(await req.json().catch(() => ({})));
    const data = await getCleanerInvoiceData({
      userId: session.user.id,
      startDate: body.startDate,
      endDate: body.endDate,
      showSpentHours: body.showSpentHours,
      showHours: body.showHours,
      jobComments: body.jobComments,
      jobHourOverrides: body.jobHourOverrides,
      excludeInvoicedJobs: true,
      excludedJobIds: body.excludedJobIds,
      excludedRunIds: body.excludedRunIds,
    });
    const missingProfile = invoicePayeeMissingFields({
      name: data.cleanerName,
      phone: data.cleanerPhone,
      email: data.cleanerEmail,
      address: data.cleanerAddress,
      abn: data.cleanerAbn,
      bankBsb: data.cleanerBankBsb,
      bankAccountNumber: data.cleanerBankAccountNumber,
      bankAccountName: data.cleanerBankAccountName,
    });
    if (missingProfile.length > 0) {
      return NextResponse.json(
        {
          error: `Complete your profile before emailing an invoice. Missing: ${missingProfile
            .map((field) => field.label)
            .join(", ")}.`,
          missingProfileFields: missingProfile,
          fixUrl: invoicePayeeProfileHref(session.user.role),
        },
        { status: 400 }
      );
    }

    if (data.estimatedPay <= 0 && data.pendingAdjustmentCount > 0) {
      return NextResponse.json(
        {
          error:
            "Invoice total is $0.00 while there are pending extra payment requests waiting for admin approval. Wait for those approvals before emailing accounts.",
          pendingAdjustmentCount: data.pendingAdjustmentCount,
          pendingAdjustmentAmount: data.pendingAdjustmentAmount,
        },
        { status: 409 }
      );
    }

    const accountsEmail = settings.accountsEmail;
    if (!accountsEmail) {
      return NextResponse.json({ error: "Accounts email is not configured." }, { status: 400 });
    }
    // Snapshot the invoice so admin can review it + push it to Xero as a bill.
    const billLines = [
      ...data.rows.map((r) => ({ description: `${r.date} · ${r.property} · ${r.jobName}`, quantity: 1, unitAmount: Number(r.amount ?? 0) })),
      ...data.extraLineRows.map((r) => ({ description: `Extra · ${r.date} · ${r.description}`, quantity: 1, unitAmount: Number(r.amount ?? 0) })),
      ...data.qaInspectionRows.map((r) => ({ description: `QA inspection · ${r.date} · ${r.property}`, quantity: 1, unitAmount: Number(r.amount ?? 0) })),
      ...data.expenseRows.map((r) => ({ description: `Shopping reimbursement · ${r.runName}`, quantity: 1, unitAmount: Number(r.amount ?? 0) })),
      ...data.shoppingTimeRows.map((r) => ({ description: `Shopping time · ${r.runName}`, quantity: 1, unitAmount: Number(r.amount ?? 0) })),
    ].filter((l) => Number.isFinite(l.unitAmount));
    const lineData = {
      contact: {
        name: data.cleanerName,
        email: data.cleanerEmail,
        phone: data.cleanerPhone ?? null,
        address: data.cleanerAddress ?? null,
        abn: data.cleanerAbn ?? null,
      },
      // CLEANER or QA_INSPECTOR — recorded so admin review, the Xero bill and any
      // later audit can tell which kind of payee raised this invoice.
      payeeRole: session.user.role ?? null,
      lines: billLines,
      // Jobs invoiced here — used to exclude them from future invoices so a
      // job can't be submitted twice and won't reappear once invoiced.
      jobIds: data.rows.map((r) => r.jobId),
      // QA inspections billed here. Audit trail only — the double-pay guard is
      // the QaAssignment.includedInCleanerInvoiceId stamp written below, not this.
      qaAssignmentIds: data.includedQaAssignmentIds,
    } as any;

    // BUG 2 FIX — idempotency anchor. Previously the email was sent FIRST and the
    // CleanerInvoiceSubmission snapshot created AFTER, with no guard, so a
    // double-tap / two in-flight sends emailed accounts twice AND created two pay
    // claims (double payment). We now create the snapshot BEFORE emailing, in a
    // per-cleaner serialized transaction, and reject a rapid duplicate for the
    // same period with a 409 before any email goes out. The row starts as
    // "SENDING" and only flips to the terminal "SUBMITTED" once the email + the
    // invoiced-marking both succeed; a failed send deletes the anchor so a
    // legitimate retry can proceed.
    let anchorId: string;
    try {
      anchorId = await db.$transaction(async (tx) => {
        // Transaction-scoped advisory lock keyed on the cleaner: serializes
        // concurrent sends for THIS cleaner so the duplicate check + insert below
        // are atomic (two simultaneous requests can't both pass the check).
        // Released automatically when the tx ends. Use $executeRaw (not
        // $queryRaw): pg_advisory_xact_lock() returns `void`, which $queryRaw
        // tries to deserialize and fails ("Failed to deserialize column of type
        // 'void'"), blocking every invoice send. We only need the side effect.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${session.user.id}))`;
        // A row for the same cleaner + period created within the last 2 minutes
        // means a send is in flight or just completed — treat this as the
        // duplicate tap. periodStart is stable across taps; periodEnd defaults to
        // "now" so we deliberately match on periodStart only. The 2-minute window
        // also self-heals a stale "SENDING" row left by a crashed request.
        const recent = await tx.cleanerInvoiceSubmission.findFirst({
          where: {
            cleanerId: session.user.id,
            periodStart: data.start,
            createdAt: { gte: new Date(Date.now() - 2 * 60_000) },
          },
          select: { id: true },
        });
        if (recent) {
          throw new Error("__DUPLICATE_INVOICE_SEND__");
        }
        const created = await tx.cleanerInvoiceSubmission.create({
          data: {
            cleanerId: session.user.id,
            periodStart: data.start,
            periodEnd: data.end,
            hours: data.hours,
            totalAmount: data.estimatedPay,
            jobCount: data.rows.length,
            status: "SENDING",
            lineData,
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (guardErr: any) {
      if (guardErr?.message === "__DUPLICATE_INVOICE_SEND__") {
        return NextResponse.json(
          {
            error:
              "An invoice for this period was just sent. Refresh to see it before sending again.",
          },
          { status: 409 }
        );
      }
      throw guardErr;
    }

    const html = buildCleanerInvoiceHtml(data);
    const pdf = await renderCleanerInvoicePdf(html);
    const fileName = `${invoiceFileStem(session.user.role)}-${session.user.id}-${data.start
      .toISOString()
      .slice(0, 10)}-to-${data.end.toISOString().slice(0, 10)}.pdf`;

    // One template for the whole rail; relabelled for an inspector so accounts
    // aren't told a cleans-free invoice is a "Cleaner Invoice".
    const emailTemplate = adaptInvoiceEmailForPayee(
      session.user.role,
      renderEmailTemplate(settings, "cleanerInvoice", {
        cleanerName: data.cleanerName,
        accountsEmail,
        jobCount: data.rows.length,
      })
    );
    const emailResult = await sendEmailDetailed({
      to: accountsEmail,
      subject: emailTemplate.subject,
      html: `${emailTemplate.html}${html}`,
      attachments: [{ filename: fileName, content: pdf }],
    });

    if (!emailResult.ok) {
      // Send failed — release the anchor so the cleaner can legitimately retry
      // (and so the jobs aren't left marked-invoiced against a send that never
      // reached accounts).
      await db.cleanerInvoiceSubmission.delete({ where: { id: anchorId } }).catch(() => {});
      return NextResponse.json({ error: emailResult.error ?? "Failed to send invoice email." }, { status: 502 });
    }

    // Settle the SHOPPING this invoice billed — the fourth stream, and until now
    // the only one settled by status alone. `estimatedPay` folds in both the
    // out-of-pocket reimbursement and the approved shopping time, so an unstamped
    // run was billed all over again by the next invoice AND payable a second time
    // by a payroll run.
    //
    // Order matters: markCleanerShoppingRunsInvoiced runs FIRST because it is what
    // guarantees a ShoppingSettlement row exists (a time-only run normally has
    // none) — the stamping updateMany would otherwise match nothing and silently
    // leave the money unguarded. Both steps share one transaction so a failure
    // can't leave runs marked INVOICED but unstamped.
    const invoicedRunIds = Array.from(
      new Set([
        ...data.expenseRows.map((row) => row.runId),
        ...data.shoppingTimeRows.map((row) => row.runId),
      ])
    );
    if (invoicedRunIds.length > 0) {
      await db.$transaction(async (tx) => {
        const ownedRunIds = await markCleanerShoppingRunsInvoiced(
          { cleanerId: session.user.id, runIds: invoicedRunIds },
          tx
        );
        await stampShoppingSettlementsForCleanerInvoice(
          {
            // Only runs the previous call confirmed this cleaner OWNS — that is
            // where the ownership check lives, so nothing here can stamp someone
            // else's money as paid to them.
            ownedRunIds,
            invoiceId: anchorId,
            // The amounts rendered on the PDF, frozen as-is — never a recomputation.
            expense: data.expenseRows.map((row) => ({ runId: row.runId, amount: row.amount })),
            time: data.shoppingTimeRows.map((row) => ({ runId: row.runId, amount: row.amount })),
          },
          tx
        );
      });
    }

    // Settle the approved pay adjustments this invoice billed. The stamp is the
    // double-pay guard: a stamped row is no longer selectable by the next
    // invoice (lib/finance/pay-adjustments.ts → isAdjustmentAvailableForInvoice),
    // so re-running generation cannot bill it twice. Applied only after the
    // email actually reached accounts — a failed send deletes the anchor above
    // and stamps nothing, leaving the adjustments available for a retry.
    // Conditioned on the stamp still being null so a concurrent invoice that
    // already claimed a row cannot have it reassigned.
    if (data.includedAdjustmentIds.length > 0) {
      await db.cleanerPayAdjustment.updateMany({
        where: {
          id: { in: data.includedAdjustmentIds },
          cleanerId: session.user.id,
          includedInCleanerInvoiceId: null,
        },
        data: { includedInCleanerInvoiceId: anchorId, includedInCleanerInvoiceAt: new Date() },
      });
    }

    // Settle the QA inspections this invoice billed — the SAME discipline as the
    // adjustments above, on the same rail. Three things happen atomically per
    // row: the invoice stamp, its timestamp, and the FROZEN amount.
    //
    //  • The amount frozen is the exact number that was rendered on the PDF
    //    (row.amount, already settlement-aware), never a recomputation — a later
    //    rate/settings change must not retro-alter what accounts was billed.
    //  • The guard requires BOTH stamps still null, so neither a concurrent
    //    invoice nor a payroll run committed in between can be overwritten; the
    //    loser of the race simply updates 0 rows and the inspection stays paid
    //    exactly once.
    //  • Applied only after the email actually reached accounts — a failed send
    //    deletes the anchor above and stamps nothing, so a retry re-bills them.
    if (data.includedQaAssignmentIds.length > 0) {
      const settledAt = new Date();
      for (const row of data.qaInspectionRows) {
        await db.qaAssignment.updateMany({
          where: {
            id: row.assignmentId,
            assignedToId: session.user.id,
            includedInCleanerInvoiceId: null,
            includedInPayrollRunId: null,
          },
          data: {
            includedInCleanerInvoiceId: anchorId,
            includedInCleanerInvoiceAt: settledAt,
            paySettledAmount: row.amount,
          },
        });
      }
    }

    // Email + invoiced-marking succeeded → flip the anchor to its terminal state.
    await db.cleanerInvoiceSubmission.update({
      where: { id: anchorId },
      data: { status: "SUBMITTED" },
    });

    return NextResponse.json({
      ok: true,
      hours: data.hours,
      estimatedPay: data.estimatedPay,
      sentTo: accountsEmail,
      jobs: data.rows.length,
      qaInspections: data.qaInspectionRows.length,
      qaInspectionTotal: data.qaInspectionTotal,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: invoiceErrorMessage(err?.message) },
      { status: invoiceErrorStatus(err?.message) }
    );
  }
}
