/** job.cleaner_invoice_amended: the office amended a payee's submitted invoice (2026-11-23). */
import { editable, inbox, part } from "./build";

const AMENDED_EMAIL = "<p>Hi {{recipientName}},</p><p>The office amended your invoice for {{periodStart}} – {{periodEnd}}{{invoiceNumberPart}}.</p><p><strong>What changed:</strong></p><ul>{{changeList}}</ul><p><strong>New total:</strong> {{newTotal}} (was {{originalTotal}})</p><p><strong>The office's reason:</strong><br/>{{fixHtml}}</p><p><a href=\"{{pdfUrl}}\">Download the amended invoice</a></p><p><a href=\"{{invoicesUrl}}\">Open your invoices</a></p><p>— {{companyName}}</p>";

export const CLEANER_INVOICE_AMENDED_WORDING = editable("job.cleaner_invoice_amended", [
  inbox("amended", "Invoice amended (payee)", "Your invoice was amended{{invoiceSuffix}}", "{{changesText}} Reason: {{reason}}", { required: ["changesText", "reason"], note: "{{changesText}} lists each change and the new total; {{reason}} is the office's reason." }),
  part("amended", "Invoice amended (payee)", "EMAIL", { subject: "Your invoice was amended{{invoiceSuffix}}", body: AMENDED_EMAIL }, { required: ["changeList", "newTotal", "fixHtml", "pdfUrl"], note: "{{changeList}} is one list item per change; {{fixHtml}} is the office's reason with its line breaks." }),
]);
