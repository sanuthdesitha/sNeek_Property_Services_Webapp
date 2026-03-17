"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { MultiSelectDropdown } from "@/components/shared/multi-select-dropdown";
import { JobAttachmentsInput } from "@/components/admin/job-attachments-input";
import { toast } from "@/hooks/use-toast";
import type { JobReferenceAttachment, JobTimingPreset } from "@/lib/jobs/meta";

const JOB_TYPES = [
  "AIRBNB_TURNOVER","DEEP_CLEAN","END_OF_LEASE","GENERAL_CLEAN","POST_CONSTRUCTION",
  "PRESSURE_WASH","WINDOW_CLEAN","LAWN_MOWING","SPECIAL_CLEAN","COMMERCIAL_RECURRING",
] as const;

type TimingRule = { enabled: boolean; preset: JobTimingPreset; time: string };
type BulkScheduleLine = {
  scheduledDate: string;
  startTime?: string;
  dueTime?: string;
  endTime?: string;
};
type FormState = {
  propertyId: string; jobType: (typeof JOB_TYPES)[number]; scheduledDate: string;
  startTime: string; dueTime: string; endTime: string; estimatedHours: string;
  notes: string; internalNotes: string; tagsText: string; attachments: JobReferenceAttachment[];
  isDraft: boolean; earlyCheckin: TimingRule; lateCheckout: TimingRule;
};
type PropertyOption = { id: string; name: string; suburb: string };
type PropertyWithDefaults = PropertyOption & { defaultCleanDurationHours: number };
type CleanerOption = { id: string; name: string | null; email: string | null; isActive?: boolean };
type JobTemplateOption = {
  id: string; name: string; jobType: (typeof JOB_TYPES)[number]; startTime?: string; dueTime?: string;
  endTime?: string; estimatedHours?: number; notes?: string; internalNotes?: string; isDraft?: boolean;
  tags?: string[]; attachments?: JobReferenceAttachment[];
  earlyCheckin?: { enabled?: boolean; preset?: JobTimingPreset; time?: string };
  lateCheckout?: { enabled?: boolean; preset?: JobTimingPreset; time?: string };
};

const emptyRule = (preset: JobTimingPreset = "none"): TimingRule => ({
  enabled: preset !== "none",
  preset,
  time: preset === "custom" ? "" : preset !== "none" ? preset : "",
});

const initialForm = (propertyId = ""): FormState => ({
  propertyId, jobType: "AIRBNB_TURNOVER", scheduledDate: "", startTime: "10:00", dueTime: "15:00",
  endTime: "", estimatedHours: "", notes: "", internalNotes: "", tagsText: "", attachments: [],
  isDraft: false, earlyCheckin: emptyRule(), lateCheckout: emptyRule(),
});

const parseTags = (text: string) => text.split(",").map((v) => v.trim()).filter(Boolean);
const isValidDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const apiRule = (rule: TimingRule) => rule.enabled ? { enabled: true, preset: rule.preset, time: rule.preset === "custom" ? rule.time || undefined : undefined } : { enabled: false, preset: "none" as const };

function normalizeTimeToken(token?: string) {
  if (!token) return undefined;
  const match = token.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseBulkScheduleLines(input: string) {
  const rawLines = input
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
  const valid: BulkScheduleLine[] = [];
  const invalid: string[] = [];

  for (const line of rawLines) {
    const tokens = line.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 4) {
      invalid.push(line);
      continue;
    }
    const [dateToken, startToken, dueToken, endToken] = tokens;
    if (!isValidDate(dateToken)) {
      invalid.push(line);
      continue;
    }
    const startTime = normalizeTimeToken(startToken);
    const dueTime = normalizeTimeToken(dueToken);
    const endTime = normalizeTimeToken(endToken);
    const hasInvalidTime =
      (startToken !== undefined && !startTime) ||
      (dueToken !== undefined && !dueTime) ||
      (endToken !== undefined && !endTime);
    if (hasInvalidTime) {
      invalid.push(line);
      continue;
    }
    valid.push({
      scheduledDate: dateToken,
      startTime,
      dueTime,
      endTime,
    });
  }

  const deduped = Array.from(
    new Map(
      valid.map((entry) => [
        `${entry.scheduledDate}|${entry.startTime ?? ""}|${entry.dueTime ?? ""}|${entry.endTime ?? ""}`,
        entry,
      ])
    ).values()
  );

  return { valid: deduped, invalid };
}

export function NewJobForm({ initialPropertyId }: { initialPropertyId?: string }) {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyWithDefaults[]>([]);
  const [cleaners, setCleaners] = useState<CleanerOption[]>([]);
  const [jobTemplates, setJobTemplates] = useState<JobTemplateOption[]>([]);
  const [templateToApply, setTemplateToApply] = useState("");
  const [newTemplateName, setNewTemplateName] = useState("");
  const [editTemplateName, setEditTemplateName] = useState("");
  const [deleteTemplateOpen, setDeleteTemplateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [updatingTemplate, setUpdatingTemplate] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [bulkPropertyIds, setBulkPropertyIds] = useState<string[]>([]);
  const [bulkDatesText, setBulkDatesText] = useState("");
  const [useBulkAllocatedHours, setUseBulkAllocatedHours] = useState(false);
  const [bulkAllocatedHours, setBulkAllocatedHours] = useState("");
  const [selectedCleaners, setSelectedCleaners] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>(() => initialForm(initialPropertyId ?? ""));

  useEffect(() => {
    fetch("/api/admin/properties", { cache: "no-store" }).then((r) => r.json()).then((data) => setProperties(Array.isArray(data) ? data.map((p: any) => ({ id: p.id, name: p.name, suburb: p.suburb, defaultCleanDurationHours: typeof p?.accessInfo?.defaultCleanDurationHours === "number" ? p.accessInfo.defaultCleanDurationHours : 3 })) : []));
    fetch(`/api/admin/users?role=CLEANER&includeInactive=1&t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json()).then((data) => setCleaners(Array.isArray(data) ? data : []));
    fetch("/api/admin/job-templates", { cache: "no-store" }).then((r) => r.json()).then((data) => setJobTemplates(Array.isArray(data) ? data : []));
  }, []);

  useEffect(() => {
    const t = jobTemplates.find((row) => row.id === templateToApply);
    setEditTemplateName(t?.name ?? "");
  }, [templateToApply, jobTemplates]);

  useEffect(() => {
    const property = properties.find((row) => row.id === form.propertyId);
    if (!property) return;
    setForm((prev) => ({
      ...prev,
      estimatedHours: property.defaultCleanDurationHours > 0 ? String(property.defaultCleanDurationHours) : prev.estimatedHours,
      dueTime: !prev.dueTime || prev.dueTime === "14:00" ? "15:00" : prev.dueTime,
    }));
  }, [form.propertyId, properties]);

  const cleanerOptions = useMemo(() => cleaners.map((c) => ({
    id: c.id,
    label: c.name ?? c.email ?? c.id,
    hint: c.isActive === false ? "Pending verification or disabled" : c.email ?? undefined,
    disabled: c.isActive === false,
  })), [cleaners]);
  const propertyOptions = useMemo(() => properties.map((p) => ({ id: p.id, label: `${p.name} (${p.suburb})` })), [properties]);
  const parsedBulkLines = useMemo(() => parseBulkScheduleLines(bulkDatesText), [bulkDatesText]);

  function setRule(kind: "earlyCheckin" | "lateCheckout", preset: JobTimingPreset) {
    setForm((prev) => {
      const time = preset === "custom" ? prev[kind].time : preset !== "none" ? preset : "";
      const next = { ...prev, [kind]: { enabled: preset !== "none", preset, time } } as FormState;
      if (kind === "earlyCheckin" && preset !== "none" && time) next.dueTime = time;
      if (kind === "lateCheckout" && preset !== "none" && time) next.startTime = time;
      if (next.startTime && next.dueTime && next.dueTime < next.startTime) {
        next.dueTime = next.startTime;
      }
      return next;
    });
  }

  function applyTemplate(templateId: string) {
    const t = jobTemplates.find((row) => row.id === templateId);
    if (!t) return;
    setForm((prev) => ({
      ...prev,
      jobType: t.jobType,
      startTime: t.startTime ?? prev.startTime,
      dueTime: t.dueTime ?? prev.dueTime,
      endTime: t.endTime ?? "",
      estimatedHours: t.estimatedHours != null ? String(t.estimatedHours) : prev.estimatedHours,
      notes: t.notes ?? "",
      internalNotes: t.internalNotes ?? "",
      isDraft: t.isDraft ?? false,
      tagsText: Array.isArray(t.tags) ? t.tags.join(", ") : "",
      attachments: Array.isArray(t.attachments) ? t.attachments : [],
      earlyCheckin: { enabled: t.earlyCheckin?.enabled === true, preset: t.earlyCheckin?.preset ?? "none", time: t.earlyCheckin?.preset === "custom" ? t.earlyCheckin?.time ?? "" : t.earlyCheckin?.preset && t.earlyCheckin.preset !== "none" ? t.earlyCheckin.preset : "" },
      lateCheckout: { enabled: t.lateCheckout?.enabled === true, preset: t.lateCheckout?.preset ?? "none", time: t.lateCheckout?.preset === "custom" ? t.lateCheckout?.time ?? "" : t.lateCheckout?.preset && t.lateCheckout.preset !== "none" ? t.lateCheckout.preset : "" },
    }));
    toast({ title: `Template applied: ${t.name}` });
  }

  async function saveTemplate(mode: "new" | "update") {
    const id = mode === "update" ? templateToApply : "";
    const name = (mode === "update" ? editTemplateName : newTemplateName).trim();
    if (!name) return toast({ title: "Template name is required.", variant: "destructive" });
    if (mode === "update" && !id) return toast({ title: "Select a template first.", variant: "destructive" });
    mode === "new" ? setSavingTemplate(true) : setUpdatingTemplate(true);
    try {
      const emptyValue = mode === "new" ? undefined : null;
      const payload = {
        name, jobType: form.jobType, startTime: form.startTime || emptyValue, dueTime: form.dueTime || emptyValue, endTime: form.endTime || emptyValue,
        estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : emptyValue, notes: form.notes || emptyValue, internalNotes: form.internalNotes || emptyValue,
        isDraft: form.isDraft, tags: parseTags(form.tagsText), attachments: form.attachments, earlyCheckin: apiRule(form.earlyCheckin), lateCheckout: apiRule(form.lateCheckout),
      };
      const res = await fetch(mode === "new" ? "/api/admin/job-templates" : `/api/admin/job-templates/${id}`, {
        method: mode === "new" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to save template.");
      if (mode === "new") {
        setJobTemplates((prev) => [body, ...prev]);
        setNewTemplateName("");
        setTemplateToApply(body.id);
      } else {
        setJobTemplates((prev) => prev.map((row) => (row.id === id ? { ...row, ...body } : row)));
      }
      toast({ title: mode === "new" ? "Template saved" : "Template updated" });
    } catch (err: any) {
      toast({ title: "Template failed", description: err.message ?? "Try again.", variant: "destructive" });
    } finally {
      setSavingTemplate(false);
      setUpdatingTemplate(false);
    }
  }

  async function deleteTemplate() {
    if (!templateToApply) return;
    setDeletingTemplate(true);
    try {
      const res = await fetch(`/api/admin/job-templates/${templateToApply}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to delete template.");
      setJobTemplates((prev) => prev.filter((row) => row.id !== templateToApply));
      setTemplateToApply("");
      setEditTemplateName("");
      setDeleteTemplateOpen(false);
      toast({ title: "Template deleted" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message ?? "Try again.", variant: "destructive" });
    } finally {
      setDeletingTemplate(false);
    }
  }

  function buildPlan() {
    const propertyIds = bulkPropertyIds.length > 0 ? bulkPropertyIds : form.propertyId ? [form.propertyId] : [];
    const lines = parsedBulkLines.valid.length > 0 ? parsedBulkLines.valid : form.scheduledDate ? [{ scheduledDate: form.scheduledDate }] : [];
    return propertyIds.flatMap((propertyId) =>
      lines.map((line) => ({
        propertyId,
        scheduledDate: line.scheduledDate,
        startTime: line.startTime,
        dueTime: line.dueTime,
        endTime: line.endTime,
      }))
    );
  }

  async function submitJobs(asDraft: boolean) {
    const plan = buildPlan();
    if (plan.length === 0) return toast({ title: "Choose at least one property and date.", variant: "destructive" });
    if (plan.some((item) => !isValidDate(item.scheduledDate))) return toast({ title: "One or more dates are invalid.", variant: "destructive" });
    if (parsedBulkLines.invalid.length > 0) {
      return toast({
        title: "Bulk schedule has invalid rows.",
        description: "Use YYYY-MM-DD or YYYY-MM-DD HH:mm HH:mm [HH:mm].",
        variant: "destructive",
      });
    }
    if ((form.earlyCheckin.enabled && form.earlyCheckin.preset === "custom" && !form.earlyCheckin.time) || (form.lateCheckout.enabled && form.lateCheckout.preset === "custom" && !form.lateCheckout.time)) {
      return toast({ title: "Custom turnaround times are required.", variant: "destructive" });
    }
    const defaultEstimatedHours = form.estimatedHours ? Number(form.estimatedHours) : undefined;
    const bulkEstimatedHours = useBulkAllocatedHours ? Number(bulkAllocatedHours) : undefined;
    if (useBulkAllocatedHours && (!(bulkEstimatedHours && Number.isFinite(bulkEstimatedHours)) || bulkEstimatedHours <= 0)) {
      return toast({ title: "Bulk fixed pay hours must be greater than 0.", variant: "destructive" });
    }
    setSaving(true);
    try {
      const created: any[] = [];
      for (const item of plan) {
        const startTime = (item.startTime ?? form.startTime) || undefined;
        const dueTime = (item.dueTime ?? form.dueTime) || undefined;
        const endTime = (item.endTime ?? form.endTime) || undefined;
        if (startTime && dueTime && dueTime < startTime) {
          throw new Error(`Due time must be after start time for ${item.scheduledDate}.`);
        }
        const payload = {
          propertyId: item.propertyId, jobType: form.jobType, scheduledDate: `${item.scheduledDate}T00:00:00.000Z`,
          startTime, dueTime, endTime,
          estimatedHours: useBulkAllocatedHours ? bulkEstimatedHours : defaultEstimatedHours, notes: form.notes || undefined, internalNotes: form.internalNotes || undefined,
          isDraft: asDraft, tags: parseTags(form.tagsText), attachments: form.attachments, earlyCheckin: apiRule(form.earlyCheckin), lateCheckout: apiRule(form.lateCheckout),
        };
        const createRes = await fetch("/api/admin/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const createdJob = await createRes.json().catch(() => ({}));
        if (!createRes.ok) throw new Error(createdJob.error ?? "Failed to create job.");
        if (selectedCleaners.length > 0) {
          const assignRes = await fetch(`/api/admin/jobs/${createdJob.id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userIds: selectedCleaners, primaryUserId: selectedCleaners[0] }) });
          const assignBody = await assignRes.json().catch(() => ({}));
          if (!assignRes.ok) throw new Error(assignBody.error ?? "Job created, but assignment failed.");
        }
        created.push(createdJob);
      }
      toast({ title: plan.length > 1 ? `${plan.length} jobs created` : asDraft ? "Draft saved" : "Job created" });
      router.push(created.length === 1 ? `/admin/jobs/${created[0].id}` : "/admin/jobs");
      router.refresh();
    } catch (err: any) {
      toast({ title: asDraft ? "Draft save failed" : "Create failed", description: err.message ?? "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const plannedCount = buildPlan().length;
  const earlyText = form.earlyCheckin.enabled ? `Complete before ${form.earlyCheckin.preset === "custom" ? form.earlyCheckin.time || "--:--" : form.earlyCheckin.preset}` : "";
  const lateText = form.lateCheckout.enabled ? `Start after ${form.lateCheckout.preset === "custom" ? form.lateCheckout.time || "--:--" : form.lateCheckout.preset}` : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-2xl font-bold">Create Jobs</h2><p className="text-sm text-muted-foreground">Single create, draft save, and bulk create in one flow.</p></div>
        <Button asChild variant="outline"><Link href="/admin/jobs">Back</Link></Button>
      </div>

      <Card><CardContent className="grid gap-4 p-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Planned jobs</p><p className="text-2xl font-semibold">{plannedCount}</p></div><div><p className="text-xs text-muted-foreground">Assignees</p><p className="text-2xl font-semibold">{selectedCleaners.length}</p></div><div><p className="text-xs text-muted-foreground">Files</p><p className="text-2xl font-semibold">{form.attachments.length}</p></div></CardContent></Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Templates</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Select value={templateToApply} onValueChange={setTemplateToApply}>
              <SelectTrigger><SelectValue placeholder={jobTemplates.length ? "Select template" : "No templates"} /></SelectTrigger>
              <SelectContent>{jobTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.jobType.replace(/_/g, " ")})</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" variant="outline" disabled={!templateToApply} onClick={() => applyTemplate(templateToApply)}>Apply</Button>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} placeholder="New template name" />
            <Button type="button" variant="secondary" disabled={savingTemplate} onClick={() => saveTemplate("new")}>{savingTemplate ? "Saving..." : "Save as template"}</Button>
          </div>
          {templateToApply ? <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]"><Input value={editTemplateName} onChange={(e) => setEditTemplateName(e.target.value)} placeholder="Template name" /><Button type="button" variant="outline" disabled={updatingTemplate} onClick={() => saveTemplate("update")}>{updatingTemplate ? "Updating..." : "Update"}</Button><Button type="button" variant="destructive" disabled={deletingTemplate} onClick={() => setDeleteTemplateOpen(true)}>{deletingTemplate ? "Deleting..." : "Delete"}</Button></div> : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Job Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5"><Label>Property</Label><Select value={form.propertyId} onValueChange={(value) => setForm((prev) => ({ ...prev, propertyId: value }))}><SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger><SelectContent>{properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.suburb})</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label>Job Type</Label><Select value={form.jobType} onValueChange={(value: (typeof JOB_TYPES)[number]) => setForm((prev) => ({ ...prev, jobType: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{JOB_TYPES.map((jobType) => <SelectItem key={jobType} value={jobType}>{jobType.replace(/_/g, " ")}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5"><Label>Scheduled Date</Label><Input type="date" value={form.scheduledDate} onChange={(e) => setForm((prev) => ({ ...prev, scheduledDate: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Fixed / Allocated Pay Hours</Label><Input type="number" step="0.25" min="0" value={form.estimatedHours} onChange={(e) => setForm((prev) => ({ ...prev, estimatedHours: e.target.value }))} /><p className="text-xs text-muted-foreground">When set, cleaner pay uses these hours (split across assignees).</p></div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5"><Label>Start Time</Label><Input type="time" value={form.startTime} onChange={(e) => setForm((prev) => ({ ...prev, startTime: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Due Time</Label><Input type="time" value={form.dueTime} onChange={(e) => setForm((prev) => ({ ...prev, dueTime: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>End Time</Label><Input type="time" value={form.endTime} onChange={(e) => setForm((prev) => ({ ...prev, endTime: e.target.value }))} /></div>
              </div>
              <div className="space-y-1.5"><Label>Assign Cleaners</Label><MultiSelectDropdown options={cleanerOptions} selected={selectedCleaners} onChange={setSelectedCleaners} placeholder="Select cleaner accounts" emptyText="No cleaner accounts." /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Turnaround Flags</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Early check-in</Label>
                  <Select value={form.earlyCheckin.preset} onValueChange={(value) => setRule("earlyCheckin", value as JobTimingPreset)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="11:00">Before 11:00 AM</SelectItem>
                      <SelectItem value="12:30">Before 12:30 PM</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.earlyCheckin.preset === "custom" ? (
                    <Input
                      type="time"
                      value={form.earlyCheckin.time}
                      onChange={(e) =>
                        setForm((prev) => {
                          const next = {
                            ...prev,
                            earlyCheckin: { ...prev.earlyCheckin, enabled: true, time: e.target.value },
                          };
                          if (e.target.value) {
                            next.dueTime = e.target.value;
                          }
                          if (next.startTime && next.dueTime && next.dueTime < next.startTime) {
                            next.dueTime = next.startTime;
                          }
                          return next;
                        })
                      }
                    />
                  ) : null}
                  {earlyText ? <p className="text-xs text-amber-700">{earlyText}</p> : null}
                </div>
                <div className="space-y-2">
                  <Label>Late checkout</Label>
                  <Select value={form.lateCheckout.preset} onValueChange={(value) => setRule("lateCheckout", value as JobTimingPreset)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="12:30">Start after 12:30 PM</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                  {form.lateCheckout.preset === "custom" ? (
                    <Input
                      type="time"
                      value={form.lateCheckout.time}
                      onChange={(e) =>
                        setForm((prev) => {
                          const next = {
                            ...prev,
                            lateCheckout: { ...prev.lateCheckout, enabled: true, time: e.target.value },
                          };
                          if (e.target.value) {
                            next.startTime = e.target.value;
                          }
                          if (next.startTime && next.dueTime && next.dueTime < next.startTime) {
                            next.dueTime = next.startTime;
                          }
                          return next;
                        })
                      }
                    />
                  ) : null}
                  {lateText ? <p className="text-xs text-amber-700">{lateText}</p> : null}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Notes, Tags, Files</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5"><Label>Tags</Label><Input value={form.tagsText} onChange={(e) => setForm((prev) => ({ ...prev, tagsText: e.target.value }))} placeholder="priority, VIP guest, keys" /></div>
              <div className="space-y-1.5"><Label>Cleaner Notes</Label><Textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Internal Notes</Label><Textarea value={form.internalNotes} onChange={(e) => setForm((prev) => ({ ...prev, internalNotes: e.target.value }))} /></div>
              <JobAttachmentsInput value={form.attachments} onChange={(attachments) => setForm((prev) => ({ ...prev, attachments }))} />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="relative z-20">
            <CardHeader><CardTitle className="text-base">Bulk Create</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5"><Label>Bulk properties</Label><MultiSelectDropdown options={propertyOptions} selected={bulkPropertyIds} onChange={setBulkPropertyIds} placeholder="Use single property above" emptyText="No properties." /></div>
              <div className="space-y-1.5">
                <Label>Bulk schedule lines</Label>
                <Textarea value={bulkDatesText} onChange={(e) => setBulkDatesText(e.target.value)} placeholder={"2026-03-05\n2026-03-06 10:00 15:00\n2026-03-07 12:30 16:30 17:00"} />
                <p className="text-xs text-muted-foreground">Format per line: YYYY-MM-DD [start HH:mm] [due HH:mm] [end HH:mm].</p>
                {parsedBulkLines.invalid.length > 0 ? <p className="text-xs text-destructive">{parsedBulkLines.invalid.length} invalid line(s) must be fixed before creating jobs.</p> : null}
              </div>
              <div className="space-y-2 rounded-lg border border-border/70 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useBulkAllocatedHours}
                    onChange={(e) => setUseBulkAllocatedHours(e.target.checked)}
                  />
                  Override fixed pay hours for all planned jobs
                </label>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={bulkAllocatedHours}
                    onChange={(e) => setBulkAllocatedHours(e.target.value)}
                    disabled={!useBulkAllocatedHours}
                    placeholder="2"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setUseBulkAllocatedHours(true);
                      setBulkAllocatedHours("2");
                      setForm((prev) => ({ ...prev, jobType: "AIRBNB_TURNOVER" }));
                    }}
                  >
                    Airbnb 2h preset
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{plannedCount === 0 ? "Choose a property and date." : plannedCount === 1 ? "One job will be created." : `${plannedCount} jobs will be created.`}</p>
            </CardContent>
          </Card>

          <Card className="relative z-10">
            <CardHeader><CardTitle className="text-base">Status</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={form.isDraft} onChange={(e) => setForm((prev) => ({ ...prev, isDraft: e.target.checked }))} /> Mark as draft by default</label>
              <div className="rounded-xl border border-border/70 p-3 text-xs text-muted-foreground">
                <p>{parseTags(form.tagsText).length} tag(s)</p>
                <p>{form.attachments.length} file(s)</p>
                <p>{form.isDraft ? "Draft mode enabled" : "Draft mode disabled"}</p>
                {earlyText ? <p>{earlyText}</p> : null}
                {lateText ? <p>{lateText}</p> : null}
              </div>
              <div className="grid gap-2">
                <Button onClick={() => submitJobs(form.isDraft)} disabled={saving}>{saving ? "Saving..." : plannedCount > 1 ? "Create planned jobs" : "Create job"}</Button>
                <Button variant="outline" onClick={() => submitJobs(true)} disabled={saving}>Save as draft</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <TwoStepConfirmDialog open={deleteTemplateOpen} onOpenChange={setDeleteTemplateOpen} title="Delete job template" description="This removes the saved template." confirmLabel="Delete template" loading={deletingTemplate} onConfirm={deleteTemplate} />
    </div>
  );
}
