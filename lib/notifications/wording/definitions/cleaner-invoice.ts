/** job.cleaner_invoice: the new-invoice email (shared template) and the "change requested" email. */
import { editable, emailTemplatePart, line, part } from "./build";

const CHANGE_EMAIL = "<p>Hi {{recipientName}},</p><p>Your invoice for {{periodStart}} – {{periodEnd}}{{invoiceNumberPart}} has been sent back for a change.</p><p><strong>What needs fixing:</strong><br/>{{fixHtml}}</p><p>Everything on it is available to invoice again, so you can correct it and resend.</p><p><a href=\"{{invoicesUrl}}\">Open your invoices</a></p><p>— {{companyName}}</p>";

export const CLEANER_INVOICE_WORDING = editable("job.cleaner_invoice", [
  emailTemplatePart("accounts", "Accounts", "cleanerInvoice"),
  part("change-request", "Change requested (cleaner)", "EMAIL", { subject: "Your invoice needs a change{{invoiceSuffix}}", body: CHANGE_EMAIL }, { required: ["fixHtml"], note: "{{fixHtml}} is the office's reason with its line breaks." }),
  line("invoice-suffix", "Invoice number (subject)", "INBOX", " — {{invoiceNumber}}", "Added to the subject when the invoice has a number."),
  line("invoice-number", "Invoice number (body)", "EMAIL", " (<strong>{{invoiceNumber}}</strong>)", "Added to the body when the invoice has a number."),
], "The remittance advice sent when an invoice is paid is a payment record (amount, method, account, period) built in lib/finance/payment-notices.ts.");
