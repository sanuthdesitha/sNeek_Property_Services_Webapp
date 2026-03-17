"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { JobType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { downloadFromApi } from "@/lib/client/download";

type Branch = {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  propertyIds: string[];
  suburbs: string[];
  notes: string | null;
};

type RouteResponse = {
  routes: Array<{
    cleanerId: string;
    cleanerName: string;
    totalEstimatedTravelMins: number;
    routeMapUrl: string | null;
    suburbClusters: Array<{ suburb: string; stopCount: number }>;
  }>;
};

type ForecastResponse = {
  generatedAt: string;
  rows: Array<{
    propertyName: string;
    itemName: string;
    supplier: string;
    onHand: number;
    parLevel: number;
    daysUntilReorder: number | null;
    risk: "LOW_STOCK" | "RISK_7D" | "RISK_14D" | "OK";
  }>;
  bySupplier: Array<{ supplier: string; lines: number; estimatedTotalCost: number }>;
};

type SlaRule = {
  id: string;
  name: string;
  isActive: boolean;
  clientId: string | null;
  propertyId: string | null;
  jobType: JobType | null;
  maxStartDelayMinutes: number;
  maxCompletionDelayMinutes: number;
};

type Integrations = {
  stripe: { enabled: boolean; currency: string; successUrl: string; cancelUrl: string };
  xero: { enabled: boolean; tenantId: string; defaultAccountCode: string };
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default function ScalePage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [routeDate, setRouteDate] = useState(todayKey());
  const [branchId, setBranchId] = useState("");
  const [routes, setRoutes] = useState<RouteResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [slaRules, setSlaRules] = useState<SlaRule[]>([]);
  const [slaBreaches, setSlaBreaches] = useState<any[]>([]);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [supplier, setSupplier] = useState("");
  const [supplierEmail, setSupplierEmail] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [stripeLink, setStripeLink] = useState("");
  const [newBranch, setNewBranch] = useState({
    name: "",
    code: "",
    propertyIdsCsv: "",
    suburbsCsv: "",
    notes: "",
  });
  const [newRule, setNewRule] = useState({
    name: "",
    maxStartDelayMinutes: "30",
    maxCompletionDelayMinutes: "120",
  });

  async function bootstrap() {
    const [bRes, rRes, iRes] = await Promise.all([
      fetch("/api/admin/phase3/branches"),
      fetch("/api/admin/phase3/commercial-sla/rules"),
      fetch("/api/admin/integrations/settings"),
    ]);
    const [bBody, rBody, iBody] = await Promise.all([
      bRes.json().catch(() => []),
      rRes.json().catch(() => []),
      iRes.json().catch(() => null),
    ]);
    setBranches(Array.isArray(bBody) ? bBody : []);
    setSlaRules(Array.isArray(rBody) ? rBody : []);
    setIntegrations(iBody && typeof iBody === "object" ? iBody : null);
  }

  useEffect(() => {
    bootstrap();
  }, []);

  async function createBranch() {
    if (!newBranch.name.trim()) return;
    const res = await fetch("/api/admin/phase3/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newBranch.name,
        code: newBranch.code || undefined,
        propertyIds: newBranch.propertyIdsCsv.split(",").map((s) => s.trim()).filter(Boolean),
        suburbs: newBranch.suburbsCsv.split(",").map((s) => s.trim()).filter(Boolean),
        notes: newBranch.notes || null,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Create branch failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setNewBranch({ name: "", code: "", propertyIdsCsv: "", suburbsCsv: "", notes: "" });
    bootstrap();
  }

  async function runRoutes() {
    const query = new URLSearchParams({ date: routeDate });
    if (branchId) query.set("branchId", branchId);
    const res = await fetch(`/api/admin/phase3/routes?${query.toString()}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Route load failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setRoutes(body);
  }

  async function runForecast() {
    const query = new URLSearchParams({ lookbackDays: "30" });
    if (branchId) query.set("branchId", branchId);
    const res = await fetch(`/api/admin/phase3/stock-forecast?${query.toString()}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Forecast failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setForecast(body);
  }

  async function emailSupplier() {
    if (!supplier) return;
    const res = await fetch("/api/admin/phase3/supplier-orders/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supplier,
        to: supplierEmail || undefined,
        lookbackDays: 30,
        branchId: branchId || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Email failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    toast({ title: "Supplier email sent", description: body.sentTo });
  }

  async function addSlaRule() {
    if (!newRule.name.trim()) return;
    const res = await fetch("/api/admin/phase3/commercial-sla/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newRule.name,
        maxStartDelayMinutes: Number(newRule.maxStartDelayMinutes || 30),
        maxCompletionDelayMinutes: Number(newRule.maxCompletionDelayMinutes || 120),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "SLA rule failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setNewRule({ name: "", maxStartDelayMinutes: "30", maxCompletionDelayMinutes: "120" });
    bootstrap();
  }

  async function deleteSlaRule(id: string) {
    if (!window.confirm("Delete this SLA rule?")) return;
    const res = await fetch(`/api/admin/phase3/commercial-sla/rules/${id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    bootstrap();
  }

  async function scanSla() {
    const res = await fetch("/api/admin/phase3/commercial-sla/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId: branchId || null, createIssues: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "SLA scan failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setSlaBreaches(Array.isArray(body.breaches) ? body.breaches : []);
  }

  async function saveIntegrations() {
    if (!integrations) return;
    const res = await fetch("/api/admin/integrations/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(integrations),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Save failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setIntegrations(body);
    toast({ title: "Integration settings saved" });
  }

  async function createStripeLink() {
    if (!quoteId.trim()) return;
    const res = await fetch("/api/admin/integrations/stripe/quote-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteId: quoteId.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Stripe link failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setStripeLink(body.paymentLink ?? "");
  }

  async function xeroCsv() {
    const query = new URLSearchParams({
      startDate: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
      endDate: todayKey(),
    });
    try {
      await downloadFromApi(`/api/admin/integrations/xero/export?${query.toString()}`, `xero-export-${todayKey()}.csv`);
    } catch (err: any) {
      toast({ title: "Export failed", description: err?.message ?? "Could not download Xero CSV.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Phase 3 Scale</h2>
        <p className="text-sm text-muted-foreground">Multi-branch, route map clusters, stock forecast, supplier ordering, commercial SLA, Xero/Stripe.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Branch Scope</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <select className="w-full rounded-md border bg-background px-3 py-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <div className="grid gap-2 md:grid-cols-5">
            <Input placeholder="Branch name" value={newBranch.name} onChange={(e) => setNewBranch((p) => ({ ...p, name: e.target.value }))} />
            <Input placeholder="Code" value={newBranch.code} onChange={(e) => setNewBranch((p) => ({ ...p, code: e.target.value }))} />
            <Input placeholder="Property IDs csv" value={newBranch.propertyIdsCsv} onChange={(e) => setNewBranch((p) => ({ ...p, propertyIdsCsv: e.target.value }))} />
            <Input placeholder="Suburbs csv" value={newBranch.suburbsCsv} onChange={(e) => setNewBranch((p) => ({ ...p, suburbsCsv: e.target.value }))} />
            <Button onClick={createBranch}>Add branch</Button>
          </div>
          <Textarea placeholder="Notes" rows={2} value={newBranch.notes} onChange={(e) => setNewBranch((p) => ({ ...p, notes: e.target.value }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Route Map Clustering</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input type="date" value={routeDate} onChange={(e) => setRouteDate(e.target.value)} />
            <Button onClick={runRoutes}>Load</Button>
          </div>
          {routes?.routes.map((r) => (
            <div key={r.cleanerId} className="rounded border p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{r.cleanerName} - {r.totalEstimatedTravelMins} mins</p>
                {r.routeMapUrl ? <a href={r.routeMapUrl} target="_blank" rel="noreferrer" className="underline">Open map</a> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.suburbClusters.map((c) => <Badge key={c.suburb} variant="secondary">{c.suburb}: {c.stopCount}</Badge>)}
              </div>
            </div>
          ))}
          {routes && routes.routes.length === 0 ? <p className="text-sm text-muted-foreground">No routes.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Stock Forecast + Supplier Ordering</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={runForecast}>Run 30-day forecast</Button>
          {forecast ? (
            <>
              <p className="text-xs text-muted-foreground">Generated {format(new Date(forecast.generatedAt), "dd MMM yyyy HH:mm")}</p>
              {forecast.rows.slice(0, 12).map((row, idx) => (
                <div key={`${idx}-${row.propertyName}-${row.itemName}`} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                  <p>{row.propertyName} - {row.itemName} - {row.supplier}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant={(row.risk === "LOW_STOCK" ? "destructive" : row.risk === "OK" ? "outline" : "secondary") as any}>{row.risk}</Badge>
                    <span className="text-xs text-muted-foreground">{row.daysUntilReorder == null ? "-" : `${row.daysUntilReorder}d`}</span>
                  </div>
                </div>
              ))}
              <div className="grid gap-2 md:grid-cols-3">
                <select className="rounded-md border bg-background px-3 py-2 text-sm" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                  <option value="">Select supplier</option>
                  {forecast.bySupplier.map((s) => (
                    <option key={s.supplier} value={s.supplier}>{s.supplier} ({s.lines} lines, ${s.estimatedTotalCost.toFixed(2)})</option>
                  ))}
                </select>
                <Input placeholder="Email override (optional)" value={supplierEmail} onChange={(e) => setSupplierEmail(e.target.value)} />
                <Button onClick={emailSupplier}>Email supplier summary</Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Commercial SLA</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <Input placeholder="Rule name" value={newRule.name} onChange={(e) => setNewRule((p) => ({ ...p, name: e.target.value }))} />
            <Input type="number" placeholder="Start delay mins" value={newRule.maxStartDelayMinutes} onChange={(e) => setNewRule((p) => ({ ...p, maxStartDelayMinutes: e.target.value }))} />
            <Input type="number" placeholder="Completion delay mins" value={newRule.maxCompletionDelayMinutes} onChange={(e) => setNewRule((p) => ({ ...p, maxCompletionDelayMinutes: e.target.value }))} />
            <Button onClick={addSlaRule}>Add rule</Button>
          </div>
          <div className="space-y-2">
            {slaRules.map((rule) => (
              <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                <p>{rule.name} - Start {rule.maxStartDelayMinutes}m - Complete {rule.maxCompletionDelayMinutes}m</p>
                <div className="flex items-center gap-2">
                  <Badge variant={rule.isActive ? "success" : "secondary"}>{rule.isActive ? "Active" : "Disabled"}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => deleteSlaRule(rule.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
          <Button onClick={scanSla}>Run SLA scan + create issue tickets</Button>
          {slaBreaches.length > 0 ? (
            <div className="space-y-1 text-sm text-muted-foreground">
              {slaBreaches.slice(0, 15).map((b: any, i) => (
                <p key={`${b.ruleId}-${b.jobId}-${i}`}>[{b.severity}] {b.clientName} - {b.propertyName} - {b.breachTypes.join(", ")}</p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Stripe + Xero</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {integrations ? (
            <>
              <div className="grid gap-2 md:grid-cols-4">
                <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={integrations.stripe.enabled} onChange={(e) => setIntegrations((prev) => prev ? ({ ...prev, stripe: { ...prev.stripe, enabled: e.target.checked } }) : prev)} />Stripe enabled</label>
                <Input value={integrations.stripe.currency} onChange={(e) => setIntegrations((prev) => prev ? ({ ...prev, stripe: { ...prev.stripe, currency: e.target.value } }) : prev)} />
                <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={integrations.xero.enabled} onChange={(e) => setIntegrations((prev) => prev ? ({ ...prev, xero: { ...prev.xero, enabled: e.target.checked } }) : prev)} />Xero enabled</label>
                <Input value={integrations.xero.tenantId} onChange={(e) => setIntegrations((prev) => prev ? ({ ...prev, xero: { ...prev.xero, tenantId: e.target.value } }) : prev)} placeholder="Tenant ID" />
              </div>
              <Button onClick={saveIntegrations}>Save integrations</Button>
              <div className="grid gap-2 md:grid-cols-3">
                <Input placeholder="Quote ID for Stripe link" value={quoteId} onChange={(e) => setQuoteId(e.target.value)} />
                <Button onClick={createStripeLink}>Create Stripe payment link</Button>
                {stripeLink ? <a href={stripeLink} target="_blank" rel="noreferrer" className="self-center underline">Open link</a> : null}
              </div>
              <Button variant="outline" onClick={xeroCsv}>Download Xero CSV export</Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Loading integration settings...</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

