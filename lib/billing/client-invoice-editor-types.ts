/**
 * Shapes the invoice editor page reads. Free of server imports so the client
 * components can import them. Every field is read from stored data or from the
 * guards the API enforces; nothing here is a client-side guess.
 */
import type { ClientInvoiceListRow } from "./client-invoice-list-types";
import type { InvoiceEditLock } from "./client-invoice-guards";
import type { StartedWorkReview } from "./started-work-reconciliation";

export type EditorLineProperty = { id: string | null; name: string; suburb: string | null };

export type EditorLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  category: string;
  /** Printed under the line on the PDF. Not editable through the API. */
  note: string | null;
  /** Reviewed shopping allocation: amount and grouping cannot change. */
  shoppingLocked: boolean;
  job: {
    id: string;
    jobNumber: string | null;
    /** The scheduled day in the organisation timezone (yyyy-MM-dd). */
    scheduledDay: string;
    property: EditorLineProperty | null;
  } | null;
  /** Manual grouping hint (manual lines only). */
  propertyId: string | null;
  property: EditorLineProperty | null;
  /** Started-work snapshot flag for this line's job, when there is one. */
  startedWork: "unfinished" | "changed" | null;
};

export type ApprovalCheckKey = "xero-reservation" | "started-work" | "rates" | "other-invoice" | "totals";

/**
 * ok: passes. refused: the approve request would be refused for this reason.
 * check: worth a look, but approval does not refuse it. unknown: could not be
 * checked (never shown as OK).
 */
export type ApprovalCheckState = "ok" | "refused" | "check" | "unknown";

export type ApprovalCheck = {
  key: ApprovalCheckKey;
  state: ApprovalCheckState;
  /** True when the PATCH that approves refuses on this check. */
  enforced: boolean;
  label: string;
  detail: string | null;
};

export type ApprovalChecks = {
  /** "approve" on a draft; null once past approval (advisory checks only). */
  appliesTo: "approve" | null;
  items: ApprovalCheck[];
};

export type HistoryEntry = {
  id: string;
  /** ISO instant. */
  at: string;
  label: string;
  actor: string | null;
  /** audit: an AuditLog row. record: a timestamp stored on the invoice. */
  source: "audit" | "record";
};

export type EditorXeroPanel = {
  state: ClientInvoiceListRow["xeroState"];
  xeroInvoiceId: string | null;
  exportedAt: string | null;
  /** Client.xeroContactId: set by the first successful push. */
  contactId: string | null;
  /** Configured sales account code (Xero settings), or null if unreadable. */
  salesAccountCode: string | null;
  disbursementAccountCode: string | null;
  hasDisbursementLines: boolean;
  settingsError: string | null;
};

export type EditorSendPanel = {
  /** Who a send with a blank "To" goes to (the client's delivery profile). */
  defaultRecipients: string[];
  recipientsError: string | null;
};

export type EditorStartedWork = {
  review: StartedWorkReview;
  inspection: { requiresReview: boolean; changedJobIds: string[]; error?: string } | null;
};

export type ClientInvoiceEditorData = {
  row: ClientInvoiceListRow;
  timezone: string;
  paymentTermsDays: number;
  updatedAt: string;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  gstEnabled: boolean;
  totalsMismatch: boolean;
  lines: EditorLine[];
  clientProperties: Array<{ id: string; name: string; suburb: string | null }>;
  editLock: InvoiceEditLock;
  canManage: boolean;
  checks: ApprovalChecks;
  send: EditorSendPanel;
  xero: EditorXeroPanel;
  history: HistoryEntry[];
  startedWork: EditorStartedWork | null;
};
