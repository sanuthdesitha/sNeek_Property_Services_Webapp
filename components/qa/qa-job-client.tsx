"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  Star,
  AlertTriangle,
  ClipboardList,
  Package,
  Boxes,
  Clock,
  RotateCcw,
  Plus,
  Trash2,
  Play,
  Square,
  ImagePlus,
  X,
  Download,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaGallery } from "@/components/shared/media-gallery";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { ReportMaintenanceSheet } from "@/components/maintenance/report-maintenance-sheet";
import { toast } from "@/hooks/use-toast";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { FieldInput } from "@/components/forms/field-input";
import { getAccuratePosition } from "@/lib/geo/get-position";
import type { StampOptions } from "@/lib/uploads/stamp";
import {
  emptyInspectionTools,
  emptyReworkProposal,
  minutesBetween,
  type QaDamageEntry,
  type QaInspectionTools,
  type QaNextCleanRequest,
} from "@/lib/qa/inspection-tools";

function uid() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const DAMAGE_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const REWORK_SEVERITIES = ["MINOR", "MODERATE", "MAJOR"] as const;

export function QaJobClient({ jobId }: { jobId: string }) {
  const { data: authSession } = useSession();
  const [payload, setPayload] = useState<any>(null);
  // Evidence stamp inputs (branding + GPS), fetched once per session and reused
  // across every QA photo so the overlay carries the real logo + location.
  const [branding, setBranding] = useState<{ companyName?: string; logoUrl?: string }>({});
  const [stampGps, setStampGps] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<Record<string, any>>({});
  const [notes, setNotes] = useState("");
  const [tools, setTools] = useState<QaInspectionTools>(() => emptyInspectionTools());
  const [reworkAreaDraft, setReworkAreaDraft] = useState("");
  // Display URLs for section photos, keyed by S3 key (seeded from GET, then
  // augmented locally as the inspector uploads new ones this session).
  const [sectionPhotoUrls, setSectionPhotoUrls] = useState<Record<string, string>>({});
  // Which section headers currently have their uploader open.
  const [openUploaders, setOpenUploaders] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/qa/jobs/${jobId}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast({ title: "Could not load QA job", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    setPayload(body);
  }

  useEffect(() => {
    void load();
  }, [jobId]);

  // Resolve branding + a GPS fix once for the evidence stamp (best-effort).
  useEffect(() => {
    let active = true;
    fetch("/api/public/branding")
      .then((r) => r.json())
      .then((b) => {
        if (active) setBranding({ companyName: b?.companyName, logoUrl: b?.logoUrl });
      })
      .catch(() => {});
    getAccuratePosition()
      .then((fix) => {
        if (active && Number.isFinite(fix?.lat) && Number.isFinite(fix?.lng)) {
          setStampGps({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy ?? null });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Seed previously-saved per-section QA photos (keys + presigned display URLs)
  // whenever a fresh payload arrives, so re-opening shows existing thumbnails.
  useEffect(() => {
    const saved = payload?.sectionPhotos as
      | Record<string, Array<{ key: string; url: string }>>
      | undefined;
    if (!saved) return;
    const keysBySection: Record<string, string[]> = {};
    const urlByKey: Record<string, string> = {};
    for (const [sectionId, entries] of Object.entries(saved)) {
      const keys = (entries ?? []).map((e) => e.key).filter(Boolean);
      if (keys.length === 0) continue;
      keysBySection[sectionId] = keys;
      for (const e of entries ?? []) {
        if (e?.key && e?.url) urlByKey[e.key] = e.url;
      }
    }
    setTools((prev) => ({ ...prev, sectionPhotos: keysBySection }));
    setSectionPhotoUrls(urlByKey);
  }, [payload]);

  const template = payload?.template;
  const job = payload?.job;

  // Base evidence stamp shared by every QA photo (timestamp Australia/Sydney,
  // inspector name, GPS, sNeek logo). Per-upload contextLabel is merged at the
  // dropzone. Rebuilds as branding/GPS resolve so later shots carry the logo+fix.
  const evidenceStamp = useMemo<StampOptions>(() => {
    const propertyName =
      (typeof job?.property?.name === "string" && job.property.name.trim()) || "";
    const propertySuburb =
      (typeof job?.property?.suburb === "string" && job.property.suburb.trim()) || "";
    return {
      capturerName: authSession?.user?.name?.trim() || "QA Inspector",
      companyName: branding.companyName?.trim() || "sNeek Property Services",
      logoUrl: branding.logoUrl || "",
      gps: stampGps,
      timezone: "Australia/Sydney",
      reference: [propertyName, propertySuburb].filter(Boolean).join(" · ") || undefined,
    };
  }, [authSession?.user?.name, branding.companyName, branding.logoUrl, stampGps, job?.property?.name, job?.property?.suburb]);
  const propertyStock: any[] = payload?.propertyStock ?? [];
  const cleanerCandidates: Array<{ id: string; name: string | null; email: string }> =
    payload?.cleanerCandidates ?? [];
  const existingReworks: any[] = job?.qaReworkTransfers ?? [];
  const latestSubmission = job?.formSubmissions?.[0];
  const mediaItems = useMemo(
    () =>
      (latestSubmission?.media ?? []).map((item: any) => ({
        id: item.id,
        url: item.annotatedUrl || item.url,
        mediaType: item.mediaType,
        label: item.label || item.fieldId,
      })),
    [latestSubmission]
  );

  function setField(id: string, value: unknown) {
    setData((prev) => ({ ...prev, [id]: value }));
  }

  // ── Time on site ──────────────────────────────────────────────────────────
  function startOnSite() {
    setTools((prev) => ({
      ...prev,
      onSite: { startedAt: new Date().toISOString(), endedAt: null, minutes: null },
    }));
  }
  function endOnSite() {
    setTools((prev) => {
      const endedAt = new Date().toISOString();
      return {
        ...prev,
        onSite: { ...prev.onSite, endedAt, minutes: minutesBetween(prev.onSite.startedAt, endedAt) },
      };
    });
  }
  const onSiteMinutes =
    tools.onSite.minutes ?? minutesBetween(tools.onSite.startedAt, tools.onSite.endedAt ?? new Date().toISOString());

  // ── Damage ──────────────────────────────────────────────────────────────
  function addDamage() {
    setTools((prev) => ({
      ...prev,
      damage: [
        ...prev.damage,
        { id: uid(), area: "", description: "", severity: "MEDIUM", photoKeys: [], estimatedCost: null },
      ],
    }));
  }
  function updateDamage(id: string, patch: Partial<QaDamageEntry>) {
    setTools((prev) => ({
      ...prev,
      damage: prev.damage.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  }
  function removeDamage(id: string) {
    setTools((prev) => ({ ...prev, damage: prev.damage.filter((d) => d.id !== id) }));
  }

  // ── Next clean requests ───────────────────────────────────────────────────
  function addNextClean(kind: QaNextCleanRequest["kind"]) {
    setTools((prev) => ({
      ...prev,
      nextClean: [...prev.nextClean, { id: uid(), kind, area: "", note: "" }],
    }));
  }
  function updateNextClean(id: string, patch: Partial<QaNextCleanRequest>) {
    setTools((prev) => ({
      ...prev,
      nextClean: prev.nextClean.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }
  function removeNextClean(id: string) {
    setTools((prev) => ({ ...prev, nextClean: prev.nextClean.filter((r) => r.id !== id) }));
  }

  // ── Restock ───────────────────────────────────────────────────────────────
  function setRestockQty(propertyStockId: string, quantity: number) {
    setTools((prev) => {
      const others = prev.restock.filter((l) => l.propertyStockId !== propertyStockId);
      return {
        ...prev,
        restock: quantity > 0 ? [...others, { propertyStockId, quantity }] : others,
      };
    });
  }

  // ── Full inventory count ────────────────────────────────────────────────
  function setCount(propertyStockId: string, countedOnHand: number | null) {
    setTools((prev) => {
      const others = prev.inventoryCount.filter((l) => l.propertyStockId !== propertyStockId);
      return {
        ...prev,
        inventoryCount: countedOnHand == null ? others : [...others, { propertyStockId, countedOnHand }],
      };
    });
  }

  // ── Per-section QA photos ─────────────────────────────────────────────────
  function addSectionPhoto(sectionId: string, key: string) {
    setTools((prev) => {
      const existing = prev.sectionPhotos[sectionId] ?? [];
      if (existing.includes(key)) return prev;
      return { ...prev, sectionPhotos: { ...prev.sectionPhotos, [sectionId]: [...existing, key] } };
    });
    // Resolve a short-lived presigned URL for the thumbnail (the upload result
    // only carries the S3 key). Best-effort — the count still shows on failure.
    void (async () => {
      try {
        const res = await fetch(`/api/uploads/access?key=${encodeURIComponent(key)}&jobId=${encodeURIComponent(jobId)}`);
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.url) {
          setSectionPhotoUrls((prev) => ({ ...prev, [key]: body.url }));
        }
      } catch {
        // ignore — thumbnail just won't render until reload
      }
    })();
  }
  function removeSectionPhoto(sectionId: string, key: string) {
    setTools((prev) => {
      const existing = prev.sectionPhotos[sectionId] ?? [];
      const next = existing.filter((k) => k !== key);
      const sectionPhotos = { ...prev.sectionPhotos };
      if (next.length > 0) sectionPhotos[sectionId] = next;
      else delete sectionPhotos[sectionId];
      return { ...prev, sectionPhotos };
    });
  }
  function toggleUploader(sectionId: string) {
    setOpenUploaders((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }

  // ── Rework transfer ───────────────────────────────────────────────────────
  const rework = tools.rework ?? emptyReworkProposal();
  function setRework(patch: Partial<typeof rework>) {
    setTools((prev) => ({ ...prev, rework: { ...(prev.rework ?? emptyReworkProposal()), ...patch } }));
  }
  function addReworkArea() {
    const value = reworkAreaDraft.trim();
    if (!value) return;
    setRework({ areas: [...rework.areas, value] });
    setReworkAreaDraft("");
  }

  async function submit() {
    if (!template?.id) return;
    // Validate rework when enabled.
    if (rework.enabled) {
      if (!rework.cleanerUserId) {
        toast({ title: "Select the cleaner for the rework transfer.", variant: "destructive" });
        return;
      }
      if (!rework.reason.trim()) {
        toast({ title: "Add a reason for the rework transfer.", variant: "destructive" });
        return;
      }
    }
    setSaving(true);
    const res = await fetch(`/api/qa/jobs/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignmentId: payload.assignment?.id ?? null,
        templateId: template.id,
        data,
        notes,
        tools: {
          damage: tools.damage,
          nextClean: tools.nextClean,
          restock: tools.restock,
          inventoryCount: tools.inventoryCount,
          sectionPhotos: tools.sectionPhotos,
          onSite: { ...tools.onSite, minutes: onSiteMinutes },
          rework: rework.enabled ? rework : null,
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "QA submission failed", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    const extras: string[] = [];
    if (body.createdCaseIds?.length) extras.push(`${body.createdCaseIds.length} case(s)`);
    if (body.restockRunId) extras.push("restock run");
    if (body.countRunId) extras.push("inventory count");
    if (body.reworkTransferId) extras.push("rework transfer pending approval");
    toast({
      title: "QA submitted",
      description: `Score ${Math.round(body.review?.score ?? 0)}%.${extras.length ? ` Created: ${extras.join(", ")}.` : ""}`,
    });
    setTools(emptyInspectionTools());
    await load();
  }

  async function decideOverride(id: string, status: "APPROVED" | "DECLINED") {
    const res = await fetch(`/api/admin/media-overrides/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Override update failed", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    toast({ title: status === "APPROVED" ? "Upload-later approved" : "Upload-later declined" });
    await load();
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Loading QA job...
      </div>
    );
  }
  if (!payload || !job) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        QA job not found.
      </div>
    );
  }

  const restockByStock = new Map(tools.restock.map((l) => [l.propertyStockId, l.quantity]));
  const countByStock = new Map(tools.inventoryCount.map((l) => [l.propertyStockId, l.countedOnHand]));
  const hasQaSubmission = (job?.qaFormSubmissions?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/qa"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">QA inspection</p>
          <h1 className="truncate text-2xl font-bold tracking-tight">{job.property?.name}</h1>
          <p className="text-sm text-muted-foreground">{job.property?.address}, {job.property?.suburb}</p>
        </div>
        {job.jobType === "AIRBNB_TURNOVER" && job.propertyId ? (
          <ReportMaintenanceSheet
            propertyId={job.propertyId}
            jobId={jobId}
            triggerLabel="Flag for maintenance"
          />
        ) : null}
        <Badge variant={job.status === "COMPLETED" ? "success" : "warning"}>{String(job.status).replace(/_/g, " ")}</Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Cleaner submission evidence</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Submitted by {latestSubmission?.submittedBy?.name || latestSubmission?.submittedBy?.email || "Unknown"}.
              </p>
              {mediaItems.length > 0 ? (
                <MediaGallery items={mediaItems} />
              ) : (
                <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No cleaner media was attached.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Tasks, laundry, and issues</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-surface-raised p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Job tasks</p>
                <p className="text-2xl font-bold tracking-tight tabular-nums">{job.jobTasks?.length ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface-raised p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Laundry status</p>
                <p className="text-sm font-semibold">{job.laundryTask?.status?.replace(/_/g, " ") ?? "No laundry task"}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface-raised p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Open cases/issues</p>
                <p className="text-2xl font-bold tracking-tight tabular-nums">{job.issueTickets?.length ?? 0}</p>
              </div>
            </CardContent>
          </Card>

          {existingReworks.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Rework transfers on this job</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {existingReworks.map((rw) => (
                  <div key={rw.id} className="rounded-lg border border-border bg-surface p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={rw.status === "APPROVED" ? "success" : rw.status === "REJECTED" ? "destructive" : "warning"}>
                        {String(rw.status)}
                      </Badge>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">{rw.severity}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {rw.minutesFromCleaner}m · ${Number(rw.amountFromCleaner).toFixed(2)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {rw.cleaner?.name ?? "Cleaner"} → {rw.qaUser?.name ?? "QA"}: {rw.reason}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {payload.mediaOverrides?.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Upload-later approvals</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {payload.mediaOverrides.map((item: any) => (
                  <div key={item.id} className="rounded-lg border border-border bg-surface p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold">{item.fieldLabel || item.fieldId}</p>
                        <p className="text-xs text-muted-foreground">{item.reason || "No reason supplied."}</p>
                        <p className="text-xs text-muted-foreground">
                          Requested by {item.requestedBy?.name || item.requestedBy?.email || "Cleaner"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={item.status === "APPROVED" ? "success" : item.status === "DECLINED" ? "destructive" : "warning"}>
                          {String(item.status).replace(/_/g, " ")}
                        </Badge>
                        {item.status === "PENDING" ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => void decideOverride(item.id, "DECLINED")}>Decline</Button>
                            <Button size="sm" onClick={() => void decideOverride(item.id, "APPROVED")}>Approve</Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {/* ── Damage report ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-destructive" /> Damage report
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Each entry opens a linked Damage case on submit (photos attach to the case).
              </p>
              {tools.damage.map((entry) => (
                <div key={entry.id} className="space-y-3 rounded-xl border border-border bg-surface-raised p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Area</Label>
                      <Input
                        value={entry.area}
                        onChange={(e) => updateDamage(entry.id, { area: e.target.value })}
                        placeholder="e.g. Master bathroom"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Severity</Label>
                      <Select value={entry.severity} onValueChange={(v) => updateDamage(entry.id, { severity: v as any })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DAMAGE_SEVERITIES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Description</Label>
                    <Textarea
                      value={entry.description}
                      onChange={(e) => updateDamage(entry.id, { description: e.target.value })}
                      placeholder="What's damaged and how?"
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[160px_1fr] sm:items-end">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Est. cost ($)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={entry.estimatedCost ?? ""}
                        onChange={(e) =>
                          updateDamage(entry.id, { estimatedCost: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {entry.photoKeys.length} photo(s) attached
                    </p>
                  </div>
                  <UploadDropzone
                    jobId={jobId}
                    accept="image/*"
                    maxFiles={6}
                    stamp={{
                      ...evidenceStamp,
                      contextLabel: ["Damage report", entry.area?.trim()].filter(Boolean).join(" · "),
                    }}
                    onUploaded={(r) => updateDamage(entry.id, { photoKeys: [...entry.photoKeys, r.key] })}
                  />
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeDamage(entry.id)}>
                    <Trash2 className="mr-2 h-4 w-4" /> Remove entry
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addDamage}>
                <Plus className="mr-2 h-4 w-4" /> Add damage entry
              </Button>
            </CardContent>
          </Card>

          {/* ── Next clean requests ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="h-4 w-4 text-primary" /> Next-clean actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Attaches to the property + this job&apos;s notes so the next cleaner sees it.
              </p>
              {tools.nextClean.map((r) => (
                <div key={r.id} className="space-y-2 rounded-xl border border-border bg-surface-raised p-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {r.kind === "DEEP_CLEAN_AREA" ? "Deep clean area" : "Special request"}
                    </Badge>
                    <Button variant="ghost" size="icon" className="ml-auto text-destructive" onClick={() => removeNextClean(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {r.kind === "DEEP_CLEAN_AREA" ? (
                    <Input
                      value={r.area ?? ""}
                      onChange={(e) => updateNextClean(r.id, { area: e.target.value })}
                      placeholder="Which area? e.g. Oven, balcony"
                    />
                  ) : null}
                  <Textarea
                    value={r.note}
                    onChange={(e) => updateNextClean(r.id, { note: e.target.value })}
                    placeholder="Instruction for the next clean"
                  />
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => addNextClean("DEEP_CLEAN_AREA")}>
                  <Plus className="mr-2 h-4 w-4" /> Deep clean area
                </Button>
                <Button variant="outline" size="sm" onClick={() => addNextClean("SPECIAL_REQUEST")}>
                  <Plus className="mr-2 h-4 w-4" /> Special request
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* ── Inventory: restock + full count ── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="h-4 w-4 text-primary" /> Inventory — restock &amp; count
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {propertyStock.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  No property stock configured.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-[1fr_90px_110px] gap-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span>Item (on hand)</span>
                    <span className="text-right">Restock qty</span>
                    <span className="text-right">Count</span>
                  </div>
                  <div className="max-h-80 space-y-1.5 overflow-auto">
                    {propertyStock.map((stock) => (
                      <div key={stock.id} className="grid grid-cols-[1fr_90px_110px] items-center gap-2 rounded-lg border border-border bg-surface p-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{stock.item?.name ?? "Item"}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            On hand: {Number(stock.onHand)} {stock.item?.unit ?? ""}
                          </p>
                        </div>
                        <Input
                          type="number"
                          min={0}
                          className="h-9 text-right tabular-nums"
                          value={restockByStock.get(stock.id) ?? ""}
                          onChange={(e) => setRestockQty(stock.id, Number(e.target.value || 0))}
                          placeholder="0"
                        />
                        <Input
                          type="number"
                          min={0}
                          className="h-9 text-right tabular-nums"
                          value={countByStock.get(stock.id) ?? ""}
                          onChange={(e) => setCount(stock.id, e.target.value === "" ? null : Number(e.target.value))}
                          placeholder="—"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Package className="h-3.5 w-3.5" /> Restock qty &gt; 0 → DRAFT restock run
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Boxes className="h-3.5 w-3.5" /> Counts → DRAFT count run (admin applies)
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {/* ── Time on site ── */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-primary" /> Time on site
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-border bg-surface-raised p-3">
                <span className="text-sm text-muted-foreground">On-site minutes</span>
                <span className="text-2xl font-bold tabular-nums">{onSiteMinutes ?? "—"}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  className="h-11 flex-1"
                  variant={tools.onSite.startedAt && !tools.onSite.endedAt ? "secondary" : "default"}
                  disabled={Boolean(tools.onSite.startedAt) && !tools.onSite.endedAt}
                  onClick={startOnSite}
                >
                  <Play className="mr-2 h-4 w-4" /> Start
                </Button>
                <Button
                  className="h-11 flex-1"
                  variant="outline"
                  disabled={!tools.onSite.startedAt || Boolean(tools.onSite.endedAt)}
                  onClick={endOnSite}
                >
                  <Square className="mr-2 h-4 w-4" /> End
                </Button>
              </div>
              {tools.onSite.startedAt ? (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Started {new Date(tools.onSite.startedAt).toLocaleTimeString()}
                  {tools.onSite.endedAt ? ` · Ended ${new Date(tools.onSite.endedAt).toLocaleTimeString()}` : " · running"}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* ── Rework transfer ── */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <RotateCcw className="h-4 w-4 text-warning" /> Rework / cleaner transfer
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={rework.enabled}
                  onCheckedChange={(v) => setRework({ enabled: v === true })}
                />
                Flag work the cleaner missed (admin approval moves time/pay to QA)
              </label>
              {rework.enabled ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cleaner</Label>
                    <Select value={rework.cleanerUserId ?? ""} onValueChange={(v) => setRework({ cleanerUserId: v })}>
                      <SelectTrigger><SelectValue placeholder="Select cleaner" /></SelectTrigger>
                      <SelectContent>
                        {cleanerCandidates.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name || c.email}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Severity</Label>
                    <Select value={rework.severity} onValueChange={(v) => setRework({ severity: v as any })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {REWORK_SEVERITIES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Reason / what was redone</Label>
                    <Textarea
                      value={rework.reason}
                      onChange={(e) => setRework({ reason: e.target.value })}
                      placeholder="e.g. Bathroom not sanitized — QA re-cleaned shower + toilet"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Areas redone</Label>
                    <div className="flex gap-2">
                      <Input
                        value={reworkAreaDraft}
                        onChange={(e) => setReworkAreaDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addReworkArea();
                          }
                        }}
                        placeholder="Add an area"
                      />
                      <Button variant="outline" size="sm" onClick={addReworkArea}>Add</Button>
                    </div>
                    {rework.areas.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {rework.areas.map((a, i) => (
                          <Badge
                            key={`${a}-${i}`}
                            variant="secondary"
                            className="cursor-pointer"
                            onClick={() => setRework({ areas: rework.areas.filter((_, idx) => idx !== i) })}
                          >
                            {a} ✕
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Minutes from cleaner</Label>
                      <Input
                        type="number"
                        min={0}
                        className="tabular-nums"
                        value={rework.minutesFromCleaner || ""}
                        onChange={(e) => setRework({ minutesFromCleaner: Number(e.target.value || 0) })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Amount ($)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        className="tabular-nums"
                        value={rework.amountFromCleaner || ""}
                        onChange={(e) => setRework({ amountFromCleaner: Number(e.target.value || 0) })}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={rework.affectsCleanerStats}
                      onCheckedChange={(v) => setRework({ affectsCleanerStats: v === true })}
                    />
                    Reflect in the cleaner&apos;s quality stats
                  </label>
                  <p className="rounded-lg bg-warning/10 p-2 text-xs text-muted-foreground">
                    On admin approval, {rework.minutesFromCleaner || 0} min and ${Number(rework.amountFromCleaner || 0).toFixed(2)}{" "}
                    move from the cleaner to you, and the cleaner is notified.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* ── Scored QA form ── */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Star className="h-4 w-4 text-warning" />
                {template?.name ?? "QA form"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {(template?.schema?.sections ?? []).map((section: any) => {
                const sectionPhotoKeys = tools.sectionPhotos[section.id] ?? [];
                const uploaderOpen = openUploaders[section.id] === true;
                return (
                  <div key={section.id} className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{section.label}</p>
                      <div className="flex items-center gap-2">
                        {sectionPhotoKeys.length > 0 ? (
                          <Badge variant="secondary" className="tabular-nums">
                            {sectionPhotoKeys.length} photo{sectionPhotoKeys.length === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11"
                          onClick={() => toggleUploader(section.id)}
                        >
                          <ImagePlus className="mr-2 h-4 w-4" />
                          {uploaderOpen ? "Done" : "Add photos"}
                        </Button>
                      </div>
                    </div>
                    {sectionPhotoKeys.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {sectionPhotoKeys.map((key) => (
                          <div key={key} className="group relative">
                            {sectionPhotoUrls[key] ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={sectionPhotoUrls[key]}
                                alt="QA section photo"
                                className="h-16 w-16 rounded-lg border border-border object-cover"
                              />
                            ) : (
                              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-surface-raised">
                                <Camera className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                            <button
                              type="button"
                              aria-label="Remove photo"
                              className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow"
                              onClick={() => removeSectionPhoto(section.id, key)}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {uploaderOpen ? (
                      <UploadDropzone
                        jobId={jobId}
                        accept="image/*"
                        maxFiles={6}
                        stamp={{
                          ...evidenceStamp,
                          contextLabel:
                            (typeof section.label === "string" && section.label.trim()) ||
                            (typeof section.title === "string" && section.title.trim()) ||
                            undefined,
                        }}
                        onUploaded={(r) => addSectionPhoto(section.id, r.key)}
                      />
                    ) : null}
                    {(section.fields ?? []).map((field: any) => (
                      <div key={field.id} className="space-y-1.5">
                        {isUploadFieldType(field.type) ? (
                          <div className="rounded-lg border border-border bg-surface-raised p-3 text-sm text-muted-foreground">
                            <Camera className="mb-2 h-4 w-4" />
                            Use &quot;Add photos&quot; on this section header (or the Damage report uploader) for QA photo evidence.
                          </div>
                        ) : (
                          <FieldInput
                            field={field}
                            value={data[field.id]}
                            onChange={(value) => setField(field.id, value)}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}

              <div className="space-y-1.5">
                <Label>QA notes</Label>
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Internal notes and follow-up instructions" />
              </div>

              <Button className="h-11 w-full" onClick={() => void submit()} disabled={saving}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {saving ? "Submitting..." : "Submit QA review"}
              </Button>
              {hasQaSubmission ? (
                <Button variant="outline" className="h-11 w-full" asChild>
                  <a href={`/api/qa/jobs/${jobId}/report`} target="_blank" rel="noreferrer">
                    <Download className="mr-2 h-4 w-4" /> Download QA report
                  </a>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
