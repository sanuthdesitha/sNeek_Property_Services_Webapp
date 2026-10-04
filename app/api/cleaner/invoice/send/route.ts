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
import { claimCleanerInvoice } from "@/lib/cleaner/invoice-claim";

const schema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  showSpentHours: z.boolean().optional(),
  showHours: z.boolean().optional(),
  jobComments: z.record(z.string(), z.string()).optional(),
  jobHourOverrides: z.record(z.string(), z.number().nonnegative()).optional(),
  excludedJobIds: z.array(z.string().min(1)).max(500).optional(),
  excludedRunIds: z.array(z.string().min(1)).max(500).optional(),
  // Approved pay adjustments the payee removed from this invoice. Never
  // stamped, so they stay owed and appear on the next one.
  excludedAdjustmentIds: z.array(z.string().min(1)).max(500).optional(),
  confirmEmail: z.literal(true),
  requestId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  let reservedId: string | null = null;
  let reservedSnapshot: any = null;
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
      excludePaidJobs: true,
      excludedJobIds: body.excludedJobIds,
      excludedRunIds: body.excludedRunIds,
      excludedAdjustmentIds: body.excludedAdjustmentIds,
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
    // `kind` is stamped per line at build time, because this is the only place
    // that still knows which stream produced it. Downstream — the Xero push in
    // particular — otherwise has to infer it from the description text or fall
    // back to one label for the whole bill, and under multi-role one bill can
    // carry cleans AND inspections. A guessed label lands in the accounts.
    const billLines = [
      ...data.rows.map((r) => ({ kind: "CLEANING" as const, description: `${r.date} · ${r.property} · ${r.jobName}`, quantity: 1, unitAmount: Number(r.amount ?? 0) })),
      ...data.extraLineRows.map((r) => ({ kind: "CLEANING" as const, description: `Extra · ${r.date} · ${r.description}`, quantity: 1, unitAmount: Number(r.amount ?? 0) })),
      ...data.qaInspectionRows.map((r) => ({ kind: "INSPECTION" as const, description: `QA inspection · ${r.date} · ${r.property}`, quantity: 1, unitAmount: Number(r.amount ?? 0) })),
      ...data.transportAllowanceRows.map((r) => ({ kind: "INSPECTION" as const, description: r.description, quantity: 1, unitAmount: r.amount })),
      ...data.expenseRows.map((r) => ({ kind: "CLEANING" as const, description: `Shopping reimbursement · ${r.runName}`, quantity: 1, unitAmount: Number(r.amount ?? 0) })),
      ...data.shoppingTimeRows.map((r) => ({ kind: "CLEANING" as const, description: `Shopping time · ${r.runName}`, quantity: 1, unitAmount: Number(r.amount ?? 0) })),
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
      adjustmentIds: data.includedAdjustmentIds,
      shoppingRunIds: Array.from(new Set([...data.expenseRows, ...data.shoppingTimeRows].map(row => row.runId))),
      travelDays: data.claimableAllowanceDays,
    } as any;

    const anchor = await claimCleanerInvoice({ cleanerId: session.user.id, requestId: body.requestId, data, lineData });
    if (anchor.reused) {
      return NextResponse.json({ ok: anchor.status === "SUBMITTED", invoiceId: anchor.id, status: anchor.status,
        requiresReview: anchor.status !== "SUBMITTED", message: anchor.status === "SUBMITTED" ? "This invoice was already submitted." : "This invoice is reserved and delivery needs office review. Do not submit it again." });
    }

    reservedId = anchor.id;
    reservedSnapshot = { ...lineData, requestId: body.requestId ?? null };
    const html = buildCleanerInvoiceHtml(data, anchor.invoiceNumber);
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
      // A finance document the admin explicitly sent — a stale suppression
      // must not silently eat an invoice.
      transactional: true,
    });

    if (!emailResult.ok) {
      // Delivery failures can be ambiguous. Keep receipt AND claims for review;
      // never release payable money or automatically repeat external delivery.
      await db.cleanerInvoiceSubmission.updateMany({ where: { id: anchor.id, status: "SENDING" }, data: { lineData: { ...lineData, requestId: body.requestId ?? null, delivery: "REVIEW_REQUIRED" } } });
      return NextResponse.json({ invoiceId: anchor.id, status: "SENDING", requiresReview: true,
        error: "Invoice reserved; email delivery needs office review. Do not submit again." }, { status: 502 });
    }

    // Email + invoiced-marking succeeded → flip the anchor to its terminal state.
    const finalized = await db.cleanerInvoiceSubmission.updateMany({
      where: { id: anchor.id, status: "SENDING" },
      data: { status: "SUBMITTED", lineData: { ...lineData, requestId: body.requestId ?? null, delivery: "SENT" } },
    });

    if (finalized.count !== 1) throw new Error("Delivery state changed during review.");
    return NextResponse.json({
      ok: true,
      invoiceId: anchor.id,
      hours: data.hours,
      estimatedPay: data.estimatedPay,
      sentTo: accountsEmail,
      jobs: data.rows.length,
      qaInspections: data.qaInspectionRows.length,
      qaInspectionTotal: data.qaInspectionTotal,
    });
  } catch (err: any) {
    if (reservedId) {
      await db.cleanerInvoiceSubmission.updateMany({ where: { id: reservedId, status: "SENDING" },
        data: { lineData: { ...reservedSnapshot, delivery: "REVIEW_REQUIRED" } } }).catch(() => undefined);
      return NextResponse.json({ invoiceId: reservedId, status: "SENDING", requiresReview: true,
        error: "Invoice reserved; delivery needs office review. Do not submit again." }, { status: 502 });
    }
    return NextResponse.json(
      { error: invoiceErrorMessage(err?.message) },
      { status: invoiceErrorStatus(err?.message) }
    );
  }
}
