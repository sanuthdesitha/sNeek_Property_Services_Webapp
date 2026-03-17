"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

const JOB_TYPES = [
  "AIRBNB_TURNOVER",
  "DEEP_CLEAN",
  "END_OF_LEASE",
  "GENERAL_CLEAN",
  "POST_CONSTRUCTION",
  "PRESSURE_WASH",
  "WINDOW_CLEAN",
  "LAWN_MOWING",
  "SPECIAL_CLEAN",
  "COMMERCIAL_RECURRING",
];

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_RULE_FORM = {
  id: "",
  name: "",
  propertyId: "",
  jobType: "AIRBNB_TURNOVER",
  daysOfWeek: [1, 3, 5] as number[],
  startTime: "10:00",
  dueTime: "15:00",
  estimatedHours: "3",
  assigneeIds: [] as string[],
};

export default function OpsPage() {
  const [properties, setProperties] = useState<any[]>([]);
  const [cleaners, setCleaners] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningSla, setRunningSla] = useState(false);
  const [generatingRecurring, setGeneratingRecurring] = useState(false);
  const [routeDate, setRouteDate] = useState(todayKey());
  const [routes, setRoutes] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);
  const [ruleForm, setRuleForm] = useState({
    ...EMPTY_RULE_FORM,
  });
  const [rangeStart, setRangeStart] = useState(todayKey());
  const [rangeEnd, setRangeEnd] = useState(
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );

  async function loadAll() {
    setLoading(true);
    const [propsRes, cleanersRes, rulesRes, jobsRes] = await Promise.all([
      fetch("/api/admin/properties"),
      fetch("/api/admin/users?role=CLEANER&includeInactive=0"),
      fetch("/api/admin/recurring-jobs"),
      fetch("/api/jobs?status=UNASSIGNED"),
    ]);
    const [propsBody, cleanersBody, rulesBody, jobsBody] = await Promise.all([
      propsRes.json().catch(() => []),
      cleanersRes.json().catch(() => []),
      rulesRes.json().catch(() => []),
      jobsRes.json().catch(() => []),
    ]);
    setProperties(Array.isArray(propsBody) ? propsBody : []);
    setCleaners(Array.isArray(cleanersBody) ? cleanersBody : []);
    setRules(Array.isArray(rulesBody) ? rulesBody : []);
    setJobs(Array.isArray(jobsBody) ? jobsBody : []);
    setLoading(false);
  }

  async function loadRoutePlan(date = routeDate) {
    const res = await fetch(`/api/admin/dispatch/routes?date=${date}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Route plan failed", description: body.error ?? "Could not load routes.", variant: "destructive" });
      return;
    }
    setRoutes(Array.isArray(body.routes) ? body.routes : []);
  }

  async function runSlaNow() {
    setRunningSla(true);
    const res = await fetch("/api/admin/ops/sla/run", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setRunningSla(false);
    if (!res.ok) {
      toast({ title: "SLA run failed", description: body.error ?? "Could not run SLA escalation.", variant: "destructive" });
      return;
    }
    toast({
      title: "SLA run complete",
      description: `Warned ${body.warned ?? 0}, escalated ${body.escalated ?? 0}.`,
    });
  }

  async function generateRecurringNow() {
    setGeneratingRecurring(true);
    const res = await fetch("/api/admin/recurring-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate", startDate: rangeStart, endDate: rangeEnd }),
    });
    const body = await res.json().catch(() => ({}));
    setGeneratingRecurring(false);
    if (!res.ok) {
      toast({ title: "Generation failed", description: body.error ?? "Could not generate recurring jobs.", variant: "destructive" });
      return;
    }
    toast({
      title: "Recurring generation complete",
      description: `Created ${body.created ?? 0}, skipped ${body.skipped ?? 0}.`,
    });
    await loadAll();
  }

  async function saveRule() {
    if (!ruleForm.name.trim() || !ruleForm.propertyId) {
      toast({ title: "Missing fields", description: "Name and property are required.", variant: "destructive" });
      return;
    }
    const res = await fetch("/api/admin/recurring-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...ruleForm,
        id: ruleForm.id || undefined,
        estimatedHours: Number(ruleForm.estimatedHours || 0),
        assigneeIds: ruleForm.assigneeIds,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Rule save failed", description: body.error ?? "Could not save rule.", variant: "destructive" });
      return;
    }
    toast({ title: ruleForm.id ? "Recurring rule updated" : "Recurring rule saved" });
    setRuleForm({ ...EMPTY_RULE_FORM });
    await loadAll();
  }

  async function toggleRule(rule: any, nextActive: boolean) {
    const res = await fetch(`/api/admin/recurring-jobs/${rule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: nextActive }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Update failed", description: body.error ?? "Could not update rule.", variant: "destructive" });
      return;
    }
    toast({ title: nextActive ? "Rule activated" : "Rule deactivated" });
    await loadAll();
  }

  async function deleteRule(ruleId: string) {
    const res = await fetch(`/api/admin/recurring-jobs/${ruleId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete rule.", variant: "destructive" });
      return;
    }
    toast({ title: "Recurring rule deleted" });
    await loadAll();
  }

  function editRule(rule: any) {
    setRuleForm({
      id: rule.id,
      name: rule.name ?? "",
      propertyId: rule.propertyId ?? "",
      jobType: rule.jobType ?? "AIRBNB_TURNOVER",
      daysOfWeek: Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length > 0 ? rule.daysOfWeek : [1, 3, 5],
      startTime: rule.startTime ?? "10:00",
      dueTime: rule.dueTime ?? "15:00",
      estimatedHours:
        typeof rule.estimatedHours === "number" && Number.isFinite(rule.estimatedHours)
          ? String(rule.estimatedHours)
          : "3",
      assigneeIds: Array.isArray(rule.assigneeIds) ? rule.assigneeIds : [],
    });
  }

  async function suggestForJob(jobId: string) {
    if (!jobId) {
      setSuggestions([]);
      return;
    }
    const res = await fetch(`/api/admin/dispatch/auto-assign/${jobId}/suggest`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Suggestion failed", description: body.error ?? "Could not generate suggestions.", variant: "destructive" });
      return;
    }
    const rows = Array.isArray(body.suggestions) ? body.suggestions : [];
    setSuggestions(rows);
    setSelectedSuggestionIds(rows.slice(0, 1).map((row: any) => row.cleanerId));
  }

  async function applyAssignment() {
    if (!selectedJobId || selectedSuggestionIds.length === 0) {
      toast({ title: "Selection required", description: "Select a job and at least one cleaner.", variant: "destructive" });
      return;
    }
    setAssigning(true);
    const res = await fetch(`/api/admin/dispatch/auto-assign/${selectedJobId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cleanerIds: selectedSuggestionIds }),
    });
    const body = await res.json().catch(() => ({}));
    setAssigning(false);
    if (!res.ok) {
      toast({ title: "Auto-assign failed", description: body.error ?? "Could not apply assignment.", variant: "destructive" });
      return;
    }
    toast({ title: "Auto-assignment applied" });
    await loadAll();
  }

  useEffect(() => {
    loadAll();
    loadRoutePlan(routeDate);
  }, []);

  const jobOptions = useMemo(
    () =>
      jobs.map((job) => ({
        id: job.id,
        label: `${job.property?.name ?? "Property"} - ${job.jobType?.replace(/_/g, " ")} (${format(new Date(job.scheduledDate), "dd MMM")})`,
      })),
    [jobs]
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Ops Automation</h2>
        <p className="text-sm text-muted-foreground">
          SLA escalation, recurring generation, smart assignment, route planning, and QA recovery controls.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">SLA + Recurring Jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button onClick={runSlaNow} disabled={runningSla}>
                {runningSla ? "Running..." : "Run SLA Escalation Now"}
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Generate from</Label>
                <Input type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Generate to</Label>
                <Input type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
              </div>
            </div>
            <Button variant="outline" onClick={generateRecurringNow} disabled={generatingRecurring}>
              {generatingRecurring ? "Generating..." : "Generate Recurring Jobs Now"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Smart Auto-Assignment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Unassigned job</Label>
              <Select
                value={selectedJobId}
                onValueChange={(value) => {
                  setSelectedJobId(value);
                  suggestForJob(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={loading ? "Loading jobs..." : "Select a job"} />
                </SelectTrigger>
                <SelectContent>
                  {jobOptions.map((job) => (
                    <SelectItem key={job.id} value={job.id}>
                      {job.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 rounded-md border p-3">
              {suggestions.length === 0 ? (
                <p className="text-xs text-muted-foreground">Pick a job to see ranked suggestions.</p>
              ) : (
                suggestions.slice(0, 5).map((row) => (
                  <label key={row.cleanerId} className="flex items-start gap-2">
                    <Checkbox
                      checked={selectedSuggestionIds.includes(row.cleanerId)}
                      onCheckedChange={(checked) =>
                        setSelectedSuggestionIds((prev) =>
                          checked
                            ? Array.from(new Set([...prev, row.cleanerId]))
                            : prev.filter((id) => id !== row.cleanerId)
                        )
                      }
                    />
                    <div className="text-sm">
                      <p className="font-medium">
                        {row.cleanerName} <Badge variant="secondary">{row.score}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">{row.reasons?.join(" | ")}</p>
                    </div>
                  </label>
                ))
              )}
            </div>
            <Button onClick={applyAssignment} disabled={assigning}>
              {assigning ? "Applying..." : "Apply Selected Assignment"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recurring Rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Rule name</Label>
              <Input value={ruleForm.name} onChange={(e) => setRuleForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Property</Label>
              <Select value={ruleForm.propertyId} onValueChange={(value) => setRuleForm((prev) => ({ ...prev, propertyId: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select property" />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name} ({property.suburb})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Job type</Label>
              <Select value={ruleForm.jobType} onValueChange={(value) => setRuleForm((prev) => ({ ...prev, jobType: value }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOB_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Start time</Label>
              <Input type="time" value={ruleForm.startTime} onChange={(e) => setRuleForm((prev) => ({ ...prev, startTime: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Due time</Label>
              <Input type="time" value={ruleForm.dueTime} onChange={(e) => setRuleForm((prev) => ({ ...prev, dueTime: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Estimated hours</Label>
              <Input type="number" min={0.5} step={0.5} value={ruleForm.estimatedHours} onChange={(e) => setRuleForm((prev) => ({ ...prev, estimatedHours: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Days of week</Label>
              <Select
                value={ruleForm.daysOfWeek.join(",")}
                onValueChange={(value) =>
                  setRuleForm((prev) => ({
                    ...prev,
                    daysOfWeek: value
                      .split(",")
                      .map((v) => Number(v))
                      .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6),
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1,2,3,4,5">Weekdays</SelectItem>
                  <SelectItem value="0,6">Weekends</SelectItem>
                  <SelectItem value="1,3,5">Mon/Wed/Fri</SelectItem>
                  <SelectItem value="2,4">Tue/Thu</SelectItem>
                  <SelectItem value="0,1,2,3,4,5,6">Every day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Default assignees</Label>
            <div className="grid gap-2 rounded-md border p-3 md:grid-cols-2">
              {cleaners.map((cleaner) => (
                <label key={cleaner.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={ruleForm.assigneeIds.includes(cleaner.id)}
                    onCheckedChange={(checked) =>
                      setRuleForm((prev) => ({
                        ...prev,
                        assigneeIds: checked
                          ? Array.from(new Set([...prev.assigneeIds, cleaner.id]))
                          : prev.assigneeIds.filter((id) => id !== cleaner.id),
                      }))
                    }
                  />
                  <span>{cleaner.name ?? cleaner.email}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={saveRule}>{ruleForm.id ? "Update recurring rule" : "Save recurring rule"}</Button>
            {ruleForm.id ? (
              <Button variant="outline" onClick={() => setRuleForm({ ...EMPTY_RULE_FORM })}>
                Cancel edit
              </Button>
            ) : null}
          </div>

          <div className="space-y-2">
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recurring rules created yet.</p>
            ) : (
              rules.map((rule) => (
                <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                  <div>
                    <p className="font-medium">{rule.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {rule.jobType.replace(/_/g, " ")} - {rule.daysOfWeek.join(",")} - {rule.startTime ?? "no start"} to {rule.dueTime ?? "no due"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={rule.isActive ? "success" : "secondary"}>{rule.isActive ? "Active" : "Disabled"}</Badge>
                    <Button variant="outline" size="sm" onClick={() => editRule(rule)}>
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleRule(rule, !rule.isActive)}
                    >
                      {rule.isActive ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => deleteRule(rule.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily Route Optimization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex max-w-sm items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={routeDate} onChange={(e) => setRouteDate(e.target.value)} />
            </div>
            <Button variant="outline" onClick={() => loadRoutePlan(routeDate)}>
              Load routes
            </Button>
          </div>
          <div className="space-y-3">
            {routes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assigned routes for this day.</p>
            ) : (
              routes.map((route) => (
                <div key={route.cleanerId} className="rounded-md border p-3">
                  <p className="font-medium">
                    {route.cleanerName} ({route.stops.length} stops, {route.totalEstimatedTravelMins} mins travel est.)
                  </p>
                  <div className="mt-2 space-y-1">
                    {route.stops.map((stop: any, index: number) => (
                      <p key={stop.jobId} className="text-sm text-muted-foreground">
                        {index + 1}. {stop.propertyName} - {stop.suburb} - {stop.startTime ?? "TBD"}
                        {index > 0 ? ` (+${stop.estimatedTravelMinsFromPrev}m travel)` : ""}
                      </p>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
