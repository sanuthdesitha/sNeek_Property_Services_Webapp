"use client";

/**
 * Add or edit a laundry partner from the Suppliers list. Same endpoints as
 * Laundry › Suppliers (POST /api/admin/laundry/suppliers, PATCH …/[id]), plus
 * two links:
 * - "Same business as": the stock supplier record for this business
 *   (`stockSupplierId`; one stock supplier links to one partner);
 * - "Laundry team": the LAUNDRY portal accounts that work for the partner
 *   (`teamUserIds`). They receive "Ask laundry team" requests for its runs.
 * Fields freeze while saving; a failed save keeps the draft and says why.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import type { LaundryPartnerRecord, LaundryUserOption, StockSupplierRecord } from "@/lib/suppliers/directory-types";
import { moveConfirmText, teamMoves } from "@/lib/suppliers/partner-body";

type PartnerDraft = {
  name: string;
  phone: string;
  email: string;
  address: string;
  pricePerKg: string;
  avgTurnaround: string;
  notes: string;
  isActive: boolean;
  stockSupplierId: string;
  teamUserIds: string[];
};

export type PartnerEditorTarget = { mode: "create" } | { mode: "edit"; partner: LaundryPartnerRecord };

type Props = {
  target: PartnerEditorTarget | null;
  stockSuppliers: StockSupplierRecord[];
  /** stock supplier id → name of the partner it is linked to (to show who holds a link). */
  linkedStock: Map<string, string>;
  laundryUsers: LaundryUserOption[];
  partnerNames: Map<string, string>;
  onClose: () => void;
  onSaved: () => void;
};

function draftFor(target: PartnerEditorTarget): PartnerDraft {
  if (target.mode === "create") {
    return { name: "", phone: "", email: "", address: "", pricePerKg: "", avgTurnaround: "", notes: "", isActive: true, stockSupplierId: "", teamUserIds: [] };
  }
  const partner = target.partner;
  return {
    name: partner.name,
    phone: partner.phone ?? "",
    email: partner.email ?? "",
    address: partner.address ?? "",
    pricePerKg: partner.pricePerKg == null ? "" : String(partner.pricePerKg),
    avgTurnaround: partner.avgTurnaround == null ? "" : String(partner.avgTurnaround),
    notes: partner.notes ?? "",
    isActive: partner.isActive,
    stockSupplierId: partner.stockSupplierId ?? "",
    teamUserIds: partner.team.map((member) => member.id),
  };
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function LaundryPartnerEditor({ target, stockSuppliers, linkedStock, laundryUsers, partnerNames, onClose, onSaved }: Props) {
  const [draft, setDraft] = React.useState<PartnerDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // The moves the person confirmed (by user ids); any other change asks again.
  const [confirmedMoves, setConfirmedMoves] = React.useState<string | null>(null);
  const [pendingMoves, setPendingMoves] = React.useState<{ key: string; text: string } | null>(null);
  const partnerId = target?.mode === "edit" ? target.partner.id : null;

  // A different partner (or a new one) starts from its own record.
  React.useEffect(() => {
    setDraft(target ? draftFor(target) : null);
    setError(null);
    setConfirmedMoves(null);
  }, [target]);

  if (!target || !draft) return null;
  const current = draft;

  function patch(next: Partial<PartnerDraft>) {
    setDraft((value) => (value ? { ...value, ...next } : value));
  }

  function toggleMember(id: string, on: boolean) {
    patch({ teamUserIds: on ? Array.from(new Set([...current.teamUserIds, id])) : current.teamUserIds.filter((value) => value !== id) });
  }

  async function save() {
    if (!current.name.trim()) {
      setError("The partner's name is required.");
      return;
    }
    const turnaround = optionalNumber(current.avgTurnaround);
    if (turnaround !== null && (!Number.isInteger(turnaround) || turnaround < 0)) {
      setError("Turnaround is whole hours.");
      return;
    }
    const moves = teamMoves(current.teamUserIds, partnerId, laundryUsers, partnerNames);
    const movesKey = moves.map((move) => move.userId).sort().join(",");
    if (moves.length && confirmedMoves !== movesKey) {
      setError(null);
      setConfirmedMoves(null);
      setPendingMoves({ key: movesKey, text: moveConfirmText(moves, current.name.trim()) });
      return;
    }
    setPendingMoves(null);
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: current.name.trim(),
        phone: current.phone.trim() || null,
        email: current.email.trim() || null,
        address: current.address.trim() || null,
        pricePerKg: optionalNumber(current.pricePerKg),
        avgTurnaround: turnaround,
        reliabilityScore: target?.mode === "edit" ? target.partner.reliabilityScore : null,
        notes: current.notes.trim() || null,
        isActive: current.isActive,
        stockSupplierId: current.stockSupplierId || null,
        teamUserIds: current.teamUserIds,
      };
      const response = await fetch(partnerId ? `/api/admin/laundry/suppliers/${partnerId}` : "/api/admin/laundry/suppliers", {
        method: partnerId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(result?.error ?? `Could not save (${response.status}).`);
        return;
      }
      onSaved();
    } catch {
      setError("Could not reach the server. Your changes are kept; try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <EModal open onClose={saving ? () => undefined : onClose} eyebrow="Suppliers" title={partnerId ? `Edit laundry partner: ${draft.name || "Partner"}` : "Add laundry partner"} wide>
      <fieldset disabled={saving} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <EField label="Name">
            <EInput value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
          </EField>
          <EField label="Email" hint="Used by Chase supplier.">
            <EInput type="email" value={draft.email} onChange={(event) => patch({ email: event.target.value })} />
          </EField>
          <EField label="Phone">
            <EInput value={draft.phone} onChange={(event) => patch({ phone: event.target.value })} />
          </EField>
          <EField label="Address">
            <EInput value={draft.address} onChange={(event) => patch({ address: event.target.value })} />
          </EField>
          <EField label="Turnaround (hours)" hint="Leave empty when not agreed.">
            <EInput type="number" min={0} step={1} value={draft.avgTurnaround} onChange={(event) => patch({ avgTurnaround: event.target.value })} />
          </EField>
          <EField label="Price per kg (AUD)">
            <EInput type="number" min={0} step="0.01" value={draft.pricePerKg} onChange={(event) => patch({ pricePerKg: event.target.value })} />
          </EField>
        </div>
        <EField label="Same business as" hint="Link the stock supplier record when this partner also supplies stock.">
          <ESelect value={draft.stockSupplierId} onChange={(event) => patch({ stockSupplierId: event.target.value })}>
            <option value="">Not linked</option>
            {stockSuppliers.map((supplier) => {
              const holder = linkedStock.get(supplier.id);
              const ownLink = target.mode === "edit" && target.partner.stockSupplierId === supplier.id;
              const taken = Boolean(holder) && supplier.id !== current.stockSupplierId && !ownLink;
              return (
                <option key={supplier.id} value={supplier.id} disabled={taken}>
                  {supplier.name}{taken ? ` (linked to ${holder})` : ""}
                </option>
              );
            })}
          </ESelect>
        </EField>
        <div className="space-y-1.5">
          <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Laundry team (portal accounts)</p>
          {laundryUsers.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No laundry portal accounts exist yet. Invite one from People, then link it here.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
              {laundryUsers.map((user) => {
                const elsewhere = user.laundrySupplierId && user.laundrySupplierId !== partnerId ? partnerNames.get(user.laundrySupplierId) ?? "another partner" : null;
                const checked = draft.teamUserIds.includes(user.id);
                return (
                  <li key={user.id}>
                    <label className="flex min-w-0 items-start gap-2 text-[0.8125rem]">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={checked} onChange={(event) => toggleMember(user.id, event.target.checked)} />
                      <span className="min-w-0 break-words">
                        {user.name?.trim() || user.email}
                        <span className="text-[hsl(var(--e-muted-foreground))]"> · {user.email}{user.isActive ? "" : " · disabled"}{elsewhere && checked ? ` · moves from ${elsewhere}` : elsewhere ? ` · on ${elsewhere}` : ""}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <EField label="Notes">
          <ETextarea rows={3} value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} />
        </EField>
        <label className="inline-flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          <input type="checkbox" checked={draft.isActive} onChange={(event) => patch({ isActive: event.target.checked })} />
          Active
        </label>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        {pendingMoves ? (
          <div role="alert" className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning,var(--e-danger))/0.5)] p-3 text-[0.8125rem]">
            <p>{pendingMoves.text}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <EButton size="sm" variant="outline" onClick={() => setPendingMoves(null)}>Keep them where they are</EButton>
              <EButton size="sm" onClick={() => { setConfirmedMoves(pendingMoves.key); setPendingMoves(null); }}>Move and continue</EButton>
            </div>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <EButton variant="outline" onClick={onClose}>Cancel</EButton>
          <EButton variant="gold" onClick={() => void save()}>{saving ? "Saving…" : confirmedMoves ? "Save with the move" : partnerId ? "Save partner" : "Add laundry partner"}</EButton>
        </div>
      </fieldset>
    </EModal>
  );
}
