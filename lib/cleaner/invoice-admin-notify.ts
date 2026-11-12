/**
 * Payee emails for admin decisions on a cleaner invoice: the send-back reason
 * and the remittance advice. Moved verbatim out of
 * app/api/admin/cleaner-invoices/[id]/route.ts so the single route and the
 * bulk route share them.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Email the payee that their invoice needs work, with the reason.
 *
 * The reason is the whole point. An invoice returned with no explanation comes
 * back unchanged, and the second round costs both people the same time as the
 * first.
 */
export async function notifyPayeeOfChangeRequest(submissionId: string, note: string): Promise<void> {
  // Two queries because CleanerInvoiceSubmission carries a bare `cleanerId`
  // with no relation to User — there is nothing to include.
  const submission = await db.cleanerInvoiceSubmission.findUnique({
    where: { id: submissionId },
    select: { invoiceNumber: true, periodStart: true, periodEnd: true, cleanerId: true },
  });
  if (!submission) return;

  const payee = await db.user.findUnique({
    where: { id: submission.cleanerId },
    select: { name: true, email: true, role: true },
  });
  if (!payee?.email) return;

  const { sendEmailDetailed } = await import("@/lib/notifications/email");
  const { getAppSettings } = await import("@/lib/settings");
  const { resolveAppUrl } = await import("@/lib/app-url");
  const settings = await getAppSettings();

  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmt = (date: Date) =>
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);

  // QA inspectors self-invoice on this same rail, so the link has to land in
  // THEIR portal rather than always the cleaner one.
  const href = payee.role === Role.QA_INSPECTOR ? "/v2/qa/invoices" : "/v2/cleaner/invoices";

  const { loadNotificationWording } = await import("@/lib/notifications/wording/render");
  const wording = await loadNotificationWording("job.cleaner_invoice");
  const hasNumber = Boolean(submission.invoiceNumber);
  const email = wording.render("change-request", "EMAIL", {
    recipientName: payee.name ?? "there",
    periodStart: fmt(submission.periodStart),
    periodEnd: fmt(submission.periodEnd),
    invoiceSuffix: wording.line("invoice-suffix", "INBOX", { invoiceNumber: submission.invoiceNumber }, hasNumber),
    invoiceNumberPart: wording.line("invoice-number", "EMAIL", { invoiceNumber: submission.invoiceNumber }, hasNumber),
    fixHtml: escape(note).replace(/\n/g, "<br/>"),
    invoicesUrl: resolveAppUrl(href),
    companyName: settings.companyName,
  });
  await sendEmailDetailed({
    kind: "job_assignment",
    to: payee.email,
    subject: email.subject,
    // A finance document the office explicitly sent back — a stale suppression
    // must not silently eat it.
    transactional: true,
    html: email.html,
  });
}


/**
 * Tell a payee that money has been sent, and what it covers.
 *
 * Read AFTER the write so the figures are the ones now stored rather than the
 * ones the request proposed — an admin who adjusted the amount would otherwise
 * have the original emailed out.
 */
export async function sendPayeeRemittance(submissionId: string): Promise<void> {
  const submission = await db.cleanerInvoiceSubmission.findUnique({
    where: { id: submissionId },
    select: {
      invoiceNumber: true,
      periodStart: true,
      periodEnd: true,
      totalAmount: true,
      paidAmount: true,
      paidBankAccount: true,
      paidNote: true,
      paymentMethod: true,
      paidDate: true,
      cleanerId: true,
    },
  });
  if (!submission) return;

  const payee = await db.user.findUnique({
    where: { id: submission.cleanerId },
    select: { name: true, email: true },
  });
  if (!payee?.email) return;

  const { sendEmailDetailed } = await import("@/lib/notifications/email");
  const { getAppSettings } = await import("@/lib/settings");
  const { buildPayeeRemittanceAdvice } = await import("@/lib/finance/payment-notices");
  const settings = await getAppSettings();

  const email = buildPayeeRemittanceAdvice({
    recipientName: payee.name,
    invoiceNumber: submission.invoiceNumber,
    // paidAmount is what actually went out; totalAmount is what was asked for,
    // and the two differ whenever the office settled a different figure.
    amount: Number(submission.paidAmount ?? submission.totalAmount ?? 0),
    method: submission.paymentMethod ?? "OTHER",
    paidDate: submission.paidDate ?? new Date(),
    bankAccount: submission.paidBankAccount,
    note: submission.paidNote,
    periodStart: submission.periodStart,
    periodEnd: submission.periodEnd,
    companyName: settings.companyName,
  });

  await sendEmailDetailed({
    kind: "auto_invoice",
    to: payee.email,
    subject: email.subject,
    html: email.html,
    // Money that has left the business. A stale suppression must not eat it.
    transactional: true,
  });
}
