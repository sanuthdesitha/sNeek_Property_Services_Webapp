/**
 * Everything the invoice editor page shows, read on the server. Reads only: all
 * changes go through the existing invoice routes and their services.
 */
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { getPhase3IntegrationsSettings } from "@/lib/phase3/integrations";
import { resolveClientDeliveryRecipients } from "@/lib/commercial/delivery-profiles";
import { isShoppingDisbursement } from "@/lib/finance/shopping-accounting";
import { getClientInvoice } from "./client-invoices";
import { getClientInvoiceListRow } from "./client-invoice-list";
import { invoiceEditLock, isShoppingLockedLine } from "./client-invoice-guards";
import { isDiscountLine } from "./client-invoice-adjustments";
import { clientInvoiceApprovalChecks } from "./client-invoice-checks";
import { clientInvoiceHistory } from "./client-invoice-history";
import { readStartedWorkReviewSafely } from "./started-work-reconciliation";
import { paymentLinkAvailability } from "./invoice-payment-link";
import { xeroAccountName } from "./xero-account-name";
import { loadDraftPanel } from "./client-invoice-editor-draft";
import type {
  ClientInvoiceEditorData,
  EditorLine,
  EditorSendPanel,
  EditorStartedWork,
  EditorXeroPanel,
} from "./client-invoice-editor-types";

type LoadedInvoice = NonNullable<Awaited<ReturnType<typeof getClientInvoice>>>;
type LoadedLine = LoadedInvoice["lines"][number];

function failed(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function readStartedWork(invoice: LoadedInvoice): EditorStartedWork | null {
  const { review } = readStartedWorkReviewSafely(invoice.metadata);
  return review ? { review, inspection: invoice.startedWorkStatus ?? null } : null;
}

function lineStartedWork(line: LoadedLine, startedWork: EditorStartedWork | null): EditorLine["startedWork"] {
  if (!startedWork || !line.jobId) return null;
  if (startedWork.inspection?.changedJobIds.includes(line.jobId)) return "changed";
  const snapshot = startedWork.review.jobs.find((job) => job.jobId === line.jobId);
  return snapshot?.unfinishedAtCutoff ? "unfinished" : null;
}

function toEditorLine(line: LoadedLine, timezone: string, startedWork: EditorStartedWork | null): EditorLine {
  return {
    id: line.id,
    description: line.description,
    quantity: Number(line.quantity),
    unitPrice: Number(line.unitPrice),
    lineTotal: Number(line.lineTotal),
    category: line.category,
    note: line.note ?? null,
    shoppingLocked: isShoppingLockedLine(line),
    discount: isDiscountLine(line),
    discountPercent: line.discountPercent ?? null,
    job: line.job
      ? {
          id: line.job.id,
          jobNumber: line.job.jobNumber ?? null,
          scheduledDay: formatInTimeZone(line.job.scheduledDate, timezone, "yyyy-MM-dd"),
          property: line.job.property
            ? { id: null, name: line.job.property.name, suburb: line.job.property.suburb ?? null }
            : null,
        }
      : null,
    propertyId: line.propertyId ?? null,
    property: line.property ? { id: line.propertyId ?? null, name: line.property.name, suburb: line.property.suburb ?? null } : null,
    startedWork: lineStartedWork(line, startedWork),
  };
}

async function readXeroPanel(invoice: LoadedInvoice, row: ClientInvoiceEditorData["row"], contactId: string | null): Promise<EditorXeroPanel> {
  const panel: EditorXeroPanel = {
    state: row.xeroState,
    xeroInvoiceId: row.xeroInvoiceId,
    exportedAt: row.xeroExportedAt,
    contactId,
    salesAccountCode: null,
    salesAccountName: null,
    salesAccountNameReason: null,
    disbursementAccountCode: null,
    hasDisbursementLines: invoice.lines.some((line) => isShoppingDisbursement(line.category)),
    settingsError: null,
  };
  try {
    const settings = await getPhase3IntegrationsSettings();
    // The push uses the default account code, falling back to 200 when blank
    // (shoppingXeroMapping); the panel states the same code.
    panel.salesAccountCode = settings.xero.defaultAccountCode.trim() || "200";
    panel.disbursementAccountCode = settings.xero.disbursementAccountCode?.trim() || null;
  } catch (error) {
    panel.settingsError = failed(error, "Xero settings could not be read.");
  }
  if (panel.salesAccountCode) {
    const named = await xeroAccountName(panel.salesAccountCode);
    panel.salesAccountName = named.name;
    panel.salesAccountNameReason = named.reason;
  }
  return panel;
}

async function readPaymentLink(kind: string): Promise<EditorSendPanel["paymentLink"]> {
  const availability = await paymentLinkAvailability(kind);
  return availability.available ? { available: true, reason: null } : { available: false, reason: availability.reason };
}

async function readSendPanel(invoice: LoadedInvoice): Promise<EditorSendPanel> {
  try {
    const recipients = await resolveClientDeliveryRecipients({
      clientId: invoice.clientId,
      fallbackEmail: invoice.client.email ?? null,
      kind: "invoice",
    });
    return { defaultRecipients: recipients, recipientsError: null, paymentLink: await readPaymentLink(invoice.kind) };
  } catch (error) {
    return {
      defaultRecipients: [],
      recipientsError: failed(error, "The client's invoice recipients could not be read."),
      paymentLink: await readPaymentLink(invoice.kind),
    };
  }
}

export async function loadClientInvoiceEditor(
  id: string,
  options: { canManage: boolean; now?: Date },
): Promise<ClientInvoiceEditorData | null> {
  const [invoice, listed] = await Promise.all([getClientInvoice(id), getClientInvoiceListRow(id, options.now)]);
  if (!invoice || !listed) return null;
  const { row, timezone, paymentTermsDays } = listed;
  const startedWork = readStartedWork(invoice);

  const [client, properties, checks, history, send, draft] = await Promise.all([
    db.client.findUnique({ where: { id: invoice.clientId }, select: { xeroContactId: true } }),
    db.property.findMany({
      where: { clientId: invoice.clientId },
      select: { id: true, name: true, suburb: true },
      orderBy: { name: "asc" },
    }),
    clientInvoiceApprovalChecks(invoice),
    clientInvoiceHistory(invoice),
    readSendPanel(invoice),
    invoice.status === "DRAFT" ? loadDraftPanel(invoice, { timezone, editable: invoiceEditLock(invoice, options.canManage).editable }) : null,
  ]);
  const xero = await readXeroPanel(invoice, row, client?.xeroContactId ?? null);

  return {
    row,
    timezone,
    paymentTermsDays,
    updatedAt: invoice.updatedAt.toISOString(),
    subtotal: Number(invoice.subtotal),
    gstAmount: Number(invoice.gstAmount),
    totalAmount: Number(invoice.totalAmount),
    gstEnabled: invoice.gstEnabled !== false,
    totalsMismatch: invoice.totalsMismatch,
    clientNote: invoice.clientNote ?? null,
    startedWorkUnreadable: readStartedWorkReviewSafely(invoice.metadata).error,
    lines: invoice.lines.map((line) => toEditorLine(line, timezone, startedWork)),
    clientProperties: properties.map((property) => ({ id: property.id, name: property.name, suburb: property.suburb ?? null })),
    editLock: invoiceEditLock(invoice, options.canManage),
    canManage: options.canManage,
    checks,
    send,
    xero,
    history,
    startedWork,
    draft,
  };
}
