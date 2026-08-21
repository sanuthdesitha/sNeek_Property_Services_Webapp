"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EBadge, EButton, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelectNative, EToggle, ESaveStatus, ESectionHeading, useSaveStatus } from "./estate-form";
import { EConfirmModal, verifyAdminSecurity } from "@/components/v2/admin/estate-kit";

type Gateway = {
  id: string;
  provider: string;
  status: string;
  label: string;
  priority: number;
  feeRate: number;
  fixedFee: number;
  surchargeEnabled: boolean;
  createdAt: string;
};

const PROVIDER_LABELS: Record<string, string> = {
  STRIPE: "Stripe",
  SQUARE: "Square",
  PAYPAL: "PayPal",
};

/**
 * Payment gateways — same CRUD as the v1 page:
 * GET/POST /api/admin/payment-gateways, PATCH/DELETE /api/admin/payment-gateways/[id].
 */
export function GatewaysSection() {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newProvider, setNewProvider] = useState("STRIPE");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  // PIN tier: a gateway is how money reaches the business. Deleting one stops
  // card payments arriving, and the keys behind it are not re-typeable from here.
  const [removeTarget, setRemoveTarget] = useState<Gateway | null>(null);
  const [removing, setRemoving] = useState(false);
  const { status, flash } = useSaveStatus();

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch("/api/admin/payment-gateways");
      if (res.ok) setGateways(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }

  async function add() {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/payment-gateways", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: newProvider,
          label: newLabel.trim(),
          credentials: {},
          feeRate: 0.0175,
          fixedFee: 0.30,
          surchargeEnabled: false,
          priority: gateways.length,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        flash("error", e.error ?? "Failed to add gateway.");
        return;
      }
      setShowAdd(false);
      setNewLabel("");
      flash("saved", "Gateway added");
      await load();
    } catch {
      flash("error", "Failed to add gateway.");
    } finally {
      setSaving(false);
    }
  }

  async function patchGateway(gw: Gateway, data: object) {
    try {
      const res = await fetch(`/api/admin/payment-gateways/${gw.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        flash("error", "Update failed.");
        return;
      }
      await load();
    } catch {
      flash("error", "Update failed.");
    }
  }

  async function remove(credentials?: { pin?: string; password?: string }) {
    const gw = removeTarget;
    if (!gw) return;
    setRemoving(true);
    try {
      // The gateway route takes no security payload of its own, so the PIN is
      // checked against the verify endpoint before the row goes.
      await verifyAdminSecurity(credentials);
      const res = await fetch(`/api/admin/payment-gateways/${gw.id}`, { method: "DELETE" });
      if (!res.ok) {
        flash("error", "Delete failed.");
        return;
      }
      setRemoveTarget(null);
      flash("saved", "Gateway removed");
      await load();
    } catch (err: any) {
      flash("error", err?.message ?? "Delete failed.");
    } finally {
      setRemoving(false);
    }
  }

  if (loading) {
    return (
      <p className="px-1 py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        Retrieving gateways…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Client payments"
        title="Payment gateways"
        description="Clients can pay through any active gateway; priority determines the order offered."
        actions={
          <div className="flex items-center gap-3">
            <ESaveStatus status={status} />
            <EButton variant={showAdd ? "outline" : "primary"} size="sm" onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? "Cancel" : (<><Plus className="h-3.5 w-3.5" /> Add gateway</>)}
            </EButton>
          </div>
        }
      />

      {showAdd ? (
        <ECard variant="ceremony" className="p-6">
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
            <EField label="Provider" htmlFor="gw-provider">
              <ESelectNative id="gw-provider" value={newProvider} onChange={(e) => setNewProvider(e.target.value)}>
                <option value="STRIPE">Stripe</option>
                <option value="SQUARE">Square</option>
                <option value="PAYPAL">PayPal</option>
              </ESelectNative>
            </EField>
            <EField label="Display name" htmlFor="gw-label">
              <EInput
                id="gw-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Stripe — cards"
              />
            </EField>
            <EButton onClick={add} disabled={saving || !newLabel.trim()}>
              {saving ? "Adding…" : "Add"}
            </EButton>
          </div>
          <p className="mt-3 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            API credentials come from the Integrations section (Stripe / Square / PayPal keys).
          </p>
        </ECard>
      ) : null}

      {gateways.length === 0 ? (
        <EEmptyState
          eyebrow="None configured"
          title="No payment gateways"
          description="Add a gateway to let clients pay invoices online."
        />
      ) : (
        <div className="space-y-3">
          {gateways.map((gw) => (
            <ECard key={gw.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.9375rem] font-semibold">{gw.label}</span>
                  <EBadge tone={gw.status === "ACTIVE" ? "success" : "neutral"} soft>{gw.status}</EBadge>
                  <EBadge tone="gold" soft>{PROVIDER_LABELS[gw.provider] ?? gw.provider}</EBadge>
                </div>
                <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Fee <span className="e-tnum">{(gw.feeRate * 100).toFixed(2)}%</span> +{" "}
                  <span className="e-tnum">${gw.fixedFee.toFixed(2)}</span>
                  {gw.surchargeEnabled ? (
                    <span className="ml-1.5 text-[hsl(var(--e-warning))]">surcharge passed to client</span>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Surcharge</span>
                  <EToggle checked={gw.surchargeEnabled} onChange={() => patchGateway(gw, { surchargeEnabled: !gw.surchargeEnabled })} />
                </div>
                <EButton
                  variant="outline"
                  size="sm"
                  onClick={() => patchGateway(gw, { status: gw.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}
                >
                  {gw.status === "ACTIVE" ? "Disable" : "Enable"}
                </EButton>
                <EButton variant="ghost" size="sm" className="text-[hsl(var(--e-danger))]" onClick={() => setRemoveTarget(gw)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </EButton>
              </div>
            </ECard>
          ))}
        </div>
      )}

      <EConfirmModal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title="Delete payment gateway"
        description={
          removeTarget
            ? `${removeTarget.label} stops accepting payments the moment it goes, and its credentials cannot be recovered from here. Enter your PIN or password to continue.`
            : undefined
        }
        confirmLabel="Delete gateway"
        requireSecurity
        loading={removing}
        onConfirm={remove}
      />
    </div>
  );
}
