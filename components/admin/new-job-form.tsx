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
import { GoogleAddressInput } from "@/components/shared/google-address-input";
import { toast } from "@/hooks/use-toast";
import type { JobReferenceAttachment, JobTimingPreset } from "@/lib/jobs/meta";

const JOB_TYPES = [
  "AIRBNB_TURNOVER","DEEP_CLEAN","END_OF_LEASE","GENERAL_CLEAN","POST_CONSTRUCTION",
  "PRESSURE_WASH","WINDOW_CLEAN","LAWN_MOWING","SPECIAL_CLEAN","COMMERCIAL_RECURRING",
] as const;
const AIRBNB_JOB_TYPE = "AIRBNB_TURNOVER" as const;
const NON_AIRBNB_RESEARCH_FIELDS_NOTE =
  "Non-Airbnb jobs can capture site contact, access, scope, hazards, floors, and service area so the resolved cleaner form and instructions match the service type.";

type TimingRule = { enabled: boolean; preset: JobTimingPreset; time: string };
type SiteMode = "existing_property" | "service_site";
type BulkScheduleLine = {
  scheduledDate: string;
  startTime?: string;
  dueTime?: string;
  endTime?: string;
};
type FormState = {
  propertyId: string; clientId: string; siteMode: SiteMode; jobType: (typeof JOB_TYPES)[number]; scheduledDate: string;
  startTime: string; dueTime: string; endTime: string; estimatedHours: string;
  notes: string; internalNotes: string; tagsText: string; attachments: JobReferenceAttachment[];
  guestName: string; reservationCode: string; guestPhone: string; guestEmail: string; guestProfileUrl: string;
  guestAdults: string; guestChildren: string; guestInfants: string; guestCheckinAtLocal: string; guestCheckoutAtLocal: string;
  guestLocationText: string;
  siteName: string; siteAddress: string; siteSuburb: string; siteState: string; sitePostcode: string;
  siteContactName: string; siteContactPhone: string; serviceAreaSqm: string; floorCount: string;
  siteBedrooms: string; siteBathrooms: string; siteHasBalcony: boolean;
  scopeOfWork: string; accessInstructions: string; parkingInstructions: string; hazardNotes: string; equipmentNotes: string;
  isDraft: boolean; earlyCheckin: TimingRule; lateCheckout: TimingRule;
};
type PropertyOption = { id: string; name: string; suburb: string };
type PropertyWithDefaults = PropertyOption & { defaultCleanDurationHours: number };
type ClientOption = { id: string; name: string };
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
  propertyId, clientId: "", siteMode: "existing_property", jobType: "AIRBNB_TURNOVER", scheduledDate: "", startTime: "10:00", dueTime: "15:00",
  endTime: "", estimatedHours: "", notes: "", internalNotes: "", tagsText: "", attachments: [],
  guestName: "", reservationCode: "", guestPhone: "", guestEmail: "", guestProfileUrl: "",
  guestAdults: "", guestChildren: "", guestInfants: "", guestCheckinAtLocal: "", guestCheckoutAtLocal: "", guestLocationText: "",
  siteName: "", siteAddress: "", siteSuburb: "", siteState: "NSW", sitePostcode: "",
  siteContactName: "", siteContactPhone: "", serviceAreaSqm: "", floorCount: "",
  siteBedrooms: "", siteBathrooms: "", siteHasBalcony: false,
  scopeOfWork: "", accessInstructions: "", parkingInstructions: "", hazardNotes: "", equipmentNotes: "",
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
  const [clients, setClients] = useState<ClientOption[]>([]);
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
    fetch("/api/admin/clients", { cache: "no-store" }).then((r) => r.json()).then((data) => setClients(Array.isArray(data) ? data.map((c: any) => ({ id: c.id, name: c.name })) : []));
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

  useEffect(() => {
    if (form.jobType === AIRBNB_JOB_TYPE) {
      setForm((prev) => ({
        ...prev,
        siteMode: "existing_property",
      }));
      return;
    }
    if (form.earlyCheckin.enabled || form.lateCheckout.enabled) {
      setForm((prev) => ({
        ...prev,
        earlyCheckin: emptyRule(),
        lateCheckout: emptyRule(),
      }));
    }
  }, [form.jobType, form.earlyCheckin.enabled, form.lateCheckout.enabled]);

  const cleanerOptions = useMemo(() => cleaners.map((c) => ({
    id: c.id,
    label: c.name ?? c.email ?? c.id,
    hint: c.isActive === false ? "Pending verification or disabled" : c.email ?? undefined,
    disabled: c.isActive === false,
  })), [cleaners]);
  const propertyOptions = useMemo(() => properties.map((p) => ({ id: p.id, label: `${p.name} (${p.suburb})` })), [properties]);
  const clientOptions = useMemo(() => clients.map((c) => ({ id: c.id, label: c.name })), [clients]);
  const parsedBulkLines = useMemo(() => parseBulkScheduleLines(bulkDatesText), [bulkDatesText]);
  const isAirbnbTurnover = form.jobType === AIRBNB_JOB_TYPE;
  const usesExistingProperty = isAirbnbTurnover || form.siteMode === "existing_property";

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
        isDraft: form.isDraft,
        tags: parseTags(form.tagsText),
        attachments: form.attachments,
        earlyCheckin: form.jobType === AIRBNB_JOB_TYPE ? apiRule(form.earlyCheckin) : { enabled: false, preset: "none" as const },
        lateCheckout: form.jobType === AIRBNB_JOB_TYPE ? apiRule(form.lateCheckout) : { enabled: false, preset: "none" as const },
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
    const propertyIds = usesExistingProperty
      ? bulkPropertyIds.length > 0
        ? bulkPropertyIds
        : form.propertyId
          ? [form.propertyId]
          : []
      : ["__service_site__"];
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
    if (plan.length === 0) {
      return toast({
        title: usesExistingProperty ? "Choose at least one property and date." : "Add at least one date for this service site job.",
        variant: "destructive",
      });
    }
    if (plan.some((item) => !isValidDate(item.scheduledDate))) return toast({ title: "One or more dates are invalid.", variant: "destructive" });
    if (parsedBulkLines.invalid.length > 0) {
      return toast({
        title: "Bulk schedule has invalid rows.",
        description: "Use YYYY-MM-DD or YYYY-MM-DD HH:mm HH:mm [HH:mm].",
        variant: "destructive",
      });
    }
    if (usesExistingProperty && !isAirbnbTurnover && !form.propertyId && bulkPropertyIds.length === 0) {
      return toast({ title: "Select an existing property or switch to Service site.", variant: "destructive" });
    }
    if (!usesExistingProperty) {
      if (!form.siteName.trim() || !form.siteAddress.trim() || !form.siteSuburb.trim()) {
        return toast({ title: "Service site name, address, and suburb are required.", variant: "destructive" });
      }
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
          propertyId: usesExistingProperty ? item.propertyId : undefined,
          clientId: !usesExistingProperty && form.clientId ? form.clientId : undefined,
          jobType: form.jobType, scheduledDate: `${item.scheduledDate}T00:00:00.000Z`,
          startTime, dueTime, endTime,
          estimatedHours: useBulkAllocatedHours ? bulkEstimatedHours : defaultEstimatedHours, notes: form.notes || undefined, internalNotes: form.internalNotes || undefined,
          isDraft: asDraft, tags: parseTags(form.tagsText), attachments: form.attachments,
          earlyCheckin: isAirbnbTurnover ? apiRule(form.earlyCheckin) : undefined,
          lateCheckout: isAirbnbTurnover ? apiRule(form.lateCheckout) : undefined,
          reservationContext:
            form.guestName ||
            form.reservationCode ||
            form.guestPhone ||
            form.guestEmail ||
            form.guestProfileUrl ||
            form.guestAdults ||
            form.guestChildren ||
            form.guestInfants ||
            form.guestCheckinAtLocal ||
            form.guestCheckoutAtLocal ||
            form.guestLocationText
              ? {
                  guestName: form.guestName.trim() || undefined,
                  reservationCode: form.reservationCode.trim() || undefined,
                  guestPhone: form.guestPhone.trim() || undefined,
                  guestEmail: form.guestEmail.trim() || undefined,
                  guestProfileUrl: form.guestProfileUrl.trim() || undefined,
                  adults: form.guestAdults ? Number(form.guestAdults) : undefined,
                  children: form.guestChildren ? Number(form.guestChildren) : undefined,
                  infants: form.guestInfants ? Number(form.guestInfants) : undefined,
                  checkinAtLocal: form.guestCheckinAtLocal ? new Date(form.guestCheckinAtLocal).toISOString() : undefined,
                  checkoutAtLocal: form.guestCheckoutAtLocal ? new Date(form.guestCheckoutAtLocal).toISOString() : undefined,
                  locationText: form.guestLocationText.trim() || undefined,
                }
              : undefined,
          serviceSite: !usesExistingProperty
            ? {
                name: form.siteName.trim(),
                address: form.siteAddress.trim(),
                suburb: form.siteSuburb.trim(),
                state: form.siteState.trim() || "NSW",
                postcode: form.sitePostcode.trim() || undefined,
                bedrooms: form.siteBedrooms ? Number(form.siteBedrooms) : undefined,
                bathrooms: form.siteBathrooms ? Number(form.siteBathrooms) : undefined,
                hasBalcony: form.siteHasBalcony,
              }
            : undefined,
          serviceContext:
            !isAirbnbTurnover ||
            form.scopeOfWork ||
            form.accessInstructions ||
            form.parkingInstructions ||
            form.hazardNotes ||
            form.equipmentNotes ||
            form.siteContactName ||
            form.siteContactPhone ||
            form.serviceAreaSqm ||
            form.floorCount
              ? {
                  scopeOfWork: form.scopeOfWork.trim() || undefined,
                  accessInstructions: form.accessInstructions.trim() || undefined,
                  parkingInstructions: form.parkingInstructions.trim() || undefined,
                  hazardNotes: form.hazardNotes.trim() || undefined,
                  equipmentNotes: form.equipmentNotes.trim() || undefined,
                  siteContactName: form.siteContactName.trim() || undefined,
                  siteContactPhone: form.siteContactPhone.trim() || undefined,
                  serviceAreaSqm: form.serviceAreaSqm ? Number(form.serviceAreaSqm) : undefined,
                  floorCount: form.floorCount ? Number(form.floorCount) : undefined,
                }
              : undefined,
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
              <div className="space-y-1.5">
                <Label>Job Type</Label>
                <Select value={form.jobType} onValueChange={(value: (typeof JOB_TYPES)[number]) => setForm((prev) => ({ ...prev, jobType: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{JOB_TYPES.map((jobType) => <SelectItem key={jobType} value={jobType}>{jobType.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Cleaner forms resolve by job type first, then any property-specific override configured on the property.</p>
              </div>

              {isAirbnbTurnover ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Property</Label>
                    <Select value={form.propertyId} onValueChange={(value) => setForm((prev) => ({ ...prev, propertyId: value }))}>
                      <SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger>
                      <SelectContent>{properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.suburb})</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-border/70 p-3">
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name="site-mode" checked={form.siteMode === "existing_property"} onChange={() => setForm((prev) => ({ ...prev, siteMode: "existing_property" }))} />
                        Use existing property
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="radio" name="site-mode" checked={form.siteMode === "service_site"} onChange={() => setForm((prev) => ({ ...prev, siteMode: "service_site", propertyId: "" }))} />
                        Create service site for this job
                      </label>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{NON_AIRBNB_RESEARCH_FIELDS_NOTE}</p>
                  </div>

                  {usesExistingProperty ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Property</Label>
                        <Select value={form.propertyId} onValueChange={(value) => setForm((prev) => ({ ...prev, propertyId: value }))}>
                          <SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger>
                          <SelectContent>{properties.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} ({p.suburb})</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 rounded-lg border border-border/70 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Client (optional)</Label>
                          <Select value={form.clientId || "__none__"} onValueChange={(value) => setForm((prev) => ({ ...prev, clientId: value === "__none__" ? "" : value }))}>
                            <SelectTrigger><SelectValue placeholder="No linked client" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">No linked client</SelectItem>
                              {clientOptions.map((client) => <SelectItem key={client.id} value={client.id}>{client.label}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Site Name</Label>
                          <Input value={form.siteName} onChange={(e) => setForm((prev) => ({ ...prev, siteName: e.target.value }))} placeholder="Example: Bondi Gym - Level 2" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Service Address</Label>
                        <GoogleAddressInput
                          value={form.siteAddress}
                          onChange={(value) => setForm((prev) => ({ ...prev, siteAddress: value }))}
                          onResolved={(parts) =>
                            setForm((prev) => ({
                              ...prev,
                              siteAddress: parts.address || prev.siteAddress,
                              siteSuburb: parts.suburb || prev.siteSuburb,
                              siteState: parts.state || prev.siteState,
                              sitePostcode: parts.postcode || prev.sitePostcode,
                            }))
                          }
                          placeholder="Start typing the address"
                        />
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-1.5"><Label>Suburb</Label><Input value={form.siteSuburb} onChange={(e) => setForm((prev) => ({ ...prev, siteSuburb: e.target.value }))} /></div>
                        <div className="space-y-1.5"><Label>State</Label><Input value={form.siteState} onChange={(e) => setForm((prev) => ({ ...prev, siteState: e.target.value }))} /></div>
                        <div className="space-y-1.5"><Label>Postcode</Label><Input value={form.sitePostcode} onChange={(e) => setForm((prev) => ({ ...prev, sitePostcode: e.target.value }))} /></div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-4">
                        <div className="space-y-1.5"><Label>Bedrooms</Label><Input type="number" min="0" value={form.siteBedrooms} onChange={(e) => setForm((prev) => ({ ...prev, siteBedrooms: e.target.value }))} placeholder="0" /></div>
                        <div className="space-y-1.5"><Label>Bathrooms</Label><Input type="number" min="0" value={form.siteBathrooms} onChange={(e) => setForm((prev) => ({ ...prev, siteBathrooms: e.target.value }))} placeholder="0" /></div>
                        <div className="space-y-1.5"><Label>Floors / Levels</Label><Input type="number" min="1" value={form.floorCount} onChange={(e) => setForm((prev) => ({ ...prev, floorCount: e.target.value }))} placeholder="1" /></div>
                        <div className="space-y-1.5"><Label>Service Area (sqm)</Label><Input type="number" min="0" step="0.5" value={form.serviceAreaSqm} onChange={(e) => setForm((prev) => ({ ...prev, serviceAreaSqm: e.target.value }))} placeholder="120" /></div>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={form.siteHasBalcony} onChange={(e) => setForm((prev) => ({ ...prev, siteHasBalcony: e.target.checked }))} />
                        Site has balcony / external area
                      </label>
                    </div>
                  )}
                </>
              )}

              {!isAirbnbTurnover ? (
                <div className="space-y-4 rounded-lg border border-border/70 p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5"><Label>On-site Contact Name</Label><Input value={form.siteContactName} onChange={(e) => setForm((prev) => ({ ...prev, siteContactName: e.target.value }))} placeholder="Building manager / owner / tenant" /></div>
                    <div className="space-y-1.5"><Label>On-site Contact Phone</Label><Input value={form.siteContactPhone} onChange={(e) => setForm((prev) => ({ ...prev, siteContactPhone: e.target.value }))} placeholder="0412 345 678" /></div>
                  </div>
                  <div className="space-y-1.5"><Label>Scope of Work</Label><Textarea value={form.scopeOfWork} onChange={(e) => setForm((prev) => ({ ...prev, scopeOfWork: e.target.value }))} placeholder="Rooms, surfaces, add-ons, completion standard, keys to collect, or commercial scope notes." /></div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5"><Label>Access Instructions</Label><Textarea value={form.accessInstructions} onChange={(e) => setForm((prev) => ({ ...prev, accessInstructions: e.target.value }))} placeholder="Reception sign-in, alarm, lift, inductions, key handover." /></div>
                    <div className="space-y-1.5"><Label>Parking / Arrival Notes</Label><Textarea value={form.parkingInstructions} onChange={(e) => setForm((prev) => ({ ...prev, parkingInstructions: e.target.value }))} placeholder="Loading zone, visitor parking, gate code, trolley access." /></div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5"><Label>Hazards / Safety Notes</Label><Textarea value={form.hazardNotes} onChange={(e) => setForm((prev) => ({ ...prev, hazardNotes: e.target.value }))} placeholder="Pets, sharps, mould, restricted areas, chemicals, ladder work." /></div>
                    <div className="space-y-1.5"><Label>Equipment / Utilities Notes</Label><Textarea value={form.equipmentNotes} onChange={(e) => setForm((prev) => ({ ...prev, equipmentNotes: e.target.value }))} placeholder="Water and power access, onsite equipment, consumables, pressure washer connection." /></div>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5"><Label>Scheduled Date</Label><Input type="date" value={form.scheduledDate} onChange={(e) => setForm((prev) => ({ ...prev, scheduledDate: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Fixed / Allocated Pay Hours</Label><Input type="number" step="0.25" min="0" value={form.estimatedHours} onChange={(e) => setForm((prev) => ({ ...prev, estimatedHours: e.target.value }))} /><p className="text-xs text-muted-foreground">{usesExistingProperty && form.propertyId ? "Prefilled from the property's default clean duration when selected. " : ""}When set, cleaner pay uses these hours (split across assignees).</p></div>
              </div>
              <div className="space-y-4 rounded-lg border border-border/70 p-4">
                <div>
                  <Label>Guest / Booking Details</Label>
                  <p className="text-xs text-muted-foreground">
                    Optional for manual jobs. iCal sync-created turnover jobs will populate these automatically from the reservation feed.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5"><Label>Guest name</Label><Input value={form.guestName} onChange={(e) => setForm((prev) => ({ ...prev, guestName: e.target.value }))} placeholder="Guest name or booking summary" /></div>
                  <div className="space-y-1.5"><Label>Reservation code</Label><Input value={form.reservationCode} onChange={(e) => setForm((prev) => ({ ...prev, reservationCode: e.target.value }))} placeholder="ABC12345" /></div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1.5"><Label>Adults</Label><Input type="number" min="0" value={form.guestAdults} onChange={(e) => setForm((prev) => ({ ...prev, guestAdults: e.target.value }))} placeholder="2" /></div>
                  <div className="space-y-1.5"><Label>Children</Label><Input type="number" min="0" value={form.guestChildren} onChange={(e) => setForm((prev) => ({ ...prev, guestChildren: e.target.value }))} placeholder="0" /></div>
                  <div className="space-y-1.5"><Label>Infants</Label><Input type="number" min="0" value={form.guestInfants} onChange={(e) => setForm((prev) => ({ ...prev, guestInfants: e.target.value }))} placeholder="0" /></div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5"><Label>Guest phone</Label><Input value={form.guestPhone} onChange={(e) => setForm((prev) => ({ ...prev, guestPhone: e.target.value }))} placeholder="+61..." /></div>
                  <div className="space-y-1.5"><Label>Guest email</Label><Input type="email" value={form.guestEmail} onChange={(e) => setForm((prev) => ({ ...prev, guestEmail: e.target.value }))} placeholder="guest@example.com" /></div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5"><Label>Check-in</Label><Input type="datetime-local" value={form.guestCheckinAtLocal} onChange={(e) => setForm((prev) => ({ ...prev, guestCheckinAtLocal: e.target.value }))} /></div>
                  <div className="space-y-1.5"><Label>Checkout</Label><Input type="datetime-local" value={form.guestCheckoutAtLocal} onChange={(e) => setForm((prev) => ({ ...prev, guestCheckoutAtLocal: e.target.value }))} /></div>
                </div>
                <div className="space-y-1.5"><Label>Guest profile URL</Label><Input value={form.guestProfileUrl} onChange={(e) => setForm((prev) => ({ ...prev, guestProfileUrl: e.target.value }))} placeholder="https://..." /></div>
                <div className="space-y-1.5"><Label>Booking location / extra details</Label><Textarea value={form.guestLocationText} onChange={(e) => setForm((prev) => ({ ...prev, guestLocationText: e.target.value }))} placeholder="Imported location, booking notes, or relevant guest details." /></div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1.5"><Label>Start Time</Label><Input type="time" value={form.startTime} onChange={(e) => setForm((prev) => ({ ...prev, startTime: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>Due Time</Label><Input type="time" value={form.dueTime} onChange={(e) => setForm((prev) => ({ ...prev, dueTime: e.target.value }))} /></div>
                <div className="space-y-1.5"><Label>End Time</Label><Input type="time" value={form.endTime} onChange={(e) => setForm((prev) => ({ ...prev, endTime: e.target.value }))} /></div>
              </div>
              <div className="space-y-1.5"><Label>Assign Cleaners</Label><MultiSelectDropdown options={cleanerOptions} selected={selectedCleaners} onChange={setSelectedCleaners} placeholder="Select cleaner accounts" emptyText="No cleaner accounts." /></div>
            </CardContent>
          </Card>

          {isAirbnbTurnover ? (
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
          ) : null}

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
              {usesExistingProperty ? (
                <div className="space-y-1.5"><Label>Bulk properties</Label><MultiSelectDropdown options={propertyOptions} selected={bulkPropertyIds} onChange={setBulkPropertyIds} placeholder="Use single property above" emptyText="No properties." /></div>
              ) : (
                <div className="rounded-lg border border-border/70 p-3 text-xs text-muted-foreground">
                  Service-site jobs can create multiple dates here. The same service site details above will be reused for each planned job.
                </div>
              )}
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
                  {isAirbnbTurnover ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setUseBulkAllocatedHours(true);
                        setBulkAllocatedHours("2");
                        setForm((prev) => ({ ...prev, jobType: AIRBNB_JOB_TYPE }));
                      }}
                    >
                      Airbnb 2h preset
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{plannedCount === 0 ? (usesExistingProperty ? "Choose a property and date." : "Choose at least one date.") : plannedCount === 1 ? "One job will be created." : `${plannedCount} jobs will be created.`}</p>
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
