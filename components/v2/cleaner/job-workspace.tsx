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
import { useSearchParams } from "next/navigation";
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
import { isLaundryUpdateEligible } from "@/lib/laundry/eligibility";
import { LAUNDRY_SKIP_REASONS } from "@/lib/laundry/constants";
import { FinalCheckupDialog } from "@/components/v2/cleaner/final-checkup-dialog";
import { StartBriefingDialog } from "@/components/v2/cleaner/start-briefing-dialog";
import type {
  ResolvedStartBriefingItem,
  StartBriefingAckEntry,
} from "@/lib/forms/start-briefing";
import type {
  FinalCheckupAckEntry,
  ResolvedFinalCheckupItem,
} from "@/lib/forms/final-checkup";
import { TimingRuleBanners, type JobTimingRulesPayload } from "@/components/v2/cleaner/job-stages/timing-banner";
import { cn } from "@/lib/utils";
import { formatDuration, elapsedSecondsSince } from "@/lib/time/format-duration";
import { deriveJobStage, type JobStage } from "@/lib/cleaner/job-stage";
import { googleMapsDirectionsUrl } from "@/lib/maps/google-maps-url";
import { buildReadFirstItems, type ReadFirstItem } from "@/components/v2/cleaner/read-first-block";
import { ContactSheet, type JobContact } from "@/components/v2/cleaner/contact-sheet";
import { PropertyInfoDrawer } from "@/components/v2/cleaner/property-info-drawer";
import { JobHeader } from "@/components/v2/cleaner/job-stages/job-header";
import { StageNav } from "@/components/v2/cleaner/job-stages/stage-nav";
import { StageAccept } from "@/components/v2/cleaner/job-stages/stage-accept";
import { StageTravel } from "@/components/v2/cleaner/job-stages/stage-travel";
import { StageSetup } from "@/components/v2/cleaner/job-stages/stage-setup";
import { StageClean } from "@/components/v2/cleaner/job-stages/stage-clean";
import { StageWrapup } from "@/components/v2/cleaner/job-stages/stage-wrapup";
import { StageFooterNav } from "@/components/v2/cleaner/job-stages/stage-footer";
import {
  isTeamStarted,
  isOwnStarted,
  isStartedForVisibility,
  requiresStartConfirmations,
} from "@/lib/cleaner/team-state";
import { mergeDraftStates } from "@/lib/cleaner/draft-merge";
import { getAccuratePosition } from "@/lib/geo/get-position";

/** Local mirror of the shared draft (v1 parity) — survives an instant reload. */
const LOCAL_DRAFT_KEY = (jobId: string) => `cleaner-job-draft-v2:${jobId}`;
import { ActionFab } from "@/components/v2/cleaner/job-stages/action-fab";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

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
  // Bulk photo pool — uploaded in one batch, not yet filed into an upload field.
  // Lives in the draft envelope so leaving the page mid-categorise never loses
  // shots that are already on S3.
  const [bulkPool, setBulkPool] = React.useState<CapturedMedia[]>([]);
  const [bulkAssignOpen, setBulkAssignOpen] = React.useState(false);

  // Laundry captured on final submit (laundry-enabled jobs only). Sent alongside
  // the form so the linen pickup is recorded at completion — same fields the
  // standalone early-update card in JobActions sends.
  const [laundryOutcome, setLaundryOutcome] = React.useState<LaundryOutcome | "">("");
  const [laundryBagLocation, setLaundryBagLocation] = React.useState("");
  const [laundryPhoto, setLaundryPhoto] = React.useState<CapturedMedia[]>([]);
  const [laundrySkipCode, setLaundrySkipCode] = React.useState("LINEN_STILL_WASHING");
  const [laundrySkipNote, setLaundrySkipNote] = React.useState("");
  // Early "send to laundry team now" action on the same card (the old separate
  // Laundry-update card in Requests & reports duplicated these fields).
  const [laundryEarlySending, setLaundryEarlySending] = React.useState(false);
  const [laundryEarlySentAt, setLaundryEarlySentAt] = React.useState<string | null>(null);
  const [laundryEarlyNotice, setLaundryEarlyNotice] = React.useState<
    { tone: "success" | "danger"; text: string } | null
  >(null);
  /**
   * Laundry card state machine: EDITING → SENDING → SENT (locked summary) →
   * EDITING (explicit "Edit update"). `laundrySentSnapshot` is a serialized copy
   * of what was actually transmitted, so we can tell "sent and untouched" from
   * "sent then amended" without trusting UI flags.
   */
  const [laundrySentSnapshot, setLaundrySentSnapshot] = React.useState<string | null>(null);
  const [laundryEditingAfterSend, setLaundryEditingAfterSend] = React.useState(false);

  async function sendLaundryEarlyUpdate() {
    if (!laundryOutcome) return;
    setLaundryEarlyNotice(null);
    setLaundryEarlySending(true);
    try {
      const res = await fetch(`/api/cleaner/jobs/${jobId}/laundry-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          laundryOutcome,
          bagLocation: laundryBagLocation.trim() || undefined,
          laundryPhotoKey: laundryPhoto[0]?.key,
          laundrySkipReasonCode: laundryOutcome === "READY_FOR_PICKUP" ? undefined : laundrySkipCode,
          laundrySkipReasonNote: laundrySkipNote.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Could not send the laundry update.");
      }
      setLaundryEarlySentAt(
        new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })
      );
      // Snapshot exactly what was sent. Submit compares against this so an
      // unchanged early-sent update is NOT transmitted a second time (v1 locks
      // the card after sending; v2 previously re-sent the whole block on submit).
      setLaundrySentSnapshot(
        JSON.stringify({
          laundryOutcome,
          bagLocation: laundryBagLocation.trim(),
          photoKey: laundryPhoto[0]?.key ?? null,
          skipCode: laundryOutcome === "READY_FOR_PICKUP" ? null : laundrySkipCode,
          skipNote: laundrySkipNote.trim(),
        }),
      );
      setLaundryEditingAfterSend(false);
      setLaundryEarlyNotice({ tone: "success", text: "Sent to the laundry team and admin." });
    } catch (e: any) {
      setLaundryEarlyNotice({ tone: "danger", text: e?.message ?? "Could not send the update." });
    } finally {
      setLaundryEarlySending(false);
    }
  }

  // Pass-to-next-cleaner: free-text flags (+ optional photo) that become
  // CARRY_FORWARD tasks on the next clean at this property.
  const [carryHasNew, setCarryHasNew] = React.useState(false);
  const [carryNotes, setCarryNotes] = React.useState<string[]>([""]);
  const [carryPhotos, setCarryPhotos] = React.useState<CapturedMedia[]>([]);

  const [busy, setBusy] = React.useState<string | null>(null);
  /** Set when the browser refuses a location fix — clock-in is blocked until fixed. */
  const [gpsBlocked, setGpsBlocked] = React.useState<string | null>(null);
  /** Server asked why the cleaner is starting away from the property. */
  const [offSitePrompt, setOffSitePrompt] = React.useState<{
    message?: string;
    distanceMeters: number | null;
    reasons: { code: string; label: string }[];
  } | null>(null);
  /** Draft of the cleaner's answer to the off-site prompt. */
  const [offSiteDraft, setOffSiteDraft] = React.useState<{ code: string; note: string }>({
    code: "",
    note: "",
  });
  /** Server says there are things to read before the clock can start. */
  const [briefingPrompt, setBriefingPrompt] = React.useState<{
    items: ResolvedStartBriefingItem[];
    stale: boolean;
  } | null>(null);
  const [notice, setNotice] = React.useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);

  // Job-start accountability gate (Phase 2b): the cleaner confirms the property
  // code and the correct laundry bag before clocking in.
  const [propertyCodeConfirmed, setPropertyCodeConfirmed] = React.useState(false);
  const [laundryBagConfirmed, setLaundryBagConfirmed] = React.useState(false);

  // Final check-up dialog (R7): shown before submit when the payload resolves
  // acknowledgement items. `finalCheckupServerItems` holds the list a 422
  // FINAL_CHECKUP_REQUIRED response returned (server-authoritative retry).
  const [finalCheckupOpen, setFinalCheckupOpen] = React.useState(false);
  const [finalCheckupServerItems, setFinalCheckupServerItems] = React.useState<
    ResolvedFinalCheckupItem[] | null
  >(null);
  // Acks already transmitted this session — merged into a retry so a 422 that
  // only lists the MISSING items still resubmits a complete acknowledgement set.
  const finalCheckupAckRef = React.useRef<FinalCheckupAckEntry[]>([]);

  // Journey-stage UI state (presentation only — the gates/handlers below are
  // unchanged; the stage just decides which slice is on screen).
  const [activeStage, setActiveStage] = React.useState<JobStage>(1);
  const [infoDrawerOpen, setInfoDrawerOpen] = React.useState(false);
  const [contactSheetOpen, setContactSheetOpen] = React.useState(false);
  const stageInitRef = React.useRef(false);
  const prevStartedRef = React.useRef(false);
  const prevLockedRef = React.useRef(false);
  const prevNeedsAcceptRef = React.useRef(true);

  // Shared cross-device draft (same /draft endpoint + envelope as v1).
  const editorSessionIdRef = React.useRef<string>(
    `v2-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
  );
  const draftHydratedRef = React.useRef(false);
  /** True after the first successful load — later refreshes must not blank the UI. */
  const hasLoadedOnceRef = React.useRef(false);
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
    if (Array.isArray(state.bulkPool)) {
      setBulkPool(
        state.bulkPool.filter((m: any) => m && typeof m === "object" && typeof m.key === "string") as CapturedMedia[]
      );
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
    // Only the FIRST load may blank the screen. This function is also the
    // visibility/focus/interval refresher below, and on a phone the file
    // picker always hides the tab — so returning with a photo used to flip
    // the workspace to the loading skeleton, which unmounted the file input
    // BEFORE the browser delivered the change event to it. The cleaner saw a
    // quick flash and their photo silently never uploaded. Refreshes now
    // update in place; the form stays mounted and the pick lands.
    if (!hasLoadedOnceRef.current) setLoading(true);
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
          // Local mirror may hold work the server never received (backgrounded
          // before the flush landed). Merge both — uploads are unioned so a
          // photo recorded in either place can never be dropped.
          let localState: Record<string, any> | null = null;
          try {
            const raw = window.localStorage.getItem(LOCAL_DRAFT_KEY(jobId));
            if (raw) localState = JSON.parse(raw);
          } catch {
            /* ignore malformed mirror */
          }

          const dRes = await fetch(`/api/cleaner/jobs/${jobId}/draft`, { cache: "no-store" });
          let envelope: any = null;
          if (dRes.ok) {
            const dBody = await dRes.json().catch(() => ({}));
            envelope = dBody?.draft ?? null;
          }
          const serverState =
            envelope?.state && typeof envelope.state === "object" ? (envelope.state as Record<string, any>) : null;

          const merged = serverState && localState ? mergeDraftStates(serverState, localState) : serverState ?? localState;
          if (merged) {
            restoreDraftState(merged);
            setDraftInfo({
              updatedAt: typeof envelope?.updatedAt === "string" ? envelope.updatedAt : null,
              updatedByName: typeof envelope?.updatedByName === "string" ? envelope.updatedByName : null,
            });
          }
        } catch {
          /* draft restore is best-effort */
        }
      }
    } catch (e: any) {
      setError(e?.message || "Could not load job");
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, [jobId, restoreDraftState]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // The server can stop the clock without the cleaner touching anything: the
  // geofence sweep closes the open TimeLog and sets PAUSED when they leave the
  // site (lib/gps/departure-clockout.ts). The workspace only loaded once on
  // mount, so it kept rendering a running, ticking timer against a log that was
  // already closed — the cleaner watched time accrue that was not being
  // recorded. Re-read on focus, and periodically as a backstop.
  React.useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 90_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
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
  const hasCheckin = Boolean(job?.gpsCheckInAt);
  // A tap on the property's own NFC tag, by THIS cleaner, on THIS job. It is
  // stronger arrival evidence than a GPS fix — the phone was held against a
  // tag fixed to the building — and it is what lets the clock-in stop
  // demanding a location the cleaner may be standing somewhere they cannot get.
  const nfcArrival = Boolean(payload?.nfcArrival);

  // ARRIVED BY TAG. The landing page sets this after an accepted scan.
  //
  // Tapping a tag screwed to the door IS the deliberate act of starting work,
  // so the clock starts by itself rather than asking the cleaner to confirm on
  // screen what they just confirmed with their hands. Any gate that is about
  // the WORK still fires — clockIn opens the read-first dialog exactly as it
  // does for a button press.
  const searchParams = useSearchParams();
  const arrivedByTag = searchParams?.get("via") === "nfc";
  const autoStartedRef = React.useRef(false);
  const propertyId: string | null = job?.propertyId ?? (property as any)?.id ?? null;

  // Accept gate: gate on THIS cleaner's own assignment response, not the job's
  // global status (a job can be ASSIGNED overall while still PENDING for me).
  const responseStatus: string | null = payload?.assignmentState?.responseStatus ?? null;
  const needsAcceptance = responseStatus === "PENDING";

  // Laundry is captured on submit only for AIRBNB_TURNOVER jobs on
  // laundry-enabled properties, and never on reworks (reworks reuse the
  // original clean's linen) — the SAME shared predicate the submit route
  // enforces (lib/laundry/eligibility.ts), so the UI matches what's persisted.
  // Non-turnover jobs show NO laundry fields at all (no bag row, no start
  // confirm, no outcome section).
  const laundryEnabled = isLaundryUpdateEligible(job, property as any);

  // Final check-up items resolved server-side in the form payload (R7). A 422
  // FINAL_CHECKUP_REQUIRED response overrides this with the server's missing
  // list until the next successful submit attempt.
  const finalCheckupPayloadItems: ResolvedFinalCheckupItem[] = React.useMemo(
    () =>
      Array.isArray(payload?.finalCheckup?.items)
        ? (payload.finalCheckup.items as ResolvedFinalCheckupItem[]).filter(
            (item) => item && typeof item.id === "string" && typeof item.title === "string"
          )
        : [],
    [payload]
  );
  const finalCheckupItems = finalCheckupServerItems ?? finalCheckupPayloadItems;

  // Structured early-check-in / late-checkout rules (R6c).
  const timingRules: JobTimingRulesPayload | null =
    payload?.timingRules && typeof payload.timingRules === "object" ? payload.timingRules : null;

  // ── Job-start "Before you start" gate ──────────────────────────────────────
  // Two different questions (see lib/cleaner/team-state.ts): "is the clean
  // underway?" (team — unlocks the checklist for a co-cleaner) vs "has MY clock
  // started?" (own — drives pay/time). Conflating them pinned the second
  // cleaner on Set-up behind the start gate while the job was IN_PROGRESS.
  const teamState = {
    jobStatus: status,
    anyTeamTimeLog: payload?.teamStarted === true,
    ownRunning: Boolean(timeState.isRunning),
    ownCompletedSeconds: timeState.completedSeconds ?? 0,
  };
  const teamStarted = isTeamStarted(teamState);
  const ownStarted = isOwnStarted(teamState);

  // Laundry card state: has the cleaner changed anything since the early send?
  const laundryCurrentSignature = JSON.stringify({
    laundryOutcome,
    bagLocation: laundryBagLocation.trim(),
    photoKey: laundryPhoto[0]?.key ?? null,
    skipCode: laundryOutcome === "READY_FOR_PICKUP" ? null : laundrySkipCode,
    skipNote: laundrySkipNote.trim(),
  });
  const laundryAmendedSinceSend =
    Boolean(laundryEarlySentAt) && laundrySentSnapshot !== null && laundryCurrentSignature !== laundrySentSnapshot;
  /** SENT + untouched → the card renders a read-only summary with "Edit update". */
  const laundryLocked = Boolean(laundryEarlySentAt) && !laundryEditingAfterSend && !laundryAmendedSinceSend;
  const propertyCode: string = (property as any)?.name ?? "";
  const expectedDurationMinutes: number | null =
    (property as any)?.cleaningDurationMinutes != null
      ? Number((property as any).cleaningDurationMinutes)
      : job?.estimatedHours != null
      ? Math.round(Number(job.estimatedHours) * 60)
      : null;
  const bagLabel: string = (property as any)?.laundryBagLabel ?? "";
  const bagColor: string = (property as any)?.laundryBagColor ?? "";
  const setupGuideEntries: Array<{
    id?: string;
    kind?: string;
    label?: string;
    instructions?: string;
    images?: Array<{ url?: string; caption?: string }>;
  }> = Array.isArray((property as any)?.setupGuide) ? (property as any).setupGuide : [];
  const restockNeeds: Array<{ name: string; needed: number; unit?: string | null }> = Array.isArray(
    payload?.restockNeeds
  )
    ? payload.restockNeeds
    : [];
  // Recurring-issue watch-outs from previous cleans (Phase 7a).
  const recurringIssues: string[] = Array.isArray(payload?.recurringIssues)
    ? payload.recurringIssues.filter((r: unknown): r is string => typeof r === "string")
    : [];
  const requireStartConfirmation = payload?.requireJobStartConfirmation !== false;
  // Admin opt-in (default OFF): an unticked required checkbox blocks submit.
  // Read strictly as `=== true` so a payload from an older server (flag absent)
  // keeps the historic, non-blocking behaviour.
  const requiredChecklistTicksBlockSubmit = payload?.requiredChecklistTicksBlockSubmit === true;
  const canUseNoPhoto = payload?.canUseNoPhoto === true;
  // Laundry-bag confirmation only when there's a labelled bag on a laundry job.
  const laundryBagConfirmRequired = requireStartConfirmation && laundryEnabled && Boolean(bagLabel);
  // Only the FIRST person to start does the heavyweight confirmations. A second
  // cleaner joining an in-progress clean isn't re-asked to verify the property
  // code the first starter already confirmed.
  //
  // This used to also bail out on `hasCheckin` (the job-level, immutable
  // Job.gpsCheckInAt). That scalar belongs to whoever arrived FIRST, so after an
  // admin bounced a started job back to ASSIGNED and reassigned it, the new
  // cleaner saw no start verification at all — while the server still demanded
  // the confirmations from them (their own TimeLog is empty), rejecting every
  // clock-in with JOB_START_CONFIRMATION_REQUIRED. The predicate now keys off
  // "is the clean running right now?" instead of stale artifacts.
  const startGateBlocks = requiresStartConfirmations({
    ...teamState,
    requireStartConfirmation,
    locked,
    needsAcceptance,
    hasJobCheckIn: hasCheckin,
  });
  // Visibility: own start OR team start (or a recorded GPS check-in) — but never
  // while this cleaner still owes their own start verification, or the workspace
  // would skip Set-up and hide the very tick they need.
  const hasStarted = !startGateBlocks && (hasCheckin || isStartedForVisibility(teamState));
  const startGateSatisfied =
    !startGateBlocks ||
    (propertyCodeConfirmed && (!laundryBagConfirmRequired || laundryBagConfirmed));
  // Show the info/gate card before AND during the clean (so setup references,
  // bag and code stay available mid-clean) — collapsed by default once started.
  const showStartGateCard = !locked && !needsAcceptance;
  const [setupCardOpen, setSetupCardOpen] = React.useState(false);
  const setupCardExpanded = !hasStarted || setupCardOpen;

  function formatDurationMinutes(mins: number): string {
    if (mins <= 0) return "—";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
  }

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

  // Build the current draft state. Kept in a ref so the unload flush can read
  // the latest values without re-registering listeners on every keystroke.
  const buildDraftState = React.useCallback(
    () => ({
      v2: true,
      updatedAt: new Date().toISOString(),
      answers,
      uploads,
      taskDrafts,
      bulkPool,
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
    }),
    [
      answers,
      uploads,
      taskDrafts,
      bulkPool,
      laundryOutcome,
      laundryBagLocation,
      laundrySkipCode,
      laundrySkipNote,
      laundryPhoto,
      carryHasNew,
      carryNotes,
      carryPhotos,
    ],
  );
  const draftStateRef = React.useRef(buildDraftState);
  draftStateRef.current = buildDraftState;

  /**
   * Persist the draft NOW. `keepalive` lets the request survive the page being
   * backgrounded/closed — the old debounce-only autosave cancelled its pending
   * timer on unmount, so photos taken in the last 1.5s were silently lost.
   * Also mirrors to localStorage synchronously (v1 parity) as a second net.
   */
  const flushDraft = React.useCallback(
    (opts?: { keepalive?: boolean }) => {
      if (!draftHydratedRef.current || locked) return;
      const state = draftStateRef.current();
      try {
        window.localStorage.setItem(LOCAL_DRAFT_KEY(jobId), JSON.stringify(state));
      } catch {
        /* quota/private mode — server draft is the primary */
      }
      void fetch(`/api/cleaner/jobs/${jobId}/draft`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editorSessionId: editorSessionIdRef.current, state }),
        keepalive: opts?.keepalive === true,
      }).catch(() => {});
    },
    [jobId, locked],
  );

  // Flush immediately when the tab is hidden or the PWA is closed/evicted.
  React.useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushDraft({ keepalive: true });
    };
    const onPageHide = () => flushDraft({ keepalive: true });
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flushDraft]);

  // Debounced shared-draft autosave — mirrors v1's PATCH /draft envelope
  // ({ editorSessionId, state }) so a co-cleaner or another device can resume.
  // On unmount we FLUSH (not cancel) any pending write.
  React.useEffect(() => {
    if (!draftHydratedRef.current || loading || !job || locked) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      flushDraft();
    }, 1500);
    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
        flushDraft({ keepalive: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    answers,
    uploads,
    taskDrafts,
    bulkPool,
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
    if (!res.ok) {
      // Carry the server's machine-readable rejection through so callers can
      // branch (e.g. FINAL_CHECKUP_REQUIRED reopens the acknowledgement dialog).
      const err = new Error(data.error || "Request failed") as Error & {
        code?: string;
        data?: unknown;
      };
      if (typeof data.code === "string") err.code = data.code;
      err.data = data;
      throw err;
    }
    return data;
  }

  /**
   * Clock-in/out GPS. Uses the shared accurate-fix helper (one-shot then a
   * short best-fix watch window) rather than accepting the FIRST fix, which on
   * WiFi-only devices is often a 500m-5km triangulation — that was the source
   * of inaccurate clock-in/out locations while photo stamps (already using this
   * helper) were correct.
   */
  async function getGps(): Promise<{ lat: number; lng: number; accuracy: number | null }> {
    const fix = await getAccuratePosition();
    return { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy };
  }

  /**
   * Clock-in: capture GPS → gps-checkin, then start the clock.
   *
   * RESUMING is different from arriving. When this cleaner already has recorded
   * time (they clocked out and came back to finish the form), we only restart
   * the timer — no geolocation, no gps-checkin. Re-running the arrival capture
   * used to stamp the cleaner's current position (often home) over the original
   * arrival coordinates. The server also refuses to overwrite an existing
   * check-in, so this is belt-and-braces.
   */
  /**
   * @param offSiteAnswer replayed on the retry that follows the off-site prompt.
   *   Passed explicitly rather than read from state so the retry cannot race the
   *   setState that triggered it.
   */
  async function clockIn(
    offSiteArg?: { code: string; note: string },
    /** Replayed on the retry that follows the start-briefing dialog. */
    briefingAck?: StartBriefingAckEntry[]
  ) {
    // `clockIn` is also wired straight to onClick in places, which would pass a
    // MouseEvent here — accept only a real answer object.
    const offSiteAnswer =
      offSiteArg && typeof (offSiteArg as any).code === "string" ? offSiteArg : undefined;
    // "Resume" = MY clock has run before. A job-level check-in left behind by a
    // previous cleaner is not my arrival, so a fresh assignee still runs the
    // arrival capture (the server preserves the original check-in regardless).
    // `hasCheckin` is job-level and can belong to a previous assignee, which
    // is why it is qualified. An NFC arrival is not: the server recorded it
    // against this user on this job, so it stands on its own.
    const isResume = ownStarted || nfcArrival || (hasCheckin && !startGateBlocks);

    // Client-side gate: block until the pre-start confirmations are ticked. The
    // server enforces this too — this just gives a clear message before the POST.
    if (startGateBlocks && !startGateSatisfied) {
      flash(
        "danger",
        laundryBagConfirmRequired
          ? "Confirm the property code and the correct laundry bag before clocking in."
          : "Confirm the property code before clocking in."
      );
      return;
    }
    setBusy("clockin");
    try {
      if (!isResume) {
        // GPS IS REQUIRED TO START. This used to catch a permission denial into
        // a blue "info" toast and clock in regardless — so "location required"
        // was advisory, and a job could be started from anywhere with no
        // evidence at all. A denial now stops the clock-in and tells the
        // cleaner how to re-enable it.
        let gps: { lat: number; lng: number; accuracy?: number | null };
        try {
          gps = await getGps();
        } catch (geoErr: any) {
          setGpsBlocked(geoErr?.message ?? "Location is unavailable.");
          flash(
            "danger",
            "Location is required to start a job. Turn on location for this site, then try again."
          );
          return;
        }

        const checkin = await post(`/api/cleaner/jobs/${jobId}/gps-checkin`, {
          lat: gps.lat,
          lng: gps.lng,
          accuracy: gps.accuracy,
          confirmed: true,
          ...(offSiteAnswer ? { reasonCode: offSiteAnswer.code, note: offSiteAnswer.note } : {}),
        }).catch((err: any) => {
          // 409 = the server wants a reason for the distance before it records
          // anything.
          if ((err?.data as any)?.error === "OFF_SITE_REASON_REQUIRED") return err.data;
          throw err;
        });

        if (checkin?.error === "OFF_SITE_REASON_REQUIRED") {
          setOffSitePrompt({
            message: checkin.message,
            distanceMeters: checkin.distanceMeters ?? null,
            reasons: checkin.reasons ?? [],
          });
          return;
        }

        if (checkin?.lowAccuracy) {
          // The server has always returned this and the client always discarded
          // it, so a ±3 km fix was recorded as if it were evidence.
          flash("info", "Your location is only roughly accurate here — we've noted that.");
        }
      }
      const started = await post(`/api/cleaner/jobs/${jobId}/start`, {
        allowFutureStart: true,
        propertyCodeConfirmed,
        laundryBagConfirmed,
        ...(briefingAck ? { startBriefingAck: briefingAck } : {}),
      }).catch((err: any) => {
        // 409 = there are things this cleaner must READ before the clock
        // starts. The server returns the resolved list so the dialog and the
        // gate can never disagree about what has to be read.
        if ((err?.data as any)?.code === "START_BRIEFING_REQUIRED") return err.data;
        throw err;
      });

      if (started?.code === "START_BRIEFING_REQUIRED") {
        setBriefingPrompt({
          items: started.items ?? [],
          stale: started.reason === "STALE",
        });
        return;
      }

      flash("success", isResume ? "Timer resumed." : "Clocked in — job started.");
      await load();
    } catch (e: any) {
      flash("danger", e.message);
    } finally {
      setBusy(null);
    }
  }

  // Start the clock for someone who arrived by tapping the tag.
  //
  // Guarded by a ref rather than by state: clockIn can re-render this
  // component several times (busy flags, the briefing dialog opening), and a
  // state-based guard would let a second run slip through between renders —
  // which on a job already running would read as a clock-out.
  React.useEffect(() => {
    if (!arrivedByTag || autoStartedRef.current) return;
    if (busy) return;
    // Already on the clock: the tap that brought them here was a check-OUT,
    // which the scan endpoint has already performed. Nothing to start.
    if (ownStarted) return;
    autoStartedRef.current = true;
    void clockIn();
    // clockIn is stable for the life of this component and intentionally not
    // a dependency — listing it would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedByTag, busy, ownStarted]);

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

  /**
   * The submit entry point the UI calls: when final check-up items apply, open
   * the acknowledgement dialog first; the dialog's completion calls submit()
   * with the recorded acknowledgements. No items → straight to submit.
   */
  function requestSubmit() {
    if (finalCheckupItems.length > 0) {
      setFinalCheckupOpen(true);
      return;
    }
    void submit();
  }

  async function submit(opts?: { finalCheckupAck?: FinalCheckupAckEntry[] }) {
    // Client-side validation gate (mirrors the server's required-field rules):
    // reveal inline errors + scroll to the first, and block the submit so the
    // cleaner sees exactly what's missing instead of a bare server rejection.
    if (schema) {
      const uploadCounts: Record<string, number> = {};
      for (const [fid, media] of Object.entries(uploads)) uploadCounts[fid] = media.length;
      // Pass the same laundry-ready state the server uses so laundry-conditional
      // fields validate identically client- and server-side (turnover jobs only).
      const formErrors = collectFormErrors(
        schema,
        answers,
        uploadCounts,
        property ?? {},
        laundryEnabled ? laundryOutcome === "READY_FOR_PICKUP" : undefined,
        requiredChecklistTicksBlockSubmit,
        {
          canUseNoPhoto,
          reasons:
            ((answers as Record<string, unknown>).__noPhotoReasons as Record<
              string,
              { reasonCode: string }
            >) ?? {},
        }
      );
      if (formErrors.length > 0) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("sneek:validate-form"));
        // Name the actual items (with their section) instead of a bare count —
        // an unticked confirmation checkbox is invisible in a long form, so
        // "3 items incomplete" left the cleaner hunting. The tappable rows in
        // the wrap-up list still jump straight to each field.
        const named = formErrors
          .slice(0, 3)
          .map((err) =>
            err.sectionLabel && err.sectionLabel !== err.label
              ? `${err.sectionLabel}: ${err.label}`
              : err.label
          )
          .join("; ");
        const more = formErrors.length > 3 ? ` (+${formErrors.length - 3} more)` : "";
        flash(
          "danger",
          `${formErrors.length} required item${formErrors.length > 1 ? "s" : ""} incomplete — ${named}${more}. Tap an item below to jump to it.`
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
      if (opts?.finalCheckupAck && opts.finalCheckupAck.length > 0) {
        // Merge with anything acknowledged on a previous attempt (retry after a
        // 422 only re-walks the missing items). Latest ack per item wins.
        const merged = new Map<string, FinalCheckupAckEntry>();
        for (const entry of [...finalCheckupAckRef.current, ...opts.finalCheckupAck]) {
          if (entry?.itemId) merged.set(entry.itemId, entry);
        }
        const ackList = Array.from(merged.values());
        finalCheckupAckRef.current = ackList;
        body.finalCheckupAck = ackList;
      }
      // Only send the laundry block when it hasn't already been transmitted
      // unchanged. Previously submit re-sent it unconditionally, so an early
      // "send to laundry team now" produced a SECOND identical update at submit.
      if (laundryEnabled && laundryOutcome && (!laundryEarlySentAt || laundryAmendedSinceSend)) {
        body.laundryOutcome = laundryOutcome;
        body.laundryReady = laundryOutcome === "READY_FOR_PICKUP";
        // Tells the server this replaces the earlier update rather than adding one.
        if (laundryEarlySentAt) body.supersedesEarlyLaundryUpdate = true;
        if (laundryOutcome === "READY_FOR_PICKUP") {
          body.bagLocation = laundryBagLocation.trim();
        } else {
          body.laundrySkipReasonCode = laundrySkipCode;
          if (laundrySkipNote.trim()) body.laundrySkipReasonNote = laundrySkipNote.trim();
        }
      }
      const data = await post(`/api/cleaner/jobs/${jobId}/submit`, body);
      setFinalCheckupServerItems(null);
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
      // Server-side final check-up gate (R7): reopen the dialog for exactly the
      // items the server says are missing.
      if (e?.code === "FINAL_CHECKUP_REQUIRED") {
        const serverItems = Array.isArray(e?.data?.items)
          ? (e.data.items as ResolvedFinalCheckupItem[]).filter(
              (item) => item && typeof item.id === "string" && typeof item.title === "string"
            )
          : [];
        if (serverItems.length > 0) setFinalCheckupServerItems(serverItems);
        setFinalCheckupOpen(true);
        flash("info", "Please complete the final check-up to submit.");
        return;
      }
      flash("danger", e.message);
    } finally {
      setBusy(null);
    }
  }

  // ── Journey stage derivation + auto-advance ────────────────────────────────
  const enRouteActive = Boolean(job?.enRouteStartedAt) && !job?.arrivedAt;
  const arrived = Boolean(job?.arrivedAt) || hasCheckin;
  const derivedStage: JobStage = deriveJobStage({
    needsAcceptance,
    hasStarted,
    locked,
    enRouteActive,
    arrived,
    formComplete: false,
  });

  // Initialise the visible stage once the job has loaded.
  React.useEffect(() => {
    if (loading || !job || stageInitRef.current) return;
    stageInitRef.current = true;
    prevStartedRef.current = hasStarted;
    prevLockedRef.current = locked;
    prevNeedsAcceptRef.current = needsAcceptance;
    setActiveStage(derivedStage);
  }, [loading, job, derivedStage, hasStarted, locked, needsAcceptance]);

  // Auto-advance on the SAME transitions that already happen today: accept →
  // setup, clock-in success → clean, submit success → wrap up.
  React.useEffect(() => {
    if (!needsAcceptance && prevNeedsAcceptRef.current) setActiveStage(3);
    prevNeedsAcceptRef.current = needsAcceptance;
  }, [needsAcceptance]);
  React.useEffect(() => {
    if (hasStarted && !prevStartedRef.current) setActiveStage(4);
    prevStartedRef.current = hasStarted;
  }, [hasStarted]);
  React.useEffect(() => {
    if (locked && !prevLockedRef.current) setActiveStage(5);
    prevLockedRef.current = locked;
  }, [locked]);

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

  const readFirstItems: ReadFirstItem[] = buildReadFirstItems(payload);
  const contact = (payload?.contact ?? null) as JobContact | null;
  const navUrl = googleMapsDirectionsUrl({
    address: property?.address,
    suburb: property?.suburb,
    state: property?.state,
    postcode: property?.postcode,
    latitude: property?.latitude,
    longitude: property?.longitude,
    placeId: (property as any)?.placeId,
    name: property?.name,
  });

  // The single slice of workspace state each journey stage renders. All logic
  // (gates, autosave, validation, submit) still lives here — the stages are
  // presentation only.
  const api: WorkspaceApi = {
    payload,
    job,
    property,
    briefing,
    template,
    schema,
    jobId,
    status,
    locked,
    needsAcceptance,
    hasStarted,
    hasCheckin,
    propertyId,
    addressLine,
    propertyCode,
    navUrl,
    jobTypeLabel: job?.jobType ? titleCase(job.jobType) : "Job",
    expectedDurationMinutes,
    formatDurationMinutes,
    jobTasks,
    importantRequests,
    readFirstItems,
    contact,
    restockNeeds,
    recurringIssues,
    requiredChecklistTicksBlockSubmit,
    canUseNoPhoto,
    setupGuideEntries,
    teamStarted,
    ownStarted,
    laundryEnabled,
    bagLabel,
    bagColor,
    laundryBagLocationOptions: Array.isArray(payload?.laundryBagLocationOptions)
      ? (payload.laundryBagLocationOptions as string[])
      : [],
    timeState,
    busy,
    activeStage,
    setActiveStage,
    startGateBlocks,
    startGateSatisfied,
    clockInDisabled: startGateBlocks && !startGateSatisfied,
    propertyCodeConfirmed,
    setPropertyCodeConfirmed,
    laundryBagConfirmRequired,
    laundryBagConfirmed,
    setLaundryBagConfirmed,
    answers,
    uploads,
    onAnswer: (id, v) => setAnswers((prev) => ({ ...prev, [id]: v })),
    onUpload: (id, m) => setUploads((prev) => ({ ...prev, [id]: m })),
    taskDrafts,
    setTask,
    allTasksDecided,
    bulkPool,
    setBulkPool,
    setUploads,
    bulkAssignOpen,
    openBulkAssign: () => setBulkAssignOpen(true),
    closeBulkAssign: () => setBulkAssignOpen(false),
    laundryOutcome,
    setLaundryOutcome,
    laundryBagLocation,
    setLaundryBagLocation,
    laundryPhoto,
    setLaundryPhoto,
    laundrySkipCode,
    setLaundrySkipCode,
    laundrySkipNote,
    setLaundrySkipNote,
    laundryLocked,
    laundryAmendedSinceSend,
    beginLaundryEdit: () => setLaundryEditingAfterSend(true),
    laundryEarlySending,
    laundryEarlySentAt,
    laundryEarlyNotice,
    sendLaundryEarlyUpdate,
    carryHasNew,
    setCarryHasNew,
    carryNotes,
    setCarryNotes,
    carryPhotos,
    setCarryPhotos,
    finalCheckupItems,
    timingRules,
    flash,
    clockIn,
    pauseClock,
    clockOutEarly,
    submit,
    requestSubmit,
    load,
    openInfoDrawer: () => setInfoDrawerOpen(true),
    openContactSheet: () => setContactSheetOpen(true),
  };

  return (
    <div className="space-y-5">
      <BackLink />

      <JobHeader api={api} />

      {/* Early-check-in / late-checkout rules (R6c) — visible on every stage.
          Same-day check-in rides along here: v1 job details surfaced it and v2
          dropped it (CP-9), leaving the cleaner blind to the hardest deadline on
          the job. It reads straight off the job row (the form route uses a
          Prisma `include`, so every Job scalar is already on the payload). */}
      {!locked ? (
        <TimingRuleBanners
          rules={timingRules}
          sameDayCheckin={{ active: job?.sameDayCheckin === true, time: job?.sameDayCheckinTime ?? null }}
        />
      ) : null}

      {notice ? (
        <EAlert tone={notice.tone === "danger" ? "danger" : notice.tone === "success" ? "success" : "info"}>
          {notice.text}
        </EAlert>
      ) : null}

      {/* Property access guide — self-fetching; hides when the property has none. */}
      {propertyId ? <PropertyAccessGuide propertyId={propertyId} /> : null}

      {/* Saved progress restored from another device / co-cleaner */}
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

      <StageNav api={api} />

      <div>
        {activeStage === 1 ? <StageAccept api={api} /> : null}
        {activeStage === 2 ? <StageTravel api={api} /> : null}
        {activeStage === 3 ? <StageSetup api={api} /> : null}
        {activeStage === 4 ? <StageClean api={api} /> : null}
        {activeStage === 5 ? <StageWrapup api={api} /> : null}

        <StageFooterNav api={api} />
      </div>

      <ActionFab api={api} />

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

      {/* Location refused / unavailable — clock-in is blocked until it's on. */}
      <EModal
        open={Boolean(gpsBlocked)}
        onClose={() => setGpsBlocked(null)}
        eyebrow="Location required"
        title="We couldn't get your location"
      >
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            {gpsBlocked} Your arrival location is the evidence that you were at the property, so a
            job can&apos;t be started without it.
          </p>
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            <p className="font-[600] text-[hsl(var(--e-text-primary))]">To turn it back on</p>
            <p className="mt-1.5">
              <span className="font-[600]">iPhone:</span> Settings → Privacy &amp; Security →
              Location Services → Safari Websites → While Using the App. Then reload this page.
            </p>
            <p className="mt-1.5">
              <span className="font-[600]">Android:</span> tap the padlock in the address bar →
              Permissions → Location → Allow. Then reload this page.
            </p>
            <p className="mt-1.5">
              Still stuck outdoors or in a basement? Step outside for a moment, or call the office
              so they can start the job for you.
            </p>
          </div>
          <EButton
            variant="gold"
            className="w-full"
            onClick={() => {
              setGpsBlocked(null);
              void clockIn();
            }}
          >
            Try again
          </EButton>
        </div>
      </EModal>

      {/* Beyond the on-site radius — a coded reason is required before we record it. */}
      <EModal
        open={Boolean(offSitePrompt)}
        onClose={() => setOffSitePrompt(null)}
        size="wide"
        eyebrow="Check your location"
        title="Why are you starting from here?"
      >
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            {offSitePrompt?.message ??
              "You look like you're away from the property. Tell us why so we can record it properly."}
          </p>
          <div className="space-y-2">
            {(offSitePrompt?.reasons ?? []).map((reason) => (
              <label
                key={reason.code}
                className="flex cursor-pointer items-start gap-2.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.875rem]"
              >
                <input
                  type="radio"
                  name="off-site-reason"
                  className="mt-1"
                  checked={offSiteDraft.code === reason.code}
                  onChange={() => setOffSiteDraft((d) => ({ ...d, code: reason.code }))}
                />
                <span>{reason.label}</span>
              </label>
            ))}
          </div>
          <textarea
            className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-transparent p-3 text-[0.875rem]"
            rows={3}
            placeholder="Add any detail that helps (optional unless you picked 'Something else')."
            value={offSiteDraft.note}
            onChange={(e) => setOffSiteDraft((d) => ({ ...d, note: e.target.value }))}
          />
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            This is sent to the office along with your distance from the property.
          </p>
          <EButton
            variant="gold"
            className="w-full"
            disabled={
              !offSiteDraft.code ||
              (offSiteDraft.code === "OTHER" && offSiteDraft.note.trim().length < 5)
            }
            onClick={() => {
              const answer = { code: offSiteDraft.code, note: offSiteDraft.note.trim() };
              setOffSitePrompt(null);
              void clockIn(answer);
            }}
          >
            Start the job
          </EButton>
        </div>
      </EModal>

      {/* Start briefing — opens on clock-in when the job carries anything the
          cleaner must have read first (timing rules, tasks, the job note). */}
      <StartBriefingDialog
        open={Boolean(briefingPrompt)}
        items={briefingPrompt?.items ?? []}
        stale={briefingPrompt?.stale}
        onClose={() => setBriefingPrompt(null)}
        onComplete={(ack) => {
          setBriefingPrompt(null);
          void clockIn(undefined, ack);
        }}
      />

      {/* Final check-up acknowledgement — opens on submit when items apply. */}
      <FinalCheckupDialog
        open={finalCheckupOpen}
        items={finalCheckupItems}
        onClose={() => setFinalCheckupOpen(false)}
        onComplete={(ack) => {
          setFinalCheckupOpen(false);
          void submit({ finalCheckupAck: ack });
        }}
      />

      <ContactSheet
        open={contactSheetOpen}
        onClose={() => setContactSheetOpen(false)}
        contact={contact ?? ({} as JobContact)}
      />
      <PropertyInfoDrawer
        open={infoDrawerOpen}
        onClose={() => setInfoDrawerOpen(false)}
        property={property}
        propertyId={propertyId}
        keyPickupLocation={payload?.keyPickupLocation ?? null}
        contact={contact}
        nextGuest={payload?.nextGuest ?? null}
        readFirstItems={readFirstItems}
        restockNeeds={restockNeeds}
      />
    </div>
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
