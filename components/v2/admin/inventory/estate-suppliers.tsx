"use client";

/**
 * ESTATE suppliers — v2-native replacement for the v1 SuppliersWorkspace.
 * The list reads stock suppliers AND laundry partners together:
 *   GET    /api/admin/inventory/suppliers/directory → { rows, laundryUsers, danglingLinks }
 * Laundry partners show as type "Laundry partner" with contact, turnaround,
 * their portal team and a link to their runs; "Add laundry partner" / Edit
 * partner use the laundry supplier endpoints (./laundry-partner-editor.tsx),
 * which also link a partner to the stock supplier record of the same business.
 * Stock supplier endpoints, unchanged:
 *   POST   /api/admin/inventory/suppliers          { name, email?, phone?, website?, defaultLeadDays, categories[], notes? }
 *   PATCH  /api/admin/inventory/suppliers/[id]     { ...full supplier }
 *   DELETE /api/admin/inventory/suppliers/[id]
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Globe, Mail, Pencil, Phone, Plus, Shirt } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  EModal,
  ETableShell,
  ETextarea,
} from "@/components/v2/admin/estate-kit";
import { SUPPLIER_KIND_LABELS, laundryRunsHref, type SupplierDirectoryResponse, type SupplierDirectoryRow } from "@/lib/suppliers/directory-types";
import { LaundryPartnerEditor, type PartnerEditorTarget } from "./laundry-partner-editor";

type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  defaultLeadDays: number;
  categories: string[];
  notes: string | null;
  isActive: boolean;
};

type Draft = {
  name: string;
  email: string;
  phone: string;
  website: string;
  defaultLeadDays: string;
  categories: string;
  notes: string;
  isActive: boolean;
};

const EMPTY: Draft = {
  name: "",
  email: "",
  phone: "",
  website: "",
  defaultLeadDays: "0",
  categories: "",
  notes: "",
  isActive: true,
};

type LoadState = { status: "loading" } | { status: "failed"; message: string } | { status: "ready" };

function turnaroundLabel(hours: number | null): string {
  return hours == null ? "Turnaround not recorded" : `Turnaround ${hours} h`;
}

export function EstateSuppliers() {
  const [directory, setDirectory] = useState<SupplierDirectoryResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [partnerTarget, setPartnerTarget] = useState<PartnerEditorTarget | null>(null);
  const loadRef = useRef<AbortController | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteFor, setDeleteFor] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    setLoadState((current) => (current.status === "ready" ? current : { status: "loading" }));
    try {
      const res = await fetch("/api/admin/inventory/suppliers/directory", { cache: "no-store", signal: controller.signal });
      const body = (await res.json().catch(() => null)) as (SupplierDirectoryResponse & { error?: string }) | null;
      if (controller.signal.aborted) return;
      if (!res.ok || !body || !Array.isArray(body.rows)) {
        setLoadState({ status: "failed", message: body?.error ?? `Could not load suppliers (${res.status}).` });
        return;
      }
      setDirectory(body);
      setLoadState({ status: "ready" });
    } catch {
      if (!controller.signal.aborted) setLoadState({ status: "failed", message: "Could not reach the server." });
    }
  }, []);

  useEffect(() => {
    void load();
    return () => loadRef.current?.abort();
  }, [load]);

  const rows: SupplierDirectoryRow[] = directory?.rows ?? [];
  const stockSuppliers = useMemo(() => rows.flatMap((row) => (row.stock ? [row.stock] : [])), [rows]);
  const linkedStock = useMemo(() => new Map(rows.flatMap((row) => (row.stock && row.laundry ? [[row.stock.id, row.laundry.name] as [string, string]] : []))), [rows]);
  const partnerNames = useMemo(() => new Map(rows.flatMap((row) => (row.laundry ? [[row.laundry.id, row.laundry.name] as [string, string]] : []))), [rows]);

  function openCreate() {
    setDraft(EMPTY);
    setCreating(true);
  }
  function openEdit(s: Supplier) {
    setEditing(s);
    setDraft({
      name: s.name,
      email: s.email ?? "",
      phone: s.phone ?? "",
      website: s.website ?? "",
      defaultLeadDays: String(s.defaultLeadDays ?? 0),
      categories: s.categories.join(", "),
      notes: s.notes ?? "",
      isActive: s.isActive,
    });
  }

  async function saveDraft() {
    if (!draft.name.trim()) {
      toast({ title: "Supplier name is required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const categories = draft.categories
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    try {
      if (editing) {
        const res = await fetch(`/api/admin/inventory/suppliers/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...editing,
            name: draft.name.trim(),
            email: draft.email.trim() || null,
            phone: draft.phone.trim() || null,
            website: draft.website.trim() || null,
            defaultLeadDays: Number(draft.defaultLeadDays || 0),
            categories,
            notes: draft.notes.trim() || null,
            isActive: draft.isActive,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({ title: "Save failed", description: body.error, variant: "destructive" });
          return;
        }
        toast({ title: "Supplier updated" });
        setEditing(null);
      } else {
        const res = await fetch("/api/admin/inventory/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name.trim(),
            email: draft.email.trim() || null,
            phone: draft.phone.trim() || null,
            website: draft.website.trim() || null,
            defaultLeadDays: Number(draft.defaultLeadDays || 0),
            categories,
            notes: draft.notes.trim() || null,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({ title: "Create failed", description: body.error, variant: "destructive" });
          return;
        }
        toast({ title: "Supplier added" });
        setCreating(false);
      }
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/inventory/suppliers/${deleteFor.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Delete failed", description: body.error, variant: "destructive" });
        return;
      }
      toast({ title: "Supplier deleted" });
      setDeleteFor(null);
      await load();
    } finally {
      setDeleting(false);
    }
  }

  const modalOpen = creating || Boolean(editing);
  function closeModal() {
    setCreating(false);
    setEditing(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Stock suppliers and laundry partners: contacts, purchasing defaults and turnaround.
        </p>
        <div className="flex flex-wrap gap-2">
          <EButton size="sm" variant="outline" onClick={() => setPartnerTarget({ mode: "create" })}>
            <Shirt className="h-3.5 w-3.5" /> Add laundry partner
          </EButton>
          <EButton size="sm" variant="gold" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> Add supplier
          </EButton>
        </div>
      </div>
      {directory?.danglingLinks.length ? (
        <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-warning,var(--e-danger)))]">
          {directory.danglingLinks.length} laundry partner link{directory.danglingLinks.length === 1 ? " points" : "s point"} to a stock supplier that no longer exists. Edit the partner to relink it.
        </p>
      ) : null}

      <ECard className="overflow-hidden p-0">
        {loadState.status === "loading" && !directory ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : loadState.status === "failed" && !directory ? (
          <div className="space-y-3 py-12 text-center text-[0.875rem]">
            <p role="alert" className="text-[hsl(var(--e-danger))]">{loadState.message}</p>
            <EButton size="sm" variant="outline" onClick={() => void load()}>Retry</EButton>
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No suppliers configured.
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Supplier" },
              { label: "Contact" },
              { label: "Details" },
              { label: "", align: "right" },
            ]}
          >
            {rows.map((row) => <SupplierRow key={row.key} row={row} onEditStock={openEdit} onDeleteStock={setDeleteFor} onEditPartner={(partner) => setPartnerTarget({ mode: "edit", partner })} />)}
          </ETableShell>
        )}
      </ECard>

      <EModal
        open={modalOpen}
        onClose={closeModal}
        eyebrow="Suppliers"
        title={editing ? `Edit — ${editing.name}` : "Add supplier"}
        wide
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Name">
              <EInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </EField>
            <EField label="Email">
              <EInput
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </EField>
            <EField label="Phone">
              <EInput value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </EField>
            <EField label="Website">
              <EInput
                value={draft.website}
                onChange={(e) => setDraft({ ...draft, website: e.target.value })}
              />
            </EField>
            <EField label="Default lead days">
              <EInput
                type="number"
                min={0}
                max={60}
                value={draft.defaultLeadDays}
                onChange={(e) => setDraft({ ...draft, defaultLeadDays: e.target.value })}
              />
            </EField>
            <EField label="Categories" hint="Comma separated">
              <EInput
                value={draft.categories}
                onChange={(e) => setDraft({ ...draft, categories: e.target.value })}
              />
            </EField>
          </div>
          <EField label="Notes">
            <ETextarea
              rows={3}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </EField>
          {editing ? (
            <label className="inline-flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              />
              Active
            </label>
          ) : null}
          <EButton className="w-full" variant="gold" onClick={saveDraft} disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add supplier"}
          </EButton>
        </div>
      </EModal>

      <LaundryPartnerEditor
        target={partnerTarget}
        stockSuppliers={stockSuppliers}
        linkedStock={linkedStock}
        laundryUsers={directory?.laundryUsers ?? []}
        partnerNames={partnerNames}
        onClose={() => setPartnerTarget(null)}
        onSaved={() => {
          toast({ title: "Laundry partner saved" });
          setPartnerTarget(null);
          void load();
        }}
      />

      <EConfirmModal
        open={Boolean(deleteFor)}
        onClose={() => setDeleteFor(null)}
        title={`Delete ${deleteFor?.name ?? "supplier"}?`}
        description="This removes the supplier from the inventory catalog. A linked laundry partner stays, with its runs and team; only the link is removed."
        confirmLabel="Delete supplier"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function ContactLines({ email, phone, website, address }: { email: string | null; phone: string | null; website?: string | null; address?: string | null }) {
  if (!email && !phone && !website && !address) return <>—</>;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {email ? <span className="inline-flex min-w-0 items-center gap-1 break-all"><Mail className="h-3 w-3 shrink-0" /> {email}</span> : null}
      {phone ? <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3 shrink-0" /> {phone}</span> : null}
      {website ? <span className="inline-flex min-w-0 items-center gap-1 break-all"><Globe className="h-3 w-3 shrink-0" /> {website}</span> : null}
      {address ? <span className="break-words">{address}</span> : null}
    </div>
  );
}

type RowProps = {
  row: SupplierDirectoryRow;
  onEditStock: (supplier: Supplier) => void;
  onDeleteStock: (supplier: Supplier) => void;
  onEditPartner: (partner: NonNullable<SupplierDirectoryRow["laundry"]>) => void;
};

function SupplierRow({ row, onEditStock, onDeleteStock, onEditPartner }: RowProps) {
  const stock = row.stock;
  const partner = row.laundry;
  const active = (stock?.isActive ?? true) && (partner?.isActive ?? true);
  const muted = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";
  return (
    <tr className={active ? "" : "opacity-60"}>
      <td className="px-4 py-3 align-top">
        <span className="font-[550] text-[hsl(var(--e-foreground))]">{row.name}</span>
        <div className="mt-1 flex flex-wrap gap-1">
          <EBadge tone={row.kind === "STOCK" ? "neutral" : "info"} soft>{SUPPLIER_KIND_LABELS[row.kind]}</EBadge>
          {active ? null : <EBadge tone="neutral" soft>Inactive</EBadge>}
        </div>
        {partner && stock && partner.name !== stock.name ? <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Laundry partner record: {partner.name}</p> : null}
      </td>
      <td className={`px-4 py-3 align-top ${muted}`}>
        {stock ? <ContactLines email={stock.email} phone={stock.phone} website={stock.website} /> : null}
        {partner && (!stock || partner.email !== stock.email || partner.phone !== stock.phone) ? (
          <div className={stock ? "mt-2" : ""}>
            {stock ? <p className="text-[0.6875rem] font-[600]">Laundry contact</p> : null}
            <ContactLines email={partner.email} phone={partner.phone} address={partner.address} />
          </div>
        ) : null}
      </td>
      <td className={`px-4 py-3 align-top ${muted}`}>
        {stock ? (
          <div className="flex flex-wrap items-center gap-1">
            {stock.categories.map((category) => <EBadge key={category} tone="neutral" soft>{category}</EBadge>)}
            <span>Lead {stock.defaultLeadDays}d</span>
          </div>
        ) : null}
        {partner ? (
          <div className={stock ? "mt-1.5 space-y-0.5" : "space-y-0.5"}>
            <p>{turnaroundLabel(partner.avgTurnaround)}{partner.pricePerKg != null ? ` · $${partner.pricePerKg.toFixed(2)}/kg` : ""}</p>
            <p>
              {partner.team.length
                ? `Team: ${partner.team.map((member) => `${member.name?.trim() || member.email}${member.isActive ? "" : " (disabled)"}`).join(", ")}`
                : "No laundry portal users linked"}
            </p>
            <Link href={laundryRunsHref(partner.id)} className="text-[hsl(var(--e-primary))] hover:underline">
              Laundry runs ({partner.runCount})
            </Link>
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {stock ? (
            <EButton size="sm" variant="outline" onClick={() => onEditStock(stock)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </EButton>
          ) : null}
          {partner ? (
            <EButton size="sm" variant="outline" onClick={() => onEditPartner(partner)}>
              <Pencil className="h-3.5 w-3.5" /> {stock ? "Edit partner" : "Edit"}
            </EButton>
          ) : null}
          {stock ? (
            <EButton size="sm" variant="ghost" className="text-[hsl(var(--e-danger))]" onClick={() => onDeleteStock(stock)}>
              Delete
            </EButton>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
