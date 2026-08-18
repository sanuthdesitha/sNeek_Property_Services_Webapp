"use client";

/**
 * ESTATE client invoices — v2-native replacement for the v1 ClientInvoicesPage.
 * Same endpoints, new Estate UI (ETableShell + EModal). Native line-item editing
 * (add / edit / remove lines) is done in an Estate EModal against the same
 * invoice PATCH endpoint; the daily flow (list, filter, view PDF, send,
 * approve/void/mark-paid, Xero push, generate a new draft) lives here too.
 *
 * Endpoints (unchanged from v1):
 *   GET   /api/admin/invoices                       → { clients, properties, rates, invoices }
 *   GET   /api/admin/invoices/[id]                  → full invoice (with lines[])
 *   POST  /api/admin/invoices/generate              { clientId, propertyId?, periodStart?, periodEnd?, gstEnabled }
 *   PATCH /api/admin/invoices/[id]                  { status } | { updateLines[] } | { addLine } | { removeLineId } | { reorderLineIds[] }
 *   POST  /api/admin/invoices/[id]/send             { to? }
 *   POST  /api/admin/invoices/[id]/xero-push
 *   GET   /api/admin/invoices/[id]/pdf              (view / download)
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BadgeCheck,
  Building2,
  Check,
  FileText,
  GripVertical,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  EModal,
  ESelect,
  ESwitch,
  ETableShell,
  ETextarea,
} from "@/components/v2/admin/estate-kit";

type InvoiceStatus = "DRAFT" | "APPROVED" | "SENT" | "PART_PAID" | "PAID" | "VOID";

type Invoice = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  totalAmount: number;
  periodStart: string | null;
  periodEnd: string | null;
  sentAt: string | null;
  paidAt: string | null;
  paidAmount?: number | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paidDate?: string | null;
  createdAt: string;
  xeroExportedAt?: string | null;
  client: { id: string; name: string; email: string };
};

type PaymentLedgerEntry = {
  amount: number;
  method: string;
  reference: string | null;
  paidDate: string;
  recordedAt: string;
  recordedById?: string;
  recordedByName?: string;
};

const PAY_METHODS = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CARD", label: "Card" },
  { value: "CASH", label: "Cash" },
  { value: "STRIPE", label: "Stripe" },
  { value: "OTHER", label: "Other" },
];
const PAY_METHOD_LABEL: Record<string, string> = {
  ...Object.fromEntries(PAY_METHODS.map((m) => [m.value, m.label])),
  // One-click "Mark as paid" — not offered in the record-payment dropdown,
  // but shown in the ledger/receipt for payments recorded that way.
  MANUAL: "Marked as paid",
};

/** Statuses on which a payment can be recorded / the invoice marked paid. */
const PAYABLE_STATUSES: InvoiceStatus[] = ["DRAFT", "APPROVED", "SENT", "PART_PAID"];

const outstandingOf = (inv: { totalAmount?: number | null; paidAmount?: number | null }) =>
  Math.max(0, Number(inv.totalAmount ?? 0) - Number(inv.paidAmount ?? 0));

type Client = { id: string; name: string; email: string };
type Property = { id: string; name: string; suburb: string; clientId: string };

type LineProperty = { id: string; name: string; suburb: string };
type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  category: string;
  /** Job-backed lines carry their property through the job. */
  job?: { id: string; jobNumber: string | null; scheduledDate: string; property: LineProperty | null } | null;
  /** Manual lines only — a grouping hint the admin sets by hand. */
  property?: LineProperty | null;
};

/**
 * Which property a line groups under.
 *
 * The job wins when there is one: that is where the work actually happened, and
 * the API refuses to let a hand-set hint override it. A manual line uses its
 * own hint, and anything with neither sinks into a single trailing bucket —
 * which is exactly the pile "Group by property" exists to break up.
 */
const OTHER_CHARGES = "Other charges";
function linePropertyLabel(line: InvoiceLine): string {
  return line.job?.property?.name ?? line.property?.name ?? OTHER_CHARGES;
}
type FullInvoice = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  gstEnabled?: boolean;
  lines: InvoiceLine[];
  paidAmount?: number | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  paidDate?: string | null;
  paidAt?: string | null;
  metadata?: { payments?: PaymentLedgerEntry[] } | null;
};

const STATUS_TONE: Record<InvoiceStatus, "warning" | "info" | "primary" | "success" | "neutral" | "gold"> = {
  DRAFT: "warning",
  APPROVED: "info",
  SENT: "primary",
  PART_PAID: "gold",
  PAID: "success",
  VOID: "neutral",
};
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  SENT: "Sent",
  PART_PAID: "Part paid",
  PAID: "Paid",
  VOID: "Void",
};

const money = (v: number | null | undefined) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(v ?? 0));
function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return format(new Date(v), "dd MMM yyyy");
  } catch {
    return v;
  }
}

export function EstateInvoices() {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("active");
  const [searchQ, setSearchQ] = useState("");

  // Generate modal
  const [showGenerate, setShowGenerate] = useState(false);
  const [genClientId, setGenClientId] = useState("");
  const [genPropertyId, setGenPropertyId] = useState("");
  const [genPeriodStart, setGenPeriodStart] = useState("");
  const [genPeriodEnd, setGenPeriodEnd] = useState("");
  const [genGstEnabled, setGenGstEnabled] = useState(true);
  // Defaults to the basis that cannot produce an out-of-period line. SERVICE
  // remains available for billing strictly by when work was finished.
  const [genPeriodBasis, setGenPeriodBasis] = useState<"SCHEDULED" | "SERVICE">("SCHEDULED");

  // Send modal
  const [sendFor, setSendFor] = useState<Invoice | null>(null);
  const [sendEmail, setSendEmail] = useState("");
  const [sendReviewed, setSendReviewed] = useState(false);

  // Line-item editor modal
  const [editFor, setEditFor] = useState<Invoice | null>(null);
  const [editInvoice, setEditInvoice] = useState<FullInvoice | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [newLine, setNewLine] = useState({ description: "", quantity: "1", unitPrice: "0" });

  // Delete confirm
  const [deleteFor, setDeleteFor] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Record-payment modal
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("BANK_TRANSFER");
  const [payDate, setPayDate] = useState("");
  const [payRef, setPayRef] = useState("");
  const [paySaving, setPaySaving] = useState(false);

  // One-click mark-as-paid confirm
  const [markPaidFor, setMarkPaidFor] = useState<Invoice | null>(null);
  const [markPaidSaving, setMarkPaidSaving] = useState(false);

  // Payment-record (receipt) viewer
  const [receiptFor, setReceiptFor] = useState<Invoice | null>(null);
  const [receipt, setReceipt] = useState<FullInvoice | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/invoices");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Load failed", variant: "destructive" });
        return;
      }
      setClients(body.clients ?? []);
      setProperties(body.properties ?? []);
      setInvoices(body.invoices ?? []);
      if (!genClientId && body.clients?.[0]) setGenClientId(body.clients[0].id);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    let list = invoices;
    if (statusFilter === "active") list = list.filter((i) => i.status !== "VOID");
    else if (statusFilter !== "all") list = list.filter((i) => i.status === statusFilter);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(
        (i) =>
          i.invoiceNumber.toLowerCase().includes(q) ||
          i.client.name.toLowerCase().includes(q) ||
          i.client.email?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [invoices, statusFilter, searchQ]);

  const visibleProperties = useMemo(
    () => properties.filter((p) => !genClientId || p.clientId === genClientId),
    [properties, genClientId],
  );

  async function patchStatus(inv: Invoice, status: InvoiceStatus, msg: string) {
    setBusy(inv.id);
    try {
      const res = await fetch(`/api/admin/invoices/${inv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: msg });
      await load();
    } finally {
      setBusy(null);
    }
  }

  /* ── Record payment (proper procedure) ─────────────────────────────────── */
  function openPay(inv: Invoice) {
    const outstanding = outstandingOf(inv);
    setPayAmount(outstanding.toFixed(2));
    setPayMethod("BANK_TRANSFER");
    setPayDate(format(new Date(), "yyyy-MM-dd"));
    setPayRef("");
    setPayFor(inv);
  }

  async function submitPayment() {
    if (!payFor) return;
    const amount = Number(payAmount);
    if (!payAmount.trim() || Number.isNaN(amount) || amount <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    setPaySaving(true);
    try {
      const res = await fetch(`/api/admin/invoices/${payFor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordPayment: {
            amount,
            method: payMethod,
            paidDate: payDate ? `${payDate}T00:00:00.000Z` : undefined,
            reference: payRef.trim() || undefined,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not record payment", description: body.error, variant: "destructive" });
        return;
      }
      toast({
        title: body.status === "PAID" ? "Payment recorded — invoice paid" : "Partial payment recorded",
        description: `${money(amount)} · ${PAY_METHOD_LABEL[payMethod] ?? payMethod}`,
      });
      setPayFor(null);
      await load();
    } finally {
      setPaySaving(false);
    }
  }

  /* ── One-click "Mark as paid" ──────────────────────────────────────────── */
  async function markAsPaid() {
    if (!markPaidFor) return;
    const outstanding = outstandingOf(markPaidFor);
    setMarkPaidSaving(true);
    try {
      // Settle the outstanding balance via the payment-recording procedure —
      // the PATCH route flips the status to PAID once fully settled and appends
      // to the metadata.payments[] ledger. If nothing is outstanding (edge:
      // already fully paid but status never flipped), fall back to the legacy
      // direct status flip.
      const payload =
        outstanding > 0
          ? { recordPayment: { amount: outstanding, method: "MANUAL", reference: "Marked as paid" } }
          : { status: "PAID" };
      const res = await fetch(`/api/admin/invoices/${markPaidFor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not mark as paid", description: body.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Invoice marked as paid",
        description: outstanding > 0 ? `${money(outstanding)} recorded as received.` : undefined,
      });
      setMarkPaidFor(null);
      await load();
    } finally {
      setMarkPaidSaving(false);
    }
  }

  async function openReceipt(inv: Invoice) {
    setReceiptFor(inv);
    setReceipt(null);
    setReceiptLoading(true);
    try {
      const res = await fetch(`/api/admin/invoices/${inv.id}`);
      const body = await res.json().catch(() => ({}));
      if (res.ok) setReceipt(body as FullInvoice);
    } finally {
      setReceiptLoading(false);
    }
  }

  async function deleteInvoice() {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/invoices/${deleteFor.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Delete failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: "Invoice deleted" });
      setDeleteFor(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  async function pushToXero(inv: Invoice) {
    setBusy(inv.id);
    try {
      const res = await fetch(`/api/admin/invoices/${inv.id}/xero-push`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Xero export failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: "Sent to Xero", description: "Created a draft invoice in Xero." });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function generateInvoice() {
    if (!genClientId) {
      toast({ title: "Select a client", variant: "destructive" });
      return;
    }
    setBusy("generate");
    try {
      const res = await fetch("/api/admin/invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: genClientId,
          propertyId: genPropertyId || undefined,
          periodStart: genPeriodStart ? `${genPeriodStart}T00:00:00.000Z` : undefined,
          periodEnd: genPeriodEnd ? `${genPeriodEnd}T23:59:59.999Z` : undefined,
          gstEnabled: genGstEnabled,
          periodBasis: genPeriodBasis,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Generate failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: "Invoice draft created" });
      setShowGenerate(false);
      await load();
    } finally {
      setBusy(null);
    }
  }

  function openSend(inv: Invoice) {
    setSendFor(inv);
    setSendEmail(inv.client.email ?? "");
    setSendReviewed(false);
  }

  async function sendInvoice() {
    if (!sendFor) return;
    setBusy("send");
    try {
      const res = await fetch(`/api/admin/invoices/${sendFor.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sendEmail ? { to: sendEmail } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Send failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: "Invoice sent" });
      setSendFor(null);
      await load();
    } finally {
      setBusy(null);
    }
  }

  /* ── Line-item editor (same invoice PATCH endpoint) ───────────────────── */
  async function openEditor(inv: Invoice) {
    setEditFor(inv);
    setEditInvoice(null);
    setNewLine({ description: "", quantity: "1", unitPrice: "0" });
    setEditLoading(true);
    try {
      const res = await fetch(`/api/admin/invoices/${inv.id}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not load invoice", description: body.error, variant: "destructive" });
        setEditFor(null);
        return;
      }
      setEditInvoice(body as FullInvoice);
    } finally {
      setEditLoading(false);
    }
  }

  async function patchInvoiceLines(body: Record<string, unknown>, msg: string) {
    if (!editFor) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/invoices/${editFor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Update failed", description: data.error, variant: "destructive" });
        return;
      }
      // Re-fetch the full invoice so totals + line ids stay in sync.
      const fresh = await fetch(`/api/admin/invoices/${editFor.id}`);
      if (fresh.ok) setEditInvoice((await fresh.json()) as FullInvoice);
      toast({ title: msg });
      await load();
    } finally {
      setEditSaving(false);
    }
  }

  function updateLineField(id: string, patch: Partial<InvoiceLine>) {
    setEditInvoice((prev) =>
      prev
        ? {
            ...prev,
            lines: prev.lines.map((l) =>
              l.id === id
                ? {
                    ...l,
                    ...patch,
                    lineTotal:
                      Number(patch.quantity ?? l.quantity) * Number(patch.unitPrice ?? l.unitPrice),
                  }
                : l,
            ),
          }
        : prev,
    );
  }

  async function saveLine(line: InvoiceLine) {
    await patchInvoiceLines(
      {
        updateLines: [
          {
            id: line.id,
            description: line.description.trim(),
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
          },
        ],
      },
      "Line updated",
    );
  }

  async function addLine() {
    if (!newLine.description.trim()) {
      toast({ title: "Add a description", variant: "destructive" });
      return;
    }
    await patchInvoiceLines(
      {
        addLine: {
          description: newLine.description.trim(),
          quantity: Number(newLine.quantity) || 1,
          unitPrice: Number(newLine.unitPrice) || 0,
        },
      },
      "Line added",
    );
    setNewLine({ description: "", quantity: "1", unitPrice: "0" });
  }

  async function removeLine(id: string) {
    await patchInvoiceLines({ removeLineId: id }, "Line removed");
  }

  const dndSensors = useSensors(
    // A small distance threshold so clicking into a price field is not read as
    // the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** Persist a whole new order, optimistically. */
  async function persistLineOrder(next: InvoiceLine[]) {
    if (!editInvoice) return;
    setEditInvoice({ ...editInvoice, lines: next });
    await patchInvoiceLines({ reorderLineIds: next.map((l) => l.id) }, "Line order saved");
  }

  function onLineDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!editInvoice || !over || active.id === over.id) return;
    const from = editInvoice.lines.findIndex((l) => l.id === active.id);
    const to = editInvoice.lines.findIndex((l) => l.id === over.id);
    if (from < 0 || to < 0) return;
    void persistLineOrder(arrayMove(editInvoice.lines, from, to));
  }

  /**
   * Cluster lines by property, keeping the existing order inside each cluster.
   *
   * Sorted by label with the unattached bucket forced last, then SAVED - the
   * stored order is what the PDF and the emailed copy render from, so a
   * view-only grouping would look right to the admin and wrong to the client.
   */
  function groupLinesByProperty() {
    if (!editInvoice) return;
    const key = (l: InvoiceLine) => {
      const label = linePropertyLabel(l);
      return label === OTHER_CHARGES ? "￿" : label;
    };
    const next = editInvoice.lines
      .map((line, index) => ({ line, index }))
      .sort((a, b) => key(a.line).localeCompare(key(b.line)) || a.index - b.index)
      .map((x) => x.line);
    void persistLineOrder(next);
  }

  /**
   * Set a status directly, stepping outside the lifecycle graph if needed.
   *
   * forceStatus is only consulted by the API when the normal graph refuses, so
   * sending it here is not a blanket bypass: a legal move stays a legal move,
   * and only a genuine override is recorded in the audit log. The API also
   * insists on ADMIN for the override, so an OPS_MANAGER simply gets a 403
   * rather than a silently ignored click.
   */
  async function overrideStatus(next: InvoiceStatus) {
    if (!editFor || next === editFor.status) return;
    const res = await fetch("/api/admin/invoices/" + editFor.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next, forceStatus: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Could not change status", description: body.error, variant: "destructive" });
      return;
    }
    setEditFor({ ...editFor, status: next });
    toast({ title: "Status set to " + STATUS_LABEL[next] });
    await load();
  }
  /** Set (or clear) a manual line grouping property. */
  async function setLineProperty(line: InvoiceLine, propertyId: string) {
    await patchInvoiceLines(
      { updateLines: [{ id: line.id, propertyId: propertyId || null }] },
      propertyId ? "Line grouped" : "Grouping cleared",
    );
  }


  const FILTERS = [
    { key: "active", label: "Active" },
    { key: "DRAFT", label: "Draft" },
    { key: "APPROVED", label: "Approved" },
    { key: "SENT", label: "Sent" },
    { key: "PART_PAID", label: "Part paid" },
    { key: "PAID", label: "Paid" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={
                "rounded-[var(--e-radius-pill)] border px-2.5 py-0.5 text-[0.75rem] font-[550] transition-colors " +
                (statusFilter === f.key
                  ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                  : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
            <EInput
              className="h-9 w-56 pl-9"
              placeholder="Search client or invoice #…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
          </div>
          <EButton size="sm" variant="ghost" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </EButton>
          <EButton size="sm" variant="gold" onClick={() => setShowGenerate(true)}>
            <Plus className="h-3.5 w-3.5" /> Generate invoice
          </EButton>
        </div>
      </div>

      <ECard className="overflow-hidden p-0">
        {loading ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No invoices found.
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Invoice" },
              { label: "Client" },
              { label: "Period" },
              { label: "Amount", align: "right" },
              { label: "Status", align: "center" },
              { label: "", align: "right" },
            ]}
          >
            {filtered.map((inv) => (
              <tr key={inv.id} className="hover:bg-[hsl(var(--e-surface-raised))]">
                <td className="px-4 py-3">
                  <span className="font-[550] text-[hsl(var(--e-foreground))]">{inv.invoiceNumber}</span>
                  <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{fmtDate(inv.createdAt)}</p>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[hsl(var(--e-foreground))]">{inv.client.name}</span>
                  <p className="max-w-[14rem] truncate text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                    {inv.client.email}
                  </p>
                </td>
                <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  {inv.periodStart && inv.periodEnd
                    ? `${fmtDate(inv.periodStart)} – ${fmtDate(inv.periodEnd)}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="e-numeral text-[0.9375rem] text-[hsl(var(--e-foreground))]">
                    {money(inv.totalAmount)}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <EBadge tone={STATUS_TONE[inv.status]} soft>
                    {STATUS_LABEL[inv.status]}
                  </EBadge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {inv.status === "DRAFT" || inv.status === "APPROVED" ? (
                      <EButton size="sm" variant="outline" onClick={() => openEditor(inv)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </EButton>
                    ) : null}
                    <EButton asChild size="sm" variant="outline">
                      <a
                        href={`/api/admin/invoices/${inv.id}/pdf?inline=1`}
                        target="_blank"
                        rel="noreferrer"
                        title="View PDF"
                      >
                        <FileText className="h-3.5 w-3.5" /> PDF
                      </a>
                    </EButton>
                    {inv.status === "DRAFT" ? (
                      <EButton
                        size="sm"
                        variant="outline"
                        disabled={busy === inv.id}
                        onClick={() => patchStatus(inv, "APPROVED", "Invoice approved")}
                      >
                        <Check className="h-3.5 w-3.5" /> Approve
                      </EButton>
                    ) : null}
                    {(inv.status === "DRAFT" || inv.status === "APPROVED") ? (
                      <EButton size="sm" variant="outline-gold" onClick={() => openSend(inv)}>
                        <Send className="h-3.5 w-3.5" /> Send
                      </EButton>
                    ) : null}
                    {PAYABLE_STATUSES.includes(inv.status) ? (
                      <>
                        <EButton
                          size="sm"
                          variant="outline"
                          disabled={busy === inv.id}
                          onClick={() => openPay(inv)}
                          title="Record a payment against this invoice"
                        >
                          <Wallet className="h-3.5 w-3.5" /> Record payment
                        </EButton>
                        <EButton
                          size="sm"
                          variant="outline"
                          disabled={busy === inv.id}
                          onClick={() => setMarkPaidFor(inv)}
                          title="Settle the outstanding balance and mark this invoice paid"
                        >
                          <BadgeCheck className="h-3.5 w-3.5" /> Mark as paid
                        </EButton>
                      </>
                    ) : null}
                    {inv.status === "PAID" || inv.status === "PART_PAID" ? (
                      <EButton
                        size="sm"
                        variant="outline"
                        onClick={() => openReceipt(inv)}
                        title="View the payment record"
                      >
                        <Receipt className="h-3.5 w-3.5" /> Payment
                      </EButton>
                    ) : null}
                    {inv.status !== "VOID" ? (
                      <EButton
                        size="sm"
                        variant="outline"
                        disabled={busy === inv.id}
                        onClick={() => pushToXero(inv)}
                        title="Create/update this invoice as a draft in Xero"
                      >
                        {busy === inv.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Building2 className="h-3.5 w-3.5" />
                        )}
                        {inv.xeroExportedAt ? "Xero ✓" : "Xero"}
                      </EButton>
                    ) : null}
                    {inv.status === "SENT" || inv.status === "APPROVED" ? (
                      <EButton
                        size="sm"
                        variant="ghost"
                        disabled={busy === inv.id}
                        onClick={() => patchStatus(inv, "VOID", "Invoice voided")}
                        title="Void this invoice"
                      >
                        Void
                      </EButton>
                    ) : null}
                    {inv.status === "DRAFT" || inv.status === "VOID" ? (
                      <EButton
                        size="sm"
                        variant="ghost"
                        className="text-[hsl(var(--e-danger))]"
                        disabled={busy === inv.id}
                        onClick={() => setDeleteFor(inv)}
                        title="Delete this invoice"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </EButton>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </ETableShell>
        )}
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Edit line items on any draft or approved invoice with the Edit action above.
      </p>

      {/* Generate modal */}
      <EModal
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        eyebrow="Commercial"
        title="Generate invoice"
      >
        <div className="space-y-4">
          <EField label="Client">
            <ESelect
              value={genClientId}
              onChange={(e) => {
                setGenClientId(e.target.value);
                setGenPropertyId("");
              }}
            >
              <option value="">Select client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </ESelect>
          </EField>
          <EField label="Property" hint="Optional — defaults to all properties for this client.">
            <ESelect value={genPropertyId} onChange={(e) => setGenPropertyId(e.target.value)}>
              <option value="">All properties</option>
              {visibleProperties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.suburb}
                </option>
              ))}
            </ESelect>
          </EField>
          <div className="grid grid-cols-2 gap-3">
            <EField label="Period from">
              <EInput type="date" value={genPeriodStart} onChange={(e) => setGenPeriodStart(e.target.value)} />
            </EField>
            <EField label="Period to">
              <EInput type="date" value={genPeriodEnd} onChange={(e) => setGenPeriodEnd(e.target.value)} />
            </EField>
          </div>
          <EField
            label="Bill jobs by"
            hint="Which date the period above is measured against. Only applies when a period is set."
          >
            <ESelect
              value={genPeriodBasis}
              onChange={(e) => setGenPeriodBasis(e.target.value as "SCHEDULED" | "SERVICE")}
            >
              <option value="SCHEDULED">Scheduled date — matches the date printed on each line</option>
              <option value="SERVICE">Completion date — bills by when work was finished</option>
            </ESelect>
          </EField>
          {genPeriodBasis === "SERVICE" && (genPeriodStart || genPeriodEnd) ? (
            // Said plainly at the point of choosing, because the resulting
            // invoice is the thing that looks wrong: the line prints its
            // SCHEDULED date, so a job finished inside the window but scheduled
            // before it reads as out of period to whoever opens the invoice.
            <p className="text-[0.75rem] text-[hsl(var(--e-warning))]">
              A job scheduled before this period but completed inside it will be included, and its
              line will show that earlier scheduled date.
            </p>
          ) : null}
          <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5">
            <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">Include GST (10%)</span>
            <ESwitch checked={genGstEnabled} onCheckedChange={setGenGstEnabled} />
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Generates lines for all completed jobs with billing rates set. Shopping reimbursements are included
            automatically.
          </p>
          <EButton
            className="w-full"
            variant="gold"
            onClick={generateInvoice}
            disabled={busy === "generate" || !genClientId}
          >
            {busy === "generate" ? "Generating…" : "Generate draft invoice"}
          </EButton>
        </div>
      </EModal>

      {/* Send modal */}
      <EModal
        open={Boolean(sendFor)}
        onClose={() => setSendFor(null)}
        eyebrow="Commercial"
        title={`Send ${sendFor?.invoiceNumber ?? "invoice"}`}
        wide
      >
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            Review the exact PDF the client will receive. Sending emails them immediately and marks the invoice
            as Sent — this can&apos;t be undone.
          </p>
          {sendFor ? (
            <div className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
              <iframe
                title="Invoice preview"
                src={`/api/admin/invoices/${sendFor.id}/pdf?inline=1`}
                className="h-[46vh] w-full"
              />
            </div>
          ) : null}
          <EField label="Send to email" hint="Leave blank to use the client's delivery profile.">
            <EInput
              type="email"
              value={sendEmail}
              onChange={(e) => setSendEmail(e.target.value)}
              placeholder={sendFor?.client.email}
            />
          </EField>
          <ESwitch
            checked={sendReviewed}
            onCheckedChange={setSendReviewed}
            label="I've reviewed the invoice above and confirm it's correct to send."
          />
          <EButton
            className="w-full"
            variant="gold"
            onClick={sendInvoice}
            disabled={busy === "send" || !sendReviewed}
          >
            {busy === "send" ? "Sending…" : "Send invoice to client"}
          </EButton>
        </div>
      </EModal>

      {/* Line-item editor */}
      <EModal
        open={Boolean(editFor)}
        onClose={() => {
          setEditFor(null);
          setEditInvoice(null);
        }}
        eyebrow="Commercial"
        title={`Edit ${editFor?.invoiceNumber ?? "invoice"}`}
        wide
      >
        {editLoading || !editInvoice ? (
          <p className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Loading invoice…
          </p>
        ) : (
          <div className="space-y-5">
            {/* Existing lines */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <EEyebrow>Line items</EEyebrow>
                <EButton
                  size="sm"
                  variant="outline"
                  disabled={editSaving || editInvoice.lines.length < 2}
                  onClick={groupLinesByProperty}
                  title="Cluster lines by property, then fine-tune by dragging"
                >
                  <Layers className="h-3.5 w-3.5" /> Group by property
                </EButton>
              </div>
              {editInvoice.lines.length === 0 ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  No line items yet — add one below.
                </p>
              ) : (
                <>
                  {editInvoice.lines.length > 1 ? (
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      Drag a row by its handle to reorder. Grouping saves immediately, so the PDF
                      and the client’s copy match what you see here.
                    </p>
                  ) : null}
                  <DndContext
                    sensors={dndSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={onLineDragEnd}
                  >
                    <SortableContext
                      items={editInvoice.lines.map((l) => l.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {editInvoice.lines.map((line, index) => {
                          // A heading whenever the property changes, so a grouped
                          // invoice reads as blocks rather than one flat list.
                          const label = linePropertyLabel(line);
                          const previous =
                            index > 0 ? linePropertyLabel(editInvoice.lines[index - 1]) : null;
                          return (
                            <Fragment key={line.id}>
                              {label !== previous ? (
                                <div className="flex items-center gap-1.5 pt-1.5 text-[0.75rem] font-semibold text-[hsl(var(--e-muted-foreground))]">
                                  <Building2 className="h-3 w-3" /> {label}
                                </div>
                              ) : null}
                              <SortableLineRow
                                line={line}
                                disabled={editSaving}
                                clientProperties={properties.filter(
                                  (prop) => prop.clientId === editFor?.client.id,
                                )}
                                onField={(patch) => updateLineField(line.id, patch)}
                                onSave={() => saveLine(line)}
                                onRemove={() => removeLine(line.id)}
                                onProperty={(propertyId) => setLineProperty(line, propertyId)}
                              />
                            </Fragment>
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                </>
              )}
            </div>

            {/* Add line */}
            <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
              <EEyebrow>Add a line</EEyebrow>
              <div className="grid grid-cols-12 items-end gap-2">
                <EField label="Description" className="col-span-5">
                  <EInput
                    className="h-9"
                    value={newLine.description}
                    onChange={(e) => setNewLine({ ...newLine, description: e.target.value })}
                  />
                </EField>
                <EField label="Qty" className="col-span-2">
                  <EInput
                    className="h-9"
                    type="number"
                    step="0.01"
                    value={newLine.quantity}
                    onChange={(e) => setNewLine({ ...newLine, quantity: e.target.value })}
                  />
                </EField>
                <EField label="Unit price" className="col-span-3">
                  <EInput
                    className="h-9"
                    type="number"
                    step="0.01"
                    value={newLine.unitPrice}
                    onChange={(e) => setNewLine({ ...newLine, unitPrice: e.target.value })}
                  />
                </EField>
                <div className="col-span-2">
                  <EButton className="w-full" size="sm" variant="outline" disabled={editSaving} onClick={addLine}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </EButton>
                </div>
              </div>
            </div>

            {/* GST toggle — same PATCH { gstEnabled } as v1 */}
            <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2.5">
              <div>
                <p className="text-[0.875rem] font-[550]">GST (10%)</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Toggle whether GST is added on top of the subtotal.
                </p>
              </div>
              <ESwitch
                checked={editInvoice.gstEnabled !== false}
                onCheckedChange={(v) =>
                  patchInvoiceLines({ gstEnabled: v }, v ? "GST enabled" : "GST disabled")
                }
              />
            </div>

            {/* Advanced */}
            <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
              <EEyebrow>Advanced</EEyebrow>
              <div className="flex flex-wrap items-end gap-2">
                <EField
                  label="Force status"
                  hint="Admin only. Steps outside the normal lifecycle and is recorded in the audit log."
                  className="min-w-[180px] flex-1"
                >
                  <ESelect
                    value={editFor?.status ?? ""}
                    onChange={(e) => overrideStatus(e.target.value as InvoiceStatus)}
                  >
                    {(Object.keys(STATUS_LABEL) as InvoiceStatus[]).map((key) => (
                      <option key={key} value={key}>
                        {STATUS_LABEL[key]}
                      </option>
                    ))}
                  </ESelect>
                </EField>
                <EButton
                  size="sm"
                  variant="outline"
                  disabled={!editFor || busy === editFor.id}
                  onClick={() => editFor && pushToXero(editFor)}
                  title="Create or update this invoice as a draft in Xero"
                >
                  {editFor?.xeroExportedAt ? "Xero ✓" : "Push to Xero"}
                </EButton>
              </div>
            </div>
            {/* Totals */}
            <div className="grid grid-cols-3 gap-3 border-t border-[hsl(var(--e-border))] pt-4">
              <div>
                <EEyebrow>Subtotal</EEyebrow>
                <p className="e-numeral mt-1 text-[1.125rem] leading-none">{money(editInvoice.subtotal)}</p>
              </div>
              <div>
                <EEyebrow>GST</EEyebrow>
                <p className="e-numeral mt-1 text-[1.125rem] leading-none">{money(editInvoice.gstAmount)}</p>
              </div>
              <div>
                <EEyebrow>Total</EEyebrow>
                <p className="e-numeral mt-1 text-[1.125rem] leading-none text-[hsl(var(--e-gold-ink))]">
                  {money(editInvoice.totalAmount)}
                </p>
              </div>
            </div>
            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              Changes save per line (the ✓ button) and update totals immediately. The arrows
              reorder lines — the new order is saved straight away and flows to the PDF.
            </p>
          </div>
        )}
      </EModal>

      {/* Record payment */}
      <EModal
        open={Boolean(payFor)}
        onClose={() => setPayFor(null)}
        eyebrow="Commercial"
        title={`Record payment · ${payFor?.invoiceNumber ?? ""}`}
      >
        {payFor ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
              <div>
                <EEyebrow>Invoice total</EEyebrow>
                <p className="e-numeral mt-1 text-[1rem] leading-none">{money(payFor.totalAmount)}</p>
              </div>
              <div>
                <EEyebrow>Already paid</EEyebrow>
                <p className="e-numeral mt-1 text-[1rem] leading-none">{money(payFor.paidAmount ?? 0)}</p>
              </div>
              <div>
                <EEyebrow>Outstanding</EEyebrow>
                <p className="e-numeral mt-1 text-[1rem] leading-none text-[hsl(var(--e-gold-ink))]">
                  {money(Math.max(0, Number(payFor.totalAmount ?? 0) - Number(payFor.paidAmount ?? 0)))}
                </p>
              </div>
            </div>
            <EField
              label="Amount received"
              hint="Defaults to the outstanding balance. A smaller amount records a partial payment (status stays Part paid)."
            >
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                  $
                </span>
                <EInput
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className="pl-6"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
            </EField>
            <div className="grid grid-cols-2 gap-3">
              <EField label="Payment method">
                <ESelect value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  {PAY_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </ESelect>
              </EField>
              <EField label="Paid date">
                <EInput type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </EField>
            </div>
            <EField label="Reference / notes" hint="e.g. bank reference, receipt number, part-payment note.">
              <ETextarea rows={2} value={payRef} onChange={(e) => setPayRef(e.target.value)} />
            </EField>
            <div className="flex justify-end gap-2 pt-1">
              <EButton variant="ghost" onClick={() => setPayFor(null)} disabled={paySaving}>
                Cancel
              </EButton>
              <EButton variant="gold" onClick={submitPayment} disabled={paySaving}>
                {paySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                Record payment
              </EButton>
            </div>
          </div>
        ) : null}
      </EModal>

      {/* Payment record (receipt) viewer */}
      <EModal
        open={Boolean(receiptFor)}
        onClose={() => {
          setReceiptFor(null);
          setReceipt(null);
        }}
        eyebrow="Commercial"
        title={`Payment record · ${receiptFor?.invoiceNumber ?? ""}`}
        wide
      >
        {receiptLoading || !receipt ? (
          <p className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Loading payment record…
          </p>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <EEyebrow>Status</EEyebrow>
                <div className="mt-1">
                  <EBadge tone={STATUS_TONE[receipt.status]} soft>
                    {STATUS_LABEL[receipt.status]}
                  </EBadge>
                </div>
              </div>
              <div>
                <EEyebrow>Invoice total</EEyebrow>
                <p className="e-numeral mt-1 text-[1rem] leading-none">{money(receipt.totalAmount)}</p>
              </div>
              <div>
                <EEyebrow>Amount paid</EEyebrow>
                <p className="e-numeral mt-1 text-[1rem] leading-none">{money(receipt.paidAmount ?? 0)}</p>
              </div>
              <div>
                <EEyebrow>Outstanding</EEyebrow>
                <p className="e-numeral mt-1 text-[1rem] leading-none">
                  {money(Math.max(0, Number(receipt.totalAmount ?? 0) - Number(receipt.paidAmount ?? 0)))}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <EEyebrow>Payment history</EEyebrow>
              {Array.from(receipt.metadata?.payments ?? []).length === 0 ? (
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  {receipt.paidAt
                    ? `Marked paid on ${fmtDate(receipt.paidAt)}${
                        receipt.paymentMethod ? ` · ${PAY_METHOD_LABEL[receipt.paymentMethod] ?? receipt.paymentMethod}` : ""
                      } — no itemised payment record (legacy one-click paid).`
                    : "No payment record captured yet."}
                </p>
              ) : (
                <ETableShell
                  headers={[
                    { label: "Paid date" },
                    { label: "Method" },
                    { label: "Reference" },
                    { label: "Recorded by" },
                    { label: "Amount", align: "right" },
                  ]}
                >
                  {Array.from(receipt.metadata?.payments ?? []).map((p, i) => (
                    <tr key={i} className="border-t border-[hsl(var(--e-border))]">
                      <td className="px-4 py-2 text-[0.8125rem]">{fmtDate(p.paidDate)}</td>
                      <td className="px-4 py-2 text-[0.8125rem]">{PAY_METHOD_LABEL[p.method] ?? p.method}</td>
                      <td className="px-4 py-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                        {p.reference || "—"}
                      </td>
                      <td className="px-4 py-2 text-[0.8125rem]">
                        {p.recordedByName || "—"}
                        <span className="block text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                          {fmtDate(p.recordedAt)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-[0.8125rem] e-tnum">{money(p.amount)}</td>
                    </tr>
                  ))}
                </ETableShell>
              )}
            </div>
          </div>
        )}
      </EModal>

      {/* Mark as paid confirm */}
      <EConfirmModal
        open={Boolean(markPaidFor)}
        onClose={() => setMarkPaidFor(null)}
        title={`Mark ${markPaidFor?.invoiceNumber ?? "invoice"} as paid?`}
        description={
          markPaidFor ? (
            outstandingOf(markPaidFor) > 0 ? (
              <>
                Records the outstanding{" "}
                <span className="e-tnum font-[550] text-[hsl(var(--e-foreground))]">
                  {money(outstandingOf(markPaidFor))}
                </span>{" "}
                as received and marks the invoice paid. Use Record payment instead for a partial
                amount or to note the method and reference.
              </>
            ) : (
              "Nothing is outstanding on this invoice — it will simply be marked as paid."
            )
          ) : null
        }
        confirmLabel="Mark as paid"
        danger={false}
        loading={markPaidSaving}
        onConfirm={markAsPaid}
      />

      {/* Delete invoice */}
      <EConfirmModal
        open={Boolean(deleteFor)}
        onClose={() => setDeleteFor(null)}
        title={`Delete ${deleteFor?.invoiceNumber ?? "invoice"}?`}
        description="This permanently removes the invoice and its line items."
        confirmLabel="Delete invoice"
        loading={deleting}
        onConfirm={deleteInvoice}
      />
    </div>
  );
}

/**
 * One editable line, draggable by its handle.
 *
 * The handle is deliberately the only drag target: the row is full of number
 * inputs, and making the whole row draggable would fight every attempt to put a
 * cursor in one. The KeyboardSensor keeps the handle operable without a mouse,
 * which is why the old up/down buttons could be retired rather than kept
 * alongside it.
 */
function SortableLineRow({
  line,
  disabled,
  clientProperties,
  onField,
  onSave,
  onRemove,
  onProperty,
}: {
  line: InvoiceLine;
  disabled: boolean;
  clientProperties: Property[];
  onField: (patch: Partial<InvoiceLine>) => void;
  onSave: () => void;
  onRemove: () => void;
  onProperty: (propertyId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: line.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        "rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 " +
        (isDragging ? "opacity-60 shadow-lg" : "")
      }
    >
      <div className="grid grid-cols-12 items-center gap-2">
        <button
          type="button"
          className="col-span-1 flex cursor-grab items-center justify-center text-[hsl(var(--e-muted-foreground))] active:cursor-grabbing"
          aria-label={"Reorder " + line.description}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <EInput
          className="col-span-4 h-9"
          value={line.description}
          placeholder="Description"
          onChange={(e) => onField({ description: e.target.value })}
        />
        <EInput
          className="col-span-2 h-9"
          type="number"
          step="0.01"
          value={line.quantity}
          onChange={(e) => onField({ quantity: Number(e.target.value) })}
          title="Quantity"
        />
        <EInput
          className="col-span-2 h-9"
          type="number"
          step="0.01"
          value={line.unitPrice}
          onChange={(e) => onField({ unitPrice: Number(e.target.value) })}
          title="Unit price"
        />
        <div className="col-span-2 text-right text-[0.8125rem] e-tnum">{money(line.lineTotal)}</div>
        <div className="col-span-1 flex justify-end gap-1">
          <EButton
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={disabled}
            onClick={onSave}
            title="Save this line"
          >
            <Check className="h-4 w-4 text-[hsl(var(--e-success))]" />
          </EButton>
          <EButton
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={disabled}
            onClick={onRemove}
            title="Remove this line"
          >
            <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
          </EButton>
        </div>
      </div>

      {/* Context row: where this charge came from. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-[8.333%] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {line.job ? (
          // Job-backed: state the source. Its property is fixed by the job, so no
          // control is offered here — the API would refuse the change anyway.
          <span>
            #{line.job.jobNumber ?? line.job.id.slice(0, 8)}
            {" · "}
            {format(new Date(line.job.scheduledDate), "dd MMM yyyy")}
            {line.job.property ? " · " + line.job.property.name : ""}
          </span>
        ) : (
          <>
            <span>Manual charge — group under</span>
            <ESelect
              className="h-7 w-auto min-w-[150px] text-[0.75rem]"
              value={line.property?.id ?? ""}
              disabled={disabled}
              onChange={(e) => onProperty(e.target.value)}
            >
              <option value="">Other charges</option>
              {clientProperties.map((prop) => (
                <option key={prop.id} value={prop.id}>
                  {prop.name}
                </option>
              ))}
            </ESelect>
          </>
        )}
      </div>
    </div>
  );
}
