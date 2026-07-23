"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
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
  Pause,
  Square,
  ImagePlus,
  Video,
  Pencil,
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MediaGallery } from "@/components/shared/media-gallery";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { ImageAnnotator } from "@/components/shared/image-annotator";
import { SignaturePad } from "@/components/shared/signature-pad";
import { GuidedCapture, type GuidedCaptureItem } from "@/components/forms/guided-capture";
import { prepareUploadFile } from "@/lib/uploads/compress";
import { ReportMaintenanceSheet } from "@/components/maintenance/report-maintenance-sheet";
import { toast } from "@/hooks/use-toast";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { FieldInput } from "@/components/forms/field-input";
import { getAccuratePosition } from "@/lib/geo/get-position";
import type { StampOptions } from "@/lib/uploads/stamp";
import {
  emptyInspectionTools,
  emptyReworkProposal,
  type QaDamageEntry,
  type QaInspectionTools,
  type QaNextCleanRequest,
} from "@/lib/qa/inspection-tools";
import { matchCleanerSection } from "@/lib/qa/section-match";
import { PASS_OPTIONS } from "@/lib/qa/seed-templates/_helpers";
import {
  DEFAULT_ACCOUNTABILITY_SCORING,
  DEFAULT_ISSUE_CATEGORIES,
  VERDICT_LABELS,
  VERDICT_OPTIONS,
  buildAccountabilityBlob,
  cleanerAnsweredAffirmatively,
  computeAccountabilityPreview,
  emptyVerdictState,
  validateAccountability,
  verdictRequiresIssue,
  type AccountabilityScoring,
  type AccountabilityVerdict,
  type ItemMeta,
  type VerdictState,
} from "@/components/v2/qa/accountability";

/** Convert a `data:image/...;base64,...` URL to a Blob without using fetch()
 *  (fetch on data: URLs is CSP-blocked in some mobile webviews). */
function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64 = ""] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] || "image/png";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function uid() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Format milliseconds as H:MM:SS (or MM:SS under an hour). */
function formatHMS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function isVideoKey(key: string): boolean {
  return /\.(mp4|mov|webm|m4v|avi|3gp|mkv)$/i.test(key || "");
}

const DAMAGE_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const REWORK_SEVERITIES = ["MINOR", "MODERATE", "MAJOR"] as const;

/** True when a choice field's options are exactly the legacy Pass/Minor
 *  issues/Fail set (PASS_OPTIONS in lib/qa/seed-templates/_helpers). These
 *  fields no longer render their own control — the answer is derived from the
 *  accountability verdict instead (mirrors the v2 workspace). */
function isPassChoiceField(field: any): boolean {
  if (field?.type !== "radio" && field?.type !== "select") return false;
  const options = Array.isArray(field?.options) ? field.options.map(String) : [];
  return options.length === PASS_OPTIONS.length && PASS_OPTIONS.every((o) => options.includes(o));
}

/** Verdict → derived legacy radio answer. NA (or null) = unanswered, so the
 *  blank-excluding legacy engine (lib/qa/scoring.ts) skips the field. */
const VERDICT_TO_LEGACY_ANSWER: Record<AccountabilityVerdict, string | null> = {
  PASS: "Pass",
  MINOR: "Minor issues",
  MAJOR: "Fail",
  CRITICAL: "Fail",
  NA: null,
};

/* ── Accountability Phase 4b (v1) — compact per-item verdict control. Mirrors
 *    the v2 workspace in the legacy shadcn skin: 5-way verdict, issue fields for
 *    MINOR+, false-confirmation + missing-evidence flags. Additive to the legacy
 *    scoring input (rendered by the parent as `children`). ─────────────────── */
const V1_VERDICT_CLASS: Record<AccountabilityVerdict, string> = {
  PASS: "bg-success text-success-foreground border-success",
  MINOR: "bg-warning text-warning-foreground border-warning",
  MAJOR: "bg-orange-500 text-white border-orange-500",
  CRITICAL: "bg-destructive text-destructive-foreground border-destructive",
  NA: "bg-muted text-foreground border-border",
};

function AccountabilityItemV1({
  field,
  requiredPhoto,
  meta,
  state,
  onPatch,
  missing,
  onToggleMissing,
  issueCategories,
  jobId,
  urlByKey,
  onAddPhoto,
  onRemovePhoto,
  children,
}: {
  field: any;
  requiredPhoto: boolean;
  meta: ItemMeta;
  state: VerdictState;
  onPatch: (patch: Partial<VerdictState>) => void;
  missing: boolean;
  onToggleMissing: (v: boolean) => void;
  issueCategories: { key: string; label: string }[];
  jobId: string;
  urlByKey: Record<string, string>;
  onAddPhoto: (key: string) => void;
  onRemovePhoto: (key: string) => void;
  children?: ReactNode;
}) {
  const showIssue = verdictRequiresIssue(state.verdict);
  const missingCategory = showIssue && !(state.category && state.category.trim());
  const missingDescription = showIssue && !(state.description && state.description.trim());
  const [uploaderOpen, setUploaderOpen] = useState(false);
  return (
    <div className="space-y-2">
      {children}
      <div className="rounded-lg border border-border bg-surface p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Verdict</span>
          {meta.cleanerMarkedComplete ? (
            <Badge variant="secondary" className="text-[10px]">Cleaner marked complete</Badge>
          ) : null}
          <div className="ml-auto flex flex-wrap gap-1">
            {VERDICT_OPTIONS.map((v) => {
              const active = state.verdict === v;
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onPatch({ verdict: v })}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                    active ? V1_VERDICT_CLASS[v] : "border-border bg-surface text-muted-foreground hover:bg-surface-raised"
                  }`}
                >
                  {VERDICT_LABELS[v]}
                </button>
              );
            })}
          </div>
        </div>

        {requiredPhoto ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={missing} onCheckedChange={(v) => onToggleMissing(v === true)} />
            Missing / insufficient evidence (−5)
          </label>
        ) : null}

        {showIssue ? (
          <div className="mt-2.5 space-y-2.5 rounded-lg border border-border bg-surface-raised p-2.5">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Issue category *</Label>
                <Select value={state.category ?? ""} onValueChange={(v) => onPatch({ category: v })}>
                  <SelectTrigger className={missingCategory ? "border-destructive" : ""}>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {issueCategories.map((c) => (
                      <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <Checkbox
                  checked={Boolean(state.guestReadyImpact)}
                  onCheckedChange={(v) => onPatch({ guestReadyImpact: v === true })}
                />
                Guest-ready impact
              </label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description *</Label>
              <Textarea
                value={state.description ?? ""}
                onChange={(e) => onPatch({ description: e.target.value })}
                placeholder="What was wrong and where?"
                className={missingDescription ? "border-destructive" : ""}
              />
            </div>
            {state.qaPhotoKeys && state.qaPhotoKeys.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {state.qaPhotoKeys.map((p) => {
                  const url = urlByKey[p.key];
                  return (
                    <div key={p.key} className="relative">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="QA evidence" className="h-16 w-16 rounded-lg border border-border object-cover" />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-surface-raised">
                          <Camera className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <button
                        type="button"
                        aria-label="Remove photo"
                        className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow"
                        onClick={() => onRemovePhoto(p.key)}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setUploaderOpen((o) => !o)}>
                <ImagePlus className="mr-2 h-4 w-4" /> {uploaderOpen ? "Done" : "Attach QA photo"}
              </Button>
              {meta.cleanerMarkedComplete ? (
                <label className="flex items-center gap-2 text-xs font-medium text-destructive">
                  <Checkbox
                    checked={Boolean(state.falseConfirmation)}
                    onCheckedChange={(v) => onPatch({ falseConfirmation: v === true })}
                  />
                  Flag as false confirmation (−10)
                </label>
              ) : null}
            </div>
            {uploaderOpen ? (
              <UploadDropzone
                jobId={jobId}
                accept="image/*"
                maxFiles={6}
                onUploaded={(r) => onAddPhoto(r.key)}
              />
            ) : null}
            {(missingCategory || missingDescription) ? (
              <p className="text-[11px] text-destructive">
                A category and description are required for {VERDICT_LABELS[state.verdict]} verdicts.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function QaJobClient({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { data: authSession } = useSession();
  const [payload, setPayload] = useState<any>(null);
  // Evidence stamp inputs (branding + GPS), fetched once per session and reused
  // across every QA photo so the overlay carries the real logo + location.
  const [branding, setBranding] = useState<{
    companyName?: string;
    logoUrl?: string;
    evidenceStamp?: { dateFormat?: string; timeFormat?: string; showWeekday?: boolean };
  }>({});
  const [stampGps, setStampGps] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<Record<string, any>>({});
  const [notes, setNotes] = useState("");
  const [tools, setTools] = useState<QaInspectionTools>(() => emptyInspectionTools());
  // ── Sign-off (Phase 1): the inspector signs + attests before submitting. ──
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [attested, setAttested] = useState(false);
  // ── Accountability Phase 4b — per-item verdicts + evidence flags ──
  const [verdicts, setVerdicts] = useState<Record<string, VerdictState>>({});
  const [missingEvidence, setMissingEvidence] = useState<Record<string, boolean>>({});
  // ── Guided live-camera capture (Phase 3) ──
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capturePending, setCapturePending] = useState<Record<string, number>>({});
  // ── Guided two-step flow (Phase 4) ──
  const QA_STEPS = ["Inspect & log findings", "Score, sign off & submit"];
  const [step, setStep] = useState(0);
  const inspectorName = authSession?.user?.name || authSession?.user?.email || "QA Inspector";
  const [reworkAreaDraft, setReworkAreaDraft] = useState("");
  // Display URLs for section photos, keyed by S3 key (seeded from GET, then
  // augmented locally as the inspector uploads new ones this session).
  const [sectionPhotoUrls, setSectionPhotoUrls] = useState<Record<string, string>>({});
  // Which section headers currently have their uploader open.
  const [openUploaders, setOpenUploaders] = useState<Record<string, boolean>>({});
  // Photo currently being marked up (draw/pin/comment). scope = which collection
  // the photo belongs to (a QA section, or a rework flagged area).
  const [annotateTarget, setAnnotateTarget] = useState<
    { scope: "section" | "flagged" | "damage"; sectionId?: string; areaId?: string; entryId?: string; key: string; url: string } | null
  >(null);
  const [savingAnnotation, setSavingAnnotation] = useState(false);

  // ── Instant autosave + offline draft ──
  // The in-progress inspection (answers, notes, tools) is saved to this device
  // continuously, so a refresh / navigation / going offline never loses work.
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const draftRestoredRef = useRef(false);
  const draftKey = useMemo(() => {
    const uid = (authSession?.user as { id?: string } | undefined)?.id || authSession?.user?.email || "anon";
    return `qa-draft-v1:${jobId}:${uid}`;
  }, [jobId, authSession?.user]);

  // ── Time-on-site stopwatch (live, pausable) ──
  // Accumulated paused time + the timestamp of the current running segment.
  const [timer, setTimer] = useState<{ running: boolean; elapsedMs: number; runningSince: number | null }>(
    { running: false, elapsedMs: 0, runningSince: null }
  );
  const [, setTick] = useState(0);
  // Tick once a second while running so the live display updates.
  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timer.running]);

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

  // Track connectivity so the UI can reassure the inspector their work is safe
  // offline (it's persisted locally and submitted when back online).
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Restore a saved draft once the job has loaded (one-time).
  useEffect(() => {
    if (draftRestoredRef.current || !payload) return;
    draftRestoredRef.current = true;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d && typeof d === "object") {
        if (d.data && typeof d.data === "object") setData(d.data);
        if (typeof d.notes === "string") setNotes(d.notes);
        if (d.tools && typeof d.tools === "object") setTools((prev) => ({ ...prev, ...d.tools }));
        if (d.verdicts && typeof d.verdicts === "object") setVerdicts(d.verdicts);
        if (d.missingEvidence && typeof d.missingEvidence === "object") setMissingEvidence(d.missingEvidence);
        if (typeof d.savedAt === "number") setDraftSavedAt(d.savedAt);
      }
    } catch {
      /* ignore corrupt/unavailable storage */
    }
  }, [payload, draftKey]);

  // Debounced autosave of the in-progress inspection to this device.
  useEffect(() => {
    if (!draftRestoredRef.current) return; // never overwrite before restoring
    const id = setTimeout(() => {
      try {
        const savedAt = Date.now();
        localStorage.setItem(draftKey, JSON.stringify({ data, notes, tools, verdicts, missingEvidence, savedAt }));
        setDraftSavedAt(savedAt);
      } catch {
        /* storage full / unavailable — non-fatal */
      }
    }, 600);
    return () => clearTimeout(id);
  }, [data, notes, tools, verdicts, missingEvidence, draftKey]);

  // Resolve branding + a GPS fix once for the evidence stamp (best-effort).
  useEffect(() => {
    let active = true;
    fetch("/api/public/branding")
      .then((r) => r.json())
      .then((b) => {
        if (active)
          setBranding({
            companyName: b?.companyName,
            logoUrl: b?.logoUrl,
            evidenceStamp: b?.evidenceStamp,
          });
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
    const addressParts = [
      job?.property?.address,
      job?.property?.suburb,
      job?.property?.state,
      job?.property?.postcode,
    ]
      .filter((v: unknown) => typeof v === "string" && v.trim())
      .map((v: string) => v.trim());
    return {
      capturerName: authSession?.user?.name?.trim() || "QA Inspector",
      companyName: branding.companyName?.trim() || "sNeek Property Services",
      logoUrl: branding.logoUrl || "",
      gps: stampGps,
      timezone: "Australia/Sydney",
      address: addressParts.join(", ") || undefined,
      reference: propertyName || undefined,
      dateFormat: branding.evidenceStamp?.dateFormat,
      timeFormat: branding.evidenceStamp?.timeFormat,
      showWeekday: branding.evidenceStamp?.showWeekday,
    };
  }, [
    authSession?.user?.name,
    branding.companyName,
    branding.logoUrl,
    branding.evidenceStamp,
    stampGps,
    job?.property?.name,
    job?.property?.address,
    job?.property?.suburb,
    job?.property?.state,
    job?.property?.postcode,
  ]);
  const propertyStock: any[] = payload?.propertyStock ?? [];
  const cleanerCandidates: Array<{ id: string; name: string | null; email: string; hourlyRate?: number | null }> =
    payload?.cleanerCandidates ?? [];
  // The whole active roster for "Different cleaner" (older payloads only carry
  // the job's own cleaners).
  const reworkPayeeCandidates: Array<{ id: string; name: string | null; email: string; hourlyRate?: number | null }> =
    payload?.reworkPayeeCandidates ?? cleanerCandidates;
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

  /** Derive the hidden legacy Pass/Minor/Fail answer from the verdict so the
   *  stored legacy percent keeps working: PASS→"Pass", MINOR→"Minor issues",
   *  MAJOR/CRITICAL→"Fail", NA→unanswered (key removed — excluded from the
   *  score by the blank-exclusion in lib/qa/scoring.ts). */
  function deriveLegacyAnswer(fieldId: string, verdict: AccountabilityVerdict) {
    const answer = VERDICT_TO_LEGACY_ANSWER[verdict];
    setData((prev) => {
      if (answer == null) {
        if (!(fieldId in prev)) return prev;
        const next = { ...prev };
        delete next[fieldId];
        return next;
      }
      if (prev[fieldId] === answer) return prev;
      return { ...prev, [fieldId]: answer };
    });
  }

  // ── Cleaner photos grouped by the CLEANER form's sections (server-built) ──
  const cleanerSectionMedia: Array<{ sectionTitle: string; mediaIds: string[] }> =
    payload?.cleanerSectionMedia ?? [];
  const cleanerSectionTitles = useMemo(
    () => cleanerSectionMedia.map((s) => s.sectionTitle),
    [cleanerSectionMedia]
  );
  const cleanerMediaIdsBySection = useMemo(
    () => new Map(cleanerSectionMedia.map((s) => [s.sectionTitle, s.mediaIds])),
    [cleanerSectionMedia]
  );
  const cleanerMediaById = useMemo(
    () => new Map(mediaItems.map((m: any) => [m.id as string, m])),
    [mediaItems]
  );

  // ── Accountability: scoring/categories (settings when exposed, else defaults) ──
  const acctScoring: AccountabilityScoring =
    (payload?.settings?.accountability?.scoring as AccountabilityScoring | undefined) ?? DEFAULT_ACCOUNTABILITY_SCORING;
  const issueCategories: { key: string; label: string }[] =
    (payload?.settings?.accountability?.issueCategories as { key: string; label: string }[] | undefined) ??
    DEFAULT_ISSUE_CATEGORIES;

  const cleanerMediaByField = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const m of latestSubmission?.media ?? []) {
      const fid = m?.fieldId;
      if (!fid) continue;
      (map[fid] ??= []).push(m.id);
    }
    return map;
  }, [latestSubmission]);
  const cleanerData: Record<string, unknown> = latestSubmission?.data ?? {};

  const itemMeta = useMemo(() => {
    const map: Record<string, ItemMeta> = {};
    for (const section of template?.schema?.sections ?? []) {
      for (const field of section.fields ?? []) {
        if (["signature", "instruction", "inventory"].includes(field.type)) continue;
        const isUpload = isUploadFieldType(field.type);
        const mediaIds = cleanerMediaByField[field.id] ?? [];
        const cleanerMarkedComplete = isUpload
          ? mediaIds.length > 0
          : cleanerAnsweredAffirmatively(cleanerData[field.id]);
        map[field.id] = {
          fieldId: field.id,
          label: field.label ?? null,
          itemKey: field.key ?? null,
          cleanerMarkedComplete,
          cleanerMediaIds: mediaIds,
        };
      }
    }
    return map;
  }, [template, cleanerMediaByField, cleanerData]);

  const acctPreview = useMemo(
    () => computeAccountabilityPreview(verdicts, missingEvidence, acctScoring),
    [verdicts, missingEvidence, acctScoring]
  );

  function verdictState(fieldId: string): VerdictState {
    return verdicts[fieldId] ?? emptyVerdictState();
  }
  function patchVerdict(fieldId: string, patch: Partial<VerdictState>) {
    setVerdicts((prev) => ({ ...prev, [fieldId]: { ...(prev[fieldId] ?? emptyVerdictState()), ...patch } }));
  }
  function toggleMissing(fieldId: string, value: boolean) {
    setMissingEvidence((prev) => {
      const next = { ...prev };
      if (value) next[fieldId] = true;
      else delete next[fieldId];
      return next;
    });
  }
  function addVerdictPhoto(fieldId: string, key: string) {
    setVerdicts((prev) => {
      const cur = prev[fieldId] ?? emptyVerdictState();
      const existing = cur.qaPhotoKeys ?? [];
      if (existing.some((p) => p.key === key)) return prev;
      return { ...prev, [fieldId]: { ...cur, qaPhotoKeys: [...existing, { key }] } };
    });
    // Resolve a thumbnail URL (best-effort), reusing the section-photo URL map.
    void (async () => {
      try {
        const res = await fetch(`/api/uploads/access?key=${encodeURIComponent(key)}&jobId=${encodeURIComponent(jobId)}`);
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.url) setSectionPhotoUrls((prev) => ({ ...prev, [key]: body.url }));
      } catch {
        /* thumbnail best-effort */
      }
    })();
  }
  function removeVerdictPhoto(fieldId: string, key: string) {
    setVerdicts((prev) => {
      const cur = prev[fieldId];
      if (!cur) return prev;
      return { ...prev, [fieldId]: { ...cur, qaPhotoKeys: (cur.qaPhotoKeys ?? []).filter((p) => p.key !== key) } };
    });
  }

  // ── Time on site (live stopwatch with pause/resume) ───────────────────────
  const liveMs = timer.elapsedMs + (timer.running && timer.runningSince != null ? Date.now() - timer.runningSince : 0);
  const onSiteMinutes = Math.round(liveMs / 60000);
  const timerEnded = Boolean(tools.onSite.endedAt);

  // Persist start/pause to the QaAssignment so the timer survives tab switches,
  // navigation, and refresh (the in-page clock alone pauses when backgrounded).
  function persistTimer(action: "start" | "pause") {
    fetch(`/api/qa/jobs/${jobId}/timer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
  }

  // Seed the live timer from the server-persisted assignment when a payload
  // arrives (so reopening the job resumes the running clock instead of resetting).
  useEffect(() => {
    const a = payload?.assignment;
    if (!a || tools.onSite.endedAt) return;
    const accMs = Math.max(0, Number(a.onSiteMinutes ?? 0)) * 60000;
    if (a.onSiteStartedAt && !a.onSiteEndedAt) {
      setTimer({ running: true, elapsedMs: accMs, runningSince: new Date(a.onSiteStartedAt).getTime() });
      setTools((prev) => ({ ...prev, onSite: { startedAt: a.onSiteStartedAt, endedAt: null, minutes: null } }));
    } else if (accMs > 0) {
      setTimer({ running: false, elapsedMs: accMs, runningSince: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.assignment?.id]);

  function startOrResumeOnSite() {
    setTimer((prev) => (prev.running ? prev : { ...prev, running: true, runningSince: Date.now() }));
    setTools((prev) => ({
      ...prev,
      onSite: { startedAt: prev.onSite.startedAt ?? new Date().toISOString(), endedAt: null, minutes: null },
    }));
    persistTimer("start");
  }
  function pauseOnSite() {
    setTimer((prev) =>
      !prev.running || prev.runningSince == null
        ? prev
        : { running: false, elapsedMs: prev.elapsedMs + (Date.now() - prev.runningSince), runningSince: null }
    );
    persistTimer("pause");
  }
  function endOnSite() {
    const finalMs = liveMs;
    setTimer({ running: false, elapsedMs: finalMs, runningSince: null });
    setTools((t) => ({
      ...t,
      onSite: { startedAt: t.onSite.startedAt, endedAt: new Date().toISOString(), minutes: Math.round(finalMs / 60000) },
    }));
    persistTimer("pause");
  }

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

  // Guided live-camera capture → stamp/compress → upload → attach to the section.
  async function captureSectionFiles(
    fieldId: string,
    files: File[],
    _source: "camera" | "gallery"
  ): Promise<{ failedCount: number }> {
    setCapturePending((p) => ({ ...p, [fieldId]: (p[fieldId] ?? 0) + files.length }));
    const label =
      (template?.schema?.sections ?? []).find((s: any) => s.id === fieldId)?.label ||
      (template?.schema?.sections ?? []).find((s: any) => s.id === fieldId)?.title ||
      "QA evidence";
    let failed = 0;
    for (const file of files) {
      try {
        const stamped = await prepareUploadFile(file, {
          ...evidenceStamp,
          tag: "qa",
          contextLabel: ["QA", typeof label === "string" ? label : ""].filter(Boolean).join(" · "),
        });
        const form = new FormData();
        form.append("file", stamped);
        form.append("folder", "qa-section");
        form.append("jobId", jobId);
        const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.key) addSectionPhoto(fieldId, body.key);
        else failed += 1;
      } catch {
        failed += 1;
      } finally {
        setCapturePending((p) => ({ ...p, [fieldId]: Math.max(0, (p[fieldId] ?? 1) - 1) }));
      }
    }
    return { failedCount: failed };
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

  // Save photo markup: upload the transparent overlay PNG and store the markup
  // (overlay + comment) against the original key, so it can be layered on the
  // photo and carried into a reclean.
  async function saveAnnotation(blob: Blob, comment: string) {
    if (!annotateTarget) return;
    setSavingAnnotation(true);
    try {
      const fd = new FormData();
      fd.append("file", new File([blob], `qa-markup-${Date.now()}.png`, { type: "image/png" }));
      fd.append("folder", "qa-annotations");
      const res = await fetch("/api/uploads/direct", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.key) {
        toast({ title: "Could not save markup", description: body?.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      const key = annotateTarget.key;
      const markup = { overlayKey: body.key as string, comment: comment || undefined };
      if (annotateTarget.scope === "flagged" && annotateTarget.areaId) {
        const areaId = annotateTarget.areaId;
        setRework({
          flaggedAreas: rework.flaggedAreas.map((a) =>
            a.id === areaId ? { ...a, annotations: { ...(a.annotations ?? {}), [key]: markup } } : a
          ),
        });
      } else if (annotateTarget.scope === "damage" && annotateTarget.entryId) {
        const entryId = annotateTarget.entryId;
        setTools((prev) => ({
          ...prev,
          damage: prev.damage.map((d) =>
            d.id === entryId ? { ...d, annotations: { ...(d.annotations ?? {}), [key]: markup } } : d
          ),
        }));
      } else {
        setTools((prev) => ({
          ...prev,
          mediaAnnotations: { ...prev.mediaAnnotations, [key]: markup },
        }));
      }
      if (body.url) setSectionPhotoUrls((prev) => ({ ...prev, [body.key]: body.url }));
      toast({ title: "Markup saved" });
      setAnnotateTarget(null);
    } finally {
      setSavingAnnotation(false);
    }
  }

  // ── Rework transfer ───────────────────────────────────────────────────────
  const rework = tools.rework ?? emptyReworkProposal();
  function setRework(patch: Partial<typeof rework>) {
    setTools((prev) => ({ ...prev, rework: { ...(prev.rework ?? emptyReworkProposal()), ...patch } }));
  }
  // "Different cleaner" can be anyone active EXCEPT the original cleaner.
  const originalCleanerId = cleanerCandidates[0]?.id ?? null;
  const payeeOptions = reworkPayeeCandidates.filter((c) => c.id !== originalCleanerId);
  // Suggested pay default: allocated rework hours (else the job's estimated
  // hours) × the payee's hourly rate. Prefill only — a typed amount stays.
  const reworkHoursBasis =
    rework.allocatedHours ?? (Number(job?.estimatedHours ?? 0) > 0 ? Number(job.estimatedHours) : null);
  const reworkPayee = reworkPayeeCandidates.find((c) => c.id === rework.payeeCleanerId);
  const reworkPayeeRate = Number(reworkPayee?.hourlyRate ?? 0);
  const paySuggestion =
    reworkPayeeRate > 0 && Number(reworkHoursBasis ?? 0) > 0
      ? {
          hours: Number(reworkHoursBasis),
          rate: reworkPayeeRate,
          amount: Math.round(Number(reworkHoursBasis) * reworkPayeeRate * 100) / 100,
        }
      : null;
  useEffect(() => {
    if (!rework.enabled || rework.assignee !== "OTHER") return;
    if (rework.payAmount > 0 || !paySuggestion) return;
    setRework({ payAmount: paySuggestion.amount });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rework.enabled, rework.assignee, rework.payeeCleanerId, paySuggestion?.amount]);
  // ── Rework flagged areas (each carries QA photos → the cleaner's fix list) ──
  function addFlaggedArea() {
    const value = reworkAreaDraft.trim();
    setRework({
      flaggedAreas: [...rework.flaggedAreas, { id: uid(), label: value || "Flagged area", note: "", photoKeys: [] }],
    });
    setReworkAreaDraft("");
  }
  function updateFlaggedArea(id: string, patch: Partial<(typeof rework.flaggedAreas)[number]>) {
    setRework({ flaggedAreas: rework.flaggedAreas.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  }
  function removeFlaggedArea(id: string) {
    setRework({ flaggedAreas: rework.flaggedAreas.filter((a) => a.id !== id) });
  }
  function addDamagePhoto(entryId: string, key: string) {
    setTools((prev) => ({
      ...prev,
      damage: prev.damage.map((d) =>
        d.id === entryId && !d.photoKeys.includes(key) ? { ...d, photoKeys: [...d.photoKeys, key] } : d
      ),
    }));
    void (async () => {
      try {
        const res = await fetch(`/api/uploads/access?key=${encodeURIComponent(key)}&jobId=${encodeURIComponent(jobId)}`);
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.url) setSectionPhotoUrls((prev) => ({ ...prev, [key]: body.url }));
      } catch {
        /* thumbnail best-effort */
      }
    })();
  }
  function removeDamagePhoto(entryId: string, key: string) {
    setTools((prev) => ({
      ...prev,
      damage: prev.damage.map((d) =>
        d.id === entryId
          ? {
              ...d,
              photoKeys: d.photoKeys.filter((k) => k !== key),
              annotations: d.annotations
                ? Object.fromEntries(Object.entries(d.annotations).filter(([k]) => k !== key))
                : d.annotations,
            }
          : d
      ),
    }));
  }
  function addFlaggedAreaPhoto(areaId: string, key: string) {
    setRework({
      flaggedAreas: rework.flaggedAreas.map((a) =>
        a.id === areaId && !a.photoKeys.includes(key) ? { ...a, photoKeys: [...a.photoKeys, key] } : a
      ),
    });
    void (async () => {
      try {
        const res = await fetch(`/api/uploads/access?key=${encodeURIComponent(key)}&jobId=${encodeURIComponent(jobId)}`);
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.url) setSectionPhotoUrls((prev) => ({ ...prev, [key]: body.url }));
      } catch {
        /* thumbnail best-effort */
      }
    })();
  }
  function removeFlaggedAreaPhoto(areaId: string, key: string) {
    setRework({
      flaggedAreas: rework.flaggedAreas.map((a) =>
        a.id === areaId ? { ...a, photoKeys: a.photoKeys.filter((k) => k !== key) } : a
      ),
    });
  }

  async function submit() {
    if (!template?.id) return;
    // Validate rework when enabled.
    if (rework.enabled) {
      if (!rework.reason.trim()) {
        toast({ title: "Add a reason for the rework.", variant: "destructive" });
        return;
      }
      if (rework.flaggedAreas.filter((a) => a.label.trim()).length === 0) {
        toast({ title: "Flag at least one area for the cleaner to fix.", variant: "destructive" });
        return;
      }
      const areaWithoutPhoto = rework.flaggedAreas.find((a) => a.photoKeys.length === 0);
      if (areaWithoutPhoto) {
        toast({
          title: "Add a photo for each flagged area",
          description: `"${areaWithoutPhoto.label.trim() || "Flagged area"}" has no photo of the problem.`,
          variant: "destructive",
        });
        return;
      }
      if (rework.assignee === "OTHER") {
        if (!rework.payeeCleanerId) {
          toast({ title: "Choose the cleaner who will redo this clean.", variant: "destructive" });
          return;
        }
        if (!(rework.payAmount > 0)) {
          toast({ title: "Enter the pay amount for the new cleaner.", variant: "destructive" });
          return;
        }
      }
    }
    // Accountability: every MINOR+ verdict needs a category + description.
    const acctInvalid = validateAccountability(verdicts, itemMeta);
    if (acctInvalid.length > 0) {
      toast({
        title: "Add a category and description for flagged items",
        description: `${acctInvalid.length} flagged item(s) need an issue category and description: ${acctInvalid.map((i) => i.label).join(", ")}.`,
        variant: "destructive",
      });
      return;
    }
    // Sign-off is mandatory — an inspection is a record, so it must be attested + signed.
    if (!attested) {
      toast({ title: "Tick the attestation to sign off this inspection.", variant: "destructive" });
      return;
    }
    if (!signatureDataUrl) {
      toast({ title: "Add your signature to sign off this inspection.", variant: "destructive" });
      return;
    }
    setSaving(true);
    // Upload the signature image first so it travels with the submission.
    let signatureKey: string | null = null;
    let signatureError = "Please retry.";
    try {
      // Decode the data URL directly — fetch() on a data: URL is blocked by CSP
      // in some mobile webviews, which was making the signature fail to save.
      const sigBlob = dataUrlToBlob(signatureDataUrl);
      const fd = new FormData();
      fd.append("file", new File([sigBlob], `qa-signature-${Date.now()}.png`, { type: "image/png" }));
      fd.append("folder", "qa-signoff");
      const upRes = await fetch("/api/uploads/direct", { method: "POST", body: fd });
      const upBody = await upRes.json().catch(() => ({}));
      if (upRes.ok && upBody?.key) signatureKey = upBody.key as string;
      else if (upBody?.error) signatureError = String(upBody.error);
    } catch (err) {
      signatureError = err instanceof Error ? err.message : "Please retry.";
    }
    if (!signatureKey) {
      setSaving(false);
      toast({ title: "Could not save your signature", description: signatureError, variant: "destructive" });
      return;
    }
    const signOff = {
      signatureKey,
      attested: true,
      signedByName: inspectorName,
      signedAt: new Date().toISOString(),
    };
    // Accountability blob — additive; omitted entirely when no non-PASS verdict,
    // missing-evidence flag or false-confirmation exists (legacy behaviour).
    const accountability = buildAccountabilityBlob(verdicts, missingEvidence, itemMeta);
    const res = await fetch(`/api/qa/jobs/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignmentId: payload.assignment?.id ?? null,
        templateId: template.id,
        data,
        notes,
        ...(accountability ? { accountability } : {}),
        tools: {
          damage: tools.damage,
          nextClean: tools.nextClean,
          restock: tools.restock,
          inventoryCount: tools.inventoryCount,
          sectionPhotos: tools.sectionPhotos,
          mediaAnnotations: tools.mediaAnnotations,
          onSite: { ...tools.onSite, minutes: onSiteMinutes },
          rework: rework.enabled ? rework : null,
          signOff,
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
    if (body.reworkJobId) extras.push("rework job created");
    if (body.reworkTransferId) extras.push("rework transfer pending approval");
    toast({
      title: "QA submitted",
      description: `Score ${Math.round(body.review?.score ?? 0)}%.${extras.length ? ` Created: ${extras.join(", ")}.` : ""}`,
    });
    // Stop the on-site timer and clear the local draft — this inspection is done.
    setTimer({ running: false, elapsedMs: 0, runningSince: null });
    setVerdicts({});
    setMissingEvidence({});
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    setDraftSavedAt(null);
    // Return to the QA home queue; the submitted job now lives under "Submitted".
    router.push("/qa");
    router.refresh();
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
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="shrink-0">
            <Link href="/qa"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">QA inspection</p>
            <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{job.property?.name}</h1>
            <p className="truncate text-sm text-muted-foreground">{job.property?.address}, {job.property?.suburb}</p>
          </div>
          <Badge variant={job.status === "COMPLETED" ? "success" : "warning"} className="shrink-0">
            {String(job.status).replace(/_/g, " ")}
          </Badge>
        </div>
        {job.jobType === "AIRBNB_TURNOVER" && job.propertyId ? (
          <div className="pl-12">
            <ReportMaintenanceSheet
              propertyId={job.propertyId}
              jobId={jobId}
              triggerLabel="Flag for maintenance"
            />
          </div>
        ) : null}
      </div>

      {/* Guided step header */}
      <div className="sticky top-0 z-20 flex gap-2 rounded-xl border border-border bg-surface/95 p-2 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        {QA_STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setStep(i);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className={`flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition ${
              i === step ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-surface-raised"
            }`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                i === step ? "bg-primary text-primary-foreground" : "border border-border"
              }`}
            >
              {i + 1}
            </span>
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div className={step === 0 ? "space-y-4" : "hidden"}>
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
                    {entry.photoKeys.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {entry.photoKeys.map((key) => {
                          const url = sectionPhotoUrls[key];
                          const ann = entry.annotations?.[key];
                          const overlayUrl = ann?.overlayKey ? sectionPhotoUrls[ann.overlayKey] : undefined;
                          return (
                            <div key={key} className="relative">
                              {url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={url} alt="Damage" className="h-16 w-16 rounded-lg border border-border object-cover" />
                              ) : (
                                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-surface-raised">
                                  <Camera className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                              {overlayUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={overlayUrl} alt="" className="pointer-events-none absolute inset-0 h-16 w-16 rounded-lg object-cover" />
                              ) : null}
                              {url ? (
                                <button
                                  type="button"
                                  aria-label="Mark up photo"
                                  title={ann?.comment || "Draw, pin and comment on this photo"}
                                  className="absolute -bottom-1.5 -left-1.5 rounded-full bg-primary p-1 text-primary-foreground shadow"
                                  onClick={() => setAnnotateTarget({ scope: "damage", entryId: entry.id, key, url })}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              ) : null}
                              {ann ? (
                                <span className="absolute left-0 top-0 rounded-br-lg rounded-tl-lg bg-primary px-1 py-0.5 text-[8px] font-bold text-primary-foreground">✎</span>
                              ) : null}
                              <button
                                type="button"
                                aria-label="Remove photo"
                                className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow"
                                onClick={() => removeDamagePhoto(entry.id, key)}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No damage photos yet — add one below.</p>
                    )}
                  </div>
                  <UploadDropzone
                    jobId={jobId}
                    accept="image/*"
                    maxFiles={6}
                    stamp={{
                      ...evidenceStamp,
                      tag: "damage",
                      contextLabel: ["Damage report", entry.area?.trim()].filter(Boolean).join(" · "),
                    }}
                    onUploaded={(r) => addDamagePhoto(entry.id, r.key)}
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
                  <div className="space-y-1.5">
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

        <div className={step === 1 ? "space-y-4" : "hidden"}>
          {/* ── Time on site ── */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-primary" /> Time on site
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col items-center rounded-lg border border-border bg-surface-raised p-4">
                <span className="font-mono text-4xl font-bold tabular-nums tracking-tight">{formatHMS(liveMs)}</span>
                <span className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {timerEnded ? "Ended" : timer.running ? "Running" : liveMs > 0 ? "Paused" : "Not started"}
                  {" · "}
                  {onSiteMinutes} min
                </span>
              </div>
              <div className="flex gap-2">
                {timer.running ? (
                  <Button className="h-11 flex-1" variant="secondary" onClick={pauseOnSite}>
                    <Pause className="mr-2 h-4 w-4" /> Pause
                  </Button>
                ) : (
                  <Button className="h-11 flex-1" variant="default" disabled={timerEnded} onClick={startOrResumeOnSite}>
                    <Play className="mr-2 h-4 w-4" /> {liveMs > 0 ? "Resume" : "Start"}
                  </Button>
                )}
                <Button
                  className="h-11 flex-1"
                  variant="outline"
                  disabled={liveMs === 0 || timerEnded}
                  onClick={endOnSite}
                >
                  <Square className="mr-2 h-4 w-4" /> End
                </Button>
              </div>
              {tools.onSite.startedAt ? (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Started {new Date(tools.onSite.startedAt).toLocaleTimeString()}
                  {tools.onSite.endedAt ? ` · Ended ${new Date(tools.onSite.endedAt).toLocaleTimeString()}` : timer.running ? " · running" : " · paused"}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* ── Send back for rework ── */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <RotateCcw className="h-4 w-4 text-warning" /> Send back for rework
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={rework.enabled}
                  onCheckedChange={(v) => setRework({ enabled: v === true })}
                />
                Create a rework job — flag the areas to fix (each with your photo)
              </label>
              {rework.enabled ? (
                <div className="space-y-3">
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
                    <Label className="text-xs">Summary / reason</Label>
                    <Textarea
                      value={rework.reason}
                      onChange={(e) => setRework({ reason: e.target.value })}
                      placeholder="e.g. Bathroom not sanitized and floors not mopped — see flagged areas."
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Allocated hours for the rework</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.25"
                        value={rework.allocatedHours ?? ""}
                        onChange={(e) =>
                          setRework({ allocatedHours: e.target.value === "" ? null : Number(e.target.value) })
                        }
                        placeholder="Leave blank to keep the original job's hours"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Sets the rework job&apos;s time. Same-cleaner reworks are unpaid; a different cleaner is paid below.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Fix checklist layout</Label>
                      <label className="flex h-10 items-center justify-between rounded-md border border-input px-3 text-sm">
                        <span>{rework.categorized ? "One section per area" : "Single flat list"}</span>
                        <Switch
                          checked={rework.categorized}
                          onCheckedChange={(v: boolean) => setRework({ categorized: v === true })}
                        />
                      </label>
                      <p className="text-[11px] text-muted-foreground">Categorise the cleaner&apos;s checklist by area, or keep it as one list.</p>
                    </div>
                  </div>

                  {/* Flagged areas — each becomes a section in the cleaner's fix checklist */}
                  <div className="space-y-2">
                    <Label className="text-xs">Flagged areas (the cleaner re-cleans each and uploads an after photo)</Label>
                    {rework.flaggedAreas.map((area) => {
                      const openKey = `rework:${area.id}`;
                      const open = openUploaders[openKey] === true;
                      return (
                        <div key={area.id} className="space-y-2 rounded-lg border border-border p-3">
                          <div className="flex items-center gap-2">
                            <Input
                              value={area.label}
                              onChange={(e) => updateFlaggedArea(area.id, { label: e.target.value })}
                              placeholder="Area (e.g. Main bathroom)"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Remove area"
                              onClick={() => removeFlaggedArea(area.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <Textarea
                            value={area.note ?? ""}
                            onChange={(e) => updateFlaggedArea(area.id, { note: e.target.value })}
                            placeholder="What's wrong / what to fix"
                            className="min-h-[60px]"
                          />
                          {area.photoKeys.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {area.photoKeys.map((key) => {
                                const fa = area.annotations?.[key];
                                const faOverlayUrl = fa?.overlayKey ? sectionPhotoUrls[fa.overlayKey] : undefined;
                                const faUrl = sectionPhotoUrls[key];
                                return (
                                  <div key={key} className="group relative">
                                    {faUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={faUrl}
                                        alt="QA flagged photo"
                                        className="h-16 w-16 rounded-lg border border-border object-cover"
                                      />
                                    ) : (
                                      <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-surface-raised">
                                        <Camera className="h-4 w-4 text-muted-foreground" />
                                      </div>
                                    )}
                                    {faOverlayUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={faOverlayUrl} alt="" className="pointer-events-none absolute inset-0 h-16 w-16 rounded-lg object-cover" />
                                    ) : null}
                                    {faUrl ? (
                                      <button
                                        type="button"
                                        aria-label="Mark up photo"
                                        title={fa?.comment || "Draw, pin and comment for the cleaner"}
                                        className="absolute -left-1.5 -bottom-1.5 rounded-full bg-primary p-1 text-primary-foreground shadow"
                                        onClick={() => setAnnotateTarget({ scope: "flagged", areaId: area.id, key, url: faUrl })}
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </button>
                                    ) : null}
                                    {fa ? (
                                      <span className="absolute left-0 top-0 rounded-br-lg rounded-tl-lg bg-primary px-1 py-0.5 text-[8px] font-bold text-primary-foreground">
                                        ✎
                                      </span>
                                    ) : null}
                                    <button
                                      type="button"
                                      aria-label="Remove photo"
                                      className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow"
                                      onClick={() => removeFlaggedAreaPhoto(area.id, key)}
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-10"
                            onClick={() => toggleUploader(openKey)}
                          >
                            <ImagePlus className="mr-2 h-4 w-4" />
                            {open ? "Done" : "Add photo of the problem"}
                          </Button>
                          {open ? (
                            <UploadDropzone
                              jobId={jobId}
                              accept="image/*"
                              maxFiles={6}
                              stamp={{ ...evidenceStamp, tag: "damage", contextLabel: area.label || "Flagged area" }}
                              onUploaded={(r) => addFlaggedAreaPhoto(area.id, r.key)}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                    <Button type="button" variant="outline" size="sm" onClick={addFlaggedArea}>
                      <Plus className="mr-2 h-4 w-4" /> Add flagged area
                    </Button>
                  </div>

                  {/* Who redoes it + pay */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">Who redoes it?</Label>
                    <Select value={rework.assignee} onValueChange={(v) => setRework({ assignee: v as "SAME" | "OTHER" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SAME">Same cleaner — no extra pay</SelectItem>
                        <SelectItem value="OTHER">Different cleaner — paid (deducted from original)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {rework.assignee === "OTHER" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">New cleaner</Label>
                        <Select value={rework.payeeCleanerId ?? ""} onValueChange={(v) => setRework({ payeeCleanerId: v })}>
                          <SelectTrigger><SelectValue placeholder="Select cleaner" /></SelectTrigger>
                          <SelectContent>
                            {payeeOptions.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name || c.email}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Pay amount ($)</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          className="tabular-nums"
                          value={rework.payAmount || ""}
                          onChange={(e) => setRework({ payAmount: Number(e.target.value || 0) })}
                        />
                        {paySuggestion ? (
                          <p className="text-[11px] text-muted-foreground">
                            Suggested: {paySuggestion.hours}h × ${paySuggestion.rate}/h = ${paySuggestion.amount.toFixed(2)}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <p className="rounded-lg bg-warning/10 p-2 text-xs text-muted-foreground">
                    {rework.assignee === "OTHER"
                      ? `A rework job is created for the new cleaner. ${rework.payAmount > 0 ? `$${Number(rework.payAmount).toFixed(2)}` : "The amount"} is paid to them and deducted from the original cleaner.`
                      : "A rework job is created for the same cleaner to fix the flagged areas — no extra pay for the redo."}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* ── Accountability live score ── */}
          <Card className="sticky top-16 z-10 h-fit">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-warning" /> Accountability score
                </CardTitle>
                <div className="text-right">
                  <p
                    className={`text-2xl font-bold tabular-nums leading-none ${
                      acctPreview.managementReview || acctPreview.rating === "FAILED"
                        ? "text-destructive"
                        : acctPreview.rating === "NEEDS IMPROVEMENT"
                          ? "text-warning"
                          : "text-success"
                    }`}
                  >
                    {acctPreview.raw}
                  </p>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {acctPreview.active ? "of 100" : "no findings"}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    acctPreview.managementReview
                      ? "destructive"
                      : acctPreview.rating === "EXCELLENT" || acctPreview.rating === "PASS"
                        ? "success"
                        : acctPreview.rating === "NEEDS IMPROVEMENT"
                          ? "warning"
                          : "destructive"
                  }
                >
                  {acctPreview.managementReview ? "MANAGEMENT REVIEW" : acctPreview.rating}
                </Badge>
                {!acctPreview.active ? (
                  <span className="text-xs text-muted-foreground">All items pass — no accountability data will be sent.</span>
                ) : null}
              </div>
              {acctPreview.active ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Minor ×{acctPreview.minor} (−{acctPreview.minor * acctScoring.minorDeduction})</span>
                  <span>Major ×{acctPreview.major} (−{acctPreview.major * acctScoring.majorDeduction})</span>
                  <span>Critical ×{acctPreview.critical} (−{acctPreview.critical * acctScoring.criticalDeduction})</span>
                  <span>Missing evidence ×{acctPreview.missingEvidence} (−{acctPreview.missingEvidence * acctScoring.missingMandatoryEvidenceDeduction})</span>
                  <span>False confirmations ×{acctPreview.falseConfirmations} (−{acctPreview.falseConfirmations * acctScoring.falseConfirmationExtraDeduction})</span>
                  {acctPreview.na > 0 ? <span>N/A ×{acctPreview.na}</span> : null}
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
              {(template?.schema?.sections ?? []).length > 0 ? (
                <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setCaptureOpen(true)}>
                  <Camera className="mr-2 h-4 w-4" />
                  Camera walkthrough — capture evidence
                </Button>
              ) : null}
              {(template?.schema?.sections ?? []).map((section: any) => {
                const sectionPhotoKeys = tools.sectionPhotos[section.id] ?? [];
                const uploaderOpen = openUploaders[section.id] === true;
                const photoCount = sectionPhotoKeys.filter((k) => !isVideoKey(k)).length;
                const videoCount = sectionPhotoKeys.filter((k) => isVideoKey(k)).length;
                const roomLabel =
                  (typeof section.label === "string" && section.label.trim()) ||
                  (typeof section.title === "string" && section.title.trim()) ||
                  "Area";
                // Cleaner's photos from the MATCHING section of the cleaner's
                // form (normalized-title match, lib/qa/section-match.ts).
                const matchedCleanerSection = latestSubmission
                  ? matchCleanerSection(roomLabel, cleanerSectionTitles)
                  : null;
                const cleanerStripItems = matchedCleanerSection
                  ? (cleanerMediaIdsBySection.get(matchedCleanerSection) ?? [])
                      .map((id) => cleanerMediaById.get(id))
                      .filter((m): m is { id: string; url: string; mediaType?: string; label?: string } => Boolean(m))
                  : [];
                return (
                  <div key={section.id} className="space-y-3 rounded-2xl border border-border bg-surface-raised/40 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-[11px] font-bold text-primary">
                          {roomLabel.charAt(0).toUpperCase()}
                        </span>
                        {roomLabel}
                      </p>
                      <div className="flex items-center gap-2">
                        {photoCount > 0 ? (
                          <Badge variant="secondary" className="tabular-nums">
                            {photoCount} photo{photoCount === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                        {videoCount > 0 ? (
                          <Badge variant="secondary" className="tabular-nums">
                            {videoCount} video{videoCount === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                        <Button
                          type="button"
                          variant={uploaderOpen ? "secondary" : "default"}
                          size="sm"
                          className="h-11"
                          onClick={() => toggleUploader(section.id)}
                        >
                          {uploaderOpen ? (
                            <>Done</>
                          ) : (
                            <>
                              <Camera className="mr-1.5 h-4 w-4" />
                              <Video className="mr-2 h-4 w-4" />
                              Capture
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                    {/* What the cleaner submitted for this area — compact strip. */}
                    {cleanerStripItems.length > 0 ? (
                      <div>
                        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                          Cleaner&apos;s photos — {matchedCleanerSection}
                        </p>
                        <MediaGallery
                          items={cleanerStripItems}
                          title={`Cleaner's photos — ${matchedCleanerSection}`}
                          className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8"
                        />
                      </div>
                    ) : null}
                    {sectionPhotoKeys.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {sectionPhotoKeys.map((key) => {
                          const url = sectionPhotoUrls[key];
                          const video = isVideoKey(key);
                          const annotation = tools.mediaAnnotations[key];
                          const overlayUrl = annotation?.overlayKey ? sectionPhotoUrls[annotation.overlayKey] : undefined;
                          return (
                            <div key={key} className="group relative">
                              {url && video ? (
                                <video
                                  src={url}
                                  muted
                                  playsInline
                                  className="h-16 w-16 rounded-lg border border-border object-cover"
                                />
                              ) : url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={url}
                                  alt="QA section media"
                                  className="h-16 w-16 rounded-lg border border-border object-cover"
                                />
                              ) : (
                                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-surface-raised">
                                  {video ? <Video className="h-4 w-4 text-muted-foreground" /> : <Camera className="h-4 w-4 text-muted-foreground" />}
                                </div>
                              )}
                              {overlayUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={overlayUrl} alt="" className="pointer-events-none absolute inset-0 h-16 w-16 rounded-lg object-cover" />
                              ) : null}
                              {video ? (
                                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                                  <span className="rounded-full bg-black/55 p-1 text-white">
                                    <Play className="h-3.5 w-3.5" />
                                  </span>
                                </span>
                              ) : null}
                              {!video && url ? (
                                <button
                                  type="button"
                                  aria-label="Mark up photo"
                                  title={annotation?.comment || "Draw, pin and comment on this photo"}
                                  className="absolute -left-1.5 -bottom-1.5 rounded-full bg-primary p-1 text-primary-foreground shadow"
                                  onClick={() => setAnnotateTarget({ scope: "section", sectionId: section.id, key, url })}
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              ) : null}
                              {annotation ? (
                                <span className="absolute left-0 top-0 rounded-br-lg rounded-tl-lg bg-primary px-1 py-0.5 text-[8px] font-bold text-primary-foreground">
                                  ✎
                                </span>
                              ) : null}
                              <button
                                type="button"
                                aria-label="Remove media"
                                className="absolute -right-1.5 -top-1.5 rounded-full bg-destructive p-0.5 text-destructive-foreground shadow"
                                onClick={() => removeSectionPhoto(section.id, key)}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {uploaderOpen ? (
                      <div className="space-y-1.5">
                        <UploadDropzone
                          jobId={jobId}
                          accept="image/*,video/*"
                          maxFiles={8}
                          stamp={{
                            ...evidenceStamp,
                            tag: "after",
                            contextLabel: roomLabel,
                          }}
                          onUploaded={(r) => addSectionPhoto(section.id, r.key)}
                        />
                        <p className="text-[11px] text-muted-foreground">Take photos or record a video for this area.</p>
                      </div>
                    ) : null}
                    {(section.fields ?? [])
                      // Signature/instruction/inventory are display-only or captured
                      // elsewhere — no verdict. The inspector signs once below.
                      .filter((field: any) => !["signature", "instruction", "inventory"].includes(field.type))
                      .map((field: any) => {
                        const answerable = !isUploadFieldType(field.type);
                        // Legacy Pass/Minor/Fail radios are no longer answered
                        // directly — the verdict below derives their answer.
                        const legacyDerived = isPassChoiceField(field);
                        const requiredPhoto =
                          isUploadFieldType(field.type) && (Boolean(field.required) || Number(field.minPhotos) > 0);
                        const meta = itemMeta[field.id];
                        if (!meta) return null;
                        return (
                          <AccountabilityItemV1
                            key={field.id}
                            field={field}
                            requiredPhoto={requiredPhoto}
                            meta={meta}
                            state={verdictState(field.id)}
                            onPatch={(patch) => {
                              patchVerdict(field.id, patch);
                              if (legacyDerived && patch.verdict) deriveLegacyAnswer(field.id, patch.verdict);
                            }}
                            missing={Boolean(missingEvidence[field.id])}
                            onToggleMissing={(v) => toggleMissing(field.id, v)}
                            issueCategories={issueCategories}
                            jobId={jobId}
                            urlByKey={sectionPhotoUrls}
                            onAddPhoto={(key) => addVerdictPhoto(field.id, key)}
                            onRemovePhoto={(key) => removeVerdictPhoto(field.id, key)}
                          >
                            {legacyDerived ? (
                              // The Pass/Minor/Fail control is gone — keep the
                              // item label; the verdict row derives the answer.
                              <div className="text-sm font-medium text-foreground">
                                {field.label}
                                {field.required ? <span className="ml-1 text-destructive">*</span> : null}
                              </div>
                            ) : answerable ? (
                              <FieldInput
                                field={field}
                                value={data[field.id]}
                                onChange={(value) => setField(field.id, value)}
                              />
                            ) : (
                              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                <Camera className="h-4 w-4 text-muted-foreground" />
                                {field.label}
                                {field.required ? <span className="text-destructive">*</span> : null}
                                <span className="text-xs font-normal text-muted-foreground">
                                  · {meta.cleanerMediaIds.length} cleaner photo{meta.cleanerMediaIds.length === 1 ? "" : "s"}
                                </span>
                              </div>
                            )}
                          </AccountabilityItemV1>
                        );
                      })}
                  </div>
                );
              })}

              <div className="space-y-1.5">
                <Label>QA notes</Label>
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Internal notes and follow-up instructions" />
              </div>

              {/* ── Inspector sign-off (required before submit) ── */}
              <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Inspector sign-off</p>
                  <p className="text-xs text-muted-foreground">Required — your signature is recorded on the inspection report.</p>
                </div>
                <SignaturePad
                  label={`Signature — ${inspectorName}`}
                  value={signatureDataUrl}
                  onChange={setSignatureDataUrl}
                  required
                />
                <label className="flex items-start gap-2.5 text-xs leading-snug text-foreground">
                  <Checkbox checked={attested} onCheckedChange={(v) => setAttested(v === true)} className="mt-0.5 shrink-0" />
                  <span>I attest that this QA inspection is accurate and complete, and was carried out by me ({inspectorName}).</span>
                </label>
              </div>

              <p className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                {!online ? (
                  <span className="text-amber-600">Offline — saved on this device, submit when you&apos;re back online.</span>
                ) : draftSavedAt ? (
                  <span>Draft saved {new Date(draftSavedAt).toLocaleTimeString()}</span>
                ) : (
                  <span>Changes save automatically as you go.</span>
                )}
              </p>
              <Button className="h-11 w-full" onClick={() => void submit()} disabled={saving || !online || !attested || !signatureDataUrl}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {saving
                  ? "Submitting..."
                  : !online
                    ? "Offline — can't submit yet"
                    : !signatureDataUrl
                      ? "Sign to submit"
                      : !attested
                        ? "Confirm attestation to submit"
                        : "Sign off & submit QA review"}
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

      {/* Step navigation */}
      <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface/95 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <Button
          type="button"
          variant="outline"
          disabled={step === 0}
          onClick={() => {
            setStep((s) => Math.max(0, s - 1));
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
        </Button>
        <span className="text-xs font-medium text-muted-foreground">
          Step {step + 1} of {QA_STEPS.length}
        </span>
        {step < QA_STEPS.length - 1 ? (
          <Button
            type="button"
            onClick={() => {
              setStep((s) => Math.min(QA_STEPS.length - 1, s + 1));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            Next: score &amp; sign off <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        ) : (
          <span className="text-xs font-medium text-primary">Submit below ↓</span>
        )}
      </div>

      {captureOpen ? (
        <GuidedCapture
          items={(template?.schema?.sections ?? []).map(
            (s: any): GuidedCaptureItem => ({
              fieldId: s.id,
              label:
                (typeof s.label === "string" && s.label.trim()) ||
                (typeof s.title === "string" && s.title.trim()) ||
                "Photos",
              sectionLabel: "QA evidence",
            })
          )}
          counts={Object.fromEntries(
            (template?.schema?.sections ?? []).map((s: any) => [
              s.id,
              (tools.sectionPhotos[s.id]?.length ?? 0) + (capturePending[s.id] ?? 0),
            ])
          )}
          pendingCounts={capturePending}
          thumbnails={Object.fromEntries(
            (template?.schema?.sections ?? []).map((s: any) => [
              s.id,
              (tools.sectionPhotos[s.id] ?? []).map((k) => sectionPhotoUrls[k]).filter(Boolean),
            ])
          )}
          onFiles={captureSectionFiles}
          onClose={() => setCaptureOpen(false)}
        />
      ) : null}

      {annotateTarget ? (
        <ImageAnnotator
          src={annotateTarget.url}
          open={Boolean(annotateTarget)}
          onOpenChange={(v) => {
            if (!v) setAnnotateTarget(null);
          }}
          initialComment={
            annotateTarget.scope === "damage"
              ? tools.damage.find((d) => d.id === annotateTarget.entryId)?.annotations?.[annotateTarget.key]?.comment ?? ""
              : annotateTarget.scope === "flagged"
                ? rework.flaggedAreas.find((a) => a.id === annotateTarget.areaId)?.annotations?.[annotateTarget.key]?.comment ?? ""
                : tools.mediaAnnotations[annotateTarget.key]?.comment ?? ""
          }
          saving={savingAnnotation}
          onSave={({ blob, comment }) => saveAnnotation(blob, comment)}
        />
      ) : null}
    </div>
  );
}
