"use client";

/**
 * ESTATE laundry suppliers — v2-native replacement for the v1
 * LaundrySuppliersWorkspace (app/admin/laundry/suppliers). Same endpoints:
 *   GET    /api/admin/laundry/suppliers        → Supplier[]
 *   POST   /api/admin/laundry/suppliers        { name, phone?, email?, address?, pricePerKg?, avgTurnaround?, reliabilityScore?, notes?, isActive? }
 *   PATCH  /api/admin/laundry/suppliers/[id]   { ...same shape, name required }
 *   DELETE /api/admin/laundry/suppliers/[id]
 * Estate token scope only; no components/ui/* dependency.
 */
import { useEffect, useState } from "react";
import { Mail, MapPin, Pencil, Phone, Plus, Star } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  EModal,
  ESwitch,
  ETableShell,
  ETextarea,
} from "@/components/v2/admin/estate-kit";

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  pricePerKg: number | null;
  avgTurnaround: number | null;
  reliabilityScore: number | null;
  notes: string | null;
  isActive: boolean;
};

type Draft = {
  name: string;
  phone: string;
  email: string;
  address: string;
  pricePerKg: string;
  avgTurnaround: string;
  reliabilityScore: string;
  notes: string;
  isActive: boolean;
};

const EMPTY: Draft = {
  name: "",
  phone: "",
  email: "",
  address: "",
  pricePerKg: "",
  avgTurnaround: "",
  reliabilityScore: "",
  notes: "",
  isActive: true,
};

export function LaundrySuppliers() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteFor, setDeleteFor] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/laundry/suppliers", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      setRows(Array.isArray(body) ? body : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setDraft(EMPTY);
    setCreating(true);
  }

  function openEdit(supplier: Supplier) {
    setEditing(supplier);
    setDraft({
      name: supplier.name,
      phone: supplier.phone ?? "",
      email: supplier.email ?? "",
      address: supplier.address ?? "",
      pricePerKg: supplier.pricePerKg != null ? String(supplier.pricePerKg) : "",
      avgTurnaround: supplier.avgTurnaround != null ? String(supplier.avgTurnaround) : "",
      reliabilityScore: supplier.reliabilityScore != null ? String(supplier.reliabilityScore) : "",
      notes: supplier.notes ?? "",
      isActive: supplier.isActive,
    });
  }

  function payload() {
    return {
      name: draft.name.trim(),
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      address: draft.address.trim() || null,
      pricePerKg: draft.pricePerKg ? Number(draft.pricePerKg) : null,
      avgTurnaround: draft.avgTurnaround ? Number(draft.avgTurnaround) : null,
      reliabilityScore: draft.reliabilityScore ? Number(draft.reliabilityScore) : null,
      notes: draft.notes.trim() || null,
      isActive: draft.isActive,
    };
  }

  async function saveDraft() {
    if (!draft.name.trim()) {
      toast({ title: "Supplier name is required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = editing
        ? await fetch(`/api/admin/laundry/suppliers/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload()),
          })
        : await fetch("/api/admin/laundry/suppliers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload()),
          });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: editing ? "Save failed" : "Create failed",
          description: body.error ?? "Please retry.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: editing ? "Supplier updated" : "Supplier added" });
      setEditing(null);
      setCreating(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/laundry/suppliers/${deleteFor.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Delete failed", description: body.error ?? "Please retry.", variant: "destructive" });
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
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="e-eyebrow">SUPPLIERS</span>
        <EButton size="sm" variant="gold" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> Add supplier
        </EButton>
      </div>

      <ECard className="overflow-hidden p-0">
        {loading ? (
          <p className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No laundry suppliers configured.
          </p>
        ) : (
          <ETableShell
            headers={[
              { label: "Supplier" },
              { label: "Contact" },
              { label: "Rate", align: "right" },
              { label: "Turnaround", align: "center" },
              { label: "Reliability", align: "center" },
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
                    {s.phone ? (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {s.phone}
                      </span>
                    ) : null}
                    {s.email ? (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {s.email}
                      </span>
                    ) : null}
                    {s.address ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {s.address}
                      </span>
                    ) : null}
                    {!s.phone && !s.email && !s.address ? "—" : null}
                  </div>
                </td>
                <td className="e-tnum px-4 py-3 text-right text-[hsl(var(--e-text-secondary))]">
                  {s.pricePerKg != null ? `$${s.pricePerKg.toFixed(2)}/kg` : "—"}
                </td>
                <td className="e-tnum px-4 py-3 text-center text-[hsl(var(--e-muted-foreground))]">
                  {s.avgTurnaround != null ? `${s.avgTurnaround}h` : "—"}
                </td>
                <td className="px-4 py-3 text-center">
                  {s.reliabilityScore != null ? (
                    <EBadge tone={s.reliabilityScore >= 4 ? "success" : s.reliabilityScore >= 2.5 ? "warning" : "danger"} soft>
                      <Star className="h-2.5 w-2.5" /> {s.reliabilityScore.toFixed(1)}/5
                    </EBadge>
                  ) : (
                    <span className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">—</span>
                  )}
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
        eyebrow="Laundry suppliers"
        title={editing ? `Edit — ${editing.name}` : "Add supplier"}
        wide
      >
        <div className="space-y-4">
          <EField label="Name">
            <EInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Supplier name" />
          </EField>
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Phone">
              <EInput value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="Optional" />
            </EField>
            <EField label="Email">
              <EInput
                type="email"
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                placeholder="Optional"
              />
            </EField>
          </div>
          <EField label="Address">
            <EInput value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Optional" />
          </EField>
          <div className="grid gap-3 sm:grid-cols-3">
            <EField label="Price / kg">
              <EInput
                type="number"
                min={0}
                step="0.01"
                value={draft.pricePerKg}
                onChange={(e) => setDraft({ ...draft, pricePerKg: e.target.value })}
                placeholder="Optional"
              />
            </EField>
            <EField label="Avg turnaround (hrs)">
              <EInput
                type="number"
                min={0}
                step="1"
                value={draft.avgTurnaround}
                onChange={(e) => setDraft({ ...draft, avgTurnaround: e.target.value })}
                placeholder="Optional"
              />
            </EField>
            <EField label="Reliability score" hint="0 – 5">
              <EInput
                type="number"
                min={0}
                max={5}
                step="0.1"
                value={draft.reliabilityScore}
                onChange={(e) => setDraft({ ...draft, reliabilityScore: e.target.value })}
              />
            </EField>
          </div>
          <EField label="Notes">
            <ETextarea
              rows={3}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Service notes, preferred pickup windows, billing notes…"
            />
          </EField>
          {editing ? (
            <ESwitch
              checked={draft.isActive}
              onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
              label="Active supplier"
            />
          ) : null}
          <EButton className="w-full" variant="gold" onClick={() => void saveDraft()} disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add supplier"}
          </EButton>
        </div>
      </EModal>

      <EConfirmModal
        open={Boolean(deleteFor)}
        onClose={() => setDeleteFor(null)}
        title={`Delete ${deleteFor?.name ?? "supplier"}?`}
        description="This permanently removes the supplier. Laundry history stays intact."
        confirmLabel="Delete supplier"
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
