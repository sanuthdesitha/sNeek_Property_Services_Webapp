"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { downloadFromApi } from "@/lib/client/download";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

export default function IntelligencePage() {
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateHistory, setTemplateHistory] = useState<any[]>([]);

  const [startDate, setStartDate] = useState(monthStart());
  const [endDate, setEndDate] = useState(today());
  const [slaHeatmap, setSlaHeatmap] = useState<any>(null);
  const [scorecards, setScorecards] = useState<any[]>([]);
  const [rescheduleJobId, setRescheduleJobId] = useState("");
  const [reschedulePlan, setReschedulePlan] = useState<any>(null);

  const [payRuns, setPayRuns] = useState<any[]>([]);
  const [payRunName, setPayRunName] = useState("");
  const [payRunStart, setPayRunStart] = useState(monthStart());
  const [payRunEnd, setPayRunEnd] = useState(today());

  const [disputes, setDisputes] = useState<any[]>([]);
  const [disputeForm, setDisputeForm] = useState({
    title: "",
    description: "",
    amountDisputed: "0",
  });

  const [rules, setRules] = useState<any[]>([]);
  const [ruleForm, setRuleForm] = useState({
    name: "",
    event: "JOB_ASSIGNED",
    channels: "PUSH",
    rolesCsv: "ADMIN,OPS_MANAGER",
    throttleMinutes: "0",
    conditionsJson: "{}",
  });
  const [ruleResolve, setRuleResolve] = useState<any>(null);

  const [shoppingRunId, setShoppingRunId] = useState("");
  const [budget, setBudget] = useState("");
  const [maxUnits, setMaxUnits] = useState("");
  const [maxLines, setMaxLines] = useState("");
  const [shoppingOptimization, setShoppingOptimization] = useState<any>(null);
  const [shoppingRuns, setShoppingRuns] = useState<any[]>([]);

  async function loadBoot() {
    const [bRes, tRes, pRes, dRes, rRes, srRes] = await Promise.all([
      fetch("/api/admin/phase3/branches"),
      fetch("/api/admin/form-templates"),
      fetch("/api/admin/phase4/payruns"),
      fetch("/api/admin/phase4/disputes"),
      fetch("/api/admin/phase4/notification-rules"),
      fetch("/api/admin/inventory/shopping-runs"),
    ]);
    const [bBody, tBody, pBody, dBody, rBody, srBody] = await Promise.all([
      bRes.json().catch(() => []),
      tRes.json().catch(() => []),
      pRes.json().catch(() => []),
      dRes.json().catch(() => []),
      rRes.json().catch(() => []),
      srRes.json().catch(() => []),
    ]);
    setBranches(Array.isArray(bBody) ? bBody : []);
    setTemplates(Array.isArray(tBody) ? tBody : []);
    setPayRuns(Array.isArray(pBody) ? pBody : []);
    setDisputes(Array.isArray(dBody) ? dBody : []);
    setRules(Array.isArray(rBody) ? rBody : []);
    const runRows = Array.isArray(srBody) ? srBody : [];
    setShoppingRuns(runRows);
    if (!shoppingRunId && runRows.length > 0) setShoppingRunId(runRows[0].id);
  }

  useEffect(() => {
    loadBoot();
  }, []);

  useEffect(() => {
    if (!selectedTemplateId) return;
    fetch(`/api/admin/phase4/template-versions/${selectedTemplateId}`)
      .then((res) => res.json())
      .then((body) => setTemplateHistory(Array.isArray(body?.templates) ? body.templates : []))
      .catch(() => setTemplateHistory([]));
  }, [selectedTemplateId]);

  async function loadSlaHeatmap() {
    const query = new URLSearchParams({ startDate, endDate });
    if (branchId) query.set("branchId", branchId);
    const res = await fetch(`/api/admin/phase4/sla/heatmap?${query.toString()}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "SLA heatmap failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setSlaHeatmap(body);
  }

  async function loadScorecards() {
    const query = new URLSearchParams({ startDate, endDate });
    const res = await fetch(`/api/admin/phase4/branches/scorecards?${query.toString()}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Scorecards failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setScorecards(Array.isArray(body.scorecards) ? body.scorecards : []);
  }

  async function runRescheduleAssistant() {
    if (!rescheduleJobId.trim()) return;
    const res = await fetch(`/api/admin/phase4/reschedule/${rescheduleJobId.trim()}/suggest`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Reschedule suggestion failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setReschedulePlan(body);
  }

  async function applyReschedule(date: string, startTime: string, dueTime: string) {
    const res = await fetch(`/api/admin/phase4/reschedule/${rescheduleJobId.trim()}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        startTime,
        dueTime,
        reason: "Applied from Intelligence panel",
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Apply failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    toast({ title: "Reschedule applied" });
    setReschedulePlan(null);
  }

  async function createPayRun() {
    const res = await fetch("/api/admin/phase4/payruns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: payRunStart,
        endDate: payRunEnd,
        name: payRunName || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Pay run create failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    toast({ title: "Pay run created" });
    setPayRunName("");
    loadBoot();
  }

  async function updatePayRun(id: string, payload: any) {
    const res = await fetch(`/api/admin/phase4/payruns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Pay run update failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    loadBoot();
  }

  async function createDispute() {
    if (!disputeForm.title.trim()) return;
    const res = await fetch("/api/admin/phase4/disputes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: disputeForm.title,
        description: disputeForm.description,
        amountDisputed: Number(disputeForm.amountDisputed || 0),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Dispute create failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setDisputeForm({ title: "", description: "", amountDisputed: "0" });
    loadBoot();
  }

  async function createRule() {
    if (!ruleForm.name.trim()) return;
    let parsedConditions: Record<string, unknown> = {};
    try {
      parsedConditions = ruleForm.conditionsJson.trim() ? JSON.parse(ruleForm.conditionsJson) : {};
    } catch {
      toast({ title: "Conditions JSON is invalid", variant: "destructive" });
      return;
    }
    const roles = ruleForm.rolesCsv
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const res = await fetch("/api/admin/phase4/notification-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: ruleForm.name,
        event: ruleForm.event,
        channels: [ruleForm.channels],
        roles,
        throttleMinutes: Number(ruleForm.throttleMinutes || 0),
        conditions: parsedConditions,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Rule create failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setRuleForm((prev) => ({ ...prev, name: "", conditionsJson: "{}" }));
    loadBoot();
  }

  async function resolveRuleDemo() {
    const res = await fetch("/api/admin/phase4/notification-rules/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: ruleForm.event,
        payload: {
          status: "UNASSIGNED",
          severity: "HIGH",
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Resolve failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setRuleResolve(body);
  }

  async function createTemplateVersionNow() {
    if (!selectedTemplateId) return;
    const res = await fetch(`/api/admin/phase4/template-versions/${selectedTemplateId}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Version create failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    toast({ title: "Template version created" });
    setSelectedTemplateId(body.id);
    loadBoot();
  }

  async function rollbackTemplate(targetTemplateId: string) {
    if (!selectedTemplateId) return;
    const res = await fetch(`/api/admin/phase4/template-versions/${selectedTemplateId}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetTemplateId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Rollback failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    toast({ title: "Template rolled back" });
    loadBoot();
  }

  async function optimizeShopping(apply: boolean) {
    if (!shoppingRunId) return;
    const res = await fetch(`/api/admin/phase4/shopping-runs/${shoppingRunId}/optimize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        budget: budget ? Number(budget) : null,
        maxUnits: maxUnits ? Number(maxUnits) : null,
        maxLines: maxLines ? Number(maxLines) : null,
        apply,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Optimization failed", description: body.error ?? "Failed", variant: "destructive" });
      return;
    }
    setShoppingOptimization(body);
    if (apply) {
      toast({ title: "Shopping run optimized and saved" });
      loadBoot();
    }
  }

  const branchOptions = useMemo(
    () => [{ id: "", name: "All branches" }, ...branches],
    [branches]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Intelligence</h2>
        <p className="text-sm text-muted-foreground">
          SLA heatmap, smart rescheduling, pay runs, disputes, notification rules, template versioning, and shopping optimization.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">SLA Heatmap + Branch Scorecards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <select className="rounded-md border bg-background px-3 py-2 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branchOptions.map((b) => (
                <option key={b.id || "all"} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button onClick={loadSlaHeatmap}>Heatmap</Button>
              <Button variant="outline" onClick={loadScorecards}>Scorecards</Button>
            </div>
          </div>

          {slaHeatmap?.summary ? (
            <div className="grid gap-2 md:grid-cols-4">
              <Badge variant="outline">Jobs: {slaHeatmap.summary.jobs}</Badge>
              <Badge variant="secondary">Due soon: {slaHeatmap.summary.dueSoon}</Badge>
              <Badge variant={slaHeatmap.summary.overdue > 0 ? "destructive" : "outline"}>Overdue: {slaHeatmap.summary.overdue}</Badge>
              <Badge variant="outline">Properties: {slaHeatmap.summary.properties}</Badge>
            </div>
          ) : null}

          {slaHeatmap?.entries?.length ? (
            <div className="max-h-48 overflow-auto rounded border text-xs">
              {slaHeatmap.entries.slice(0, 80).map((entry: any) => (
                <div key={`${entry.propertyId}-${entry.date}`} className="flex items-center justify-between border-b px-2 py-1 last:border-0">
                  <p>{entry.date} - {entry.propertyName}</p>
                  <p>Jobs {entry.totalJobs} | Soon {entry.dueSoon} | Overdue {entry.overdue}</p>
                </div>
              ))}
            </div>
          ) : null}

          {scorecards.length > 0 ? (
            <div className="grid gap-2 md:grid-cols-2">
              {scorecards.map((row) => (
                <div key={row.branchId} className="rounded border p-2 text-sm">
                  <p className="font-medium">{row.branchName}</p>
                  <p className="text-xs text-muted-foreground">
                    Jobs {row.jobs} ({row.completedJobs} done) - QA {row.qaAvg ?? "-"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Revenue ${row.revenue.toFixed(2)} | Labor ${row.estimatedLaborCost.toFixed(2)} | Margin ${row.margin.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auto Re-Scheduling Assistant</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Job ID" value={rescheduleJobId} onChange={(e) => setRescheduleJobId(e.target.value)} />
            <Button onClick={runRescheduleAssistant}>Suggest</Button>
          </div>
          {reschedulePlan?.suggestions?.length ? (
            <div className="space-y-2">
              {reschedulePlan.suggestions.map((option: any) => (
                <div key={option.date} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                  <p>{option.date} {option.startTime} {"->"} {option.dueTime}</p>
                  <Button size="sm" onClick={() => applyReschedule(option.date, option.startTime, option.dueTime)}>
                    Apply
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payroll Lock + Pay Runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <Input value={payRunName} onChange={(e) => setPayRunName(e.target.value)} placeholder="Run name (optional)" />
            <Input type="date" value={payRunStart} onChange={(e) => setPayRunStart(e.target.value)} />
            <Input type="date" value={payRunEnd} onChange={(e) => setPayRunEnd(e.target.value)} />
            <Button onClick={createPayRun}>Create run</Button>
          </div>
          <div className="space-y-2">
            {payRuns.map((run) => (
              <div key={run.id} className="rounded border p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{run.name}</p>
                  <Badge variant={run.status === "PAID" ? "success" : run.status === "LOCKED" ? "secondary" : "outline"}>{run.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {run.periodStart} {"->"} {run.periodEnd} | {run.totals.cleaners} cleaners | ${run.totals.amount.toFixed(2)}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {run.status === "DRAFT" ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => updatePayRun(run.id, { action: "refresh" })}>Refresh</Button>
                      <Button size="sm" onClick={() => updatePayRun(run.id, { status: "LOCKED" })}>Lock</Button>
                    </>
                  ) : null}
                  {run.status === "LOCKED" ? (
                    <Button size="sm" onClick={() => updatePayRun(run.id, { status: "PAID" })}>Mark paid</Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      downloadFromApi(`/api/admin/phase4/payruns/${run.id}/export`, `payrun-${run.id}.csv`).catch((err: any) =>
                        toast({
                          title: "Export failed",
                          description: err?.message ?? "Could not export pay run.",
                          variant: "destructive",
                        })
                      )
                    }
                  >
                    Export CSV
                  </Button>
                </div>
              </div>
            ))}
            {payRuns.length === 0 ? <p className="text-sm text-muted-foreground">No pay runs yet.</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dispute Center</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <Input placeholder="Dispute title" value={disputeForm.title} onChange={(e) => setDisputeForm((prev) => ({ ...prev, title: e.target.value }))} />
            <Input type="number" min={0} value={disputeForm.amountDisputed} onChange={(e) => setDisputeForm((prev) => ({ ...prev, amountDisputed: e.target.value }))} />
            <Button onClick={createDispute}>Open dispute</Button>
          </div>
          <Textarea placeholder="Description" value={disputeForm.description} onChange={(e) => setDisputeForm((prev) => ({ ...prev, description: e.target.value }))} />
          <div className="space-y-2">
            {disputes.slice(0, 20).map((row) => (
              <div key={row.id} className="rounded border p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{row.title}</p>
                  <Badge variant={row.status === "OPEN" ? "warning" : row.status === "RESOLVED" ? "success" : "secondary"}>{row.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {row.client?.name ?? "No client"} | {format(new Date(row.createdAt), "dd MMM yyyy HH:mm")}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={async () => {
                    await fetch(`/api/admin/phase4/disputes/${row.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "UNDER_REVIEW" }),
                    });
                    loadBoot();
                  }}>
                    Review
                  </Button>
                  <Button size="sm" onClick={async () => {
                    await fetch(`/api/admin/phase4/disputes/${row.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "RESOLVED" }),
                    });
                    loadBoot();
                  }}>
                    Resolve
                  </Button>
                </div>
              </div>
            ))}
            {disputes.length === 0 ? <p className="text-sm text-muted-foreground">No disputes yet.</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Rules Engine</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <Input placeholder="Rule name" value={ruleForm.name} onChange={(e) => setRuleForm((prev) => ({ ...prev, name: e.target.value }))} />
            <select className="rounded-md border bg-background px-3 py-2 text-sm" value={ruleForm.event} onChange={(e) => setRuleForm((prev) => ({ ...prev, event: e.target.value }))}>
              {["JOB_ASSIGNED","JOB_STATUS_CHANGED","QA_FAILED","APPROVAL_REQUESTED","DISPUTE_OPENED","STOCK_LOW","LAUNDRY_READY","PAY_ADJUSTMENT_REQUESTED"].map((event) => (
                <option key={event} value={event}>{event}</option>
              ))}
            </select>
            <select className="rounded-md border bg-background px-3 py-2 text-sm" value={ruleForm.channels} onChange={(e) => setRuleForm((prev) => ({ ...prev, channels: e.target.value }))}>
              {["PUSH", "EMAIL", "SMS"].map((channel) => (
                <option key={channel} value={channel}>{channel}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <Input placeholder="Roles CSV" value={ruleForm.rolesCsv} onChange={(e) => setRuleForm((prev) => ({ ...prev, rolesCsv: e.target.value }))} />
            <Input type="number" placeholder="Throttle minutes" value={ruleForm.throttleMinutes} onChange={(e) => setRuleForm((prev) => ({ ...prev, throttleMinutes: e.target.value }))} />
            <Button onClick={createRule}>Create rule</Button>
          </div>
          <Textarea rows={3} placeholder="Conditions JSON" value={ruleForm.conditionsJson} onChange={(e) => setRuleForm((prev) => ({ ...prev, conditionsJson: e.target.value }))} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={resolveRuleDemo}>Test resolve</Button>
            {ruleResolve ? <p className="text-xs text-muted-foreground self-center">Matched {ruleResolve.rules?.length ?? 0} rule(s), recipients {ruleResolve.recipients?.length ?? 0}</p> : null}
          </div>
          <div className="space-y-2">
            {rules.map((rule) => (
              <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                <p>{rule.name} - {rule.event} ({rule.channels.join(", ")})</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={async () => {
                    await fetch(`/api/admin/phase4/notification-rules/${rule.id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ isActive: !rule.isActive }),
                    });
                    loadBoot();
                  }}>
                    {rule.isActive ? "Disable" : "Enable"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={async () => {
                    await fetch(`/api/admin/phase4/notification-rules/${rule.id}`, { method: "DELETE" });
                    loadBoot();
                  }}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Template Versioning + Rollback</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <select className="rounded-md border bg-background px-3 py-2 text-sm" value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
              <option value="">Select template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.serviceType})
                </option>
              ))}
            </select>
            <Button variant="outline" onClick={createTemplateVersionNow} disabled={!selectedTemplateId}>Create next version</Button>
            <Button variant="outline" onClick={async () => {
              if (!selectedTemplateId) return;
              const res = await fetch(`/api/admin/phase4/template-versions/${selectedTemplateId}`);
              const body = await res.json().catch(() => ({}));
              setTemplateHistory(Array.isArray(body?.templates) ? body.templates : []);
            }} disabled={!selectedTemplateId}>
              Refresh
            </Button>
          </div>
          <div className="space-y-2">
            {templateHistory.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <p>{item.name} - v{item.version} {item.isActive ? "(active)" : ""}</p>
                {!item.isActive ? (
                  <Button size="sm" onClick={() => rollbackTemplate(item.id)}>Rollback</Button>
                ) : (
                  <Badge variant="success">Active</Badge>
                )}
              </div>
            ))}
            {selectedTemplateId && templateHistory.length === 0 ? <p className="text-sm text-muted-foreground">No version history found.</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Smart Stock Purchasing Optimizer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-4">
            <select className="rounded-md border bg-background px-3 py-2 text-sm" value={shoppingRunId} onChange={(e) => setShoppingRunId(e.target.value)}>
              <option value="">Select shopping run</option>
              {shoppingRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.name}
                </option>
              ))}
            </select>
            <Input type="number" placeholder="Budget" value={budget} onChange={(e) => setBudget(e.target.value)} />
            <Input type="number" placeholder="Max units" value={maxUnits} onChange={(e) => setMaxUnits(e.target.value)} />
            <Input type="number" placeholder="Max lines" value={maxLines} onChange={(e) => setMaxLines(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => optimizeShopping(false)} disabled={!shoppingRunId}>Preview optimization</Button>
            <Button onClick={() => optimizeShopping(true)} disabled={!shoppingRunId}>Apply optimization</Button>
          </div>
          {shoppingOptimization?.optimized ? (
            <p className="text-sm text-muted-foreground">
              Used budget ${shoppingOptimization.optimized.usedBudget.toFixed(2)} | Units {shoppingOptimization.optimized.usedUnits} | Lines {shoppingOptimization.optimized.usedLines}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
