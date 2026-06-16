"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Save, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/hooks/use-toast";

type Pricing = {
  cleanerHourlyCost: number;
  rackHourlyRate: number;
  marginFloorPercent: number;
  gstEnabled: boolean;
};
type Row = {
  id: string;
  jobType: string;
  label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  hours: number;
  baseRate: number;
  margin: number | null;
};

export default function PricingPage() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [savingRow, setSavingRow] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/pricing/rate-card", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not load pricing", description: body.error ?? "Retry.", variant: "destructive" });
        return;
      }
      setPricing(body.pricing);
      setRows(body.rows ?? []);
      setSeeded(Boolean(body.seeded));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function saveConfig() {
    if (!pricing) return;
    setSavingCfg(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricing }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Save failed.");
      }
      toast({ title: "Pricing settings saved" });
      await load();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingCfg(false);
    }
  }

  async function regenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/pricing/rate-card", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not generate.");
      toast({ title: "Rate card generated", description: `${body.generated} price points created from $${pricing?.rackHourlyRate}/hr.` });
      await load();
    } catch (err: any) {
      toast({ title: "Generate failed", description: err.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  async function saveRow(row: Row) {
    setSavingRow(row.id);
    try {
      const res = await fetch("/api/admin/pricing/rate-card", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, baseRate: row.baseRate }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? "Save failed.");
      }
      toast({ title: "Price updated" });
      await load();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingRow(null);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; rows: Row[] }>();
    for (const r of rows) {
      if (!map.has(r.jobType)) map.set(r.jobType, { label: r.label, rows: [] });
      map.get(r.jobType)!.rows.push(r);
    }
    return Array.from(map.values());
  }, [rows]);

  const floor = pricing?.marginFloorPercent ?? 40;

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading pricing…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<DollarSign />}
        title="Pricing & rate card"
        description="Set the labour cost, rack rate, and margin floor — then generate every service price. Edit any price directly; all quotes use these."
      />

      {/* Pricing model */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pricing model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pricing ? (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Cleaner pay ($/hr)</Label>
                  <Input
                    type="number"
                    value={pricing.cleanerHourlyCost}
                    onChange={(e) => setPricing({ ...pricing, cleanerHourlyCost: Number(e.target.value) })}
                  />
                  <p className="text-[11px] text-muted-foreground">Your cost base for the margin calc.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Rack rate ($/hr)</Label>
                  <Input
                    type="number"
                    value={pricing.rackHourlyRate}
                    onChange={(e) => setPricing({ ...pricing, rackHourlyRate: Number(e.target.value) })}
                  />
                  <p className="text-[11px] text-muted-foreground">Customer-facing effective hourly rate the card is built on.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>Margin floor (%)</Label>
                  <Input
                    type="number"
                    value={pricing.marginFloorPercent}
                    onChange={(e) => setPricing({ ...pricing, marginFloorPercent: Number(e.target.value) })}
                  />
                  <p className="text-[11px] text-muted-foreground">Discounts never drop a quote below this.</p>
                </div>
              </div>
              <label className="flex items-center gap-3 rounded-md border p-3">
                <Switch
                  checked={pricing.gstEnabled}
                  onCheckedChange={(v) => setPricing({ ...pricing, gstEnabled: v })}
                />
                <span className="text-sm">Add GST (10%) to quotes</span>
              </label>
              <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                At ${pricing.cleanerHourlyCost}/hr cost and ${pricing.rackHourlyRate}/hr rack rate, baseline margin is{" "}
                <strong className="text-foreground">
                  {pricing.rackHourlyRate > 0
                    ? Math.round(((pricing.rackHourlyRate - pricing.cleanerHourlyCost) / pricing.rackHourlyRate) * 100)
                    : 0}
                  %
                </strong>
                . Floor is {floor}% — the most you can discount before a quote is capped is about{" "}
                {pricing.rackHourlyRate > 0
                  ? Math.max(
                      0,
                      Math.round(
                        (1 - (pricing.cleanerHourlyCost / pricing.rackHourlyRate) / (1 - floor / 100)) * 100
                      )
                    )
                  : 0}
                %.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={saveConfig} disabled={savingCfg}>
                  <Save className="mr-2 h-4 w-4" />
                  {savingCfg ? "Saving…" : "Save pricing model"}
                </Button>
                <Button variant="outline" onClick={regenerate} disabled={generating}>
                  {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  {seeded ? "Regenerate rate card" : "Generate rate card"}
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Rate card */}
      {grouped.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No rate card yet. Set your rack rate above and click <strong>Generate rate card</strong> to price every
            service × size combination.
          </CardContent>
        </Card>
      ) : (
        grouped.map((group) => (
          <Card key={group.label}>
            <CardHeader>
              <CardTitle className="text-base">{group.label}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2">Bed</th>
                    <th className="px-4 py-2">Bath</th>
                    <th className="px-4 py-2">Est. hrs</th>
                    <th className="px-4 py-2">Price (GST-inc)</th>
                    <th className="px-4 py-2">Margin</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => {
                    const belowFloor = row.margin != null && row.margin < floor;
                    return (
                      <tr key={row.id} className="border-b last:border-b-0">
                        <td className="px-4 py-2 tabular-nums">{row.bedrooms}</td>
                        <td className="px-4 py-2 tabular-nums">{row.bathrooms}</td>
                        <td className="px-4 py-2 tabular-nums text-muted-foreground">{row.hours}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1">
                            <span className="text-muted-foreground">$</span>
                            <Input
                              type="number"
                              className="h-8 w-24"
                              value={row.baseRate}
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r) => (r.id === row.id ? { ...r, baseRate: Number(e.target.value) } : r))
                                )
                              }
                            />
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          {row.margin != null ? (
                            <Badge variant={belowFloor ? "destructive" : "success"}>{row.margin}%</Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button size="sm" variant="outline" disabled={savingRow === row.id} onClick={() => saveRow(row)}>
                            {savingRow === row.id ? "Saving…" : "Save"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
