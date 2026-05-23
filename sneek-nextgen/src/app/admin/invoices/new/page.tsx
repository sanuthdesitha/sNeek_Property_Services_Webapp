"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  category: string;
}

export default function NewInvoicePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lines, setLines] = useState<LineItem[]>([{ description: "", quantity: 1, unitPrice: 0, category: "JOB" }]);
  const [gstEnabled, setGstEnabled] = useState(true);

  function addLine() {
    setLines([...lines, { description: "", quantity: 1, unitPrice: 0, category: "JOB" }]);
  }

  function removeLine(index: number) {
    setLines(lines.filter((_, i) => i !== index));
  }

  function updateLine(index: number, field: keyof LineItem, value: string | number) {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setLines(newLines);
  }

  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const gst = gstEnabled ? subtotal * 0.1 : 0;
  const total = subtotal + gst;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      clientId: formData.get("clientId"),
      periodStart: formData.get("periodStart"),
      periodEnd: formData.get("periodEnd"),
      lines,
      gstEnabled,
    };

    try {
      const res = await fetch("/api/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create invoice");
      }

      router.push("/admin/invoices");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild><Link href="/admin/invoices"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link></Button>
        <div><h1 className="text-2xl font-bold text-text-primary">Create Invoice</h1><p className="text-text-secondary mt-1">Generate a new client invoice</p></div>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">{error}</div>
            )}
            <Select name="clientId" label="Client" options={[{ value: "client_001", label: "Harbour Properties Pty Ltd" }]} placeholder="Select client" required />
            <div className="grid grid-cols-2 gap-4">
              <Input name="periodStart" label="Period Start" type="date" />
              <Input name="periodEnd" label="Period End" type="date" />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Line Items</h3>
                <Button type="button" variant="outline" size="sm" onClick={addLine}><Plus className="h-3 w-3 mr-1" />Add Item</Button>
              </div>
              {lines.map((line, i) => (
                <div key={i} className="flex items-end gap-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                  <div className="flex-1">
                    <Input value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} placeholder="Description" />
                  </div>
                  <div className="w-20">
                    <Input type="number" value={line.quantity} onChange={(e) => updateLine(i, "quantity", parseFloat(e.target.value) || 0)} placeholder="Qty" min={1} />
                  </div>
                  <div className="w-28">
                    <Input type="number" value={line.unitPrice} onChange={(e) => updateLine(i, "unitPrice", parseFloat(e.target.value) || 0)} placeholder="Price" min={0} step="0.01" />
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(i)} disabled={lines.length === 1}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>

            <Switch label="Include GST (10%)" checked={gstEnabled} onChange={(e) => setGstEnabled(e.target.checked)} />

            <div className="flex justify-end gap-4 text-sm">
              <span>Subtotal: ${subtotal.toFixed(2)}</span>
              {gstEnabled && <span>GST: ${gst.toFixed(2)}</span>}
              <span className="font-bold">Total: ${total.toFixed(2)}</span>
            </div>

            <Button type="submit" className="w-full" loading={loading}>Create Invoice</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
