"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";

interface PricebookEditorProps {
  initialRows: Array<{
    id: string;
    jobType: string;
    bedrooms: number | null;
    bathrooms: number | null;
    baseRate: number;
    addOns: Record<string, number>;
    isActive: boolean;
  }>;
  canEdit: boolean;
}

export function PricebookEditor({ initialRows, canEdit }: PricebookEditorProps) {
  const [rows, setRows] = useState(initialRows);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function saveRow(row: (typeof rows)[number]) {
    if (!canEdit) return;
    setSavingId(row.id);
    const res = await fetch(`/api/admin/pricebook/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseRate: row.baseRate,
        addOns: row.addOns,
        isActive: row.isActive,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok) {
      toast({ title: "Save failed", description: body.error ?? "Could not update price row.", variant: "destructive" });
      return;
    }
    toast({ title: "Price row updated" });
  }

  const addOnKeys = Array.from(
    new Set([
      "minimumPrice",
      "additionalBedroom",
      "additionalBathroom",
      ...rows.flatMap((row) => Object.keys(row.addOns || {})),
    ])
  ).sort();

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b">
            <tr className="text-xs text-muted-foreground">
              <th className="p-3 text-left">Service</th>
              <th className="p-3 text-left">Config</th>
              <th className="p-3 text-right">Base</th>
              {addOnKeys.map((key) => (
                <th key={key} className="p-3 text-right">
                  {key}
                </th>
              ))}
              <th className="p-3 text-center">Active</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="p-3 font-medium">{row.jobType.replace(/_/g, " ")}</td>
                <td className="p-3 text-muted-foreground">
                  {row.bedrooms ?? "-"}bd / {row.bathrooms ?? "-"}ba
                </td>
                <td className="p-3">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={row.baseRate}
                    disabled={!canEdit}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x) => (x.id === row.id ? { ...x, baseRate: Number(e.target.value || 0) } : x))
                      )
                    }
                  />
                </td>
                {addOnKeys.map((key) => (
                  <td key={key} className="p-3">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={row.addOns?.[key] ?? 0}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((x) =>
                            x.id === row.id
                              ? { ...x, addOns: { ...x.addOns, [key]: Number(e.target.value || 0) } }
                              : x
                          )
                        )
                      }
                    />
                  </td>
                ))}
                <td className="p-3 text-center">
                  <Switch
                    checked={row.isActive}
                    disabled={!canEdit}
                    onCheckedChange={(value) =>
                      setRows((prev) => prev.map((x) => (x.id === row.id ? { ...x, isActive: value } : x)))
                    }
                  />
                </td>
                <td className="p-3 text-right">
                  <Button
                    size="sm"
                    disabled={!canEdit || savingId === row.id}
                    onClick={() => saveRow(row)}
                  >
                    {savingId === row.id ? "Saving..." : "Save"}
                  </Button>
                  {!canEdit && (
                    <p className="mt-1 text-xs text-muted-foreground">{formatCurrency(row.baseRate)}</p>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5 + addOnKeys.length} className="p-8 text-center text-sm text-muted-foreground">
                  No price book rows found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
