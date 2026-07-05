"use client";

/**
 * ESTATE suppliers — v2-native replacement for the v1 SuppliersWorkspace.
 * Same endpoints:
 *   GET    /api/admin/inventory/suppliers          → Supplier[]
 *   POST   /api/admin/inventory/suppliers          { name, email?, phone?, website?, defaultLeadDays, categories[], notes? }
 *   PATCH  /api/admin/inventory/suppliers/[id]     { ...full supplier }
 *   DELETE /api/admin/inventory/suppliers/[id]
 */
import { useEffect, useState } from "react";
import { Globe, Mail, Pencil, Phone, Plus } from "lucide-react";
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

export function EstateSuppliers() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteFor, setDeleteFor] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/inventory/suppliers");
      const body = await res.json().catch(() => []);
      setRows(Array.isArray(body) ? body : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

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
          Supplier contacts and purchasing defaults.
        </p>
        <EButton size="sm" variant="gold" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> Add supplier
        </EButton>
      </div>

      <ECard className="overflow-hidden p-0">
        {loading ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No suppliers configured.
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Supplier" },
              { label: "Contact" },
              { label: "Categories" },
              { label: "Lead", align: "center" },
              { label: "", align: "right" },
            ]}
          >
            {rows.map((s) => (
              <tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
                <td className="px-4 py-3">
                  <span className="font-[550] text-[hsl(var(--e-foreground))]">{s.name}</span>
                  {s.isActive ? null : (
                    <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Inactive</p>
                  )}
                </td>
                <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  <div className="flex flex-col gap-0.5">
                    {s.email ? (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {s.email}
                      </span>
                    ) : null}
                    {s.phone ? (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {s.phone}
                      </span>
                    ) : null}
                    {s.website ? (
                      <span className="inline-flex items-center gap-1">
                        <Globe className="h-3 w-3" /> {s.website}
                      </span>
                    ) : null}
                    {!s.email && !s.phone && !s.website ? "—" : null}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {s.categories.length === 0 ? (
                      <span className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">—</span>
                    ) : (
                      s.categories.map((c) => (
                        <EBadge key={c} tone="neutral" soft>
                          {c}
                        </EBadge>
                      ))
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-center e-tnum text-[hsl(var(--e-muted-foreground))]">
                  {s.defaultLeadDays}d
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <EButton size="sm" variant="outline" onClick={() => openEdit(s)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </EButton>
                    <EButton
                      size="sm"
                      variant="ghost"
                      className="text-[hsl(var(--e-danger))]"
                      onClick={() => setDeleteFor(s)}
                    >
                      Delete
                    </EButton>
                  </div>
                </td>
              </tr>
            ))}
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

      <EConfirmModal
        open={Boolean(deleteFor)}
        onClose={() => setDeleteFor(null)}
        title={`Delete ${deleteFor?.name ?? "supplier"}?`}
        description="This removes the supplier from the inventory catalog."
        confirmLabel="Delete supplier"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
