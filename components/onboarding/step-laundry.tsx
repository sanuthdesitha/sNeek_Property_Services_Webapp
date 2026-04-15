"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

interface Supplier {
  id: string;
  name: string;
  pricePerKg: number | null;
  avgTurnaround: number | null;
}

interface StepLaundryProps {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}

export function StepLaundry({ data, onChange }: StepLaundryProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const laundry = (data.laundryDetail as Record<string, unknown>) ?? {};
  const update = (key: string, value: unknown) => onChange({ ...data, laundryDetail: { ...laundry, [key]: value } });

  useEffect(() => {
    fetch("/api/admin/laundry/suppliers")
      .then((r) => r.json().catch(() => []))
      .then((rows) => {
        if (Array.isArray(rows)) {
          setSuppliers(rows.filter((s: any) => s.isActive !== false));
        }
      })
      .catch(() => setSuppliers([]));
  }, []);

  const selectedSupplier = suppliers.find((s) => s.id === data.laundrySupplierId);

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={laundry.hasLaundry === true}
          onCheckedChange={(v) => update("hasLaundry", v === true)}
        />
        <span className="text-sm">Property has laundry</span>
      </label>

      {laundry.hasLaundry === true && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Assign laundry partner</Label>
            <Select
              value={data.laundrySupplierId ? String(data.laundrySupplierId) : "__none__"}
              onValueChange={(v) => onChange({ ...data, laundrySupplierId: v === "__none__" ? null : v })}
            >
              <SelectTrigger><SelectValue placeholder="Select a laundry partner" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No partner assigned</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                    {s.pricePerKg ? ` — $${s.pricePerKg.toFixed(2)}/kg` : ""}
                    {s.avgTurnaround ? ` — ${s.avgTurnaround}h turnaround` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedSupplier && (
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedSupplier.name}
                {selectedSupplier.pricePerKg ? ` · $${selectedSupplier.pricePerKg.toFixed(2)}/kg` : ""}
                {selectedSupplier.avgTurnaround ? ` · ${selectedSupplier.avgTurnaround}h avg turnaround` : ""}
              </p>
            )}
          </div>
          <div>
            <Label>Washer type</Label>
            <Select value={String(laundry.washerType ?? "")} onValueChange={(v) => update("washerType", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["FRONT_LOAD", "TOP_LOAD", "COMBO"].map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Dryer type</Label>
            <Select value={String(laundry.dryerType ?? "")} onValueChange={(v) => update("dryerType", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["DRYER", "COMBO", "NONE"].map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Laundry location</Label>
            <Select value={String(laundry.laundryLocation ?? "")} onValueChange={(v) => update("laundryLocation", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["INSIDE_UNIT", "SEPARATE_ROOM", "GARAGE", "OUTDOOR"].map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Detergent type</Label>
            <Select value={String(laundry.detergentType ?? "")} onValueChange={(v) => update("detergentType", v)}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                {["STANDARD", "HYPOALLERGENIC", "ECO", "CLIENT_PROVIDED"].map((t) => (
                  <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2">
            <Checkbox
              checked={laundry.suppliesProvided === true}
              onCheckedChange={(v) => update("suppliesProvided", v === true)}
            />
            <span className="text-sm">Supplies provided by client</span>
          </label>
          <div className="md:col-span-2">
            <Label>Laundry notes</Label>
            <Textarea
              value={String(laundry.notes ?? "")}
              onChange={(e) => update("notes", e.target.value)}
              placeholder="Any laundry-specific instructions"
            />
          </div>
        </div>
      )}
    </div>
  );
}
