"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

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

export function PaymentGatewaysPage() {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newProvider, setNewProvider] = useState("STRIPE");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadGateways(); }, []);

  async function loadGateways() {
    try {
      const res = await fetch("/api/admin/payment-gateways");
      if (res.ok) setGateways(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function handleAdd() {
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
      if (!res.ok) { const e = await res.json(); alert(e.error); return; }
      setShowAdd(false);
      setNewLabel("");
      await loadGateways();
    } catch { alert("Failed to add gateway"); }
    finally { setSaving(false); }
  }

  async function toggleStatus(gw: Gateway) {
    const newStatus = gw.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      const res = await fetch(`/api/admin/payment-gateways/${gw.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) return;
      await loadGateways();
    } catch { /* ignore */ }
  }

  async function toggleSurcharge(gw: Gateway) {
    try {
      const res = await fetch(`/api/admin/payment-gateways/${gw.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surchargeEnabled: !gw.surchargeEnabled }),
      });
      if (!res.ok) return;
      await loadGateways();
    } catch { /* ignore */ }
  }

  async function deleteGateway(gw: Gateway) {
    if (!confirm(`Delete ${gw.label}?`)) return;
    try {
      const res = await fetch(`/api/admin/payment-gateways/${gw.id}`, { method: "DELETE" });
      if (!res.ok) return;
      await loadGateways();
    } catch { /* ignore */ }
  }

  if (loading) return <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Loading gateways...</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Active Gateways</CardTitle>
              <CardDescription>Clients can pay through any active gateway. Priority determines order.</CardDescription>
            </div>
            <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
              {showAdd ? "Cancel" : "Add Gateway"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {gateways.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No payment gateways configured.</p>
          ) : (
            <div className="space-y-3">
              {gateways.map((gw) => (
                <div key={gw.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{gw.label}</span>
                      <Badge variant={gw.status === "ACTIVE" ? "success" : "secondary"}>{gw.status}</Badge>
                      <Badge variant="outline">{PROVIDER_LABELS[gw.provider] || gw.provider}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Fee: {(gw.feeRate * 100).toFixed(2)}% + ${gw.fixedFee.toFixed(2)}
                      {gw.surchargeEnabled && <span className="ml-1 text-amber-600">(surcharge enabled)</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Surcharge</span>
                      <Switch checked={gw.surchargeEnabled} onCheckedChange={() => toggleSurcharge(gw)} />
                    </div>
                    <Button variant="outline" size="sm" onClick={() => toggleStatus(gw)}>
                      {gw.status === "ACTIVE" ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-red-600" onClick={() => deleteGateway(gw)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showAdd && (
            <div className="mt-4 rounded-lg border p-4 space-y-3">
              <p className="text-sm font-medium">Add New Gateway</p>
              <div className="flex flex-wrap gap-3">
                <select
                  value={newProvider}
                  onChange={(e) => setNewProvider(e.target.value)}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="STRIPE">Stripe</option>
                  <option value="SQUARE">Square</option>
                  <option value="PAYPAL">PayPal</option>
                </select>
                <Input
                  placeholder="Display name"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  className="max-w-xs"
                />
                <Button onClick={handleAdd} disabled={saving || !newLabel.trim()}>
                  {saving ? "Adding..." : "Add"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Configure API credentials in the database after adding. Set env vars: STRIPE_SECRET_KEY, SQUARE_ACCESS_TOKEN, PAYPAL_CLIENT_ID/SECRET.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
