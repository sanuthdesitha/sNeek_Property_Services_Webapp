"use client";

/**
 * ESTATE client invoices — v2-native replacement for the v1 ClientInvoicesPage.
 * Same endpoints, new Estate UI (ETableShell + EModal). Line-item drag editing
 * (a deep power-user flow) is intentionally left to the classic view via an
 * EClassicLink; here we cover the daily flow: list, filter, view PDF, send,
 * approve/void/mark-paid, Xero push, and generate a new draft.
 *
 * Endpoints (unchanged from v1):
 *   GET   /api/admin/invoices                       → { clients, properties, rates, invoices }
 *   GET   /api/admin/invoices/[id]                  → full invoice
 *   POST  /api/admin/invoices/generate              { clientId, propertyId?, periodStart?, periodEnd?, gstEnabled }
 *   PATCH /api/admin/invoices/[id]                  { status }
 *   POST  /api/admin/invoices/[id]/send             { to? }
 *   POST  /api/admin/invoices/[id]/xero-push
 *   GET   /api/admin/invoices/[id]/pdf              (view / download)
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Building2,
  Check,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EClassicLink,
  EField,
  EInput,
  EModal,
  ESelect,
  ESwitch,
  ETableShell,
} from "@/components/v2/admin/estate-kit";

type InvoiceStatus = "DRAFT" | "APPROVED" | "SENT" | "PAID" | "VOID";

type Invoice = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  totalAmount: number;
  periodStart: string | null;
  periodEnd: string | null;
  sentAt: string | null;
  paidAt: string | null;
  createdAt: string;
  xeroExportedAt?: string | null;
  client: { id: string; name: string; email: string };
};

type Client = { id: string; name: string; email: string };
type Property = { id: string; name: string; suburb: string; clientId: string };

const STATUS_TONE: Record<InvoiceStatus, "warning" | "info" | "primary" | "success" | "neutral"> = {
  DRAFT: "warning",
  APPROVED: "info",
  SENT: "primary",
  PAID: "success",
  VOID: "neutral",
};
const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  APPROVED: "Approved",
  SENT: "Sent",
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

  // Send modal
  const [sendFor, setSendFor] = useState<Invoice | null>(null);
  const [sendEmail, setSendEmail] = useState("");
  const [sendReviewed, setSendReviewed] = useState(false);

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

  const FILTERS = [
    { key: "active", label: "Active" },
    { key: "DRAFT", label: "Draft" },
    { key: "APPROVED", label: "Approved" },
    { key: "SENT", label: "Sent" },
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
                    {inv.status === "SENT" ? (
                      <EButton
                        size="sm"
                        variant="outline"
                        disabled={busy === inv.id}
                        onClick={() => patchStatus(inv, "PAID", "Marked as paid")}
                      >
                        <Check className="h-3.5 w-3.5" /> Mark paid
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
                  </div>
                </td>
              </tr>
            ))}
          </ETableShell>
        )}
      </ECard>

      <div className="flex items-center justify-between">
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          Line-item editing, reordering &amp; billing rates live in the classic invoice desk.
        </p>
        <EClassicLink href="/admin/finance?tab=invoices">Open invoice desk</EClassicLink>
      </div>

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
    </div>
  );
}
