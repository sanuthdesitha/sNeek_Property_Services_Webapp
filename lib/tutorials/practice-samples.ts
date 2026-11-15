/**
 * Sample records for practice walkthroughs (plain module: safe for server
 * pages). Every name says "Practice" and every id starts "practice-", so the
 * practice guard answers any read for them in the browser and a sample can
 * never be mistaken for, or written as, a real record.
 */
import type { ClientInvoiceEditorData } from "@/lib/billing/client-invoice-editor-types";

export const PRACTICE_PROPERTY = {
  id: "practice-demo-cottage",
  name: "Practice: Demo Cottage",
  suburb: "Surry Hills",
  address: "1 Sample Lane",
};

export const PRACTICE_CLIENT = { id: "practice-client", name: "Practice client", email: "practice-client@example.invalid" };

const PRACTICE_DAY = "2026-11-03";

/** INV-P001: two turnovers at $140 plus GST, a draft ready to send (board "Admin tours", D). */
export function practiceInvoice(timezone: string): ClientInvoiceEditorData {
  const createdAt = "2026-11-14T00:00:00.000Z";
  const line = (id: string, day: string) => ({
    id,
    description: `Practice turnover · ${day === PRACTICE_DAY ? "3 Nov" : "10 Nov"}`,
    quantity: 1,
    unitPrice: 140,
    lineTotal: 140,
    category: "CLEANING",
    note: null,
    shoppingLocked: false,
    discount: false,
    discountPercent: null,
    job: {
      id: `practice-job-${id}`,
      jobNumber: id === "practice-line-1" ? "J-P001" : "J-P002",
      scheduledDay: day,
      property: { id: PRACTICE_PROPERTY.id, name: PRACTICE_PROPERTY.name, suburb: PRACTICE_PROPERTY.suburb },
    },
    propertyId: null,
    property: null,
    startedWork: null,
  });
  return {
    row: {
      id: "practice-invoice",
      invoiceNumber: "INV-P001",
      status: "DRAFT",
      totalAmount: 308,
      paidAmount: null,
      amountOwing: 308,
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      sentAt: null,
      paidAt: null,
      paidDate: null,
      paymentMethod: null,
      paymentReference: null,
      createdAt,
      dueDate: "2026-11-28",
      paymentTermsDays: 14,
      overdue: false,
      xeroInvoiceId: null,
      xeroExportedAt: null,
      xeroState: "NONE",
      xeroPushFailure: null,
      xeroSync: null,
      missingRateJobs: 0,
      client: PRACTICE_CLIENT,
      kind: "INVOICE",
      clientReference: null,
      creditedAmount: 0,
      fullyCredited: false,
      credits: null,
      creditedBy: [],
    },
    timezone,
    paymentTermsDays: 14,
    updatedAt: createdAt,
    subtotal: 280,
    gstAmount: 28,
    totalAmount: 308,
    gstEnabled: true,
    totalsMismatch: false,
    clientNote: null,
    startedWorkUnreadable: null,
    lines: [line("practice-line-1", PRACTICE_DAY), line("practice-line-2", "2026-11-10")],
    clientProperties: [{ id: PRACTICE_PROPERTY.id, name: PRACTICE_PROPERTY.name, suburb: PRACTICE_PROPERTY.suburb }],
    editLock: { editable: false, kind: "view-only", reason: "Practice invoice: a sample to look through. Nothing here is saved, emailed or sent to Xero." },
    canManage: true,
    canVoidCredit: false,
    checks: {
      appliesTo: "approve",
      items: [
        { key: "lines", state: "ok", enforced: true, label: "Lines come from finished jobs", detail: "Practice sample", fixHref: null, fixLabel: null },
        { key: "rates", state: "ok", enforced: true, label: "Every job has a client rate", detail: "Practice sample", fixHref: null, fixLabel: null },
      ],
    },
    send: { defaultRecipients: [PRACTICE_CLIENT.email], recipientsError: null, paymentLink: { available: false, reason: "Not offered in practice." } },
    xero: {
      state: "NONE",
      xeroInvoiceId: null,
      exportedAt: null,
      contactId: null,
      salesAccountCode: null,
      salesAccountName: null,
      salesAccountNameReason: "Practice: Xero is not contacted.",
      disbursementAccountCode: null,
      hasDisbursementLines: false,
      settingsError: null,
    },
    history: [{ id: "practice-history-1", at: createdAt, label: "Practice invoice created as a sample", actor: "Practice", source: "record" }],
    startedWork: null,
    draft: null,
  };
}
