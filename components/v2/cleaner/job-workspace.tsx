"use client";

/**
 * Native Estate cleaner job workspace — the execution surface.
 *
 * Wires the SAME endpoints the v1 workspace uses:
 *   GET  /api/jobs/[id]/form                       → job, template, jobTasks, timeState
 *   GET  /api/cleaner/jobs/[id]/briefing           → prior QA warning, rework notes, linen drop, access vault
 *   GET/PATCH/DELETE /api/cleaner/jobs/[id]/draft  → shared cross-device job draft
 *   POST /api/cleaner/jobs/[id]/gps-checkin        → clock-in GPS capture
 *   POST /api/cleaner/jobs/[id]/start              → start (IN_PROGRESS) / clock-in
 *   POST /api/cleaner/jobs/[id]/stop               → pause clock (PAUSED)
 *   POST /api/cleaner/jobs/[id]/clock-out-early    → clock out, finish form later (admin-allowlisted)
 *   POST /api/cleaner/jobs/[id]/gps-checkout       → clock-out GPS
 *   POST /api/cleaner/jobs/[id]/submit             → checklist + form submission
 *   POST /api/uploads/direct                       → per-field photo/video (via MediaCapture)
 *
 * Flow: open → property/access + clock-in (GPS) → checklist (jobTasks: per-item
 * complete + note + photo) → the assigned form template rendered natively →
 * submit → clock-out.
 */
import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  MapPin,
  Clock,
  Play,
  Pause,
  Loader2,
  CheckCircle2,
  Camera,
  Navigation,
  KeyRound,
  ListChecks,
  ClipboardCheck,
  AlertTriangle,
  BookOpen,
  Package,
  Square,
  Megaphone,
  WashingMachine,
  Forward,
  Plus,
  Trash2,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EAlert,
} from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { MediaGallery } from "@/components/shared/media-gallery";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";
import { JobOfferActions } from "@/components/v2/cleaner/job-offer-actions";
import { JobActions } from "@/components/v2/cleaner/job-actions";
import PropertyAccessGuide from "@/components/v2/cleaner/property-access-guide";
import {
  FormRenderer,
  type AnswerMap,
  type UploadMap,
} from "@/components/v2/cleaner/form-renderer";
import type { FormSchema } from "@/lib/forms/types";
import { collectFormErrors } from "@/lib/forms/validate-submission";
import { cn } from "@/lib/utils";
import { formatDuration, elapsedSecondsSince } from "@/lib/time/format-duration";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

function statusTone(status: string): Tone {
  switch (status) {
    case "ASSIGNED":
    case "EN_ROUTE":
      return "primary";
    case "IN_PROGRESS":
      return "info";
    case "PAUSED":
      return "warning";
    case "SUBMITTED":
      return "warning";
    case "QA_REVIEW":
      return "aubergine";
    case "COMPLETED":
    case "INVOICED":
      return "success";
    default:
      return "neutral";
  }
}
function titleCase(v: string) {
  return v.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

interface JobTask {
  id: string;
  title: string;
  description?: string | null;
  source: string;
  requiresPhoto?: boolean;
  requiresNote?: boolean;
}
interface TaskDraft {
  decision: "OPEN" | "COMPLETED" | "NOT_COMPLETED";
  note: string;
  proof: CapturedMedia[];
}
/** A client- or admin-flagged request the cleaner must not miss on this job. */
interface ImportantRequest {
  key: string;
  title: string;
  detail?: string;
  source: string;
}

const LOCKED = ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"];

type LaundryOutcome = "READY_FOR_PICKUP" | "NOT_READY" | "NO_PICKUP_REQUIRED";
const LAUNDRY_SKIP_REASONS: Array<{ value: string; label: string }> = [
  { value: "LINEN_STILL_WASHING", label: "Linen still washing" },
  { value: "LINEN_STILL_DRYING", label: "Linen still drying" },
  { value: "NO_LINEN_ON_SITE", label: "No linen on site" },
  { value: "NO_PICKUP_REQUIRED", label: "No pickup required" },
  { value: "OTHER", label: "Other" },
];
/** Upload key the submit route reads for the laundry-ready photo. */
const LAUNDRY_PHOTO_KEY = "laundry_photo";

export function JobWorkspace({ jobId }: { jobId: string }) {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [payload, setPayload] = React.useState<any>(null);
  const [briefing, setBriefing] = React.useState<any>(null);

  const [answers, setAnswers] = React.useState<AnswerMap>({});
  const [uploads, setUploads] = React.useState<UploadMap>({});
  const [taskDrafts, setTaskDrafts] = React.useState<Record<string, TaskDraft>>({});

  // Laundry captured on final submit (laundry-enabled jobs only). Sent alongside
  // the form so the linen pickup is recorded at completion — same fields the
  // standalone early-update card in JobActions sends.
  const [laundryOutcome, setLaundryOutcome] = React.useState<LaundryOutcome | "">("");
  const [laundryBagLocation, setLaundryBagLocation] = React.useState("");
  const [laundryPhoto, setLaundryPhoto] = React.useState<CapturedMedia[]>([]);
  const [laundrySkipCode, setLaundrySkipCode] = React.useState("LINEN_STILL_WASHING");
  const [laundrySkipNote, setLaundrySkipNote] = React.useState("");

  // Pass-to-next-cleaner: free-text flags (+ optional photo) that become
  // CARRY_FORWARD tasks on the next clean at this property.
  const [carryHasNew, setCarryHasNew] = React.useState(false);
  const [carryNotes, setCarryNotes] = React.useState<string[]>([""]);
  const [carryPhotos, setCarryPhotos] = React.useState<CapturedMedia[]>([]);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  // Shared cross-device draft (same /draft endpoint + envelope as v1).
  const editorSessionIdRef = React.useRef<string>(
    `v2-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
  );
  const draftHydratedRef = React.useRef(false);
  const draftTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftInfo, setDraftInfo] = React.useState<{ updatedAt: string | null; updatedByName: string | null }>({
    updatedAt: null,
    updatedByName: null,
  });

  const restoreDraftState = React.useCallback((state: Record<string, any>) => {
    if (!state || typeof state !== "object") return;
    if (state.answers && typeof state.answers === "object") setAnswers(state.answers as AnswerMap);
    if (state.uploads && typeof state.uploads === "object") {
      const next: UploadMap = {};
      for (const [fieldId, media] of Object.entries(state.uploads as Record<string, unknown>)) {
        if (Array.isArray(media)) {
          next[fieldId] = media.filter(
            (m: any) => m && typeof m === "object" && typeof m.key === "string"
          ) as CapturedMedia[];
        }
      }
      setUploads(next);
    }
    if (state.taskDrafts && typeof state.taskDrafts === "object") {
      setTaskDrafts((prev) => {
        const next = { ...prev };
        for (const [taskId, raw] of Object.entries(state.taskDrafts as Record<string, any>)) {
          if (!raw || typeof raw !== "object") continue;
          next[taskId] = {
            decision:
              raw.decision === "COMPLETED" || raw.decision === "NOT_COMPLETED" ? raw.decision : "OPEN",
            note: typeof raw.note === "string" ? raw.note : "",
            proof: Array.isArray(raw.proof)
              ? (raw.proof.filter((m: any) => m && typeof m.key === "string") as CapturedMedia[])
              : [],
          };
        }
        return next;
      });
    }
    const laundry = state.laundry;
    if (laundry && typeof laundry === "object") {
      if (
        laundry.outcome === "READY_FOR_PICKUP" ||
        laundry.outcome === "NOT_READY" ||
        laundry.outcome === "NO_PICKUP_REQUIRED"
      ) {
        setLaundryOutcome(laundry.outcome);
      }
      if (typeof laundry.bagLocation === "string") setLaundryBagLocation(laundry.bagLocation);
      if (typeof laundry.skipCode === "string" && laundry.skipCode) setLaundrySkipCode(laundry.skipCode);
      if (typeof laundry.skipNote === "string") setLaundrySkipNote(laundry.skipNote);
      if (Array.isArray(laundry.photo)) {
        setLaundryPhoto(laundry.photo.filter((m: any) => m && typeof m.key === "string") as CapturedMedia[]);
      }
    }
    const carry = state.carryForward;
    if (carry && typeof carry === "object") {
      setCarryHasNew(carry.hasNew === true);
      if (Array.isArray(carry.notes)) {
        const notes = carry.notes.filter((n: any) => typeof n === "string");
        setCarryNotes(notes.length > 0 ? notes : [""]);
      }
      if (Array.isArray(carry.photos)) {
        setCarryPhotos(carry.photos.filter((m: any) => m && typeof m.key === "string") as CapturedMedia[]);
      }
    }
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/form`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load job");
      setPayload(data);
      // Seed task drafts.
      const tasks: JobTask[] = Array.isArray(data.jobTasks) ? data.jobTasks : [];
      setTaskDrafts((prev) => {
        const next = { ...prev };
        for (const t of tasks) {
          if (!next[t.id]) next[t.id] = { decision: "OPEN", note: "", proof: [] };
        }
        return next;
      });
      // Pre-start briefing — prior QA warning, rework notes, linen drop, access vault.
      try {
        const bRes = await fetch(`/api/cleaner/jobs/${jobId}/briefing`, { cache: "no-store" });
        const bBody = await bRes.json().catch(() => null);
        setBriefing(bRes.ok ? bBody : null);
      } catch {
        setBriefing(null);
      }
      // Restore the shared draft once (progress saved on this or another device).
      if (!draftHydratedRef.current) {
        draftHydratedRef.current = true;
        try {
          const dRes = await fetch(`/api/cleaner/jobs/${jobId}/draft`, { cache: "no-store" });
          if (dRes.ok) {
            const dBody = await dRes.json().catch(() => ({}));
            const envelope = dBody?.draft;
            if (envelope?.state && typeof envelope.state === "object") {
              restoreDraftState(envelope.state as Record<string, any>);
              setDraftInfo({
                updatedAt: typeof envelope.updatedAt === "string" ? envelope.updatedAt : null,
                updatedByName: typeof envelope.updatedByName === "string" ? envelope.updatedByName : null,
              });
            }
          }
        } catch {
          /* draft restore is best-effort */
        }
      }
    } catch (e: any) {
      setError(e?.message || "Could not load job");
    } finally {
      setLoading(false);
    }
  }, [jobId, restoreDraftState]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const job = payload?.job;
  const template = payload?.template;
  const schema: FormSchema | null = template?.schema ?? null;
  const jobTasks: JobTask[] = Array.isArray(payload?.jobTasks) ? payload.jobTasks : [];
  const timeState = payload?.timeState ?? { isRunning: false, completedSeconds: 0 };
  const status: string = job?.status ?? "";
  const locked = LOCKED.includes(status);
  const property = job?.property ?? {};
  const addressLine = [property.address, property.suburb, property.state, property.postcode].filter(Boolean).join(", ");
  // accessInfo may be a plain string OR a structured object (codes/lockbox/
  // parking/instructions/accessNotesSummary…). Render it as safe text either way.
  const rawAccess: any = (property as any).accessInfo;
  const accessText: string =
    typeof rawAccess === "string"
      ? rawAccess
      : rawAccess && typeof rawAccess === "object"
      ? [
          rawAccess.accessNotesSummary,
          rawAccess.instructions,
          rawAccess.codes && typeof rawAccess.codes === "string" ? `Codes: ${rawAccess.codes}` : null,
          rawAccess.lockbox && typeof rawAccess.lockbox === "string" ? `Lockbox: ${rawAccess.lockbox}` : null,
          rawAccess.parking && typeof rawAccess.parking === "string" ? `Parking: ${rawAccess.parking}` : null,
          rawAccess.other && typeof rawAccess.other === "string" ? rawAccess.other : null,
        ]
          .filter((x) => typeof x === "string" && x.trim())
          .join("\n")
      : "";
  const hasCheckin = Boolean(job?.gpsCheckInAt);
  const propertyId: string | null = job?.propertyId ?? (property as any)?.id ?? null;

  // Accept gate: gate on THIS cleaner's own assignment response, not the job's
  // global status (a job can be ASSIGNED overall while still PENDING for me).
  const responseStatus: string | null = payload?.assignmentState?.responseStatus ?? null;
  const needsAcceptance = responseStatus === "PENDING";

  // Laundry is captured on submit only when the property has laundry enabled and
  // this isn't a rework (reworks reuse the original clean's linen) — mirrors the
  // submit route's `laundrySuppressed` rule so the UI matches what's persisted.
  const laundryEnabled = (property as any)?.laundryEnabled !== false && job?.isRework !== true;

  // Client / admin-flagged requests for THIS job — sourced from the same jobTasks
  // the checklist uses (source CLIENT / ADMIN) plus the quote's client-requested
  // additionals (payload.jobMeta.additionals — the form's "Additionals
  // (client-requested)" section). These are the things the cleaner must not miss.
  const importantRequests = React.useMemo<ImportantRequest[]>(() => {
    const out: ImportantRequest[] = [];
    for (const t of jobTasks) {
      const s = String(t.source ?? "").toUpperCase();
      if (s !== "CLIENT" && s !== "ADMIN") continue;
      out.push({
        key: `task-${t.id}`,
        title: t.title,
        detail: t.description ?? undefined,
        source: s === "CLIENT" ? "Client request" : "Admin request",
      });
    }
    const additionals = Array.isArray(payload?.jobMeta?.additionals) ? payload.jobMeta.additionals : [];
    for (const a of additionals) {
      if (!a || typeof a !== "object") continue;
      const title = typeof a.label === "string" ? a.label.trim() : "";
      if (!title) continue;
      out.push({
        key: `additional-${a.id ?? title}`,
        title,
        detail: typeof a.instructions === "string" && a.instructions.trim() ? a.instructions : undefined,
        source: "Client-requested extra",
      });
    }
    return out;
  }, [jobTasks, payload]);

  // One-time attention popup on open (per job, remembered in localStorage).
  const ackKey = `sneek-v2-important-ack-${jobId}`;
  const [importantAck, setImportantAck] = React.useState(false);
  const [importantOpen, setImportantOpen] = React.useState(false);
  const importantShownRef = React.useRef(false);
  React.useEffect(() => {
    if (importantShownRef.current || loading) return;
    if (locked || needsAcceptance) return;
    if (importantRequests.length === 0) return;
    importantShownRef.current = true;
    let acked = false;
    try {
      acked = typeof window !== "undefined" && window.localStorage.getItem(ackKey) === "1";
    } catch {
      /* private mode — treat as not yet acknowledged */
    }
    setImportantAck(acked);
    if (!acked) setImportantOpen(true);
  }, [loading, locked, needsAcceptance, importantRequests.length, ackKey]);

  function acknowledgeImportant() {
    try {
      window.localStorage.setItem(ackKey, "1");
    } catch {
      /* best-effort */
    }
    setImportantAck(true);
    setImportantOpen(false);
  }

  // Debounced shared-draft autosave — mirrors v1's PATCH /draft envelope
  // ({ editorSessionId, state }) so a co-cleaner or another device can resume.
  React.useEffect(() => {
    if (!draftHydratedRef.current || loading || !job || locked) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const state = {
        v2: true,
        updatedAt: new Date().toISOString(),
        answers,
        uploads,
        taskDrafts,
        laundry: {
          outcome: laundryOutcome,
          bagLocation: laundryBagLocation,
          skipCode: laundrySkipCode,
          skipNote: laundrySkipNote,
          photo: laundryPhoto,
        },
        carryForward: {
          hasNew: carryHasNew,
          notes: carryNotes,
          photos: carryPhotos,
        },
      };
      void fetch(`/api/cleaner/jobs/${jobId}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editorSessionId: editorSessionIdRef.current, state }),
      }).catch(() => {});
    }, 1500);
    return () => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    answers,
    uploads,
    taskDrafts,
    laundryOutcome,
    laundryBagLocation,
    laundrySkipCode,
    laundrySkipNote,
    laundryPhoto,
    carryHasNew,
    carryNotes,
    carryPhotos,
    locked,
    loading,
    jobId,
  ]);

  function flash(tone: "success" | "danger" | "info", text: string) {
    setNotice({ tone, text });
    if (tone !== "danger") setTimeout(() => setNotice(null), 4000);
  }

  async function post(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function getGps(): Promise<{ lat: number; lng: number; accuracy: number | null }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Geolocation unavailable"));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
        (e) => reject(new Error(e.message || "Location denied")),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }

  // Clock-in: capture GPS → gps-checkin, then start the clock.
  async function clockIn() {
    setBusy("clockin");
    try {
      let gps: { lat: number; lng: number; accuracy: number | null } | null = null;
      try {
        gps = await getGps();
        await post(`/api/cleaner/jobs/${jobId}/gps-checkin`, {
          lat: gps.lat,
          lng: gps.lng,
          accuracy: gps.accuracy,
          confirmed: true,
        });
      } catch (geoErr: any) {
        // GPS optional but recorded when available; surface a soft note.
        flash("info", `Starting without GPS (${geoErr.message}).`);
      }
      await post(`/api/cleaner/jobs/${jobId}/start`, { allowFutureStart: true });
      flash("success", "Clocked in — job started.");
      await load();
    } catch (e: any) {
      flash("danger", e.message);
    } finally {
      setBusy(null);
    }
  }

  async function pauseClock() {
    setBusy("pause");
    try {
      await post(`/api/cleaner/jobs/${jobId}/stop`);
      flash("info", "Clock paused.");
      await load();
    } catch (e: any) {
      flash("danger", e.message);
    } finally {
      setBusy(null);
    }
  }

  // Clock out WITHOUT the form (admin-allowlisted): the clock stops but the job
  // stays open — not counted as completed until the form is submitted.
  async function clockOutEarly() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Clock out and finish the form later?\n\nThe clock will stop, but this job stays open and is NOT counted as completed until you come back and submit the form."
      )
    )
      return;
    setBusy("clockout-early");
    try {
      await post(`/api/cleaner/jobs/${jobId}/clock-out-early`);
      try {
        const gps = await getGps();
        await post(`/api/cleaner/jobs/${jobId}/gps-checkout`, { lat: gps.lat, lng: gps.lng });
      } catch {
        /* GPS optional */
      }
      flash("success", "Clocked out. Come back any time to finish the form — the job isn't complete until it's submitted.");
      await load();
    } catch (e: any) {
      flash("danger", e.message);
    } finally {
      setBusy(null);
    }
  }

  function setTask(id: string, patch: Partial<TaskDraft>) {
    setTaskDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function submit() {
    // Client-side validation gate (mirrors the server's required-field rules):
    // reveal inline errors + scroll to the first, and block the submit so the
    // cleaner sees exactly what's missing instead of a bare server rejection.
    if (schema) {
      const uploadCounts: Record<string, number> = {};
      for (const [fid, media] of Object.entries(uploads)) uploadCounts[fid] = media.length;
      const formErrors = collectFormErrors(schema, answers, uploadCounts, property ?? {});
      if (formErrors.length > 0) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("sneek:validate-form"));
        flash(
          "danger",
          `${formErrors.length} required item${formErrors.length > 1 ? "s" : ""} incomplete — please review the highlighted fields.`
        );
        return;
      }
    }
    // Laundry capture gate (laundry-enabled jobs) — mirrors the submit route's
    // laundry rules so the cleaner sees exactly what's missing.
    if (laundryEnabled) {
      if (!laundryOutcome) {
        flash("danger", "Choose a laundry outcome before submitting.");
        return;
      }
      if (laundryOutcome === "READY_FOR_PICKUP") {
        if (!laundryBagLocation.trim()) {
          flash("danger", "Bag location is required when laundry is ready for pickup.");
          return;
        }
        if (laundryPhoto.length === 0) {
          flash("danger", "A laundry photo is required when laundry is marked ready.");
          return;
        }
      } else if (!laundrySkipCode) {
        flash("danger", "Select a reason when laundry isn't ready for pickup.");
        return;
      }
    }
    setBusy("submit");
    setNotice(null);
    try {
      // Build the uploads map (fieldId → [s3Key]) from captured media.
      const uploadKeys: Record<string, string[]> = {};
      for (const [fieldId, media] of Object.entries(uploads)) {
        if (media.length > 0) uploadKeys[fieldId] = media.map((m) => m.key);
      }
      // jobTasks decisions.
      const jobTasksPayload = jobTasks.map((t) => {
        const d = taskDrafts[t.id] ?? { decision: "OPEN", note: "", proof: [] };
        return {
          id: t.id,
          decision: (d.decision === "COMPLETED" ? "COMPLETED" : "NOT_COMPLETED") as "COMPLETED" | "NOT_COMPLETED",
          note: d.note,
          proofKeys: d.proof.map((m) => m.key),
        };
      });

      // Carry-forward block for the next cleaner at this property. resolvedTaskIds
      // stays empty in v2 — incoming carry-forward tasks are resolved through the
      // unified checklist above; this card only raises NEW flags. New-flag photos
      // are namespaced so the route never confuses them with resolved-task proofs.
      const cleanCarryNotes = carryNotes.map((n) => n.trim()).filter(Boolean);
      const carryForwardPayload = {
        resolvedTaskIds: [] as string[],
        hasNew: carryHasNew && cleanCarryNotes.length > 0,
        newTaskNotes: carryHasNew ? cleanCarryNotes : [],
        taskPhotoKeys:
          carryHasNew && carryPhotos.length > 0
            ? { __carryForwardNew: carryPhotos.map((m) => m.key) }
            : {},
      };

      // Laundry captured at submit → same upload key + top-level fields the route
      // already reads (extractUploads → laundry_photo; body.laundryOutcome …).
      if (laundryEnabled && laundryOutcome === "READY_FOR_PICKUP" && laundryPhoto.length > 0) {
        uploadKeys[LAUNDRY_PHOTO_KEY] = laundryPhoto.map((m) => m.key);
      }

      const body: Record<string, unknown> = {
        templateId: template?.id,
        data: { ...answers, uploads: uploadKeys, carryForward: carryForwardPayload },
        jobTasks: jobTasksPayload,
      };
      if (laundryEnabled && laundryOutcome) {
        body.laundryOutcome = laundryOutcome;
        body.laundryReady = laundryOutcome === "READY_FOR_PICKUP";
        if (laundryOutcome === "READY_FOR_PICKUP") {
          body.bagLocation = laundryBagLocation.trim();
        } else {
          body.laundrySkipReasonCode = laundrySkipCode;
          if (laundrySkipNote.trim()) body.laundrySkipReasonNote = laundrySkipNote.trim();
        }
      }
      const data = await post(`/api/cleaner/jobs/${jobId}/submit`, body);
      // The job is done — clear the shared draft so no one resumes stale state.
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      void fetch(`/api/cleaner/jobs/${jobId}/draft`, { method: "DELETE" }).catch(() => {});
      // Best-effort clock-out GPS after a successful submit.
      try {
        const gps = await getGps();
        await post(`/api/cleaner/jobs/${jobId}/gps-checkout`, { lat: gps.lat, lng: gps.lng });
      } catch {
        /* GPS optional at clock-out */
      }
      flash("success", "Job submitted. Thank you.");
      await load();
      return data;
    } catch (e: any) {
      flash("danger", e.message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (error || !job) {
    return (
      <div className="space-y-4">
        <BackLink />
        <EAlert tone="danger" title="Could not load job">
          {error || "This job is unavailable."}
        </EAlert>
        <EButton variant="outline" onClick={() => void load()}>
          Try again
        </EButton>
      </div>
    );
  }

  const allTasksDecided = jobTasks.every((t) => (taskDrafts[t.id]?.decision ?? "OPEN") !== "OPEN");

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="e-eyebrow">{job.jobNumber ? `Job ${job.jobNumber}` : "Job"}</p>
            <h1 className="e-display-md truncate">{property.name}</h1>
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{titleCase(job.jobType)}</p>
          </div>
          <EBadge tone={statusTone(status)} soft>
            {titleCase(status)}
          </EBadge>
        </div>
        <div className="e-signature-rule" />
      </div>

      {notice ? (
        <EAlert tone={notice.tone === "danger" ? "danger" : notice.tone === "success" ? "success" : "info"}>
          {notice.text}
        </EAlert>
      ) : null}

      {/* Property access guide — self-fetching; renders nothing when the property
          has no guide, so mounting it is always safe. */}
      {propertyId ? <PropertyAccessGuide propertyId={propertyId} /> : null}

      {/* Client / admin requests — a loud, always-visible callout so the specific
          asks for this job stay front-of-mind even after the popup is dismissed. */}
      {importantRequests.length > 0 ? (
        <ECard className="border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]">
          <ECardBody className="space-y-3 pt-6">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600] text-[hsl(var(--e-foreground))]">
                <Megaphone className="h-4 w-4 text-[hsl(var(--e-gold))]" /> Client requests
              </p>
              <EBadge tone="gold" soft>
                {importantRequests.length}
              </EBadge>
            </div>
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              Specific requests the client or admin flagged for this job — make sure every one is handled.
            </p>
            <ul className="space-y-2">
              {importantRequests.map((r) => (
                <li
                  key={r.key}
                  className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-gold))] bg-[hsl(var(--e-surface))] p-3"
                >
                  <p className="text-[0.875rem] font-[550]">{r.title}</p>
                  {r.detail ? (
                    <p className="mt-0.5 whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                      {r.detail}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[0.625rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                    {r.source}
                  </p>
                </li>
              ))}
            </ul>
            {importantAck ? (
              <button
                type="button"
                onClick={() => setImportantOpen(true)}
                className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] underline-offset-2 hover:underline"
              >
                Show the full requests reminder again
              </button>
            ) : null}
          </ECardBody>
        </ECard>
      ) : null}

      {/* One-time attention popup for client / admin requests on this job. */}
      <EModal
        open={importantOpen}
        onClose={() => setImportantOpen(false)}
        size="wide"
        eyebrow="Please read"
        title={
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[hsl(var(--e-gold))]" /> Important requests for this job
          </span>
        }
      >
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            The client and admin flagged these specific requests for this job. Please read them before you begin.
          </p>
          <ul className="space-y-3">
            {importantRequests.map((r) => (
              <li
                key={r.key}
                className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] p-3"
              >
                <p className="text-[0.9375rem] font-[600]">{r.title}</p>
                {r.detail ? (
                  <p className="mt-1 whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                    {r.detail}
                  </p>
                ) : null}
                <p className="mt-1.5 text-[0.625rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                  {r.source}
                </p>
              </li>
            ))}
          </ul>
          <EButton variant="gold" className="w-full" onClick={acknowledgeImportant}>
            <CheckCircle2 className="h-4 w-4" /> I&apos;ve read these
          </EButton>
        </div>
      </EModal>

      {/* Offer — accept or decline before starting. Gated on MY assignment's
          response (PENDING), not the job's global status. */}
      {needsAcceptance ? (
        <ECard>
          <ECardBody className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[0.9375rem] font-[600]">You've been offered this job</p>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Accept to add it to your schedule, or decline so it can be reassigned.
              </p>
            </div>
            <JobOfferActions jobId={job.id} size="md" />
          </ECardBody>
        </ECard>
      ) : null}

      {/* Property / access */}
      <ECard>
        <ECardBody className="space-y-3 pt-6">
          <p className="flex items-start gap-2 text-[0.875rem]">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" />
            <span>{addressLine || "Address not set"}</span>
          </p>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {property.bedrooms ?? 0} bd · {property.bathrooms ?? 0} ba
            {job.startTime ? ` · ${job.startTime}${job.dueTime ? `–${job.dueTime}` : ""}` : ""}
          </p>
          {accessText ? (
            <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] p-3">
              <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
                <KeyRound className="h-4 w-4" /> Access
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                {accessText}
              </p>
            </div>
          ) : null}
          {job.notes?.trim() ? (
            <p className="whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{job.notes.trim()}</p>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            {addressLine ? (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressLine)}`}
                target="_blank"
                rel="noreferrer"
              >
                <EButton variant="outline" size="sm">
                  <Navigation className="h-4 w-4" /> Navigate
                </EButton>
              </a>
            ) : null}
          </div>
        </ECardBody>
      </ECard>

      {/* Job briefing — prior QA warning, rework notes, linen drop, access vault */}
      {!locked && !needsAcceptance ? <BriefingCard briefing={briefing} /> : null}

      {/* Shared draft resumed from another device / co-cleaner */}
      {!locked && draftInfo.updatedAt ? (
        <EAlert tone="info" title="Saved progress restored">
          {draftInfo.updatedByName ? `Last saved by ${draftInfo.updatedByName}` : "Draft restored"}
          {" · "}
          {new Date(draftInfo.updatedAt).toLocaleString("en-AU", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
          . Your checklist and form answers keep saving automatically.
        </EAlert>
      ) : null}

      {/* Clock / GPS control */}
      <ClockCard
        status={status}
        locked={locked}
        hasCheckin={hasCheckin}
        isRunning={timeState.isRunning}
        completedSeconds={timeState.completedSeconds}
        activeStartedAt={timeState.activeStartedAt ?? null}
        maxAllowedTotalSeconds={timeState.maxAllowedTotalSeconds ?? null}
        busy={busy}
        onClockIn={clockIn}
        onPause={pauseClock}
      />

      {/* Form still pending after an early clock-out */}
      {job?.formPendingAfterClockOut && !locked ? (
        <EAlert tone="warning" title="Form still pending">
          You clocked out without submitting the form. This job is not complete until the form below is submitted.
        </EAlert>
      ) : null}

      {/* Clock out & finish the form later — only for admin-allowlisted cleaners */}
      {payload?.canClockOutWithoutForm &&
      (hasCheckin || timeState.isRunning || (timeState.completedSeconds ?? 0) > 0) &&
      !locked ? (
        <ECard className="border-[hsl(var(--e-warning))]">
          <ECardBody className="space-y-2 pt-6">
            <p className="text-[0.875rem] font-[550]">Clock out &amp; finish the form later</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Stops your clock now. This job stays open and is <strong>not counted as completed</strong> until you
              come back and submit the form.
            </p>
            <EButton
              variant="outline"
              className="w-full"
              disabled={busy === "clockout-early"}
              onClick={() => void clockOutEarly()}
            >
              {busy === "clockout-early" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              Clock out (finish form later)
            </EButton>
          </ECardBody>
        </ECard>
      ) : null}

      {/* Checklist — jobTasks (admin / carry-forward), per-item complete + note + photo */}
      {jobTasks.length > 0 ? (
        <ECard>
          <ECardBody className="space-y-4 pt-6">
            <p className="e-eyebrow flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" /> Checklist ({jobTasks.length})
            </p>
            {jobTasks.map((t) => {
              const d = taskDrafts[t.id] ?? { decision: "OPEN", note: "", proof: [] };
              return (
                <div key={t.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[0.875rem] font-[550]">{t.title}</p>
                      {t.description ? (
                        <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{t.description}</p>
                      ) : null}
                      <p className="mt-1 text-[0.625rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                        {titleCase(t.source)}
                        {t.requiresPhoto ? " · photo required" : ""}
                        {t.requiresNote ? " · note required" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <TaskChip active={d.decision === "COMPLETED"} disabled={locked} onClick={() => setTask(t.id, { decision: "COMPLETED" })}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Done
                    </TaskChip>
                    <TaskChip active={d.decision === "NOT_COMPLETED"} disabled={locked} tone="warning" onClick={() => setTask(t.id, { decision: "NOT_COMPLETED" })}>
                      Not done
                    </TaskChip>
                  </div>
                  {d.decision !== "OPEN" ? (
                    <div className="mt-3 space-y-2">
                      <ETextarea
                        placeholder={
                          d.decision === "NOT_COMPLETED"
                            ? "Reason it wasn't done (required)"
                            : t.requiresNote
                              ? "Add a note (required)"
                              : "Add a note (optional)"
                        }
                        value={d.note}
                        disabled={locked}
                        onChange={(e) => setTask(t.id, { note: e.target.value })}
                      />
                      {(t.requiresPhoto || d.decision === "COMPLETED") ? (
                        <div>
                          <p className="mb-1 flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            <Camera className="h-3.5 w-3.5" /> Proof photo{t.requiresPhoto ? " (required)" : ""}
                          </p>
                          <MediaCapture
                            value={d.proof}
                            onChange={(m) => setTask(t.id, { proof: m })}
                            mode="photo"
                            folder="evidence"
                            disabled={locked}
                            stamp={{
                              address: addressLine || undefined,
                              reference: (property.name as string) || undefined,
                              contextLabel: t.title || undefined,
                              tag: "after",
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </ECardBody>
        </ECard>
      ) : null}

      {/* The assigned form template rendered natively */}
      {schema ? (
        <div className="space-y-3">
          <p className="e-eyebrow flex items-center gap-1.5">
            <ClipboardCheck className="h-3.5 w-3.5" /> {template?.name || "Job form"}
          </p>
          <FormRenderer
            schema={schema}
            answers={answers}
            uploads={uploads}
            property={property}
            onAnswer={(id, v) => setAnswers((prev) => ({ ...prev, [id]: v }))}
            onUpload={(id, m) => setUploads((prev) => ({ ...prev, [id]: m }))}
            disabled={locked}
          />
        </div>
      ) : (
        <EAlert tone="warning" title="No form template">
          No active form template is configured for this job type — you can still clock in/out and complete the checklist.
        </EAlert>
      )}

      {/* Per-job requests & reports — parity with the v1 cleaner job actions.
          Hidden while the job is still OFFERED (accept first) or fully locked. */}
      {!needsAcceptance && !locked ? (
        <JobActions
          jobId={job.id}
          requiresSafetyCheckin={Boolean(job.requiresSafetyCheckin)}
          safetyCheckinAt={job.safetyCheckinAt ?? null}
          hasStarted={Boolean(hasCheckin || timeState.isRunning || (timeState.completedSeconds ?? 0) > 0)}
          onChanged={() => void load()}
        />
      ) : null}

      {/* Laundry on submit — laundry-enabled jobs record the linen pickup as part
          of completion. The standalone early-update card (in JobActions) still
          works; this is the outcome saved when the job is submitted. */}
      {laundryEnabled && !needsAcceptance && !locked ? (
        <ECard>
          <ECardBody className="space-y-3 pt-6">
            <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
              <WashingMachine className="h-4 w-4" /> Laundry
            </p>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Record the linen status for this clean — saved when you submit and sent to the laundry team.
            </p>
            <EField label="Outcome (required)">
              <ESelect
                value={laundryOutcome}
                disabled={locked}
                onChange={(e) => setLaundryOutcome(e.target.value as LaundryOutcome | "")}
              >
                <option value="">Select an outcome…</option>
                <option value="READY_FOR_PICKUP">Ready for pickup</option>
                <option value="NOT_READY">Not ready</option>
                <option value="NO_PICKUP_REQUIRED">No pickup required</option>
              </ESelect>
            </EField>
            {laundryOutcome === "READY_FOR_PICKUP" ? (
              <>
                <EField label="Bag location (required)">
                  <EInput
                    placeholder="e.g. Laundry room shelf, labeled bags"
                    value={laundryBagLocation}
                    disabled={locked}
                    onChange={(e) => setLaundryBagLocation(e.target.value)}
                  />
                </EField>
                <EField label="Laundry photo (required)">
                  <MediaCapture
                    value={laundryPhoto}
                    onChange={setLaundryPhoto}
                    mode="photo"
                    folder="laundry"
                    disabled={locked}
                    stamp={{
                      address: addressLine || undefined,
                      reference: (property.name as string) || undefined,
                      tag: "laundry",
                      contextLabel: "Laundry bags ready for pickup",
                    }}
                  />
                </EField>
              </>
            ) : laundryOutcome ? (
              <>
                <EField label="Reason (required)">
                  <ESelect
                    value={laundrySkipCode}
                    disabled={locked}
                    onChange={(e) => setLaundrySkipCode(e.target.value)}
                  >
                    {LAUNDRY_SKIP_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </ESelect>
                </EField>
                <EField label="Note (optional)">
                  <ETextarea
                    value={laundrySkipNote}
                    disabled={locked}
                    onChange={(e) => setLaundrySkipNote(e.target.value)}
                  />
                </EField>
              </>
            ) : null}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Pass to next clean — flags that carry forward as tasks on the next visit. */}
      {!needsAcceptance && !locked ? (
        <ECard>
          <ECardBody className="space-y-3 pt-6">
            <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
              <Forward className="h-4 w-4" /> Pass to next clean
            </p>
            <label className="flex items-start gap-2 text-[0.875rem]">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[hsl(var(--e-gold))]"
                checked={carryHasNew}
                disabled={locked}
                onChange={(e) => setCarryHasNew(e.target.checked)}
              />
              <span>Anything to flag for the next visit?</span>
            </label>
            {carryHasNew ? (
              <div className="space-y-3">
                {carryNotes.map((note, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <ETextarea
                      placeholder="e.g. Oven needs a deeper clean next time — ran out of time today"
                      value={note}
                      disabled={locked}
                      onChange={(e) =>
                        setCarryNotes((prev) => prev.map((n, idx) => (idx === i ? e.target.value : n)))
                      }
                    />
                    {carryNotes.length > 1 ? (
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => setCarryNotes((prev) => prev.filter((_, idx) => idx !== i))}
                        className="mt-2 shrink-0 text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-danger))] disabled:opacity-50"
                        aria-label="Remove note"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setCarryNotes((prev) => [...prev, ""])}
                  className="inline-flex items-center gap-1.5 text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))] underline-offset-2 hover:underline disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Add another flag
                </button>
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    <Camera className="h-3.5 w-3.5" /> Photo (optional)
                  </p>
                  <MediaCapture
                    value={carryPhotos}
                    onChange={setCarryPhotos}
                    mode="photo"
                    folder="evidence"
                    multiple
                    disabled={locked}
                    stamp={{
                      address: addressLine || undefined,
                      reference: (property.name as string) || undefined,
                      contextLabel: "Flag for next clean",
                    }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                Tick the box to leave notes or a photo for whoever cleans here next.
              </p>
            )}
          </ECardBody>
        </ECard>
      ) : null}

      {/* Submit */}
      {!locked ? (
        <ECard variant="ceremony">
          <ECardBody className="space-y-3 pt-6">
            {jobTasks.length > 0 && !allTasksDecided ? (
              <p className="flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-warning))]">
                <AlertTriangle className="h-4 w-4" /> Mark every checklist item done or not done before submitting.
              </p>
            ) : null}
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Submitting sends the form + checklist for QA and records your clock-out.
            </p>
            <EButton
              variant="gold"
              className="w-full"
              disabled={busy === "submit" || (jobTasks.length > 0 && !allTasksDecided)}
              onClick={() => void submit()}
            >
              {busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Submit & clock out
            </EButton>
          </ECardBody>
        </ECard>
      ) : (
        <EAlert tone="success" title="Submitted">
          This job has been submitted{status === "COMPLETED" ? " and completed" : ""}. No further action needed.
        </EAlert>
      )}
    </div>
  );
}

function ClockCard({
  status,
  locked,
  hasCheckin,
  isRunning,
  completedSeconds,
  activeStartedAt,
  maxAllowedTotalSeconds,
  busy,
  onClockIn,
  onPause,
}: {
  status: string;
  locked: boolean;
  hasCheckin: boolean;
  isRunning: boolean;
  completedSeconds: number;
  activeStartedAt: string | null;
  maxAllowedTotalSeconds: number | null;
  busy: string | null;
  onClockIn: () => void;
  onPause: () => void;
}) {
  // Re-render every second while the clock runs so the live elapsed keeps
  // advancing. `tick` isn't read directly — it exists purely to schedule the
  // render; the displayed time is derived fresh from `activeStartedAt` + now on
  // each render (never an accumulating counter), so a background-tab throttle or
  // reload can't drift it.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  // Total seconds on site: banked (stopped logs) + the live active leg. Never
  // clamped — the timer KEEPS TICKING past the job's planned end/due time; the
  // server-side auto-clock-out safety net (due-time + grace / midnight / max
  // length) is what actually stops the log, not this display.
  const totalSeconds = isRunning
    ? elapsedSecondsSince(activeStartedAt, completedSeconds)
    : completedSeconds;
  // "Over planned time" is a subtle informational badge — it does NOT stop the
  // clock. maxAllowedTotalSeconds is the server's allowed total until the cutoff
  // (respects stopAtEstimatedDuration, default false).
  const overrunSeconds =
    isRunning && maxAllowedTotalSeconds != null && totalSeconds > maxAllowedTotalSeconds
      ? totalSeconds - maxAllowedTotalSeconds
      : 0;
  const overPlanned = overrunSeconds > 0;

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <div className="flex items-center justify-between">
          <p className="e-eyebrow flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Time on site
          </p>
          <span className="inline-flex items-center gap-2 text-[0.875rem] font-[550] tabular-nums">
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 text-[hsl(var(--e-success))]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--e-success))]" />
                {formatDuration(totalSeconds)}
              </span>
            ) : (
              <span className="text-[hsl(var(--e-muted-foreground))]">
                {formatDuration(totalSeconds)} logged
              </span>
            )}
            {overPlanned ? (
              <EBadge tone="warning" soft>
                +{formatDuration(overrunSeconds)} over planned
              </EBadge>
            ) : null}
          </span>
        </div>

        {/* Unambiguous clock state + a subtle "GPS captured" indicator so it's
            clear whether the clock is running and that location was recorded. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isRunning ? "bg-[hsl(var(--e-success))]" : "bg-[hsl(var(--e-text-faint))]"
              )}
            />
            {isRunning ? "Clock running" : hasCheckin ? "Clock stopped" : "Not clocked in"}
          </span>
          {hasCheckin ? (
            <span className="inline-flex items-center gap-1 text-[hsl(var(--e-text-faint))]">
              <MapPin className="h-3.5 w-3.5" /> GPS captured at check-in
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {!isRunning && !locked ? (
            <EButton variant="primary" disabled={busy === "clockin"} onClick={onClockIn}>
              {busy === "clockin" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {hasCheckin ? "Resume · clock in" : "Clock in (GPS)"}
            </EButton>
          ) : null}
          {isRunning && !locked ? (
            <EButton variant="outline" disabled={busy === "pause"} onClick={onPause}>
              {busy === "pause" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
              Pause clock
            </EButton>
          ) : null}
        </div>
        {!hasCheckin && !locked ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Clocking in captures your GPS location at the property.
          </p>
        ) : (hasCheckin || isRunning) && !locked ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            To finish, use <strong>Submit &amp; clock out</strong> below. Need to leave before finishing the form?
            Use <strong>Clock out (finish form later)</strong>.
          </p>
        ) : null}
      </ECardBody>
    </ECard>
  );
}

function TaskChip({
  active,
  disabled,
  tone = "primary",
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  tone?: "primary" | "warning";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeCls =
    tone === "warning"
      ? "border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] text-[hsl(var(--e-foreground))]"
      : "border-[hsl(var(--e-success))] bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-foreground))]";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors disabled:opacity-50",
        active
          ? activeCls
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
      )}
    >
      {children}
    </button>
  );
}

/**
 * Pre-start job briefing — parity with the v1 briefing step. Renders the prior
 * QA warning at this property, confirmed QA rework notes, the previous linen
 * drop (photo + where the bags were left), recent property photos, the access
 * vault (codes / key location / notes) and previous QA flags — all from
 * GET /api/cleaner/jobs/[id]/briefing.
 */
function BriefingCard({ briefing }: { briefing: any }) {
  if (!briefing) return null;
  const hasVault =
    briefing.accessCode || briefing.alarmCode || briefing.keyLocation || briefing.accessNotes;
  const reworkNotes: any[] = Array.isArray(briefing.qaReworkNotes) ? briefing.qaReworkNotes : [];
  const flags: string[] = Array.isArray(briefing.previousFlags) ? briefing.previousFlags : [];
  const lastPhotos: any[] = Array.isArray(briefing.lastPhotos) ? briefing.lastPhotos : [];
  const drop = briefing.previousLaundryDrop;
  const hasContent =
    briefing.priorQaWarning || reworkNotes.length > 0 || drop || lastPhotos.length > 0 || hasVault || flags.length > 0 || briefing.laundryInstructions;
  if (!hasContent) return null;

  return (
    <ECard>
      <ECardBody className="space-y-4 pt-6">
        <p className="e-eyebrow flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5" /> Job briefing
        </p>

        {briefing.priorQaWarning ? (
          <div
            className={cn(
              "rounded-[var(--e-radius)] border-l-[3px] p-3",
              briefing.priorQaWarning.band === "FAIL"
                ? "border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))]"
                : "border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))]"
            )}
          >
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Previous QA at this property: {briefing.priorQaWarning.percent}% ({briefing.priorQaWarning.band})
            </p>
            <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              {briefing.priorQaWarning.cleanerFeedback ||
                briefing.priorQaWarning.inspectorNotes ||
                "Take extra care today — review the checklist carefully."}
            </p>
          </div>
        ) : null}

        {reworkNotes.length > 0 ? (
          <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
              <AlertTriangle className="h-4 w-4 shrink-0" /> QA had to redo work on this job
            </p>
            <div className="mt-2 space-y-2">
              {reworkNotes.map((note: any) => (
                <div key={note.id}>
                  <p className="text-[0.75rem] font-[550]">
                    {String(note.severity ?? "").charAt(0) + String(note.severity ?? "").slice(1).toLowerCase()}
                    {note.qaUser?.name ? ` · ${note.qaUser.name}` : " · QA inspector"}
                    {note.minutesFromCleaner > 0 ? ` · ${note.minutesFromCleaner} min` : ""}
                  </p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{note.reason}</p>
                  {Array.isArray(note.areas) && note.areas.length > 0 ? (
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      Areas: {note.areas.join(", ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {drop ? (
          <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-info))] bg-[hsl(var(--e-info-soft))] p-3">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
              <Package className="h-4 w-4 shrink-0" /> Linen drop — where to find it
            </p>
            <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              Fresh linen from the last drop-off
              {drop.droppedAt
                ? ` on ${new Date(drop.droppedAt).toLocaleString("en-AU", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}`
                : ""}
              . Use this to locate the bags before you start.
            </p>
            {drop.notes ? (
              <p className="mt-2 whitespace-pre-wrap rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface))] px-2 py-1.5 text-[0.75rem]">
                {drop.notes}
              </p>
            ) : null}
            {drop.photo?.url ? (
              <div className="mt-2 max-w-[10rem]">
                <MediaGallery
                  items={[{ id: drop.photo.url, url: drop.photo.url, label: drop.photo.label || "Linen drop-off", mediaType: (drop.photo as any).mediaType }]}
                  title={drop.photo.label || "Linen drop-off"}
                  className="grid grid-cols-1"
                />
              </div>
            ) : (
              <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                No drop-off photo was captured — check the usual linen storage spot.
              </p>
            )}
          </div>
        ) : null}

        {lastPhotos.length > 0 ? (
          <div>
            <p className="text-[0.8125rem] font-[550]">Recent property photos</p>
            <MediaGallery
              items={lastPhotos.slice(0, 6).map((photo: any) => ({
                id: photo.id ?? photo.url,
                url: photo.url,
                label: photo.label || undefined,
                mediaType: photo.mediaType,
              }))}
              title="Recent property photos"
              className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6"
            />
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
              <KeyRound className="h-3.5 w-3.5" /> Access details
            </p>
            {briefing.accessCode ? (
              <div>
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Access code</p>
                <p className="text-[0.875rem] font-[550]">{briefing.accessCode}</p>
              </div>
            ) : null}
            {briefing.alarmCode ? (
              <div>
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Alarm code</p>
                <p className="text-[0.875rem] font-[550]">{briefing.alarmCode}</p>
              </div>
            ) : null}
            {briefing.keyLocation ? (
              <div>
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Key location</p>
                <p className="text-[0.875rem]">{briefing.keyLocation}</p>
              </div>
            ) : null}
            {briefing.accessNotes ? (
              <div>
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Access notes</p>
                <p className="whitespace-pre-wrap text-[0.8125rem]">{briefing.accessNotes}</p>
              </div>
            ) : null}
            {!hasVault ? (
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                No extra access vault details saved for this property.
              </p>
            ) : null}
          </div>

          <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
            <p className="text-[0.8125rem] font-[550]">Operational notes</p>
            {briefing.jobNotes ? (
              <div>
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Job notes</p>
                <p className="whitespace-pre-wrap text-[0.8125rem]">{briefing.jobNotes}</p>
              </div>
            ) : null}
            {flags.length > 0 ? (
              <div>
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Previous QA flags</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {flags.map((flag) => (
                    <EBadge key={flag} tone="warning" soft>
                      {flag}
                    </EBadge>
                  ))}
                </div>
              </div>
            ) : null}
            {briefing.laundryInstructions ? (
              <div>
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Laundry</p>
                <p className="text-[0.8125rem]">
                  {String(briefing.laundryInstructions.status ?? "").replace(/_/g, " ")}
                </p>
              </div>
            ) : null}
            {!briefing.jobNotes && flags.length === 0 && !briefing.laundryInstructions ? (
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Nothing flagged for this visit.</p>
            ) : null}
          </div>
        </div>
      </ECardBody>
    </ECard>
  );
}

function BackLink() {
  return (
    <Link
      href="/v2/cleaner/jobs"
      className="inline-flex items-center gap-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> All jobs
    </Link>
  );
}
