import "server-only";
/**
 * Tell the payee their invoice was amended by the office (catalog type
 * job.cleaner_invoice_amended, 2026-11-23), through the office send pipeline
 * with explicit transports: an inbox row (no phone or browser push) and an
 * email. The payee's own notification switches apply (the type RESPECTS
 * preferences; the provider chokepoints and the inbox writer check them).
 *
 * The message lists each change in plain words, the new and previous totals
 * and the office's reason, and links to the amended invoice: a download of the
 * payee's own invoice built from the stored snapshot by the existing renderer
 * (the pipeline carries no attachments, and a link to an own-scoped download
 * never mails a financial document to a stale address).
 *
 * The outcomes are returned as the pipeline reports them: queued, in the inbox,
 * accepted by the email provider, switched off or skipped. None of them is
 * "delivered". The event id is per amendment, so a retry never sends twice.
 */
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { formatInTimeZone } from "date-fns-tz";
import { resolveAppUrl } from "@/lib/app-url";
import { getAppSettings } from "@/lib/settings";
import { sendOfficeNotification, type RecipientOutcome } from "@/lib/notifications/office-sends";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { loadNotificationWording } from "@/lib/notifications/wording/render";
import { formatAud } from "./invoice-amend-rules";

export const AMENDED_TYPE_KEY = "job.cleaner_invoice_amended";
export const AMENDED_EVENT_KEY = "cleaner_invoice.amended";

/** What the amendment record keeps about the notice. */
export type AmendNoticeRecord =
  | { status: "sent"; at: string; outcomes: Array<Pick<RecipientOutcome, "transport" | "path" | "state" | "errorCode">> }
  | { status: "not-sent"; at: string; reason: string };

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function payeeInvoicesPath(role: string | null | undefined): string {
  return role === Role.QA_INSPECTOR ? "/v2/qa/invoices" : "/v2/cleaner/pay?tab=invoices";
}

export async function notifyPayeeOfAmendment(input: {
  submissionId: string;
  revision: number;
  actorId: string;
  changeLines: string[];
  reason: string;
  beforeTotal: number;
  afterTotal: number;
}): Promise<AmendNoticeRecord> {
  const at = new Date().toISOString();
  const submission = await db.cleanerInvoiceSubmission.findUnique({
    where: { id: input.submissionId },
    select: { id: true, invoiceNumber: true, periodStart: true, periodEnd: true, cleanerId: true },
  });
  if (!submission) return { status: "not-sent", at, reason: "The invoice could not be found." };
  const payee = await db.user.findUnique({ where: { id: submission.cleanerId }, select: { id: true, role: true, name: true, email: true, isActive: true } });
  if (!payee) return { status: "not-sent", at, reason: "The payee's account could not be found." };
  if (!payee.isActive) return { status: "not-sent", at, reason: "The payee's account is not active, so nothing was sent." };
  if (payee.role !== Role.CLEANER && payee.role !== Role.QA_INSPECTOR) return { status: "not-sent", at, reason: "The payee no longer has a cleaner or QA inspector account, so nothing was sent." };

  const [settings, wording, controls] = await Promise.all([getAppSettings(), loadNotificationWording(AMENDED_TYPE_KEY), getNotificationTypeControls()]);
  const timeZone = settings.timezone || "Australia/Sydney";
  const day = (date: Date) => formatInTimeZone(date, timeZone, "d MMM yyyy");
  const invoicesPath = payeeInvoicesPath(payee.role);
  const pdfPath = `/api/cleaner/invoice/submissions/${encodeURIComponent(submission.id)}/pdf`;
  const suffix = submission.invoiceNumber ? ` — ${submission.invoiceNumber}` : "";
  const changesText = `${input.changeLines.join(". ")}.`;
  const values = {
    recipientName: payee.name ?? "there",
    invoiceSuffix: suffix,
    changesText,
    reason: input.reason,
  };
  const inboxText = wording.render("amended", "INBOX", values);
  const email = wording.render("amended", "EMAIL", {
    ...values,
    periodStart: day(submission.periodStart),
    periodEnd: day(submission.periodEnd),
    invoiceNumberPart: submission.invoiceNumber ? ` (<strong>${escapeHtml(submission.invoiceNumber)}</strong>)` : "",
    changeList: input.changeLines.map((line) => `<li>${escapeHtml(line)}</li>`).join(""),
    newTotal: formatAud(input.afterTotal),
    originalTotal: formatAud(input.beforeTotal),
    fixHtml: escapeHtml(input.reason).replace(/\n/g, "<br/>"),
    pdfUrl: resolveAppUrl(pdfPath),
    invoicesUrl: resolveAppUrl(invoicesPath),
    companyName: settings.companyName,
  });

  const outcomes = await sendOfficeNotification({
    typeKey: AMENDED_TYPE_KEY,
    eventKey: "cleaner_invoice.amended",
    eventId: `cleaner-invoice-amended:${submission.id}:${input.revision}`,
    entity: { type: "CleanerInvoiceSubmission", id: submission.id },
    actorId: input.actorId,
    scopeType: "CLEANER_INVOICE_PAYEE",
    scopeId: () => submission.id,
    category: "billing",
    severity: "ACTION",
    jobId: null,
    subject: inboxText.title,
    body: inboxText.body,
    url: invoicesPath,
    email: () => ({ subject: email.subject, html: email.html }),
    emailKind: "auto_invoice",
    transports: ["INBOX", "EMAIL"],
    recipients: [{ id: payee.id, role: payee.role, name: payee.name, email: payee.email }],
    respectsPreferences: true,
    disabledTransports: controls.disabledTransports[AMENDED_TYPE_KEY] ?? [],
  });
  return { status: "sent", at, outcomes: outcomes.map(({ transport, path, state, errorCode }) => ({ transport, path, state, errorCode: errorCode ?? null })) };
}
