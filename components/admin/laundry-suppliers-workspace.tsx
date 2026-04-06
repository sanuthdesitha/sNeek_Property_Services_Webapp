"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type SupplierRow = {
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
  createdAt: string;
  updatedAt: string;
};

type SupplierForm = {
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

const EMPTY_FORM: SupplierForm = {
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

function formFromSupplier(row: SupplierRow): SupplierForm {
  return {
    name: row.name,
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    pricePerKg: row.pricePerKg != null ? String(row.pricePerKg) : "",
    avgTurnaround: row.avgTurnaround != null ? String(row.avgTurnaround) : "",
    reliabilityScore: row.reliabilityScore != null ? String(row.reliabilityScore) : "",
    notes: row.notes ?? "",
    isActive: row.isActive,
  };
}

export function LaundrySuppliersWorkspace({ initialSuppliers }: { initialSuppliers: SupplierRow[] }) {
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function saveSupplier() {
    setSaving(true);
    try {
      const response = await fetch(editingId ? `/api/admin/laundry/suppliers/${editingId}` : "/api/admin/laundry/suppliers", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          pricePerKg: form.pricePerKg ? Number(form.pricePerKg) : null,
          avgTurnaround: form.avgTurnaround ? Number(form.avgTurnaround) : null,
          reliabilityScore: form.reliabilityScore ? Number(form.reliabilityScore) : null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not save supplier.");
      const row = body.supplier as SupplierRow;
      setSuppliers((current) => {
        const next = editingId ? current.map((item) => (item.id === row.id ? row : item)) : [row, ...current];
        return [...next].sort((left, right) => left.name.localeCompare(right.name));
      });
      toast({ title: editingId ? "Supplier updated" : "Supplier created" });
      resetForm();
    } catch (error: any) {
      toast({ title: "Save failed", description: error?.message ?? "Could not save supplier.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteSupplier(id: string) {
    if (!window.confirm("Delete this supplier?")) return;
    try {
      const response = await fetch(`/api/admin/laundry/suppliers/${id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not delete supplier.");
      setSuppliers((current) => current.filter((item) => item.id !== id));
      if (editingId === id) resetForm();
      toast({ title: "Supplier deleted" });
    } catch (error: any) {
      toast({ title: "Delete failed", description: error?.message ?? "Could not delete supplier.", variant: "destructive" });
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit supplier" : "New supplier"}</CardTitle>
          <CardDescription>Track laundry suppliers used for pickup, drop-off, and cost logging.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Supplier name" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="Optional" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="Optional" />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Price / kg</Label>
              <Input type="number" min="0" step="0.01" value={form.pricePerKg} onChange={(event) => setForm((current) => ({ ...current, pricePerKg: event.target.value }))} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Avg turnaround (hrs)</Label>
              <Input type="number" min="0" step="1" value={form.avgTurnaround} onChange={(event) => setForm((current) => ({ ...current, avgTurnaround: event.target.value }))} placeholder="Optional" />
            </div>
            <div className="space-y-2">
              <Label>Reliability score</Label>
              <Input type="number" min="0" max="5" step="0.1" value={form.reliabilityScore} onChange={(event) => setForm((current) => ({ ...current, reliabilityScore: event.target.value }))} placeholder="0 - 5" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea rows={4} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Service notes, preferred pickup windows, billing notes..." />
          </div>
          <div className="flex items-center justify-between rounded-2xl border p-3">
            <div>
              <p className="text-sm font-medium">Active supplier</p>
              <p className="text-xs text-muted-foreground">Inactive suppliers stay archived and stop appearing in the laundry portal dropdown.</p>
            </div>
            <Switch checked={form.isActive} onCheckedChange={(value) => setForm((current) => ({ ...current, isActive: value }))} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetForm}>Reset</Button>
            <Button type="button" onClick={saveSupplier} disabled={saving || !form.name.trim()}>{saving ? "Saving..." : editingId ? "Save changes" : "Create supplier"}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Supplier list</CardTitle>
          <CardDescription>These suppliers feed directly into the laundry portal when workers record drop-off cost and supplier details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {suppliers.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No suppliers yet.</div>
          ) : (
            suppliers.map((supplier) => (
              <div key={supplier.id} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold">{supplier.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {supplier.phone || supplier.email || "No direct contact saved"}
                      {supplier.address ? ` | ${supplier.address}` : ""}
                    </p>
                    {supplier.notes ? <p className="mt-2 text-sm text-muted-foreground">{supplier.notes}</p> : null}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{supplier.pricePerKg != null ? `$${supplier.pricePerKg.toFixed(2)}/kg` : "Rate not set"}</p>
                    <p className="text-xs text-muted-foreground">
                      {supplier.avgTurnaround != null ? `${supplier.avgTurnaround}h turnaround` : "Turnaround not set"}
                      {supplier.reliabilityScore != null ? ` | ${supplier.reliabilityScore.toFixed(1)}/5` : ""}
                    </p>
                    <p className={`mt-1 text-xs font-medium ${supplier.isActive ? "text-emerald-600" : "text-muted-foreground"}`}>
                      {supplier.isActive ? "Active" : "Inactive"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setEditingId(supplier.id); setForm(formFromSupplier(supplier)); }}>Edit</Button>
                  <Button variant="destructive" size="sm" onClick={() => deleteSupplier(supplier.id)}>Delete</Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
