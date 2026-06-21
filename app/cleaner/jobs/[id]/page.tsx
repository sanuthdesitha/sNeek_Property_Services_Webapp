"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, AlertTriangle, Camera, Clock, Eye, MapPin, Play, Send, Square, PauseCircle, TimerReset, Navigation, TrafficCone, Plus, Pencil, Trash2, HandCoins, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { AccessInstructionsPanel } from "@/components/shared/access-instructions-panel";
import { MediaGallery } from "@/components/shared/media-gallery";
import { SignaturePad } from "@/components/shared/signature-pad";
import type { JobSpecialRequestTask } from "@/lib/jobs/meta";
import {
  collectRequiredAnswerFields,
  isTemplateNodeVisible,
  flattenFieldsOneLevel,
  isFlattenedFieldVisible,
  fieldDetailsKey,
} from "@/lib/forms/visibility";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { stampImage, isStampableImage, type StampOptions } from "@/lib/uploads/stamp";
import { prepareUploadFile } from "@/lib/uploads/compress";
import { FieldRenderer } from "@/components/forms/field-renderer";
import { FieldReferences } from "@/components/forms/field-references";
import { GuidedCapture, type GuidedCaptureItem } from "@/components/forms/guided-capture";
import { ClockLocationsMap } from "@/components/shared/clock-locations-map";
import { googleMapsDirectionsUrl } from "@/lib/maps/google-maps-url";
import { VideoRecorder } from "@/components/forms/video-recorder";
import {
  INVENTORY_LOCATIONS,
  INVENTORY_LOCATION_LABELS,
  normalizeInventoryLocation,
  type InventoryLocation,
} from "@/lib/inventory/locations";
import { formatDuration, elapsedSecondsSince, safeSeconds } from "@/lib/time/format-duration";
import {
  getAccuratePosition,
  formatAccuracy,
  GpsError,
  POOR_ACCURACY_M,
  type GpsFix,
} from "@/lib/geo/get-position";
import { haversineMeters } from "@/lib/jobs/gps";
import {
  formatAssignmentResponseLabel,
  formatJobStatusLabel,
} from "@/lib/jobs/assignment-workflow";
import { ensureGoogleMaps, resolveBrowserMapsKey } from "@/lib/maps/loader";
import { ReportMaintenanceSheet } from "@/components/maintenance/report-maintenance-sheet";
import { DrivingPanel } from "@/components/cleaner/driving-panel";
import { ProcessNudge, ProcessConfirm } from "@/components/shared/process-nudge";

type Step = "briefing" | "checklist" | "uploads" | "laundry" | "submit";
type FormPageSlot = "auto" | "checklist" | "uploads" | "laundry" | "submit";
type RenderableFormStep = Step;
type LaundryOutcome = "READY_FOR_PICKUP" | "NOT_READY" | "NO_PICKUP_REQUIRED";
type SavedLaundryUpdate = {
  outcome: LaundryOutcome;
  submittedAt: string;
  bagLocation?: string;
  skipReasonCode?: string;
  skipReasonNote?: string;
};
type SharedCleanerDraftEnvelope = {
  updatedAt: string;
  updatedByUserId: string;
  updatedByName: string;
  editorSessionId: string;
  state: Record<string, any>;
};
const LAUNDRY_SKIP_REASONS = [
  { value: "NO_LINEN_USED", label: "No linen used" },
  { value: "LINEN_STILL_WASHING", label: "Linen still washing" },
  { value: "BUFFER_SET_USED", label: "Buffer set used" },
  { value: "GUEST_STILL_USING_ITEMS", label: "Guest still using items" },
  { value: "ADMIN_INSTRUCTION", label: "Admin instruction" },
  { value: "OTHER", label: "Other" },
];
const CLIENT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const CLIENT_MAX_VIDEO_BYTES = 150 * 1024 * 1024;
type UploadItemStatus = "queued" | "uploading" | "uploaded" | "failed";
type UploadSource = "camera" | "gallery";

type UploadItemState = {
  id: string;
  name: string;
  progress: number;
  status: UploadItemStatus;
  error?: string;
  key?: string;
};

function formatMinutesLabel(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  if (hours <= 0) return `${mins} min`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function normalizeFormPageSlot(value: unknown): FormPageSlot {
  if (typeof value !== "string") return "auto";
  const normalized = value.trim().toLowerCase();
  if (normalized === "checklist" || normalized === "uploads" || normalized === "laundry" || normalized === "submit") {
    return normalized;
  }
  return "auto";
}

function isLaundryLikeLabel(value: unknown) {
  const text = String(value ?? "").toLowerCase();
  return /laundry|bag[_\s-]?location|laundry_ready/.test(text);
}

function resolveFieldStep(field: any, section: any): RenderableFormStep {
  const fieldSlot = normalizeFormPageSlot(field?.page);
  if (fieldSlot !== "auto") return fieldSlot;

  const sectionSlot = normalizeFormPageSlot(section?.page);
  if (sectionSlot !== "auto") return sectionSlot;

  if (
    isLaundryLikeLabel(field?.id) ||
    isLaundryLikeLabel(field?.label) ||
    isLaundryLikeLabel(section?.id) ||
    isLaundryLikeLabel(section?.label)
  ) {
    return "laundry";
  }

  if (isUploadFieldType(field?.type)) return "uploads";
  return "checklist";
}

function inferLocationFromText(value: unknown): InventoryLocation | null {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text.includes("bath")) return "BATHROOM";
  if (text.includes("kitchen")) return "KITCHEN";
  if (text.includes("other") || text.includes("cleaner") || text.includes("cupboard")) {
    return "CLEANERS_CUPBOARD";
  }
  return null;
}

function isFieldVisible(field: any, formData: Record<string, unknown>, property: Record<string, unknown> | undefined) {
  return isTemplateNodeVisible(field, formData, property ?? {});
}

function isSectionVisible(section: any, formData: Record<string, unknown>, property: Record<string, unknown> | undefined) {
  return isTemplateNodeVisible(section, formData, property ?? {});
}

function adminRequestedTaskDoneFieldId(taskId: string) {
  return `__admin_requested_task_${taskId}_done`;
}

function adminRequestedTaskNoteFieldId(taskId: string) {
  return `__admin_requested_task_${taskId}_note`;
}

function adminRequestedTaskPhotoFieldId(taskId: string) {
  return `__admin_requested_task_${taskId}_photo`;
}

function jobTaskDecisionFieldId(taskId: string) {
  return `__job_task_${taskId}_decision`;
}

function jobTaskNoteFieldId(taskId: string) {
  return `__job_task_${taskId}_note`;
}

function jobTaskProofFieldId(taskId: string) {
  return `__job_task_${taskId}_proof`;
}

function carryForwardPhotoFieldId(taskId: string) {
  return `carry_forward_photo_${taskId}`;
}

const DAMAGE_UPLOAD_FIELD_ID = "__damage_report_photos";
const PAY_REQUEST_UPLOAD_FIELD_ID = "__pay_request_photos";

type DamageItem = {
  id: string;
  title: string;
  area: string;
  description: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  estimatedCost: string;
  photoFieldId: string;
};

type PayRequestItem = {
  id: string;
  title: string;
  description: string;
  type: "HOURLY" | "FIXED";
  hours: string;
  rate: string;
  amount: string;
  photoFieldId: string;
};

const DAMAGE_SEVERITY_OPTIONS: Array<{ value: DamageItem["severity"]; label: string }> = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

function createLineItemId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function damageItemPhotoFieldId(itemId: string) {
  return `__damage_item_${itemId}_photos`;
}

function payRequestItemPhotoFieldId(itemId: string) {
  return `__pay_request_item_${itemId}_photos`;
}

function payRequestItemAmount(item: Pick<PayRequestItem, "type" | "hours" | "rate" | "amount">) {
  if (item.type === "HOURLY") {
    return Number(item.hours || 0) * Number(item.rate || 0);
  }
  return Number(item.amount || 0);
}

function normalizeDamageSeverity(value: unknown): DamageItem["severity"] {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH" || value === "CRITICAL"
    ? value
    : "HIGH";
}

function sanitizeDamageItems(value: unknown): DamageItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const id = typeof item.id === "string" && item.id ? item.id : createLineItemId();
      return {
        id,
        title: typeof item.title === "string" ? item.title : "",
        area: typeof item.area === "string" ? item.area : "",
        description: typeof item.description === "string" ? item.description : "",
        severity: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(item.severity as string)
          ? (item.severity as DamageItem["severity"])
          : "HIGH",
        estimatedCost: typeof item.estimatedCost === "string" ? item.estimatedCost : "0",
        photoFieldId:
          typeof item.photoFieldId === "string" && item.photoFieldId
            ? item.photoFieldId
            : damageItemPhotoFieldId(id),
      };
    })
    .filter((item) => item.title.trim().length > 0);
}

function sanitizePayRequestItems(value: unknown): PayRequestItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const id = typeof item.id === "string" && item.id ? item.id : createLineItemId();
      return {
        id,
        title: typeof item.title === "string" ? item.title : "",
        description: typeof item.description === "string" ? item.description : "",
        type: item.type === "HOURLY" ? ("HOURLY" as const) : ("FIXED" as const),
        hours: typeof item.hours === "string" ? item.hours : "1",
        rate: typeof item.rate === "string" ? item.rate : "",
        amount: typeof item.amount === "string" ? item.amount : "0",
        photoFieldId:
          typeof item.photoFieldId === "string" && item.photoFieldId
            ? item.photoFieldId
            : payRequestItemPhotoFieldId(id),
      };
    })
    .filter((item) => item.title.trim().length > 0);
}

function formatLaundryOutcomeLabelValue(outcome: LaundryOutcome) {
  switch (outcome) {
    case "READY_FOR_PICKUP":
      return "Ready for pickup";
    case "NO_PICKUP_REQUIRED":
      return "No pickup required";
    default:
      return "Not ready";
  }
}

function getLaundrySkipReasonLabel(reasonCode: string | undefined) {
  if (!reasonCode) return "";
  return LAUNDRY_SKIP_REASONS.find((reason) => reason.value === reasonCode)?.label ?? reasonCode.replace(/_/g, " ");
}

function formatJobTaskSourceLabel(source: string) {
  switch (source) {
    case "CLIENT":
      return "Client request";
    case "CARRY_FORWARD":
      return "Carry forward";
    default:
      return "Admin request";
  }
}

function buildLaundryUpdateSummary(update: SavedLaundryUpdate | null) {
  if (!update) return "";
  if (update.outcome === "READY_FOR_PICKUP") {
    return update.bagLocation?.trim()
      ? `Sent: ${formatLaundryOutcomeLabelValue(update.outcome)} - ${update.bagLocation.trim()}`
      : `Sent: ${formatLaundryOutcomeLabelValue(update.outcome)}`;
  }
  const reasonLabel = getLaundrySkipReasonLabel(update.skipReasonCode);
  const reasonNote = update.skipReasonNote?.trim();
  return [formatLaundryOutcomeLabelValue(update.outcome), reasonLabel, reasonNote]
    .filter(Boolean)
    .join(" - ");
}

function hasMeaningfulDraftValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulDraftValue(item));
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => hasMeaningfulDraftValue(item));
  }
  return false;
}

function hasServerProgress(body: any) {
  const status = String(body?.job?.status ?? "");
  if (
    [
      "IN_PROGRESS",
      "PAUSED",
      "WAITING_CONTINUATION_APPROVAL",
      "SUBMITTED",
      "QA_REVIEW",
      "COMPLETED",
      "INVOICED",
    ].includes(status)
  ) {
    return true;
  }
  if (body?.timeState?.isRunning) return true;
  if (Number(body?.timeState?.completedSeconds ?? 0) > 0) return true;
  if (body?.laundryState) return true;
  if (
    body?.continuationProgressSnapshot &&
    typeof body.continuationProgressSnapshot === "object" &&
    Object.keys(body.continuationProgressSnapshot).length > 0
  ) {
    return true;
  }
  return false;
}

function shouldDiscardLocalDraft(draft: Record<string, any> | null, body: any) {
  if (!draft) return false;
  if (hasServerProgress(body)) return false;
  if (draft.step && draft.step !== "briefing") return true;
  if (hasMeaningfulDraftValue(draft.formData)) return true;
  if (hasMeaningfulDraftValue(draft.uploads)) return true;
  if (hasMeaningfulDraftValue(draft.savedLaundryUpdate)) return true;
  if (draft.hasMissedTask || draft.extraPaymentRequired || draft.damageFound || draft.showRescheduleForm) {
    return true;
  }
  if (Array.isArray(draft.damageItems) && draft.damageItems.length > 0) return true;
  if (Array.isArray(draft.payRequestItems) && draft.payRequestItems.length > 0) return true;
  return false;
}

function createEditorSessionId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function CleanerJobPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = Array.isArray(params.id) ? params.id[0] : String(params.id);

  const [payload, setPayload] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [uploads, setUploads] = useState<Record<string, string[]>>({});
  const [uploadStates, setUploadStates] = useState<Record<string, UploadItemState[]>>({});
  const [guidedCaptureOpen, setGuidedCaptureOpen] = useState(false);
  const [laundryOutcome, setLaundryOutcome] = useState<LaundryOutcome | null>(null);
  const [laundrySkipReasonCode, setLaundrySkipReasonCode] = useState("LINEN_STILL_WASHING");
  const [laundrySkipReasonNote, setLaundrySkipReasonNote] = useState("");
  const [bagLocationSelection, setBagLocationSelection] = useState<string>("__custom");
  const [bagLocationCustom, setBagLocationCustom] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [pendingSync, setPendingSync] = useState(false);
  const [savingLaundryUpdate, setSavingLaundryUpdate] = useState(false);
  const [lastLaundrySubmittedAt, setLastLaundrySubmittedAt] = useState<string | null>(null);
  const [savedLaundryUpdate, setSavedLaundryUpdate] = useState<SavedLaundryUpdate | null>(null);
  const [laundryUpdateCollapsed, setLaundryUpdateCollapsed] = useState(false);
  const [clockReviewOpen, setClockReviewOpen] = useState(false);
  const [requestClockAdjustment, setRequestClockAdjustment] = useState(false);
  const [clockAdjustmentMinutes, setClockAdjustmentMinutes] = useState("");
  const [clockAdjustmentReason, setClockAdjustmentReason] = useState("");
  const [pendingSubmitPayload, setPendingSubmitPayload] = useState<Record<string, unknown> | null>(null);
  const [step, setStep] = useState<Step>("briefing");
  const [briefing, setBriefing] = useState<any>(null);
  const [verificationDate, setVerificationDate] = useState("");
  const [confirmOnSite, setConfirmOnSite] = useState(false);
  const [confirmChecklist, setConfirmChecklist] = useState(false);
  const [resolvedCarryForwardIds, setResolvedCarryForwardIds] = useState<string[]>([]);
  const [hasMissedTask, setHasMissedTask] = useState(false);
  const [missedTaskNotes, setMissedTaskNotes] = useState<string[]>([""]);
  const [approvalTitle, setApprovalTitle] = useState("");
  const [approvalDescription, setApprovalDescription] = useState("");
  const [approvalType, setApprovalType] = useState<"HOURLY" | "FIXED">("FIXED");
  const [approvalHours, setApprovalHours] = useState("1");
  const [approvalRate, setApprovalRate] = useState("");
  const [approvalAmount, setApprovalAmount] = useState("0");
  const [extraPaymentRequired, setExtraPaymentRequired] = useState(false);
  const [damageFound, setDamageFound] = useState(false);
  const [damageTitle, setDamageTitle] = useState("");
  const [damageArea, setDamageArea] = useState("");
  const [damageSeverity, setDamageSeverity] = useState<DamageItem["severity"]>("HIGH");
  const [damageDescription, setDamageDescription] = useState("");
  const [damageEstimatedCost, setDamageEstimatedCost] = useState("0");
  // Committed lists. Items here are guaranteed to be submitted with the job —
  // they never depend on a "save draft" step and survive reloads via the draft
  // snapshot. The single-field state above is just the working mini-form.
  const [damageItems, setDamageItems] = useState<DamageItem[]>([]);
  const [payRequestItems, setPayRequestItems] = useState<PayRequestItem[]>([]);
  const [editingDamageId, setEditingDamageId] = useState<string | null>(null);
  const [editingPayRequestId, setEditingPayRequestId] = useState<string | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [reschedulePreferredDate, setReschedulePreferredDate] = useState("");
  const [rescheduleRemainingHours, setRescheduleRemainingHours] = useState("");
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [rescheduleRequests, setRescheduleRequests] = useState<any[]>([]);
  const [earlyCheckoutRequests, setEarlyCheckoutRequests] = useState<any[]>([]);
  const [submittingReschedule, setSubmittingReschedule] = useState(false);
  const [uploadPreviewUrls, setUploadPreviewUrls] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSrc, setPreviewSrc] = useState("");
  const [previewLabel, setPreviewLabel] = useState("Image preview");
  const [showJobNotes, setShowJobNotes] = useState(false);
  const [sendingSafetyCheckin, setSendingSafetyCheckin] = useState(false);
  const [assignmentNote, setAssignmentNote] = useState("");
  const [transferCleanerId, setTransferCleanerId] = useState("");
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [assignmentActionLoading, setAssignmentActionLoading] = useState<"ACCEPT" | "DECLINE" | "TRANSFER" | null>(null);

  const [startingDriving, setStartingDriving] = useState(false);
  const [stoppingDriving, setStoppingDriving] = useState(false);
  const [pausingDriving, setPausingDriving] = useState(false);
  const [resumingDriving, setResumingDriving] = useState(false);
  const [arrivingDriving, setArrivingDriving] = useState(false);
  const [markingDelayed, setMarkingDelayed] = useState(false);
  // En-route reason chips: the value IS the reason string sent to the API
  // (the pause/mark-delayed endpoints already accept any free-text reason).
  const [pauseReasonSelect, setPauseReasonSelect] = useState("Traffic");
  const [pauseReasonOther, setPauseReasonOther] = useState("");
  const [delayedReason, setDelayedReason] = useState("Traffic");
  const [delayedReasonOther, setDelayedReasonOther] = useState("");
  const [manualEta, setManualEta] = useState("");
  const [trackingActive, setTrackingActive] = useState(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [lastPingSentAt, setLastPingSentAt] = useState<number | null>(null);
  const [lastPingAccuracy, setLastPingAccuracy] = useState<number | null>(null);
  const [pingClock, setPingClock] = useState(() => Date.now());

  // Adherence nudge: confirm-before-submit gate when the cleaner tries to
  // submit with an incomplete checklist or without a GPS check-in on record.
  // It never hard-blocks a legitimate submit — once acknowledged, we proceed
  // straight through. The reminder explains the step is logged for quality + pay.
  const [adherenceConfirmOpen, setAdherenceConfirmOpen] = useState(false);
  const [adherenceConfirmMessage, setAdherenceConfirmMessage] = useState<string>("");
  const adherenceBypassRef = useRef(false);

  // GPS check-in confirm/adjust popup state.
  const [gpsCheckinOpen, setGpsCheckinOpen] = useState(false);
  const [gpsCheckinSaving, setGpsCheckinSaving] = useState(false);
  const [gpsCheckinAdjustMode, setGpsCheckinAdjustMode] = useState(false);
  const [gpsCheckinNote, setGpsCheckinNote] = useState("");
  const [gpsCheckinFix, setGpsCheckinFix] = useState<{
    lat: number;
    lng: number;
    accuracy: number | null;
    adjusted: boolean;
  } | null>(null);
  const gpsMapRef = useRef<HTMLDivElement | null>(null);
  const gpsMarkerRef = useRef<any>(null);
  const gpsMapInstanceRef = useRef<any>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hydratedRef = useRef(false);
  const carryoverNoticeShownRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const pendingPingsRef = useRef<Array<Record<string, number | null>>>([]);
  const flushingPingsRef = useRef(false);
  const lastUploadRef = useRef<{ at: number; lat: number; lng: number } | null>(null);
  const lastFixRef = useRef<GpsFix | null>(null);
  // Cached GPS fix for evidence stamping, fetched once per capture session and
  // reused across shots so continuous capture is never blocked on geolocation.
  const stampGpsRef = useRef<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const stampGpsPromiseRef = useRef<Promise<{ lat: number; lng: number; accuracy: number | null } | null> | null>(null);
  const editorSessionIdRef = useRef(createEditorSessionId());
  const lastKnownSharedDraftAtRef = useRef<string | null>(null);
  const suppressDraftSyncUntilRef = useRef(0);

  function stopTicking() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function syncLaundryReadyFromOutcome(nextOutcome: LaundryOutcome | null) {
    setLaundryOutcome(nextOutcome);
  }

  function startTimerFromState(completedSeconds: number, activeStartedAt?: string | null) {
    stopTicking();
    const banked = safeSeconds(completedSeconds);
    // Guard: a missing or unparseable startedAt must never start a ticking
    // interval (it used to compute NaN forever). Treat it as "not running".
    const startedMs = activeStartedAt ? new Date(activeStartedAt).getTime() : Number.NaN;
    if (!activeStartedAt || !Number.isFinite(startedMs)) {
      setIsRunning(false);
      setElapsed(banked);
      return;
    }

    // Derive from the server startedAt on every tick (not an accumulating
    // counter), so background-tab throttling / PWA suspends / reloads can't
    // drift or corrupt the displayed time.
    const tick = () => {
      setElapsed(elapsedSecondsSince(new Date(startedMs), banked));
    };
    tick();
    setIsRunning(true);
    timerRef.current = setInterval(tick, 1000);
  }

  function readDraftState() {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(`cleaner-job-draft:${jobId}`);
      if (!raw) return null;
      return JSON.parse(raw) as Record<string, any>;
    } catch {
      return null;
    }
  }

  function clearDraftState() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(`cleaner-job-draft:${jobId}`);
  }

  function readPendingSubmission() {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(`cleaner-job-pending-submit:${jobId}`);
      if (!raw) return null;
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function writePendingSubmission(payload: Record<string, unknown>) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`cleaner-job-pending-submit:${jobId}`, JSON.stringify(payload));
    setPendingSync(true);
  }

  function clearPendingSubmission() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(`cleaner-job-pending-submit:${jobId}`);
    setPendingSync(false);
  }

  function suppressDraftSync(ms = 1200) {
    suppressDraftSyncUntilRef.current = Date.now() + ms;
  }

  function buildDraftSnapshot(updatedAt = new Date().toISOString()) {
    return {
      updatedAt,
      formData,
      uploads,
      laundryOutcome,
      laundryReady,
      laundrySkipReasonCode,
      laundrySkipReasonNote,
      savedLaundryUpdate,
      lastLaundrySubmittedAt,
      laundryUpdateCollapsed,
      bagLocationSelection,
      bagLocationCustom,
      step,
      verificationDate,
      confirmOnSite,
      confirmChecklist,
      resolvedCarryForwardIds,
      hasMissedTask,
      extraPaymentRequired,
      damageFound,
      approvalTitle,
      approvalDescription,
      approvalType,
      approvalHours,
      approvalRate,
      approvalAmount,
      damageTitle,
      damageArea,
      damageSeverity,
      damageDescription,
      damageEstimatedCost,
      damageItems,
      payRequestItems,
      showRescheduleForm,
      missedTaskNotes,
    };
  }

  function applyDraftSnapshot(
    draft: Record<string, any>,
    options: {
      bagLocationOptions: string[];
      fallbackStep: Step;
      expectedDate?: string;
    }
  ) {
    suppressDraftSync();
    setFormData(draft.formData ?? {});
    setUploads(draft.uploads ?? {});
    syncLaundryReadyFromOutcome(
      (draft.laundryOutcome as LaundryOutcome | undefined) ??
        (draft.laundryReady === true ? "READY_FOR_PICKUP" : null)
    );
    setLaundrySkipReasonCode(
      typeof draft.laundrySkipReasonCode === "string" && draft.laundrySkipReasonCode
        ? draft.laundrySkipReasonCode
        : "LINEN_STILL_WASHING"
    );
    setLaundrySkipReasonNote(typeof draft.laundrySkipReasonNote === "string" ? draft.laundrySkipReasonNote : "");
    setBagLocationSelection(
      typeof draft.bagLocationSelection === "string"
        ? draft.bagLocationSelection
        : options.bagLocationOptions[0] ?? "__custom"
    );
    setBagLocationCustom(draft.bagLocationCustom ?? "");
    const nextStep =
      draft.step === "overview"
        ? options.fallbackStep
        : ((draft.step as Step | undefined) ?? options.fallbackStep);
    setStep(nextStep);
    setVerificationDate(draft.verificationDate ?? options.expectedDate ?? "");
    setConfirmOnSite(Boolean(draft.confirmOnSite));
    setConfirmChecklist(Boolean(draft.confirmChecklist));
    setResolvedCarryForwardIds(Array.isArray(draft.resolvedCarryForwardIds) ? draft.resolvedCarryForwardIds : []);
    setHasMissedTask(Boolean(draft.hasMissedTask));
    setShowRescheduleForm(Boolean(draft.showRescheduleForm));
    setExtraPaymentRequired(Boolean(draft.extraPaymentRequired));
    setDamageFound(Boolean(draft.damageFound));
    setApprovalTitle(typeof draft.approvalTitle === "string" ? draft.approvalTitle : "");
    setApprovalDescription(typeof draft.approvalDescription === "string" ? draft.approvalDescription : "");
    setApprovalType(draft.approvalType === "HOURLY" ? "HOURLY" : "FIXED");
    setApprovalHours(typeof draft.approvalHours === "string" ? draft.approvalHours : "1");
    setApprovalRate(typeof draft.approvalRate === "string" ? draft.approvalRate : "");
    setApprovalAmount(typeof draft.approvalAmount === "string" ? draft.approvalAmount : "0");
    setDamageTitle(typeof draft.damageTitle === "string" ? draft.damageTitle : "");
    setDamageArea(typeof draft.damageArea === "string" ? draft.damageArea : "");
    setDamageSeverity(normalizeDamageSeverity(draft.damageSeverity));
    setDamageDescription(typeof draft.damageDescription === "string" ? draft.damageDescription : "");
    setDamageEstimatedCost(typeof draft.damageEstimatedCost === "string" ? draft.damageEstimatedCost : "0");
    setDamageItems(sanitizeDamageItems(draft.damageItems));
    setPayRequestItems(sanitizePayRequestItems(draft.payRequestItems));
    setEditingDamageId(null);
    setEditingPayRequestId(null);
    const draftSavedLaundryUpdate =
      draft.savedLaundryUpdate && typeof draft.savedLaundryUpdate === "object"
        ? (draft.savedLaundryUpdate as SavedLaundryUpdate)
        : null;
    setSavedLaundryUpdate(draftSavedLaundryUpdate);
    setLastLaundrySubmittedAt(
      typeof draft.lastLaundrySubmittedAt === "string"
        ? draft.lastLaundrySubmittedAt
        : draftSavedLaundryUpdate?.submittedAt ?? null
    );
    setLaundryUpdateCollapsed(
      typeof draft.laundryUpdateCollapsed === "boolean"
        ? draft.laundryUpdateCollapsed
        : Boolean(draftSavedLaundryUpdate)
    );
    const draftNotes = Array.isArray(draft.missedTaskNotes)
      ? draft.missedTaskNotes
      : typeof draft.missedTaskNote === "string"
        ? [draft.missedTaskNote]
        : [];
    setMissedTaskNotes(draftNotes.length > 0 ? draftNotes : [""]);
    lastKnownSharedDraftAtRef.current =
      typeof draft.updatedAt === "string" && draft.updatedAt ? draft.updatedAt : lastKnownSharedDraftAtRef.current;
  }

  async function fetchSharedDraftState() {
    const res = await fetch(`/api/cleaner/jobs/${jobId}/draft`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return body?.draft && typeof body.draft === "object"
      ? (body.draft as SharedCleanerDraftEnvelope)
      : null;
  }

  async function persistSharedDraftState(snapshot: Record<string, any>) {
    const res = await fetch(`/api/cleaner/jobs/${jobId}/draft`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        editorSessionId: editorSessionIdRef.current,
        state: snapshot,
      }),
    });
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    lastKnownSharedDraftAtRef.current =
      typeof body.updatedAt === "string" && body.updatedAt ? body.updatedAt : snapshot.updatedAt;
  }

  async function clearSharedDraftState() {
    lastKnownSharedDraftAtRef.current = null;
    await fetch(`/api/cleaner/jobs/${jobId}/draft`, { method: "DELETE" }).catch(() => {});
  }

  function isImageFileName(value: string) {
    return /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(value);
  }

  function isImageFile(file: File) {
    return file.type?.toLowerCase().startsWith("image/") || /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif)$/i.test(file.name ?? "");
  }

function formatDateTimeLabel(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-AU", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function clockLimitSourceLabel(value: string | null | undefined) {
  switch (value) {
    case "ESTIMATED_HOURS":
      return "the job's fixed / allocated pay hours";
    case "MAX_JOB_LENGTH":
      return "the maximum job length from admin settings";
    case "DUE_TIME":
      return "the job due time";
    case "END_TIME":
      return "the job end time";
    case "MIDNIGHT":
      return "the midnight fallback";
    default:
      return "the job timing rules";
  }
}

  /**
   * Resolve the GPS fix used for evidence stamping. Fetched at most once per
   * capture session and cached on a ref so continuous shooting never blocks on
   * geolocation. Reuses the most recent en-route / check-in fix when present,
   * otherwise asks for an accurate position. Never throws — a missing fix just
   * means the stamp omits coordinates.
   */
  async function resolveStampGps(): Promise<{ lat: number; lng: number; accuracy: number | null } | null> {
    if (stampGpsRef.current) return stampGpsRef.current;
    const recent = lastFixRef.current;
    if (recent && Number.isFinite(recent.lat) && Number.isFinite(recent.lng)) {
      stampGpsRef.current = { lat: recent.lat, lng: recent.lng, accuracy: recent.accuracy ?? null };
      return stampGpsRef.current;
    }
    if (!stampGpsPromiseRef.current) {
      stampGpsPromiseRef.current = (async () => {
        try {
          const fix = await getAccuratePosition();
          lastFixRef.current = fix;
          return { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy ?? null };
        } catch {
          return null;
        }
      })();
    }
    const resolved = await stampGpsPromiseRef.current;
    if (resolved) stampGpsRef.current = resolved;
    return resolved;
  }

  /**
   * Heuristic: derive the evidence tag (before / after / damage) for a photo
   * from the section/field it belongs to. Damage uploaders pass tag explicitly;
   * here we look at the section title for clearly pre-clean / arrival wording,
   * otherwise default to "after" (completion / checklist evidence).
   */
  function deriveTag(fieldId?: string): string {
    if (!fieldId) return "after";
    // Damage uploaders use synthetic field ids (DAMAGE_UPLOAD_FIELD_ID and
    // damageItemPhotoFieldId) that don't live in the form sections.
    if (fieldId === DAMAGE_UPLOAD_FIELD_ID || fieldId.startsWith("__damage_")) {
      return "damage";
    }
    const match = visibleSections
      .flatMap((section: any) => (section.fields ?? []).map((f: any) => ({ f, section })))
      .find((entry: any) => entry.f?.id === fieldId);
    if (!match) return "after";
    // An explicit per-field stamp tag set in the form builder wins over the
    // wording heuristic ("auto"/empty falls through to the heuristic below).
    const explicit =
      typeof match.f?.stampTag === "string" ? match.f.stampTag.trim().toLowerCase() : "";
    if (explicit && explicit !== "auto") return explicit;
    const haystack = [
      match.section?.title,
      match.section?.label,
      match.section?.description,
      match.f?.label,
      match.f?.locationTag,
    ]
      .filter((v: unknown) => typeof v === "string")
      .join(" ")
      .toLowerCase();
    if (/\b(damage|broken|defect|fault)\b/.test(haystack)) return "damage";
    if (/\b(before|arrival|arrive|pre-?clean|pre clean|start|check-?in|on arrival)\b/.test(haystack)) {
      return "before";
    }
    return "after";
  }

  /** Build the evidence stamp options shared by every job photo. */
  function buildStampOptions(
    gps: { lat: number; lng: number; accuracy: number | null } | null,
    fieldId?: string,
    tag?: "before" | "after" | "damage"
  ): StampOptions {
    const capturerName =
      (typeof payload?.viewerName === "string" && payload.viewerName.trim()) || "Cleaner";
    const companyName =
      (typeof payload?.branding?.companyName === "string" && payload.branding.companyName.trim()) ||
      "sNeek Property Services";
    const logoUrl = typeof payload?.branding?.logoUrl === "string" ? payload.branding.logoUrl : "";
    const timezone =
      (typeof payload?.startVerification?.timezone === "string" && payload.startVerification.timezone) ||
      "Australia/Sydney";
    const stampFormat = payload?.branding?.evidenceStamp ?? {};

    const prop = payload?.job?.property ?? {};
    const propertyName = (typeof prop.name === "string" && prop.name.trim()) || "";
    const addressParts = [prop.address, prop.suburb, prop.state, prop.postcode]
      .filter((v: unknown) => typeof v === "string" && v.trim())
      .map((v: string) => v.trim());
    const address = addressParts.join(", ") || undefined;
    // Property NAME stays as the small reference; the address line is the
    // headline locator on the stamp.
    const reference = propertyName || undefined;

    let contextLabel: string | undefined;
    if (fieldId) {
      const match = visibleSections
        .flatMap((section: any) => (section.fields ?? []).map((f: any) => ({ f, section })))
        .find((entry: any) => entry.f?.id === fieldId);
      if (match) {
        const sectionLabel =
          (typeof match.section?.label === "string" && match.section.label.trim()) ||
          (typeof match.section?.title === "string" && match.section.title.trim()) ||
          "";
        const fieldLabel =
          (typeof match.f?.label === "string" && match.f.label.trim()) || "";
        contextLabel = [sectionLabel, fieldLabel].filter(Boolean).join(" · ") || undefined;
      }
    }

    return {
      capturerName,
      companyName,
      logoUrl,
      timezone,
      gps,
      address,
      reference,
      contextLabel,
      tag: tag ?? deriveTag(fieldId),
      dateFormat: typeof stampFormat.dateFormat === "string" ? stampFormat.dateFormat : undefined,
      timeFormat: typeof stampFormat.timeFormat === "string" ? stampFormat.timeFormat : undefined,
      showWeekday: typeof stampFormat.showWeekday === "boolean" ? stampFormat.showWeekday : undefined,
    };
  }

  /**
   * Evidence-prepare a single image.
   *  - CAMERA captures (live camera / capture="environment" / guided capture) are
   *    fresh photos with no embedded timestamp, so we burn the evidence stamp
   *    (time/date/address) into them.
   *  - GALLERY uploads are existing files that already carry their own
   *    timestamp/EXIF, so stamping would add a SECOND, different time. We only
   *    compress those (no stamp).
   * Never throws; falls back to the raw file on failure.
   */
  async function prepareEvidenceImage(
    file: File,
    gps: { lat: number; lng: number; accuracy: number | null } | null,
    fieldId: string | undefined,
    shouldStamp: boolean
  ): Promise<File> {
    if (!isStampableImage(file)) return file;
    if (!shouldStamp) {
      // Uploaded image — don't double-stamp; just size it for upload.
      return prepareUploadFile(file, null);
    }
    return stampImage(file, buildStampOptions(gps, fieldId));
  }

  async function preprocessFilesForUpload(
    files: File[],
    source: UploadSource,
    fieldId?: string
  ): Promise<File[]> {
    // Only in-app camera captures get the evidence timestamp stamp. Gallery
    // uploads already have their own timestamp, so a second stamp would show two
    // conflicting times — those are compressed only.
    const shouldStamp = source === "camera";
    const hasImage = files.some((file) => isImageFile(file) && !isVideoFile(file));
    // GPS is only needed for the stamp, so only resolve it for camera captures.
    const gps = shouldStamp && hasImage ? await resolveStampGps() : null;

    const processed: File[] = [];
    let imagePrepFailures = 0;
    for (const file of files) {
      if (!isImageFile(file) || isVideoFile(file)) {
        processed.push(file);
        continue;
      }
      try {
        processed.push(await prepareEvidenceImage(file, gps, fieldId, shouldStamp));
      } catch {
        imagePrepFailures += 1;
        processed.push(file);
      }
    }
    // Only warn about a missing stamp when we actually intended to stamp (camera).
    if (imagePrepFailures > 0 && shouldStamp) {
      toast({
        title: "Some images were not stamped",
        description: `${imagePrepFailures} photo(s) were uploaded without the evidence stamp.`,
        variant: "destructive",
      });
    }
    return processed;
  }

  async function fetchPreviewUrlForKey(key: string) {
    const url = `/api/uploads/access?key=${encodeURIComponent(key)}&jobId=${encodeURIComponent(jobId)}`;
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body?.url) {
      throw new Error(body?.error ?? "Could not fetch preview URL.");
    }
    return String(body.url);
  }

  async function openImagePreviewForKey(key: string, label: string) {
    try {
      const existing = uploadPreviewUrls[key];
      const url = existing || (await fetchPreviewUrlForKey(key));
      if (!existing) {
        setUploadPreviewUrls((prev) => ({ ...prev, [key]: url }));
      }
      setPreviewLabel(label || "Image preview");
      setPreviewSrc(url);
      setPreviewOpen(true);
    } catch {
      showPopupNotification("Preview failed", "Could not open image preview.", "destructive");
    }
  }

  function showPopupNotification(title: string, description?: string, variant?: "default" | "destructive") {
    toast({ title, description, variant });
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const body = description?.trim();
    if (Notification.permission === "granted") {
      try {
        new Notification(title, { body });
      } catch {
        // Ignore browser-level notification failures and keep toast behavior.
      }
      return;
    }
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }

  async function load() {
    const res = await fetch(`/api/jobs/${jobId}/form`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      setPayload({
        error:
          body?.error ??
          "Could not load this job form. Please refresh or check server logs.",
      });
      setPendingSync(Boolean(readPendingSubmission()));
      return;
    }
    setPayload(body);
    const briefingRes = await fetch(`/api/cleaner/jobs/${jobId}/briefing`, { cache: "no-store" });
    const briefingBody = await briefingRes.json().catch(() => null);
    setBriefing(briefingRes.ok ? briefingBody : null);
    const options = Array.isArray(body?.laundryBagLocationOptions) ? body.laundryBagLocationOptions : [];
    const finishedState = ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"].includes(body?.job?.status ?? "");
    let draft = !finishedState ? readDraftState() : null;
    const carryoverSnapshot =
      body?.continuationProgressSnapshot && typeof body.continuationProgressSnapshot === "object"
        ? (body.continuationProgressSnapshot as Record<string, any>)
        : null;
    setPendingSync(Boolean(readPendingSubmission()));

    if (shouldDiscardLocalDraft(draft, body)) {
      clearDraftState();
      clearPendingSubmission();
      void clearSharedDraftState();
      draft = null;
      showPopupNotification(
        "Previous progress cleared",
        "This job was reset or restarted, so the old local draft was removed."
      );
    }

    if (draft) {
      applyDraftSnapshot(draft, {
        bagLocationOptions: options,
        fallbackStep: body?.timeState?.isRunning ? "checklist" : "briefing",
        expectedDate: body?.startVerification?.expectedDate ?? "",
      });
    } else {
      const carryFormData =
        carryoverSnapshot?.formData && typeof carryoverSnapshot.formData === "object"
          ? (carryoverSnapshot.formData as Record<string, any>)
          : {};
      const carryUploads =
        carryoverSnapshot?.uploads && typeof carryoverSnapshot.uploads === "object"
          ? Object.entries(carryoverSnapshot.uploads as Record<string, unknown>).reduce<Record<string, string[]>>(
              (acc, [fieldId, values]) => {
                if (!Array.isArray(values)) return acc;
                const keys = values
                  .filter((value): value is string => typeof value === "string")
                  .filter(Boolean);
                if (keys.length > 0) acc[fieldId] = keys;
                return acc;
              },
              {}
            )
          : {};
      const carryBagLocation =
        typeof carryoverSnapshot?.bagLocation === "string" ? carryoverSnapshot.bagLocation.trim() : "";
      const matchedBagOption = carryBagLocation && options.includes(carryBagLocation) ? carryBagLocation : "";
      const carryNotes = Array.isArray(carryoverSnapshot?.missedTaskNotes)
        ? carryoverSnapshot.missedTaskNotes
            .filter((value: unknown): value is string => typeof value === "string")
            .map((value: string) => value.trim())
            .filter(Boolean)
        : [];

      setFormData(carryFormData);
      setUploads(carryUploads);
      syncLaundryReadyFromOutcome(
        (carryoverSnapshot?.laundryOutcome as LaundryOutcome | undefined) ??
          (carryoverSnapshot?.laundryReady === true ? "READY_FOR_PICKUP" : null)
      );
      setLaundrySkipReasonCode(
        typeof carryoverSnapshot?.laundrySkipReasonCode === "string" && carryoverSnapshot.laundrySkipReasonCode
          ? carryoverSnapshot.laundrySkipReasonCode
          : "LINEN_STILL_WASHING"
      );
      setLaundrySkipReasonNote(
        typeof carryoverSnapshot?.laundrySkipReasonNote === "string"
          ? carryoverSnapshot.laundrySkipReasonNote
          : ""
      );
      setBagLocationSelection(
        matchedBagOption
          ? matchedBagOption
          : carryBagLocation
            ? "__custom"
            : options[0] ?? "__custom"
      );
      setBagLocationCustom(matchedBagOption ? "" : carryBagLocation);
      setStep(
        body?.timeState?.isRunning
          ? "checklist"
          : carryoverSnapshot
            ? "checklist"
            : "briefing"
      );
      setVerificationDate(body?.startVerification?.expectedDate ?? "");
      setConfirmOnSite(false);
      setConfirmChecklist(false);
      setResolvedCarryForwardIds(
        Array.isArray(carryoverSnapshot?.resolvedCarryForwardIds)
          ? carryoverSnapshot.resolvedCarryForwardIds
              .filter((value: unknown): value is string => typeof value === "string")
              .filter(Boolean)
          : []
      );
      setHasMissedTask(carryoverSnapshot?.hasMissedTask === true);
      setShowRescheduleForm(false);
      setExtraPaymentRequired(carryoverSnapshot?.extraPaymentRequired === true);
      setDamageFound(carryoverSnapshot?.damageFound === true);
      setApprovalTitle(typeof carryoverSnapshot?.approvalTitle === "string" ? carryoverSnapshot.approvalTitle : "");
      setApprovalDescription(
        typeof carryoverSnapshot?.approvalDescription === "string" ? carryoverSnapshot.approvalDescription : ""
      );
      setApprovalType(carryoverSnapshot?.approvalType === "HOURLY" ? "HOURLY" : "FIXED");
      setApprovalHours(typeof carryoverSnapshot?.approvalHours === "string" ? carryoverSnapshot.approvalHours : "1");
      setApprovalRate(typeof carryoverSnapshot?.approvalRate === "string" ? carryoverSnapshot.approvalRate : "");
      setApprovalAmount(
        typeof carryoverSnapshot?.approvalAmount === "string" ? carryoverSnapshot.approvalAmount : "0"
      );
      setDamageTitle(typeof carryoverSnapshot?.damageTitle === "string" ? carryoverSnapshot.damageTitle : "");
      setDamageArea(typeof carryoverSnapshot?.damageArea === "string" ? carryoverSnapshot.damageArea : "");
      setDamageSeverity(normalizeDamageSeverity(carryoverSnapshot?.damageSeverity));
      setDamageDescription(
        typeof carryoverSnapshot?.damageDescription === "string" ? carryoverSnapshot.damageDescription : ""
      );
      setDamageEstimatedCost(
        typeof carryoverSnapshot?.damageEstimatedCost === "string" ? carryoverSnapshot.damageEstimatedCost : "0"
      );
      setDamageItems(sanitizeDamageItems(carryoverSnapshot?.damageItems));
      setPayRequestItems(sanitizePayRequestItems(carryoverSnapshot?.payRequestItems));
      setEditingDamageId(null);
      setEditingPayRequestId(null);
      setSavedLaundryUpdate(null);
      setLastLaundrySubmittedAt(null);
      setLaundryUpdateCollapsed(false);
      setMissedTaskNotes(carryNotes.length > 0 ? carryNotes : [""]);
      if (carryoverSnapshot && !carryoverNoticeShownRef.current) {
        carryoverNoticeShownRef.current = true;
        showPopupNotification(
          "Progress restored",
          "Checklist and uploads from the previous cleaner were carried over."
        );
      }
    }
    if (!draft && !carryoverSnapshot && body?.laundryState) {
      const persistedState = body.laundryState;
      let persistedOutcome: LaundryOutcome | null = null;
      if (persistedState.status === "CONFIRMED") {
        persistedOutcome = "READY_FOR_PICKUP";
      } else if (persistedState.status === "SKIPPED_PICKUP") {
        persistedOutcome = "NO_PICKUP_REQUIRED";
      } else if (persistedState.status === "FLAGGED") {
        persistedOutcome = "NOT_READY";
      }
      syncLaundryReadyFromOutcome(persistedOutcome);
      if (typeof persistedState.skipReasonCode === "string" && persistedState.skipReasonCode) {
        setLaundrySkipReasonCode(persistedState.skipReasonCode);
      }
      if (typeof persistedState.skipReasonNote === "string") {
        setLaundrySkipReasonNote(persistedState.skipReasonNote);
      }
      const persistedBagLocation = persistedState.latestConfirmation?.bagLocation;
      if (typeof persistedBagLocation === "string" && persistedBagLocation.trim()) {
        const trimmedLocation = persistedBagLocation.trim();
        const matchedOption = options.includes(trimmedLocation) ? trimmedLocation : null;
        setBagLocationSelection(matchedOption ?? "__custom");
        setBagLocationCustom(matchedOption ? "" : trimmedLocation);
      }
      const persistedSubmittedAt =
        body?.laundryState?.latestConfirmation?.createdAt ??
        body?.laundryState?.updatedAt ??
        null;
      const persistedUpdate =
        persistedOutcome && typeof persistedSubmittedAt === "string"
          ? {
              outcome: persistedOutcome,
              submittedAt: persistedSubmittedAt,
              bagLocation:
                persistedOutcome === "READY_FOR_PICKUP" ? persistedState.latestConfirmation?.bagLocation ?? undefined : undefined,
              skipReasonCode:
                persistedOutcome !== "READY_FOR_PICKUP" ? persistedState.skipReasonCode ?? undefined : undefined,
              skipReasonNote:
                persistedOutcome !== "READY_FOR_PICKUP" ? persistedState.skipReasonNote ?? undefined : undefined,
            }
          : null;
      setSavedLaundryUpdate(persistedUpdate);
      setLaundryUpdateCollapsed(Boolean(persistedUpdate));
      setLastLaundrySubmittedAt(persistedSubmittedAt);
    } else if (!draft && !carryoverSnapshot) {
      setSavedLaundryUpdate(null);
      setLastLaundrySubmittedAt(null);
      setLaundryUpdateCollapsed(false);
    }
    if (!finishedState) {
      const sharedDraft = await fetchSharedDraftState().catch(() => null);
      const localDraftUpdatedAt = typeof draft?.updatedAt === "string" ? draft.updatedAt : null;
      if (sharedDraft && sharedDraft.editorSessionId !== editorSessionIdRef.current) {
        if (shouldDiscardLocalDraft(sharedDraft.state, body)) {
          void clearSharedDraftState();
        } else if (!localDraftUpdatedAt || sharedDraft.updatedAt > localDraftUpdatedAt) {
          applyDraftSnapshot(
            {
              ...sharedDraft.state,
              updatedAt: sharedDraft.updatedAt,
            },
            {
              bagLocationOptions: options,
              fallbackStep: body?.timeState?.isRunning ? "checklist" : "briefing",
              expectedDate: body?.startVerification?.expectedDate ?? "",
            }
          );
          if (typeof window !== "undefined") {
            window.localStorage.setItem(
              `cleaner-job-draft:${jobId}`,
              JSON.stringify({
                ...sharedDraft.state,
                updatedAt: sharedDraft.updatedAt,
              })
            );
          }
        }
      }
    }
    startTimerFromState(body?.timeState?.completedSeconds ?? 0, body?.timeState?.activeStartedAt ?? null);
    const continuationRes = await fetch(`/api/cleaner/jobs/${jobId}/reschedule-request`, { cache: "no-store" });
    const continuationBody = await continuationRes.json().catch(() => []);
    if (continuationRes.ok) {
      setRescheduleRequests(Array.isArray(continuationBody) ? continuationBody : []);
    }
    const earlyCheckoutRes = await fetch(`/api/cleaner/jobs/${jobId}/early-checkout-requests`, { cache: "no-store" });
    const earlyCheckoutBody = await earlyCheckoutRes.json().catch(() => []);
    if (earlyCheckoutRes.ok) {
      setEarlyCheckoutRequests(Array.isArray(earlyCheckoutBody) ? earlyCheckoutBody : []);
    }
    if (finishedState) clearDraftState();
    if (finishedState) clearPendingSubmission();
    if (finishedState) void clearSharedDraftState();
    // Keep ops live-tracking alive for the whole active window: while driving
    // (EN_ROUTE, not paused/arrived) AND while the clean is underway
    // (IN_PROGRESS). Previously tracking stopped at arrival, so on-site cleaners
    // dropped off the ops map after the 10-minute stale-ping window.
    const liveStatus = body?.job?.status;
    const shouldTrack =
      (liveStatus === "EN_ROUTE" && !body?.job?.drivingPausedAt && !body?.job?.arrivedAt) ||
      liveStatus === "IN_PROGRESS";
    if (shouldTrack && watchIdRef.current == null) {
      startLocationTracking();
    }
    if (!shouldTrack && watchIdRef.current != null) {
      stopLocationTracking();
    }
    hydratedRef.current = true;
  }

  async function respondToTimingRequest(requestId: string, decision: "APPROVE" | "DECLINE") {
    const res = await fetch(`/api/cleaner/job-early-checkouts/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({
        title: "Could not update timing request",
        description: body.error ?? "Please retry.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: decision === "APPROVE" ? "Timing update approved" : "Timing update declined" });
    await load();
  }

  async function handleAssignmentResponse(action: "ACCEPT" | "DECLINE" | "TRANSFER") {
    if (action === "TRANSFER" && !transferCleanerId) {
      toast({
        title: "Choose a cleaner",
        description: "Select the cleaner you want to transfer this job to.",
        variant: "destructive",
      });
      return;
    }

    setAssignmentActionLoading(action);
    const res = await fetch(`/api/cleaner/jobs/${jobId}/assignment-response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        note: assignmentNote.trim() || undefined,
        targetCleanerId: action === "TRANSFER" ? transferCleanerId : undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setAssignmentActionLoading(null);
    if (!res.ok) {
      toast({
        title: "Could not update assignment",
        description: body.error ?? "Please retry.",
        variant: "destructive",
      });
      return;
    }

    setAssignmentNote("");
    setTransferCleanerId("");
    setShowTransferForm(false);
    toast({
      title:
        action === "ACCEPT"
          ? "Job accepted"
          : action === "DECLINE"
            ? "Job declined"
            : "Transfer sent",
      description:
        action === "TRANSFER"
          ? "The new cleaner now needs to confirm the job."
          : undefined,
    });
    await load();
  }

  useEffect(() => {
    load();
    return () => {
      stopTicking();
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // While en-route tracking is active: flush queued pings when connectivity
  // returns, fire a final beacon ping on page hide, and tick the "last ping
  // sent Xs ago" display every 5s.
  useEffect(() => {
    if (!trackingActive) return;

    const onOnline = () => {
      void flushQueuedPings();
    };
    const onPageHide = () => {
      sendFinalPingBeacon();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") sendFinalPingBeacon();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const clockId = window.setInterval(() => setPingClock(Date.now()), 5000);

    // Heartbeat: re-send the last known fix every 60s. watchPosition can go quiet
    // when the cleaner is stationary on-site, so this guarantees a fresh ping lands
    // inside the ops map's 10-minute live window for the whole clean.
    const heartbeatId = window.setInterval(() => {
      const fix = lastFixRef.current;
      if (!fix) return;
      pendingPingsRef.current.push({
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        heading: fix.heading,
        speed: fix.speed,
      });
      void flushQueuedPings();
    }, 60_000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(clockId);
      window.clearInterval(heartbeatId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingActive, jobId]);

  // Initialise the Google map with a draggable pin when the cleaner switches the
  // check-in popup to "Adjust" mode. Falls back silently when no maps key is set.
  useEffect(() => {
    if (!gpsCheckinOpen || !gpsCheckinAdjustMode || !gpsCheckinFix) return;
    let cancelled = false;
    (async () => {
      const key = await resolveBrowserMapsKey().catch(() => "");
      if (!key) return;
      await ensureGoogleMaps().catch(() => {});
      if (cancelled) return;
      const w = window as any;
      const container = gpsMapRef.current;
      if (!w.google?.maps || !container) return;
      const center = { lat: gpsCheckinFix.lat, lng: gpsCheckinFix.lng };
      const map = new w.google.maps.Map(container, {
        center,
        zoom: 18,
        disableDefaultUI: true,
        zoomControl: true,
      });
      const marker = new w.google.maps.Marker({
        position: center,
        map,
        draggable: true,
      });
      marker.addListener("dragend", () => {
        const pos = marker.getPosition();
        if (!pos) return;
        setGpsCheckinFix((prev) =>
          prev ? { ...prev, lat: pos.lat(), lng: pos.lng(), adjusted: true } : prev
        );
      });
      map.addListener("click", (event: any) => {
        if (!event?.latLng) return;
        marker.setPosition(event.latLng);
        setGpsCheckinFix((prev) =>
          prev ? { ...prev, lat: event.latLng.lat(), lng: event.latLng.lng(), adjusted: true } : prev
        );
      });
      gpsMapInstanceRef.current = map;
      gpsMarkerRef.current = marker;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsCheckinOpen, gpsCheckinAdjustMode]);

  useEffect(() => {
    if (!hydratedRef.current || !payload?.job) return;
    if (Date.now() < suppressDraftSyncUntilRef.current) return;
    const finishedState = ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"].includes(payload.job.status ?? "");
    if (finishedState) {
      clearDraftState();
      void clearSharedDraftState();
      return;
    }
    if (typeof window === "undefined") return;
    const snapshot = buildDraftSnapshot();
    window.localStorage.setItem(
      `cleaner-job-draft:${jobId}`,
      JSON.stringify(snapshot)
    );
  }, [
    bagLocationCustom,
    bagLocationSelection,
    confirmChecklist,
    confirmOnSite,
    damageArea,
    damageSeverity,
    damageDescription,
    damageEstimatedCost,
    damageItems,
    payRequestItems,
    formData,
    hasMissedTask,
    jobId,
    damageFound,
    damageTitle,
    extraPaymentRequired,
    approvalAmount,
    approvalDescription,
    approvalHours,
    approvalRate,
    approvalTitle,
    approvalType,
    laundryOutcome,
    laundrySkipReasonCode,
    laundrySkipReasonNote,
    savedLaundryUpdate,
    lastLaundrySubmittedAt,
    laundryUpdateCollapsed,
    missedTaskNotes,
    payload,
    resolvedCarryForwardIds,
    showRescheduleForm,
    step,
    uploads,
    verificationDate,
  ]);

  useEffect(() => {
    if (!hydratedRef.current || !payload?.job) return;
    if (Date.now() < suppressDraftSyncUntilRef.current) return;
    const finishedState = ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"].includes(payload.job.status ?? "");
    if (finishedState) return;

    const timer = window.setTimeout(() => {
      const snapshot = buildDraftSnapshot();
      void persistSharedDraftState(snapshot);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [
    approvalAmount,
    approvalDescription,
    approvalHours,
    approvalRate,
    approvalTitle,
    approvalType,
    bagLocationCustom,
    bagLocationSelection,
    confirmChecklist,
    confirmOnSite,
    damageArea,
    damageSeverity,
    damageDescription,
    damageEstimatedCost,
    damageItems,
    payRequestItems,
    damageFound,
    damageTitle,
    extraPaymentRequired,
    formData,
    hasMissedTask,
    jobId,
    lastLaundrySubmittedAt,
    laundryOutcome,
    laundrySkipReasonCode,
    laundrySkipReasonNote,
    laundryUpdateCollapsed,
    missedTaskNotes,
    payload?.job?.status,
    resolvedCarryForwardIds,
    savedLaundryUpdate,
    showRescheduleForm,
    step,
    uploads,
    verificationDate,
  ]);

  useEffect(() => {
    if (!hydratedRef.current || !payload?.job) return;
    const finishedState = ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"].includes(payload.job.status ?? "");
    if (finishedState) return;

    let cancelled = false;

    async function pollSharedDraft() {
      const draft = await fetchSharedDraftState();
      if (cancelled || !draft) return;
      if (draft.editorSessionId === editorSessionIdRef.current) {
        if (draft.updatedAt) lastKnownSharedDraftAtRef.current = draft.updatedAt;
        return;
      }
      if (lastKnownSharedDraftAtRef.current && draft.updatedAt <= lastKnownSharedDraftAtRef.current) return;
      if (shouldDiscardLocalDraft(draft.state, payload)) {
        void clearSharedDraftState();
        return;
      }

      applyDraftSnapshot(
        {
          ...draft.state,
          updatedAt: draft.updatedAt,
        },
        {
          bagLocationOptions: Array.isArray(payload?.laundryBagLocationOptions) ? payload.laundryBagLocationOptions : [],
          fallbackStep: payload?.timeState?.isRunning ? "checklist" : "briefing",
          expectedDate: payload?.startVerification?.expectedDate ?? "",
        }
      );

      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          `cleaner-job-draft:${jobId}`,
          JSON.stringify({
            ...draft.state,
            updatedAt: draft.updatedAt,
          })
        );
      }

      showPopupNotification(
        "Form updated live",
        `${draft.updatedByName || "Another cleaner"} updated this form.`
      );
    }

    void pollSharedDraft();
    const interval = window.setInterval(() => {
      void pollSharedDraft();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [jobId, payload]);

  useEffect(() => {
    async function syncPending() {
      const queued = readPendingSubmission();
      if (!queued) return;
      if (!navigator.onLine) return;
      setSubmitting(true);
      const ok = await submitPayload(queued, true);
      setSubmitting(false);
      if (ok) {
        clearPendingSubmission();
      }
    }
    syncPending();
    function onOnline() {
      syncPending();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, payload?.job?.status]);

  useEffect(() => {
    const keys = Array.from(
      new Set(
        Object.values(uploads)
          .flat()
          .filter((key): key is string => typeof key === "string" && key.length > 0)
      )
    ).filter((key) => isImageFileName(key) && !uploadPreviewUrls[key]);

    if (keys.length === 0) return;
    let cancelled = false;

    async function hydratePreviews() {
      for (const key of keys.slice(0, 60)) {
        try {
          const url = await fetchPreviewUrlForKey(key);
          if (cancelled) return;
          setUploadPreviewUrls((prev) => {
            if (prev[key]) return prev;
            return { ...prev, [key]: url };
          });
        } catch {
          // Ignore preview failures; user can still remove or continue submission.
        }
      }
    }

    hydratePreviews();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploads, jobId]);

  const job = payload?.job;
  const template = payload?.template;
  const startVerification = payload?.startVerification;
  const sections: any[] = template?.schema?.sections ?? [];
  const property = (job?.property ?? {}) as Record<string, unknown>;
  const inventoryStock: Array<any> = Array.isArray(payload?.inventoryStock) ? payload.inventoryStock : [];
  const bagLocationOptions: string[] = Array.isArray(payload?.laundryBagLocationOptions)
    ? payload.laundryBagLocationOptions
    : [];
  const hasContinuationCarryover = Boolean(payload?.continuationProgressSnapshot);
  const jobTimingHighlights: string[] = Array.isArray(payload?.jobTimingHighlights)
    ? payload.jobTimingHighlights.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const cleanerInstructionText =
    typeof payload?.jobMeta?.internalNoteText === "string" ? payload.jobMeta.internalNoteText.trim() : "";
  const cleanerTags: string[] = Array.isArray(payload?.jobMeta?.tags)
    ? payload.jobMeta.tags.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const hasJobNotes = Boolean(typeof job?.notes === "string" && job.notes.trim().length > 0);
  const unifiedJobTasks: Array<any> = Array.isArray(payload?.jobTasks)
    ? payload.jobTasks.filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
  const hasUnifiedAdminTasks = unifiedJobTasks.some((task) => task.source === "ADMIN");
  const hasUnifiedCarryForwardTasks = unifiedJobTasks.some((task) => task.source === "CARRY_FORWARD");
  const specialRequestTasks: JobSpecialRequestTask[] =
    hasUnifiedAdminTasks
      ? []
      : Array.isArray(payload?.jobMeta?.specialRequestTasks)
    ? payload.jobMeta.specialRequestTasks
        .filter((item: unknown): item is JobSpecialRequestTask => !!item && typeof item === "object")
        .filter((task: JobSpecialRequestTask) => typeof task.title === "string" && task.title.trim().length > 0)
      : [];
  const serviceContext = payload?.jobMeta?.serviceContext ?? {};
  const reservationContext = payload?.jobMeta?.reservationContext ?? {};
  const hasServiceContext =
    Boolean(serviceContext && typeof serviceContext === "object" && Object.keys(serviceContext).length > 0);
  const hasReservationContext =
    Boolean(reservationContext && typeof reservationContext === "object" && Object.keys(reservationContext).length > 0);
  const preparationGuestCount = Number(reservationContext?.preparationGuestCount ?? 0);
  const preparationSource = reservationContext?.preparationSource ?? "INCOMING_BOOKING";
  const carryForwardTasks: Array<any> =
    hasUnifiedCarryForwardTasks || !Array.isArray(payload?.carryForwardTasks) ? [] : payload.carryForwardTasks;
  const canUseSelectAll = Boolean(payload?.canUseSelectAll);
  const sectionsWithAutoInventory = useMemo(() => {
    const baseSections = Array.isArray(sections)
      ? sections.map((section) => ({
          ...section,
          fields: Array.isArray(section?.fields) ? [...section.fields] : [],
        }))
      : [];

    if (!job?.property?.inventoryEnabled) return baseSections;

    const hasCupboardStock = inventoryStock.some(
      (stock) => normalizeInventoryLocation(stock?.item?.location) === "CLEANERS_CUPBOARD"
    );
    if (!hasCupboardStock) return baseSections;

    const hasCupboardInventoryField = baseSections.some((section: any) =>
      (section?.fields ?? []).some((field: any) => {
        if (field?.type !== "inventory") return false;
        if (field?.location && normalizeInventoryLocation(field.location) === "CLEANERS_CUPBOARD") return true;
        if (section?.location && normalizeInventoryLocation(section.location) === "CLEANERS_CUPBOARD") return true;
        return (
          inferLocationFromText(field?.label) === "CLEANERS_CUPBOARD" ||
          inferLocationFromText(field?.id) === "CLEANERS_CUPBOARD" ||
          inferLocationFromText(section?.label) === "CLEANERS_CUPBOARD" ||
          inferLocationFromText(section?.id) === "CLEANERS_CUPBOARD"
        );
      })
    );

    if (hasCupboardInventoryField) return baseSections;

    baseSections.push({
      id: "__auto_inventory_other",
      label: "Other Inventory",
      page: "checklist",
      fields: [
        {
          id: "__auto_inventory_cleaners_cupboard",
          type: "inventory",
          label: "Cleaners cupboard supplies used",
          location: "CLEANERS_CUPBOARD",
          inventoryUsage: true,
        },
      ],
    });
    return baseSections;
  }, [sections, job?.property?.inventoryEnabled, inventoryStock]);

  const visibleSections = useMemo(
    () =>
      sectionsWithAutoInventory
        .filter((section) => isSectionVisible(section, formData, property))
        .map((section) => ({
          ...section,
          // Sub-fields (children) are flattened inline after their parent;
          // a child is visible only when the parent is visible too.
          fields: flattenFieldsOneLevel(section.fields ?? [])
            .filter((field: any) => isFlattenedFieldVisible(field, formData, property))
            .map((field: any) => ({
              ...field,
              _resolvedStep: resolveFieldStep(field, section),
            })),
        })),
    [sectionsWithAutoInventory, formData, property]
  );

  const checklistSections = useMemo(
    () =>
      visibleSections
        .map((section: any) => ({
          ...section,
          fields: (section.fields ?? []).filter(
            (field: any) => field._resolvedStep === "checklist" && !isUploadFieldType(field.type)
          ),
        }))
        .filter((section: any) => (section.fields?.length ?? 0) > 0),
    [visibleSections]
  );

  const uploadFields = useMemo(() => {
    const all = visibleSections
      .flatMap((section) =>
        (section.fields ?? [])
          .filter((field: any) => field._resolvedStep === "uploads" && isUploadFieldType(field.type))
          .map((field: any) => ({ ...field, sectionLabel: section.label }))
      );
    return all.filter(
      (field: any, index: number, arr: any[]) => arr.findIndex((x: any) => x.id === field.id) === index
    );
  }, [visibleSections]);

  const laundryFields = useMemo(() => {
    const all = visibleSections
      .flatMap((section) =>
        (section.fields ?? [])
          .filter((field: any) => field._resolvedStep === "laundry")
          .map((field: any) => ({ ...field, sectionLabel: section.label, _section: section }))
      );
    return all.filter(
      (field: any, index: number, arr: any[]) => arr.findIndex((x: any) => x.id === field.id) === index
    );
  }, [visibleSections]);

  const laundryUploadFields = useMemo(
    () => laundryFields.filter((field: any) => isUploadFieldType(field.type)),
    [laundryFields]
  );

  const laundryNonUploadFields = useMemo(
    () => laundryFields.filter((field: any) => !isUploadFieldType(field.type)),
    [laundryFields]
  );

  const laundryUploadField = useMemo(
    () =>
      laundryUploadFields.find((field: any) => String(field.id ?? "").toLowerCase() === "laundry_photo") ??
      laundryUploadFields.find(
        (field: any) =>
          /laundry/i.test(String(field.id ?? "")) || /laundry/i.test(String(field.label ?? ""))
      ),
    [laundryUploadFields]
  );

  const checklistUploadFields = uploadFields;

  const submitFields = useMemo(() => {
    const all = visibleSections
      .flatMap((section) =>
        (section.fields ?? [])
          .filter((field: any) => field._resolvedStep === "submit" && !isUploadFieldType(field.type))
          .map((field: any) => ({ ...field, sectionLabel: section.label, _section: section }))
      );
    return all.filter(
      (field: any, index: number, arr: any[]) => arr.findIndex((x: any) => x.id === field.id) === index
    );
  }, [visibleSections]);

  // Ordered queue of every photo requirement across the form, driving the
  // full-screen guided capture flow ("Inside the fridge" → shoot → auto-next).
  const guidedCaptureItems = useMemo<GuidedCaptureItem[]>(() => {
    const items = visibleSections.flatMap((section: any) =>
      (section.fields ?? [])
        .filter((field: any) => {
          const type = String(field?.type ?? "").toLowerCase();
          return (type === "photo" || type === "upload") && field?.id;
        })
        .map((field: any) => ({
          fieldId: String(field.id),
          label: typeof field.label === "string" && field.label.trim() ? field.label.trim() : String(field.id),
          sectionLabel:
            typeof section.label === "string" && section.label.trim()
              ? section.label.trim()
              : typeof section.title === "string"
                ? section.title.trim()
                : undefined,
          description: typeof field.helpText === "string" ? field.helpText : undefined,
          locationTag: typeof field.locationTag === "string" ? field.locationTag : undefined,
          minPhotos: typeof field.minPhotos === "number" ? field.minPhotos : field.required ? 1 : 0,
          maxFiles: typeof field.maxFiles === "number" ? field.maxFiles : undefined,
        }))
    );
    return items.filter(
      (item: GuidedCaptureItem, index: number, arr: GuidedCaptureItem[]) =>
        arr.findIndex((x) => x.fieldId === item.fieldId) === index
    );
  }, [visibleSections]);

  const guidedCaptureCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of guidedCaptureItems) {
      const uploaded = uploads[item.fieldId]?.length ?? 0;
      const pending = (uploadStates[item.fieldId] ?? []).filter(
        (s) => s.status === "queued" || s.status === "uploading"
      ).length;
      counts[item.fieldId] = uploaded + pending;
    }
    return counts;
  }, [guidedCaptureItems, uploads, uploadStates]);

  const guidedCapturePending = useMemo(() => {
    const pending: Record<string, number> = {};
    for (const item of guidedCaptureItems) {
      pending[item.fieldId] = (uploadStates[item.fieldId] ?? []).filter(
        (s) => s.status === "queued" || s.status === "uploading"
      ).length;
    }
    return pending;
  }, [guidedCaptureItems, uploadStates]);

  const guidedCaptureThumbnails = useMemo(() => {
    const thumbs: Record<string, string[]> = {};
    for (const item of guidedCaptureItems) {
      thumbs[item.fieldId] = (uploads[item.fieldId] ?? [])
        .filter((key) => isImageFileName(key))
        .map((key) => uploadPreviewUrls[key])
        .filter(Boolean);
    }
    return thumbs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidedCaptureItems, uploads, uploadPreviewUrls]);

  const progressFields = useMemo(
    () =>
      visibleSections.flatMap((section: any) =>
        (section.fields ?? []).filter((field: any) => !isUploadFieldType(field.type))
      ),
    [visibleSections]
  );
  const totalFields = progressFields.length;
  const filledFields = progressFields.filter((field: any) => {
    const value = formData[field.id];
    if (field.type === "checkbox") return value === true;
    if (field.type === "number") {
      const numeric = Number(value);
      return Number.isFinite(numeric);
    }
    return value !== undefined && value !== null && String(value).trim().length > 0;
  }).length;
  const progress = totalFields > 0 ? Math.round((filledFields / totalFields) * 100) : 0;
  const uploadedCount = Object.values(uploads).reduce((sum, keys) => sum + keys.length, 0);
  const bagLocation = bagLocationSelection === "__custom" ? bagLocationCustom : bagLocationSelection;
  const laundryPhotoKey =
    uploads.laundry_photo?.[0] ??
    (laundryUploadField?.id ? uploads[laundryUploadField.id]?.[0] : undefined);
  const laundryReady = laundryOutcome === "READY_FOR_PICKUP";
  const laundryOutcomeLabel = laundryOutcome ? formatLaundryOutcomeLabelValue(laundryOutcome) : "No update selected";
  const savedLaundryUpdateSummary = buildLaundryUpdateSummary(savedLaundryUpdate);
  const timeReview = useMemo(() => {
    const maxAllowedTotalSecondsRaw = payload?.timeState?.maxAllowedTotalSeconds;
    const maxAllowedTotalSeconds =
      typeof maxAllowedTotalSecondsRaw === "number" && Number.isFinite(maxAllowedTotalSecondsRaw)
        ? maxAllowedTotalSecondsRaw
        : null;
    const proposedTotalSeconds =
      maxAllowedTotalSeconds != null ? Math.min(elapsed, maxAllowedTotalSeconds) : elapsed;
    const currentMinutes = Math.max(1, Math.round(elapsed / 60));
    const proposedMinutes = Math.max(1, Math.round(proposedTotalSeconds / 60));
    return {
      isRunning: Boolean(payload?.timeState?.isRunning),
      activeTimeLogId:
        typeof payload?.timeState?.activeTimeLogId === "string"
          ? payload.timeState.activeTimeLogId
          : null,
      limitSource:
        typeof payload?.timeState?.limitSource === "string"
          ? payload.timeState.limitSource
          : null,
      suggestedStoppedAt:
        typeof payload?.timeState?.suggestedStoppedAt === "string"
          ? payload.timeState.suggestedStoppedAt
          : null,
      exceedsAllowedDuration: Boolean(payload?.timeState?.exceedsAllowedDuration),
      currentMinutes,
      proposedMinutes,
      currentSeconds: elapsed,
      proposedSeconds: proposedTotalSeconds,
    };
  }, [elapsed, payload]);

  function toggleResolvedTask(taskId: string, checked: boolean) {
    setResolvedCarryForwardIds((prev) => {
      if (checked) return Array.from(new Set([...prev, taskId]));
      return prev.filter((id) => id !== taskId);
    });
  }

  function selectAllChecklistItems() {
    const updates: Record<string, any> = {};
    for (const section of checklistSections) {
      for (const field of section.fields ?? []) {
        if (field.type === "checkbox") {
          updates[field.id] = true;
        }
      }
    }
    setFormData((prev) => ({ ...prev, ...updates }));
    toast({ title: "Checklist selected", description: "All standard checklist checkboxes marked." });
  }

  function updateMissedTaskNote(index: number, value: string) {
    setMissedTaskNotes((prev) => prev.map((note, noteIndex) => (noteIndex === index ? value : note)));
  }

  function addMissedTaskNote() {
    setMissedTaskNotes((prev) => [...prev, ""]);
  }

  function removeMissedTaskNote(index: number) {
    setMissedTaskNotes((prev) => {
      const next = prev.filter((_, noteIndex) => noteIndex !== index);
      return next.length > 0 ? next : [""];
    });
  }

  function resetClockReviewState() {
    setClockReviewOpen(false);
    setRequestClockAdjustment(false);
    setClockAdjustmentMinutes("");
    setClockAdjustmentReason("");
    setPendingSubmitPayload(null);
  }

  // Check-in capture: get a fix, then show the cleaner a confirm/adjust popup
  // before recording. The popup posts the (possibly adjusted) coordinates.
  async function beginGpsCheckin() {
    try {
      const fix = await getAccuratePosition();
      setGpsCheckinFix({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, adjusted: false });
      setGpsCheckinNote("");
      setGpsCheckinAdjustMode(false);
      setGpsCheckinOpen(true);
    } catch (error) {
      if (error instanceof GpsError && error.code === "PERMISSION_DENIED") {
        showPopupNotification("Location blocked", error.message, "destructive");
      }
      // Other GPS failures stay silent — GPS logging is advisory only.
    }
  }

  async function submitGpsCheckin(confirmed: boolean) {
    if (!gpsCheckinFix) return;
    setGpsCheckinSaving(true);
    try {
      const res = await fetch(`/api/cleaner/jobs/${params.id}/gps-checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: gpsCheckinFix.lat,
          lng: gpsCheckinFix.lng,
          accuracy: gpsCheckinFix.accuracy,
          confirmed,
          adjusted: gpsCheckinFix.adjusted,
          note: gpsCheckinNote.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showPopupNotification("Check-in failed", body?.error ?? "Could not record check-in.", "destructive");
        return;
      }
      const accuracyLabel = formatAccuracy(gpsCheckinFix.accuracy);
      if (gpsCheckinFix.adjusted) {
        showPopupNotification("Check-in adjusted", "Your corrected location was recorded and admin was notified.");
      } else if (typeof body?.distanceMeters === "number" && body.distanceMeters >= 500) {
        showPopupNotification(
          "Check-in recorded",
          `You appear to be ${body.distanceMeters}m from the property (${accuracyLabel}).`,
          "destructive"
        );
      } else {
        showPopupNotification("Check-in recorded", `Location confirmed (${accuracyLabel}).`);
      }
      setGpsCheckinOpen(false);
    } finally {
      setGpsCheckinSaving(false);
    }
  }

  async function sendGpsSnapshot(path: string, kind: "check-in" | "check-out" = "check-in") {
    try {
      const fix = await getAccuratePosition();
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return;
      const accuracyLabel = formatAccuracy(fix.accuracy);
      const poorAccuracy = fix.accuracy != null && fix.accuracy > POOR_ACCURACY_M;
      if (poorAccuracy) {
        // Still recorded, but a coarse fix makes the distance meaningless —
        // say so instead of alarming the cleaner with a wrong distance.
        showPopupNotification(
          `GPS ${kind} recorded (low accuracy)`,
          `Location fix is only ${accuracyLabel}, so the distance to the property may be unreliable. Enable "Precise location" for your browser to improve this.`,
          "destructive"
        );
      } else if (typeof body?.distanceMeters === "number" && body.distanceMeters >= 500) {
        showPopupNotification(
          `GPS ${kind} recorded`,
          `You appear to be ${body.distanceMeters}m from the property (${accuracyLabel}). ${kind === "check-in" ? "Check-in" : "Check-out"} recorded.`,
          "destructive"
        );
      } else {
        showPopupNotification(`GPS ${kind} recorded`, `Location recorded (${accuracyLabel}).`);
      }
    } catch (error) {
      if (error instanceof GpsError && error.code === "PERMISSION_DENIED") {
        showPopupNotification("Location blocked", error.message, "destructive");
      }
      // Other GPS failures stay silent — GPS logging is advisory only.
    }
  }

  const PING_MIN_INTERVAL_MS = 20_000;
  const PING_MIN_MOVE_METERS = 50;
  const PING_QUEUE_LIMIT = 30;

  async function flushQueuedPings() {
    if (flushingPingsRef.current) return;
    const queue = pendingPingsRef.current;
    if (queue.length === 0) return;
    flushingPingsRef.current = true;
    try {
      while (queue.length > 0) {
        const next = queue[0];
        const res = await fetch(`/api/cleaner/jobs/${jobId}/location-ping`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-progress-toast": "off" },
          body: JSON.stringify(next),
        });
        if (!res.ok) {
          // 400 = job no longer en route — drop the queue; anything else
          // (network blip, 5xx) keeps pings queued for the next flush.
          if (res.status === 400 || res.status === 404) queue.length = 0;
          return;
        }
        queue.shift();
        setLastPingSentAt(Date.now());
        setLastPingAccuracy(typeof next.accuracy === "number" ? next.accuracy : null);
      }
    } catch {
      // Offline — pings stay queued; the `online` listener retries.
    } finally {
      flushingPingsRef.current = false;
    }
  }

  function sendFinalPingBeacon() {
    const fix = lastFixRef.current;
    if (!fix) return;
    const url = `/api/cleaner/jobs/${jobId}/location-ping`;
    const payload = JSON.stringify({
      lat: fix.lat,
      lng: fix.lng,
      accuracy: fix.accuracy,
      heading: fix.heading,
      speed: fix.speed,
    });
    try {
      if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
      } else {
        void fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Best-effort only.
    }
  }

  function startLocationTracking() {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setTrackingError("This device does not support location tracking.");
      return;
    }
    if (watchIdRef.current != null) return; // already watching
    setTrackingError(null);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setTrackingError(null);
        setTrackingActive(true);
        const fix: GpsFix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          heading: pos.coords.heading != null && Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
          speed: pos.coords.speed != null && Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
          timestamp: Date.now(),
        };
        lastFixRef.current = fix;
        // Throttle uploads: one ping per ~20s, or sooner after >=50m movement.
        const lastUpload = lastUploadRef.current;
        const sinceMs = lastUpload ? Date.now() - lastUpload.at : Number.POSITIVE_INFINITY;
        const movedMeters = lastUpload
          ? haversineMeters(lastUpload.lat, lastUpload.lng, fix.lat, fix.lng)
          : Number.POSITIVE_INFINITY;
        if (sinceMs < PING_MIN_INTERVAL_MS && movedMeters < PING_MIN_MOVE_METERS) return;
        lastUploadRef.current = { at: Date.now(), lat: fix.lat, lng: fix.lng };
        pendingPingsRef.current.push({
          lat: fix.lat,
          lng: fix.lng,
          accuracy: fix.accuracy,
          heading: fix.heading,
          speed: fix.speed,
        });
        if (pendingPingsRef.current.length > PING_QUEUE_LIMIT) {
          pendingPingsRef.current.splice(0, pendingPingsRef.current.length - PING_QUEUE_LIMIT);
        }
        void flushQueuedPings();
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setTrackingError(
            "Location access is blocked. Allow location for this site in your browser settings, then tap Retry."
          );
          stopLocationTracking();
        }
        // TIMEOUT / POSITION_UNAVAILABLE are transient — the watch keeps going.
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
    setTrackingActive(true);
  }

  function stopLocationTracking() {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTrackingActive(false);
  }

  async function handleStartDriving() {
    setStartingDriving(true);
    try {
      // Get an accurate current position first for the initial ETA.
      const position = await getAccuratePosition().catch(() => null);

      const res = await fetch(`/api/cleaner/jobs/${jobId}/start-driving`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(position ? { lat: position.lat, lng: position.lng } : {}),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showPopupNotification("Error", body.error ?? "Could not start driving.", "destructive");
        return;
      }

      startLocationTracking();
      await load();
      showPopupNotification("On the way", "Location tracking is now active.", "default");
    } finally {
      setStartingDriving(false);
    }
  }

  async function handleStopDriving() {
    setStoppingDriving(true);
    try {
      sendFinalPingBeacon();
      stopLocationTracking();
      const res = await fetch(`/api/cleaner/jobs/${jobId}/stop-driving`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showPopupNotification("Error", body.error ?? "Could not stop driving.", "destructive");
        return;
      }
      await load();
    } finally {
      setStoppingDriving(false);
    }
  }

  async function handlePauseDriving() {
    const reason = pauseReasonSelect.trim();
    if (!reason) {
      showPopupNotification("Pause reason required", "Add a short reason before pausing driving.", "destructive");
      return;
    }
    setPausingDriving(true);
    try {
      stopLocationTracking();
      const res = await fetch(`/api/cleaner/jobs/${jobId}/pause-driving`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showPopupNotification("Error", body.error ?? "Could not pause driving.", "destructive");
        return;
      }
      await load();
      showPopupNotification("Driving paused", reason);
    } finally {
      setPausingDriving(false);
    }
  }

  async function handleResumeDriving() {
    setResumingDriving(true);
    try {
      const position = await getAccuratePosition().catch(() => null);

      const res = await fetch(`/api/cleaner/jobs/${jobId}/resume-driving`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(position ? { lat: position.lat, lng: position.lng } : {}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showPopupNotification("Error", body.error ?? "Could not resume driving.", "destructive");
        return;
      }
      startLocationTracking();
      setPauseReasonSelect("PETROL_STOP");
      setPauseReasonOther("");
      await load();
      showPopupNotification("Driving resumed", "Live tracking is active again.");
    } finally {
      setResumingDriving(false);
    }
  }

  function handleSetManualEta() {
    const mins = parseInt(manualEta, 10);
    if (!mins || mins < 1) return;
    const ping = Array.isArray(job?.cleanerLocationPings) ? job.cleanerLocationPings[0] : null;
    void (async () => {
      await fetch(`/api/cleaner/jobs/${jobId}/location-ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: ping?.lat ?? 0, lng: ping?.lng ?? 0, manualEtaMinutes: mins }),
      }).catch(() => {});
      await load();
      setManualEta("");
    })();
  }

  async function handleArrivedDriving() {
    setArrivingDriving(true);
    try {
      sendFinalPingBeacon();
      stopLocationTracking();
      const res = await fetch(`/api/cleaner/jobs/${jobId}/arrived-driving`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showPopupNotification("Error", body.error ?? "Could not mark arrival.", "destructive");
        return;
      }
      await load();
      showPopupNotification("Arrived", "Client has been updated.");
    } finally {
      setArrivingDriving(false);
    }
  }

  async function handleMarkDelayed() {
    const reason = delayedReason === "OTHER" ? delayedReasonOther.trim() : delayedReason;
    if (!reason) {
      showPopupNotification("Delay reason required", "Choose or enter a delay reason.", "destructive");
      return;
    }
    setMarkingDelayed(true);
    try {
      const res = await fetch(`/api/cleaner/jobs/${jobId}/mark-delayed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showPopupNotification("Error", body.error ?? "Could not mark delayed.", "destructive");
        return;
      }
      await load();
      showPopupNotification("Delay sent", "The client has been notified of the delay.");
    } finally {
      setMarkingDelayed(false);
    }
  }

  async function handleStart() {
    async function submitStart(allowFutureStart: boolean) {
      const res = await fetch(`/api/cleaner/jobs/${params.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowFutureStart,
        }),
      });
      const body = await res.json().catch(() => ({}));
      return { res, body };
    }

    const firstAttempt = await submitStart(false);
    if (firstAttempt.res.status === 409 && firstAttempt.body?.code === "FUTURE_START_CONFIRMATION_REQUIRED") {
      const confirmMessage =
        `${firstAttempt.body.error ?? "This job is scheduled for a future date."}\n\n` +
        `Scheduled: ${firstAttempt.body?.scheduledDate ?? "N/A"}\n` +
        `Today: ${firstAttempt.body?.todayDate ?? "N/A"}\n\n` +
        "Start anyway?";
      const confirmed = window.confirm(confirmMessage);
      if (!confirmed) return;

      const confirmedAttempt = await submitStart(true);
      if (!confirmedAttempt.res.ok) {
        showPopupNotification(
          "Start failed",
          confirmedAttempt.body?.error ?? "Could not start job.",
          "destructive"
        );
        return;
      }
      await load();
      void beginGpsCheckin();
      showPopupNotification("Job started", "Timer is now running.");
      setStep("checklist");
      return;
    }

    if (firstAttempt.res.status === 409 && firstAttempt.body?.code === "ACTIVE_JOB_IN_PROGRESS") {
      const active = firstAttempt.body?.activeJob;
      showPopupNotification(
        "Another job is already running",
        active?.propertyName
          ? `Pause or complete your active job at ${active.propertyName} first.`
          : "Pause or complete your active job first.",
        "destructive"
      );
      return;
    }

    if (!firstAttempt.res.ok) {
      showPopupNotification(
        "Start failed",
        firstAttempt.body?.error ?? "Could not start job.",
        "destructive"
      );
      return;
    }

    await load();
    void beginGpsCheckin();
    showPopupNotification("Job started", "Timer is now running.");
    setStep("checklist");
  }

  async function handleStop() {
    const res = await fetch(`/api/cleaner/jobs/${params.id}/stop`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      showPopupNotification("Stop failed", body.error ?? "Could not stop timer.", "destructive");
      return;
    }
    await load();
    void sendGpsSnapshot(`/api/cleaner/jobs/${params.id}/gps-checkout`, "check-out");
    setConfirmOnSite(false);
    setConfirmChecklist(false);
    showPopupNotification("Timer stopped", "You can now start another assigned job.");
  }

  const [clockingOutEarly, setClockingOutEarly] = useState(false);
  async function handleClockOutEarly() {
    if (clockingOutEarly) return;
    if (typeof window !== "undefined" && !window.confirm(
      "Clock out and finish the form later?\n\nThe clock will stop, but this job stays open and is NOT counted as completed until you come back and submit the form."
    )) return;
    setClockingOutEarly(true);
    try {
      const res = await fetch(`/api/cleaner/jobs/${params.id}/clock-out-early`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showPopupNotification("Clock-out failed", body.error ?? "Could not clock out.", "destructive");
        return;
      }
      await load();
      void sendGpsSnapshot(`/api/cleaner/jobs/${params.id}/gps-checkout`, "check-out");
      showPopupNotification("Clocked out", "Come back any time to finish the form. This job isn't complete until the form is submitted.");
    } finally {
      setClockingOutEarly(false);
    }
  }

  async function handleSafetyCheckin() {
    setSendingSafetyCheckin(true);
    try {
      const res = await fetch(`/api/cleaner/jobs/${params.id}/safety-checkin`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showPopupNotification(
          "Safety check-in failed",
          body?.error ?? "Could not record safety check-in.",
          "destructive"
        );
        return;
      }
      await load();
      showPopupNotification("Safety check-in recorded", "Admin has your safety confirmation.");
    } finally {
      setSendingSafetyCheckin(false);
    }
  }

  function pushUploadedKeys(fieldId: string, keys: string[]) {
    setUploads((prev) => ({
      ...prev,
      [fieldId]: [...(prev[fieldId] ?? []), ...keys],
    }));
  }

  function createUploadItemId() {
    if (typeof window !== "undefined" && window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function appendUploadItems(fieldId: string, files: File[]) {
    const items: UploadItemState[] = files.map((file) => ({
      id: createUploadItemId(),
      name: file.name,
      progress: 0,
      status: "queued",
    }));
    setUploadStates((prev) => ({
      ...prev,
      [fieldId]: [...(prev[fieldId] ?? []), ...items],
    }));
    return items;
  }

  function updateUploadItem(fieldId: string, itemId: string, patch: Partial<UploadItemState>) {
    setUploadStates((prev) => ({
      ...prev,
      [fieldId]: (prev[fieldId] ?? []).map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    }));
  }

  function renderUploadStatusText(status: UploadItemStatus, progress: number) {
    if (status === "queued") return "Queued";
    if (status === "uploading") return `Uploading ${progress}%`;
    if (status === "uploaded") return "Uploaded";
    return "Failed";
  }

  function isVideoFile(file: File) {
    if (file.type?.toLowerCase().startsWith("video/")) return true;
    return /\.(mp4|mov|m4v|avi|mkv|webm|3gp|mpeg|mpg)$/i.test(file.name ?? "");
  }

  function validateUploadSizes(fileArray: File[]): string | null {
    for (const file of fileArray) {
      if (isVideoFile(file) && file.size > CLIENT_MAX_VIDEO_BYTES) {
        return `Video "${file.name}" is too large. Max 150MB before compression.`;
      }
      if (!isVideoFile(file) && file.size > CLIENT_MAX_IMAGE_BYTES) {
        return `File "${file.name}" is too large. Max 20MB for images.`;
      }
    }
    return null;
  }

  async function uploadViaDirect(file: File, onProgress?: (progress: number) => void): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", `jobs/${params.id}`);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/uploads/direct");
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || !event.total) return;
        onProgress?.(Math.min(99, Math.max(0, Math.round((event.loaded / event.total) * 100))));
      };
      xhr.onerror = () => reject(new Error("Could not upload file."));
      xhr.onload = () => {
        let body: any = {};
        try {
          body = JSON.parse(xhr.responseText || "{}");
        } catch {
          body = {};
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(body.error ?? "Could not upload file."));
          return;
        }
        onProgress?.(100);
        resolve(body.key);
      };
      xhr.send(form);
    });
  }

  async function uploadViaPresign(file: File, onProgress?: (progress: number) => void): Promise<string> {
    const res = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType: file.type, folder: `jobs/${params.id}` }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "Failed to create upload URL");
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", body.uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || !event.total) return;
        onProgress?.(Math.min(99, Math.max(0, Math.round((event.loaded / event.total) * 100))));
      };
      xhr.onerror = () => reject(new Error("Presigned upload failed"));
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error("Presigned upload failed"));
          return;
        }
        onProgress?.(100);
        resolve(body.key);
      };
      xhr.send(file);
    });
  }

  async function uploadOneFile(file: File, onProgress?: (progress: number) => void): Promise<string> {
    if (isVideoFile(file)) {
      return uploadViaDirect(file, onProgress);
    }

    try {
      return await uploadViaPresign(file, onProgress);
    } catch {
      onProgress?.(0);
      return uploadViaDirect(file, onProgress);
    }
  }

  async function uploadFilesForField(fieldId: string, files: FileList | File[], source: UploadSource = "gallery") {
    const originalFiles = Array.from(files);
    const fileArray = await preprocessFilesForUpload(originalFiles, source, fieldId);
    if (fileArray.length === 0) return { uploadedKeys: [] as string[], failedCount: 0 };
    const sizeError = validateUploadSizes(fileArray);
    if (sizeError) {
      toast({ title: "Upload failed", description: sizeError, variant: "destructive" });
      return { uploadedKeys: [] as string[], failedCount: fileArray.length };
    }

    const items = appendUploadItems(fieldId, fileArray);
    const uploadedKeys: string[] = [];
    let failedCount = 0;

    for (let index = 0; index < fileArray.length; index += 1) {
      const file = fileArray[index];
      const itemId = items[index].id;
      updateUploadItem(fieldId, itemId, { status: "uploading", progress: 0, error: undefined });
      try {
        const key = await uploadOneFile(file, (progress) =>
          updateUploadItem(fieldId, itemId, { status: "uploading", progress })
        );
        uploadedKeys.push(key);
        updateUploadItem(fieldId, itemId, { status: "uploaded", progress: 100, key });
      } catch (err: any) {
        failedCount += 1;
        updateUploadItem(fieldId, itemId, {
          status: "failed",
          progress: 0,
          error: err?.message ?? "Could not upload file.",
        });
      }
    }

    return { uploadedKeys, failedCount };
  }

  async function handleUpload(fieldId: string, files: FileList | File[], source: UploadSource = "gallery") {
    const { uploadedKeys, failedCount } = await uploadFilesForField(fieldId, files, source);
    if (uploadedKeys.length > 0) {
      pushUploadedKeys(fieldId, uploadedKeys);
    }
    if (uploadedKeys.length > 0 && failedCount === 0) {
      showPopupNotification("Upload complete", `${uploadedKeys.length} file(s) uploaded.`);
      return { uploadedKeys, failedCount };
    }
    if (uploadedKeys.length > 0 && failedCount > 0) {
      toast({
        title: "Some uploads failed",
        description: `${uploadedKeys.length} uploaded, ${failedCount} failed.`,
        variant: "destructive",
      });
      return { uploadedKeys, failedCount };
    }
    if (failedCount > 0) {
      toast({ title: "Upload failed", description: "No files uploaded.", variant: "destructive" });
    }
    return { uploadedKeys, failedCount };
  }

  async function handleLaundryPhotoUpload(files: FileList | File[], source: UploadSource = "gallery") {
    const { uploadedKeys, failedCount } = await uploadFilesForField("laundry_photo", files, source);
    if (uploadedKeys.length > 0) {
      pushUploadedKeys("laundry_photo", uploadedKeys);
      if (laundryUploadField?.id) {
        pushUploadedKeys(laundryUploadField.id, uploadedKeys);
      }
    }
    if (uploadedKeys.length > 0 && failedCount === 0) {
      showPopupNotification("Upload complete", `${uploadedKeys.length} file(s) uploaded.`);
      return;
    }
    if (uploadedKeys.length > 0 && failedCount > 0) {
      toast({
        title: "Some uploads failed",
        description: `${uploadedKeys.length} uploaded, ${failedCount} failed.`,
        variant: "destructive",
      });
      return;
    }
    if (failedCount > 0) {
      toast({ title: "Upload failed", description: "No files uploaded.", variant: "destructive" });
    }
  }

  function updateInventoryUsage(itemId: string, rawValue: string) {
    const qty = Math.max(0, Number(rawValue || 0));
    setFormData((prev) => ({
      ...prev,
      inventoryUsage: {
        ...(prev.inventoryUsage ?? {}),
        [itemId]: Number.isFinite(qty) ? qty : 0,
      },
    }));
  }

  function adjustInventoryUsage(itemId: string, delta: number) {
    const current = getInventoryValue(itemId);
    const next = Math.max(0, current + delta);
    setFormData((prev) => ({
      ...prev,
      inventoryUsage: {
        ...(prev.inventoryUsage ?? {}),
        [itemId]: next,
      },
    }));
  }

  function resolveInventoryTargetLocations(field: any, section?: any): InventoryLocation[] | null {
    if (Array.isArray(field?.locations)) {
      const fromArray = field.locations
        .map((value: unknown) => normalizeInventoryLocation(value))
        .filter((value: InventoryLocation, index: number, arr: InventoryLocation[]) => arr.indexOf(value) === index);
      if (fromArray.length > 0) return fromArray;
    }
    if (field?.location) {
      return [normalizeInventoryLocation(field.location)];
    }
    if (section?.location) {
      return [normalizeInventoryLocation(section.location)];
    }

    const inferred =
      inferLocationFromText(section?.label) ??
      inferLocationFromText(section?.id) ??
      inferLocationFromText(field?.label) ??
      inferLocationFromText(field?.id);
    return inferred ? [inferred] : null;
  }

  function getInventoryOptionsForField(field: any, section?: any) {
    const selectors = Array.isArray(field?.items) ? field.items : [];
    const base = selectors.length === 0
      ? inventoryStock
      : inventoryStock.filter((stock) => {
      const itemId = String(stock?.item?.id ?? "");
      const sku = String(stock?.item?.sku ?? "");
      return selectors.includes(itemId) || selectors.includes(sku);
    });

    const targetLocations = resolveInventoryTargetLocations(field, section);
    if (!targetLocations || targetLocations.length === 0) return base;
    return base.filter((stock) =>
      targetLocations.includes(normalizeInventoryLocation(stock?.item?.location))
    );
  }

  function getInventoryValue(itemId: string): number {
    const raw = formData?.inventoryUsage?.[itemId];
    const value = typeof raw === "number" ? raw : Number(raw ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  function removeUploadedKey(fieldId: string, keyToRemove: string) {
    setUploads((prev) => ({
      ...prev,
      [fieldId]: (prev[fieldId] ?? []).filter((key) => key !== keyToRemove),
    }));
    setUploadStates((prev) => ({
      ...prev,
      [fieldId]: (prev[fieldId] ?? []).filter((item) => item.key !== keyToRemove),
    }));
  }

  function removeUploadStateItem(fieldId: string, itemId: string) {
    setUploadStates((prev) => ({
      ...prev,
      [fieldId]: (prev[fieldId] ?? []).filter((item) => item.id !== itemId),
    }));
  }

  function formatUploadName(key: string) {
    const parts = key.split("/");
    return parts[parts.length - 1] || key;
  }

  function uploadFieldStatus(fieldId: string) {
    const pending = (uploadStates[fieldId] ?? []).filter(
      (item) => item.status === "queued" || item.status === "uploading"
    ).length;
    if (pending > 0) return `${pending} uploading...`;
    const count = uploads[fieldId]?.length ?? 0;
    if (count === 0) return "Tap to upload";
    return `${count} uploaded`;
  }

  function uploadFieldComplete(fieldId: string) {
    return (uploads[fieldId]?.length ?? 0) > 0;
  }

  function renderUnifiedUploadList(fieldId: string) {
    const states = uploadStates[fieldId] ?? [];
    const uploadedKeys = uploads[fieldId] ?? [];
    const stateByKey = new Map<string, UploadItemState>();
    const rows: Array<{
      id: string;
      key?: string;
      name: string;
      status: UploadItemStatus;
      progress: number;
      error?: string;
      source: "state" | "existing";
    }> = [];

    for (const state of states) {
      if (state.key && !stateByKey.has(state.key)) {
        stateByKey.set(state.key, state);
      }
      rows.push({
        id: state.id,
        key: state.key,
        name: state.name || (state.key ? formatUploadName(state.key) : "Upload"),
        status: state.status,
        progress: state.progress,
        error: state.error,
        source: "state",
      });
    }

    for (const key of uploadedKeys) {
      if (stateByKey.has(key)) continue;
      rows.push({
        id: `existing-${fieldId}-${key}`,
        key,
        name: formatUploadName(key),
        status: "uploaded",
        progress: 100,
        source: "existing",
      });
    }

    if (rows.length === 0) return null;

    return (
      <div className="space-y-1 rounded-md border p-2">
        {rows.slice(-20).map((item) => {
          const canRemove = item.status !== "queued" && item.status !== "uploading";
          const isImage = Boolean(item.key && isImageFileName(item.key));
          const previewUrl = item.key ? uploadPreviewUrls[item.key] : "";
          return (
            <div key={item.id} className="space-y-1 rounded-md border px-2 py-1.5">
              <div className="flex flex-col gap-2 text-[11px] sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-center gap-2 sm:flex-1">
                  {isImage && previewUrl ? (
                    <button
                      type="button"
                      onClick={() => openImagePreviewForKey(item.key!, item.name)}
                      className="h-8 w-8 shrink-0 overflow-hidden rounded border bg-muted"
                      title="Preview image"
                    >
                      <img src={previewUrl} alt={item.name} className="h-full w-full object-cover" />
                    </button>
                  ) : (
                    <div className="h-8 w-8 shrink-0 rounded border bg-muted/40" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-muted-foreground">{item.name}</p>
                    <p
                      className={
                        item.status === "failed"
                          ? "text-destructive"
                          : item.status === "uploaded"
                            ? "text-success"
                            : "text-muted-foreground"
                      }
                    >
                      {renderUploadStatusText(item.status, item.progress)}
                    </p>
                  </div>
                </div>
                <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:w-auto sm:flex-nowrap">
                  {isImage && item.key ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-[11px]"
                      onClick={() => openImagePreviewForKey(item.key!, item.name)}
                    >
                      <Eye className="h-3.5 w-3.5 sm:mr-1" />
                      <span className="hidden sm:inline">Preview</span>
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-[11px] text-destructive"
                    disabled={!canRemove}
                    onClick={() => {
                      if (item.key) {
                        removeUploadedKey(fieldId, item.key);
                      } else if (item.source === "state") {
                        removeUploadStateItem(fieldId, item.id);
                      }
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
              {(item.status === "queued" || item.status === "uploading") && (
                <Progress value={item.progress} className="h-1.5" />
              )}
              {item.status === "failed" && item.error ? (
                <p className="text-[10px] text-destructive">{item.error}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  function renderTaskReferenceAttachments(task: any) {
    const attachments = Array.isArray(task?.attachments) ? task.attachments : [];
    if (attachments.length === 0) return null;

    return (
      <div className="space-y-2 rounded-md border border-dashed p-3">
        <p className="text-xs font-medium text-muted-foreground">Reference files</p>
        <div className="flex flex-wrap gap-2">
          {attachments.map((attachment: any) => {
            const key = typeof attachment?.s3Key === "string" ? attachment.s3Key : "";
            const label = typeof attachment?.label === "string" && attachment.label.trim() ? attachment.label : "Reference";
            const previewUrl = key ? uploadPreviewUrls[key] : "";
            const isImage = Boolean(key && isImageFileName(key));
            return (
              <div key={attachment.id ?? key ?? label} className="rounded-md border bg-background p-2 text-xs">
                {isImage && previewUrl ? (
                  <button
                    type="button"
                    onClick={() => openImagePreviewForKey(key, label)}
                    className="mb-2 block h-20 w-20 overflow-hidden rounded border bg-muted"
                  >
                    <img src={previewUrl} alt={label} className="h-full w-full object-cover" />
                  </button>
                ) : null}
                {isImage && key ? (
                  <button
                    type="button"
                    className="text-left text-primary underline"
                    onClick={() => openImagePreviewForKey(key, label)}
                  >
                    {label}
                  </button>
                ) : typeof attachment?.url === "string" && attachment.url ? (
                  <a href={attachment.url} target="_blank" rel="noreferrer" className="text-primary underline">
                    {label}
                  </a>
                ) : (
                  <span>{label}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderInventoryField(field: any, section?: any) {
    if (!job?.property?.inventoryEnabled) {
      return (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Inventory is disabled for this property.
        </div>
      );
    }

    const options = getInventoryOptionsForField(field, section);
    if (options.length === 0) {
      return (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No inventory items matched for this field.
        </div>
      );
    }

    const grouped = options.reduce<Record<InventoryLocation, Record<string, any[]>>>(
      (acc, stock) => {
        const location = normalizeInventoryLocation(stock?.item?.location);
        const category = String(stock?.item?.category ?? "General").trim() || "General";
        if (!acc[location]) acc[location] = {};
        if (!acc[location][category]) acc[location][category] = [];
        acc[location][category].push(stock);
        return acc;
      },
      {
        BATHROOM: {},
        KITCHEN: {},
        CLEANERS_CUPBOARD: {},
      }
    );

    return (
      <div className="space-y-2 rounded-md border p-2">
        <p className="text-xs font-medium text-muted-foreground">{field.label}</p>
        <div className="space-y-3">
          {INVENTORY_LOCATIONS.map((location) => {
            const categories = grouped[location];
            const categoryEntries = Object.entries(categories).filter(([, rows]) => rows.length > 0);
            if (categoryEntries.length === 0) return null;
            return (
              <div key={location} className="space-y-2 rounded-md border border-dashed p-2">
                <p className="text-xs font-semibold text-primary">{INVENTORY_LOCATION_LABELS[location]}</p>
                {categoryEntries.map(([category, rows]) => (
                  <div key={`${location}-${category}`} className="space-y-2">
                    <p className="text-[11px] font-medium text-muted-foreground">{category}</p>
                    {rows.map((stock: any) => {
                      const qtyUsed = getInventoryValue(stock.item.id);
                      const remaining = Math.max(0, Number(stock.onHand ?? 0) - qtyUsed);
                      return (
                        <div
                          key={stock.item.id}
                          className="rounded-md border p-2 sm:grid sm:grid-cols-[minmax(0,1fr)_110px_130px] sm:items-center sm:gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium leading-snug sm:truncate">{stock.item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              On hand: {Number(stock.onHand).toFixed(0)} {stock.item.unit}
                              {stock.item.sku ? ` - ${stock.item.sku}` : ""}
                            </p>
                          </div>
                          <div className="mt-3 sm:mt-0">
                            <Label className="text-[10px] text-muted-foreground">Used</Label>
                            <div className="mt-1 flex items-center gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-9 w-9 shrink-0 p-0"
                                onClick={() => adjustInventoryUsage(stock.item.id, -1)}
                                disabled={qtyUsed <= 0}
                                aria-label={`Decrease ${stock.item.name} usage`}
                              >
                                -
                              </Button>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={String(qtyUsed)}
                                onChange={(e) => updateInventoryUsage(stock.item.id, e.target.value)}
                                className="h-9 min-w-0 flex-1 text-center sm:w-16 sm:flex-none sm:text-right"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-9 w-9 shrink-0 p-0"
                                onClick={() => adjustInventoryUsage(stock.item.id, 1)}
                                aria-label={`Increase ${stock.item.name} usage`}
                              >
                                +
                              </Button>
                            </div>
                          </div>
                          <div className="mt-3 rounded-md bg-muted/40 px-2 py-2 text-left sm:mt-0 sm:bg-transparent sm:px-0 sm:py-0 sm:text-right">
                            <p className="text-[10px] text-muted-foreground">After submit</p>
                            <p className="text-sm font-semibold">
                              {remaining.toFixed(0)} {stock.item.unit}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderDynamicFieldInput(field: any, section?: any) {
    // Inventory is a bespoke widget driven by property stock; everything else
    // (including all the new field types) is rendered by the shared FieldInput.
    if (field.type === "inventory") {
      return <div>{renderInventoryField(field, section)}</div>;
    }

    // Normalize the legacy "textarea" type name to the canonical "longtext".
    const normalizedField = field.type === "textarea" ? { ...field, type: "longtext" } : field;

    return (
      <FieldRenderer
        field={normalizedField}
        answers={formData}
        onAnswer={(fieldId, value) => setFormData((prev) => ({ ...prev, [fieldId]: value }))}
      />
    );
  }

  async function submitPayload(payloadToSubmit: Record<string, unknown>, fromQueue = false) {
    const res = await fetch(`/api/cleaner/jobs/${params.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadToSubmit),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const missingUploadFields = Array.isArray(body?.missingUploadFields)
        ? body.missingUploadFields.filter((field: any) => field && typeof field === "object")
        : [];
      const missingRequiredFields = Array.isArray(body?.missingRequiredFields)
        ? body.missingRequiredFields.filter((field: any) => field && typeof field === "object")
        : [];
      if (missingUploadFields.length > 0) {
        const missingIds = new Set(
          missingUploadFields
            .map((field: any) => (typeof field.id === "string" ? field.id : ""))
            .filter(Boolean)
        );
        const hasLaundryUploadMissing = laundryUploadFields.some((field: any) =>
          missingIds.has(String(field.id))
        );
        setStep(hasLaundryUploadMissing ? "laundry" : "uploads");
        const readableMissingUploads = missingUploadFields
          .map((field: any) => {
            const label =
              typeof field.label === "string" && field.label.trim()
                ? field.label.trim()
                : typeof field.id === "string"
                  ? field.id
                  : "Required upload";
            const sectionLabel =
              typeof field.sectionLabel === "string" && field.sectionLabel.trim()
                ? field.sectionLabel.trim()
                : "";
            return sectionLabel && sectionLabel !== label ? `${sectionLabel}: ${label}` : label;
          })
          .join(", ");
        toast({
          title: "Missing required uploads",
          description: readableMissingUploads,
          variant: "destructive",
        });
        return false;
      }
      if (missingRequiredFields.length > 0) {
        const firstMissingId =
          typeof missingRequiredFields[0]?.id === "string" ? missingRequiredFields[0].id : "";
        const matchingField = visibleSections
          .flatMap((section: any) => section.fields ?? [])
          .find((field: any) => field?.id === firstMissingId);
        const targetStep = matchingField?._resolvedStep;
        if (targetStep === "checklist" || targetStep === "uploads" || targetStep === "laundry" || targetStep === "submit") {
          setStep(targetStep);
        }
        toast({
          title: "Missing required fields",
          description: missingRequiredFields
            .map((field: any) => {
              const label =
                typeof field.label === "string" && field.label.trim()
                  ? field.label.trim()
                  : typeof field.id === "string"
                    ? field.id
                    : "Required field";
              const sectionLabel =
                typeof field.sectionLabel === "string" && field.sectionLabel.trim()
                  ? field.sectionLabel.trim()
                  : "";
              return sectionLabel && sectionLabel !== label ? `${sectionLabel}: ${label}` : label;
            })
            .join(", "),
          variant: "destructive",
        });
        return false;
      }
      if (!fromQueue) {
        const offlineLike = !navigator.onLine || res.status >= 500;
        if (offlineLike) {
          writePendingSubmission(payloadToSubmit);
          toast({
            title: "Saved for sync",
            description: "No connection. Submission queued and will auto-sync when online.",
            variant: "destructive",
          });
          return true;
        }
      }
      toast({ title: "Submission failed", description: body.error ?? "Could not submit job.", variant: "destructive" });
      return false;
    }
    clearPendingSubmission();
    showPopupNotification(
      fromQueue ? "Queued submission synced" : "Job submitted successfully",
      fromQueue ? "Offline submission is now synced." : "Submission sent to admin."
    );
    clearDraftState();
    void clearSharedDraftState();
    stopTicking();
    void sendGpsSnapshot(`/api/cleaner/jobs/${params.id}/gps-checkout`, "check-out");
    router.push("/cleaner");
    return true;
  }

  function validateLaundryState() {
    if (!laundryOutcome) {
      toast({
        title: "Select laundry outcome",
        description: "Choose the laundry outcome before sending or submitting it.",
        variant: "destructive",
      });
      return false;
    }
    if (
      (laundryOutcome === "NOT_READY" || laundryOutcome === "NO_PICKUP_REQUIRED") &&
      !laundrySkipReasonCode
    ) {
      toast({
        title: "Laundry reason required",
        description: "Select why laundry is not ready or no pickup is required.",
        variant: "destructive",
      });
      return false;
    }
    if (laundryOutcome === "READY_FOR_PICKUP") {
      if (!bagLocation.trim()) {
        toast({
          title: "Bag location required",
          description: "Enter the bag location before sending a laundry-ready update.",
          variant: "destructive",
        });
        return false;
      }
      if (!laundryPhotoKey) {
        toast({
          title: "Laundry photo required",
          description: "Capture or upload the laundry photo before sending this update.",
          variant: "destructive",
        });
        return false;
      }
    }
    return true;
  }

  function buildSubmissionPayload() {
    if (hasPendingContinuationRequest) {
      toast({
        title: "Submission blocked",
        description: "A continuation request is pending admin decision for this job.",
        variant: "destructive",
      });
      return null;
    }
    if (hasPendingUploads) {
      toast({
        title: "Uploads still in progress",
        description: `Wait until all uploads finish before submitting.`,
        variant: "destructive",
      });
      return null;
    }
    if (!template) {
      toast({ title: "No form template available", variant: "destructive" });
      return null;
    }
    if (!laundryOutcome && !savedLaundryUpdate) {
      toast({
        title: "Laundry outcome required",
        description: "Select and send a laundry outcome now or include one with the final submission.",
        variant: "destructive",
      });
      return null;
    }
    if (laundryOutcome && !validateLaundryState()) return null;
    const missingRequiredSignatures = collectRequiredAnswerFields(
      template.schema,
      formData,
      (job?.property ?? {}) as Record<string, unknown>,
      {
        laundryReady,
        fieldTypes: ["signature"],
      }
    );
    if (missingRequiredSignatures.length > 0) {
      const firstMissingField = visibleSections
        .flatMap((section: any) => section.fields ?? [])
        .find((field: any) => field?.id === missingRequiredSignatures[0]?.id);
      const targetStep = firstMissingField?._resolvedStep;
      if (targetStep === "checklist" || targetStep === "uploads" || targetStep === "laundry" || targetStep === "submit") {
        setStep(targetStep);
      }
      toast({
        title: "Signature required",
        description: missingRequiredSignatures
          .map((field) =>
            field.sectionLabel && field.sectionLabel !== field.label ? `${field.sectionLabel}: ${field.label}` : field.label
          )
          .join(", "),
        variant: "destructive",
      });
      return null;
    }
    // Yes/No fields configured with "details required when No".
    const missingNoDetails = visibleSections
      .flatMap((section: any) =>
        (section.fields ?? []).map((field: any) => ({ field, sectionLabel: section.label ?? section.title }))
      )
      .filter(
        ({ field }: any) =>
          field?.type === "yesno" &&
          field?.detailsWhenNo === true &&
          formData[field.id] === false &&
          !String(formData[fieldDetailsKey(field.id)] ?? "").trim()
      );
    if (missingNoDetails.length > 0) {
      const first = missingNoDetails[0];
      const targetStep = first.field?._resolvedStep;
      if (targetStep === "checklist" || targetStep === "uploads" || targetStep === "laundry" || targetStep === "submit") {
        setStep(targetStep);
      }
      toast({
        title: "Details required",
        description: missingNoDetails
          .map(({ field, sectionLabel }: any) =>
            sectionLabel && sectionLabel !== field.label ? `${sectionLabel}: ${field.label}` : field.label
          )
          .join(", "),
        variant: "destructive",
      });
      return null;
    }
    // Damage + pay requests are committed lists now. A half-typed working item
    // is never silently dropped: the submit handler prompts the cleaner before
    // we get here. If they chose to keep it, we auto-commit it; if it can't be
    // committed (e.g. missing photo) we block submission with a clear message.
    if (damageWorkingFieldsDirty()) {
      if (!commitDamageWorkingItem()) return null;
    }
    if (payRequestWorkingFieldsDirty()) {
      if (!commitPayRequestWorkingItem()) return null;
    }
    const anyPendingItemUploads = [...damageItems, ...payRequestItems].some((item) =>
      (uploadStates[item.photoFieldId] ?? []).some(
        (upload) => upload.status === "queued" || upload.status === "uploading"
      )
    );
    if (anyPendingItemUploads) {
      toast({
        title: "Evidence uploads in progress",
        description: "Wait until all damage / pay request photos finish uploading.",
        variant: "destructive",
      });
      return null;
    }
    for (const task of specialRequestTasks) {
      const doneFieldId = adminRequestedTaskDoneFieldId(task.id);
      const noteFieldId = adminRequestedTaskNoteFieldId(task.id);
      const photoFieldId = adminRequestedTaskPhotoFieldId(task.id);
      const isCompleted = formData[doneFieldId] === true;
      const cleanerNote = String(formData[noteFieldId] ?? "").trim();
      const photoKeys = uploads[photoFieldId] ?? [];

      if (!isCompleted) {
        toast({
          title: "Complete all admin requested tasks",
          description: `"${task.title}" must be marked complete before submitting.`,
          variant: "destructive",
        });
        return null;
      }
      if (task.requiresNote && !cleanerNote) {
        toast({
          title: "Cleaner note required",
          description: `Add the requested note for "${task.title}".`,
          variant: "destructive",
        });
        return null;
      }
      if (task.requiresPhoto && photoKeys.length === 0) {
        toast({
          title: "Image proof required",
          description: `Upload image proof for "${task.title}" before submitting.`,
          variant: "destructive",
        });
        return null;
      }
    }
    const unifiedTaskPayload = unifiedJobTasks.map((task) => {
      const decision = String(formData[jobTaskDecisionFieldId(String(task.id))] ?? "");
      const note = String(formData[jobTaskNoteFieldId(String(task.id))] ?? "").trim();
      const proofKeys = uploads[jobTaskProofFieldId(String(task.id))] ?? [];
      return {
        id: String(task.id),
        title: String(task.title ?? "Task"),
        decision,
        note,
        proofKeys,
        requiresPhoto: task.requiresPhoto === true,
        requiresNote: task.requiresNote === true,
      };
    });
    for (const task of unifiedTaskPayload) {
      if (task.decision !== "COMPLETED" && task.decision !== "NOT_COMPLETED") {
        toast({
          title: "Task decision required",
          description: `Choose completed or not completed for "${task.title}".`,
          variant: "destructive",
        });
        return null;
      }
      if (task.decision === "COMPLETED") {
        if (task.requiresNote && !task.note) {
          toast({
            title: "Cleaner note required",
            description: `Add the requested note for "${task.title}".`,
            variant: "destructive",
          });
          return null;
        }
        if (task.requiresPhoto && task.proofKeys.length === 0) {
          toast({
            title: "Image proof required",
            description: `Upload proof for "${task.title}".`,
            variant: "destructive",
          });
          return null;
        }
      } else if (!task.note) {
        toast({
          title: "Reason required",
          description: `Explain why "${task.title}" was not completed.`,
          variant: "destructive",
        });
        return null;
      }
    }
    const carryForwardTaskPhotoKeys = Object.fromEntries(
      carryForwardTasks.map((task) => {
        const taskId = String(task.id);
        const fieldId = carryForwardPhotoFieldId(taskId);
        return [taskId, uploads[fieldId] ?? []];
      })
    );
    const payloadToSubmit = {
      templateId: template.id,
      jobTasks: unifiedTaskPayload.map((task) => ({
        id: task.id,
        decision: task.decision,
        note: task.note,
        proofKeys: task.proofKeys,
      })),
      laundryOutcome: laundryOutcome ?? undefined,
      laundryReady: laundryOutcome ? laundryReady : undefined,
      laundrySkipReasonCode,
      laundrySkipReasonNote,
      bagLocation,
      draftDamageItems: damageItems.map((item) => ({
        title: item.title,
        description: item.description,
        area: item.area || undefined,
        estimatedCost: Number(item.estimatedCost || 0),
        severity: item.severity,
        mediaKeys: uploads[item.photoFieldId] ?? [],
      })),
      draftPayRequestItems: payRequestItems.map((item) => ({
        title: item.title,
        cleanerNote: item.description,
        type: item.type,
        requestedHours: item.type === "HOURLY" ? Number(item.hours || 0) : undefined,
        requestedRate: item.type === "HOURLY" ? Number(item.rate || 0) : undefined,
        requestedAmount: payRequestItemAmount(item),
        mediaKeys: uploads[item.photoFieldId] ?? [],
      })),
      data: {
        ...formData,
        uploads,
        __adminRequestedTasks: specialRequestTasks.map((task) => {
          const noteFieldId = adminRequestedTaskNoteFieldId(task.id);
          const photoFieldId = adminRequestedTaskPhotoFieldId(task.id);
          return {
            id: task.id,
            title: task.title,
            description: task.description ?? "",
            requiresPhoto: task.requiresPhoto === true,
            requiresNote: task.requiresNote === true,
            completed: formData[adminRequestedTaskDoneFieldId(task.id)] === true,
            note: String(formData[noteFieldId] ?? "").trim(),
            photoFieldId,
            photoKeys: uploads[photoFieldId] ?? [],
          };
        }),
        carryForward: {
          resolvedTaskIds: resolvedCarryForwardIds,
          hasNew: hasMissedTask,
          newTaskNotes: missedTaskNotes,
          taskPhotoKeys: carryForwardTaskPhotoKeys,
        },
      },
    };
    return payloadToSubmit;
  }

  async function handleSendLaundryUpdateNow() {
    if (!hasStartedJob) {
      toast({
        title: "Start the job first",
        description: "Laundry updates can be sent after the job has started.",
        variant: "destructive",
      });
      return;
    }
    if (!laundryOutcome) {
      toast({
        title: "Select laundry outcome",
        description: "Choose the laundry outcome before sending the update.",
        variant: "destructive",
      });
      return;
    }
    if (!validateLaundryState()) return;

    setSavingLaundryUpdate(true);
    const res = await fetch(`/api/cleaner/jobs/${params.id}/laundry-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        laundryOutcome,
        laundryReady,
        laundrySkipReasonCode,
        laundrySkipReasonNote,
        bagLocation,
        laundryPhotoKey,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingLaundryUpdate(false);

    if (!res.ok) {
      toast({
        title: "Laundry update failed",
        description: body.error ?? "Could not send laundry status.",
        variant: "destructive",
      });
      return;
    }

    const submittedAt = typeof body.updatedAt === "string" ? body.updatedAt : new Date().toISOString();
    setLastLaundrySubmittedAt(submittedAt);
    setSavedLaundryUpdate({
      outcome: laundryOutcome,
      submittedAt,
      bagLocation: laundryOutcome === "READY_FOR_PICKUP" ? bagLocation.trim() || undefined : undefined,
      skipReasonCode:
        laundryOutcome !== "READY_FOR_PICKUP" ? laundrySkipReasonCode || undefined : undefined,
      skipReasonNote:
        laundryOutcome !== "READY_FOR_PICKUP" ? laundrySkipReasonNote.trim() || undefined : undefined,
    });
    setLaundryUpdateCollapsed(true);
    showPopupNotification(
      body.duplicated ? "Laundry update already sent" : "Laundry update sent",
      body.duplicated
        ? "The latest laundry status is already saved."
        : "Laundry team and admin now have the latest status."
    );
  }

  async function confirmClockReviewAndSubmit() {
    if (!pendingSubmitPayload) return;

    let payloadToSubmit = pendingSubmitPayload;
    if (requestClockAdjustment) {
      const requestedDurationM = Number(clockAdjustmentMinutes || 0);
      if (!Number.isFinite(requestedDurationM) || requestedDurationM <= 0) {
        toast({
          title: "Adjusted time required",
          description: "Enter the requested final clock minutes.",
          variant: "destructive",
        });
        return;
      }
      if (!clockAdjustmentReason.trim()) {
        toast({
          title: "Adjustment reason required",
          description: "Explain why the clock should be adjusted.",
          variant: "destructive",
        });
        return;
      }
      payloadToSubmit = {
        ...payloadToSubmit,
        clockAdjustmentRequest: {
          requestedDurationM,
          reason: clockAdjustmentReason.trim(),
        },
      };
    }

    setClockReviewOpen(false);
    setSubmitting(true);
    await submitPayload(payloadToSubmit, false);
    setSubmitting(false);
    resetClockReviewState();
  }

  async function handleSubmit() {
    // Nothing the cleaner typed is silently lost: if a damage / pay request
    // mini-form is half-filled but not yet Added, ask before submitting.
    if (damageWorkingFieldsDirty()) {
      const keep = window.confirm(
        "You have a damage item you started but haven't added yet.\n\nClick OK to add it now (it will be submitted), or Cancel to keep editing."
      );
      if (!keep) {
        setStep("submit");
        toast({
          title: "Add or clear your damage item",
          description: "Press \"Add damage item\" to include it, or remove the details, then submit.",
        });
        return;
      }
      if (!commitDamageWorkingItem()) {
        setStep("submit");
        return;
      }
    }
    if (payRequestWorkingFieldsDirty()) {
      const keep = window.confirm(
        "You have an extra pay request you started but haven't added yet.\n\nClick OK to add it now (it will be submitted), or Cancel to keep editing."
      );
      if (!keep) {
        setStep("submit");
        toast({
          title: "Add or clear your pay request",
          description: "Press \"Add pay request\" to include it, or remove the details, then submit.",
        });
        return;
      }
      if (!commitPayRequestWorkingItem()) {
        setStep("submit");
        return;
      }
    }

    // Adherence nudge: if the checklist isn't fully ticked, give a friendly-but-
    // firm reminder before submitting. This is NOT a hard block — once the
    // cleaner acknowledges, adherenceBypassRef lets the next call sail through.
    // It only fires at the real friction point (genuine incomplete checklist),
    // never on a fully-completed job.
    if (!adherenceBypassRef.current && totalFields > 0 && filledFields < totalFields) {
      const remaining = totalFields - filledFields;
      setAdherenceConfirmMessage(
        `${remaining} checklist item${remaining === 1 ? "" : "s"} ${remaining === 1 ? "is" : "are"} not ticked yet. ` +
          "Every item you complete is logged for quality and pay. Submitting with items unticked is recorded and may delay approval or pay."
      );
      setAdherenceConfirmOpen(true);
      return;
    }
    adherenceBypassRef.current = false;

    const payloadToSubmit = buildSubmissionPayload();
    if (!payloadToSubmit) return;

    if (isRunning && timeReview.activeTimeLogId) {
      setPendingSubmitPayload(payloadToSubmit);
      setRequestClockAdjustment(false);
      setClockAdjustmentMinutes(String(timeReview.currentMinutes));
      setClockAdjustmentReason("");
      setClockReviewOpen(true);
      return;
    }

    setSubmitting(true);
    await submitPayload(payloadToSubmit, false);
    setSubmitting(false);
  }

  // ---- Damage items: explicit Add → committed list ----------------------

  function damageWorkingFieldsDirty() {
    return Boolean(
      damageTitle.trim() ||
        damageArea.trim() ||
        damageDescription.trim() ||
        (uploads[DAMAGE_UPLOAD_FIELD_ID]?.length ?? 0) > 0 ||
        Number(damageEstimatedCost || 0) > 0
    );
  }

  function resetDamageWorkingFields() {
    setDamageTitle("");
    setDamageArea("");
    setDamageSeverity("HIGH");
    setDamageDescription("");
    setDamageEstimatedCost("0");
    setEditingDamageId(null);
    // Clear the shared working upload bucket so the next item starts fresh.
    setUploads((prev) => ({ ...prev, [DAMAGE_UPLOAD_FIELD_ID]: [] }));
    setUploadStates((prev) => ({ ...prev, [DAMAGE_UPLOAD_FIELD_ID]: [] }));
  }

  // Validate + commit the in-progress damage mini-form to the list. Returns
  // true when an item was committed. Photos move into the item's own field id.
  function commitDamageWorkingItem(options: { silent?: boolean } = {}): boolean {
    if (!damageTitle.trim()) {
      if (!options.silent) toast({ title: "Damage title is required", variant: "destructive" });
      return false;
    }
    const pendingDamageUploads = (uploadStates[DAMAGE_UPLOAD_FIELD_ID] ?? []).some(
      (item) => item.status === "queued" || item.status === "uploading"
    );
    if (pendingDamageUploads) {
      if (!options.silent)
        toast({
          title: "Damage uploads in progress",
          description: "Wait until evidence uploads finish before adding this item.",
          variant: "destructive",
        });
      return false;
    }
    const workingKeys = uploads[DAMAGE_UPLOAD_FIELD_ID] ?? [];
    if (workingKeys.length === 0) {
      if (!options.silent)
        toast({
          title: "Damage photo required",
          description: "Capture or upload at least one photo as evidence.",
          variant: "destructive",
        });
      return false;
    }

    const itemId = editingDamageId ?? createLineItemId();
    const photoFieldId = damageItemPhotoFieldId(itemId);
    const item: DamageItem = {
      id: itemId,
      title: damageTitle.trim(),
      area: damageArea.trim(),
      severity: damageSeverity,
      description: damageDescription.trim(),
      estimatedCost: damageEstimatedCost,
      photoFieldId,
    };

    // Move the working photos into the item's dedicated upload bucket.
    setUploads((prev) => {
      const next = { ...prev };
      next[photoFieldId] = [...workingKeys];
      next[DAMAGE_UPLOAD_FIELD_ID] = [];
      return next;
    });
    setUploadStates((prev) => ({ ...prev, [DAMAGE_UPLOAD_FIELD_ID]: [] }));

    setDamageItems((prev) => {
      const exists = prev.some((existing) => existing.id === itemId);
      return exists ? prev.map((existing) => (existing.id === itemId ? item : existing)) : [...prev, item];
    });

    resetDamageWorkingFields();
    return true;
  }

  function handleAddDamageItem() {
    const wasEditing = Boolean(editingDamageId);
    if (commitDamageWorkingItem()) {
      showPopupNotification(
        wasEditing ? "Damage item updated" : "Damage item added",
        "It is in your list and will be submitted with the job."
      );
    }
  }

  function handleEditDamageItem(itemId: string) {
    const item = damageItems.find((existing) => existing.id === itemId);
    if (!item) return;
    if (damageWorkingFieldsDirty() && editingDamageId !== itemId) {
      // Don't silently lose a half-typed new item — commit or keep it.
      if (!commitDamageWorkingItem({ silent: true })) {
        toast({
          title: "Finish the current damage item first",
          description: "Add or clear the item you are entering before editing another.",
          variant: "destructive",
        });
        return;
      }
    }
    setEditingDamageId(itemId);
    setDamageTitle(item.title);
    setDamageArea(item.area);
    setDamageSeverity(item.severity);
    setDamageDescription(item.description);
    setDamageEstimatedCost(item.estimatedCost);
    setUploads((prev) => ({ ...prev, [DAMAGE_UPLOAD_FIELD_ID]: [...(prev[item.photoFieldId] ?? [])] }));
    setUploadStates((prev) => ({ ...prev, [DAMAGE_UPLOAD_FIELD_ID]: [] }));
  }

  function handleRemoveDamageItem(itemId: string) {
    const item = damageItems.find((existing) => existing.id === itemId);
    setDamageItems((prev) => prev.filter((existing) => existing.id !== itemId));
    if (item) {
      setUploads((prev) => {
        const next = { ...prev };
        delete next[item.photoFieldId];
        return next;
      });
      setUploadStates((prev) => {
        const next = { ...prev };
        delete next[item.photoFieldId];
        return next;
      });
    }
    if (editingDamageId === itemId) resetDamageWorkingFields();
    showPopupNotification("Damage item removed");
  }

  // ---- Pay request items: explicit Add → committed list -----------------

  function payRequestWorkingFieldsDirty() {
    return Boolean(
      approvalTitle.trim() ||
        approvalDescription.trim() ||
        (uploads[PAY_REQUEST_UPLOAD_FIELD_ID]?.length ?? 0) > 0 ||
        (approvalType === "HOURLY"
          ? Number(approvalHours || 0) > 0 || Number(approvalRate || 0) > 0
          : Number(approvalAmount || 0) > 0)
    );
  }

  function resetPayRequestWorkingFields() {
    setApprovalTitle("");
    setApprovalDescription("");
    setApprovalType("FIXED");
    setApprovalHours("1");
    setApprovalRate("");
    setApprovalAmount("0");
    setEditingPayRequestId(null);
    setUploads((prev) => ({ ...prev, [PAY_REQUEST_UPLOAD_FIELD_ID]: [] }));
    setUploadStates((prev) => ({ ...prev, [PAY_REQUEST_UPLOAD_FIELD_ID]: [] }));
  }

  function commitPayRequestWorkingItem(options: { silent?: boolean } = {}): boolean {
    const pendingPayUploads = (uploadStates[PAY_REQUEST_UPLOAD_FIELD_ID] ?? []).some(
      (item) => item.status === "queued" || item.status === "uploading"
    );
    if (pendingPayUploads) {
      if (!options.silent)
        toast({
          title: "Pay request uploads in progress",
          description: "Wait until evidence uploads finish before adding this request.",
          variant: "destructive",
        });
      return false;
    }
    if (!approvalTitle.trim()) {
      if (!options.silent) toast({ title: "Request title is required", variant: "destructive" });
      return false;
    }
    if (approvalType === "HOURLY") {
      const hours = Number(approvalHours || 0);
      const rate = Number(approvalRate || 0);
      if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(rate) || rate <= 0) {
        if (!options.silent) toast({ title: "Enter valid hours and rate", variant: "destructive" });
        return false;
      }
    } else {
      const amount = Number(approvalAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        if (!options.silent) toast({ title: "Enter a valid amount", variant: "destructive" });
        return false;
      }
    }

    const itemId = editingPayRequestId ?? createLineItemId();
    const photoFieldId = payRequestItemPhotoFieldId(itemId);
    const workingKeys = uploads[PAY_REQUEST_UPLOAD_FIELD_ID] ?? [];
    const item: PayRequestItem = {
      id: itemId,
      title: approvalTitle.trim(),
      description: approvalDescription.trim(),
      type: approvalType,
      hours: approvalHours,
      rate: approvalRate,
      amount: approvalAmount,
      photoFieldId,
    };

    setUploads((prev) => {
      const next = { ...prev };
      next[photoFieldId] = [...workingKeys];
      next[PAY_REQUEST_UPLOAD_FIELD_ID] = [];
      return next;
    });
    setUploadStates((prev) => ({ ...prev, [PAY_REQUEST_UPLOAD_FIELD_ID]: [] }));

    setPayRequestItems((prev) => {
      const exists = prev.some((existing) => existing.id === itemId);
      return exists ? prev.map((existing) => (existing.id === itemId ? item : existing)) : [...prev, item];
    });

    resetPayRequestWorkingFields();
    return true;
  }

  function handleAddPayRequestItem() {
    const wasEditing = Boolean(editingPayRequestId);
    if (commitPayRequestWorkingItem()) {
      showPopupNotification(
        wasEditing ? "Pay request updated" : "Pay request added",
        "It is in your list and will be submitted with the job."
      );
    }
  }

  function handleEditPayRequestItem(itemId: string) {
    const item = payRequestItems.find((existing) => existing.id === itemId);
    if (!item) return;
    if (payRequestWorkingFieldsDirty() && editingPayRequestId !== itemId) {
      if (!commitPayRequestWorkingItem({ silent: true })) {
        toast({
          title: "Finish the current pay request first",
          description: "Add or clear the request you are entering before editing another.",
          variant: "destructive",
        });
        return;
      }
    }
    setEditingPayRequestId(itemId);
    setApprovalTitle(item.title);
    setApprovalDescription(item.description);
    setApprovalType(item.type);
    setApprovalHours(item.hours);
    setApprovalRate(item.rate);
    setApprovalAmount(item.amount);
    setUploads((prev) => ({ ...prev, [PAY_REQUEST_UPLOAD_FIELD_ID]: [...(prev[item.photoFieldId] ?? [])] }));
    setUploadStates((prev) => ({ ...prev, [PAY_REQUEST_UPLOAD_FIELD_ID]: [] }));
  }

  function handleRemovePayRequestItem(itemId: string) {
    const item = payRequestItems.find((existing) => existing.id === itemId);
    setPayRequestItems((prev) => prev.filter((existing) => existing.id !== itemId));
    if (item) {
      setUploads((prev) => {
        const next = { ...prev };
        delete next[item.photoFieldId];
        return next;
      });
      setUploadStates((prev) => {
        const next = { ...prev };
        delete next[item.photoFieldId];
        return next;
      });
    }
    if (editingPayRequestId === itemId) resetPayRequestWorkingFields();
    showPopupNotification("Pay request removed");
  }

  async function handleRequestReschedule() {
    if (hasPendingUploads) {
      toast({
        title: "Uploads still in progress",
        description: "Wait for uploads to finish before requesting continuation.",
        variant: "destructive",
      });
      return;
    }
    if (!rescheduleReason.trim()) {
      toast({ title: "Reason is required", variant: "destructive" });
      return;
    }
    setSubmittingReschedule(true);
    const res = await fetch(`/api/cleaner/jobs/${params.id}/reschedule-request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: rescheduleReason.trim(),
        preferredDate: reschedulePreferredDate || undefined,
        estimatedRemainingHours: rescheduleRemainingHours ? Number(rescheduleRemainingHours) : undefined,
        progressSnapshot: {
          formData,
          uploads,
          laundryOutcome,
          laundryReady,
          laundrySkipReasonCode,
          laundrySkipReasonNote,
          bagLocation,
          resolvedCarryForwardIds,
          hasMissedTask,
          missedTaskNotes,
          extraPaymentRequired,
          approvalTitle,
          approvalDescription,
          approvalType,
          approvalHours,
          approvalRate,
          approvalAmount,
          damageFound,
          damageTitle,
          damageArea,
          damageSeverity,
          damageDescription,
          damageEstimatedCost,
          damageItems,
          payRequestItems,
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSubmittingReschedule(false);
    if (!res.ok) {
      toast({
        title: "Request failed",
        description: body.error ?? "Could not submit continuation request.",
        variant: "destructive",
      });
      return;
    }
    setRescheduleReason("");
    setReschedulePreferredDate("");
    setRescheduleRemainingHours("");
    setShowRescheduleForm(false);
    if (body?.timerAutoPaused) {
      showPopupNotification(
        "Timer auto-paused",
        `Continuation request sent. ${body?.autoPausedMinutes ?? 0} minute(s) logged.`
      );
    } else {
      showPopupNotification("Continuation request sent", "Admin approval is required.");
    }
    await load();
  }

  if (!payload) return <div className="py-8 text-center text-muted-foreground">Loading...</div>;
  if (payload?.error) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm font-medium text-destructive">Could not load job form</p>
          <p className="text-sm text-muted-foreground">{String(payload.error)}</p>
          <Button variant="outline" onClick={() => load()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (!job || !job.property) {
    return (
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm font-medium text-destructive">Job data is incomplete</p>
          <p className="text-sm text-muted-foreground">
            This job is missing linked property details. Ask admin to recreate or relink the job.
          </p>
          <Button variant="outline" onClick={() => load()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const accessInfo = job?.property?.accessInfo as Record<string, string> | undefined;
  const finished = ["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"].includes(job?.status ?? "");
  const hasStartedJob = isRunning || elapsed > 0 || job?.status === "IN_PROGRESS";
  const pendingUploadCount = Object.values(uploadStates)
    .flat()
    .filter((item) => item.status === "queued" || item.status === "uploading").length;
  const hasPendingUploads = pendingUploadCount > 0;
  const hasPendingContinuationRequest = rescheduleRequests.some((row) => row.status === "PENDING");
  const latestEarlyCheckoutRequest = earlyCheckoutRequests[0] ?? null;
  const pendingEarlyCheckoutRequest = earlyCheckoutRequests.find((row) => row.status === "PENDING") ?? null;
  const mapsUrl = googleMapsDirectionsUrl({
    address: job?.property?.address,
    suburb: job?.property?.suburb,
    state: job?.property?.state,
    postcode: job?.property?.postcode,
    latitude: job?.property?.latitude,
    longitude: job?.property?.longitude,
    placeId: job?.property?.placeId,
    name: job?.property?.name,
  });
  const assignmentState = payload?.assignmentState ?? null;
  const assignmentResponseStatus = String(assignmentState?.responseStatus ?? "");
  const assignmentResponseLabel = assignmentResponseStatus
    ? formatAssignmentResponseLabel(assignmentResponseStatus as any)
    : null;
  const canManageAssignment =
    Boolean(assignmentState) &&
    !finished &&
    ["UNASSIGNED", "OFFERED", "ASSIGNED"].includes(job?.status ?? "");
  const transferCandidates = Array.isArray(payload?.transferCandidates) ? payload.transferCandidates : [];
  const latestPing = Array.isArray(job?.cleanerLocationPings) ? job.cleanerLocationPings[0] : null;
  const tripStateLabel = job?.arrivedAt
    ? "Arrived"
    : job?.drivingPausedAt
      ? "Paused"
      : job?.drivingDelayedAt
        ? "Delayed"
        : job?.status === "EN_ROUTE"
          ? "On the way"
          : null;
  const tripEtaLabel =
    typeof job?.enRouteEtaMinutes === "number"
      ? job.enRouteEtaMinutes <= 1
        ? "Arriving now"
        : (() => {
            const arrival = new Date(Date.now() + job.enRouteEtaMinutes * 60 * 1000);
            const time = arrival.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
            return `${job.enRouteEtaMinutes} min · ~${time}`;
          })()
      : "ETA unavailable";
  const tripLastUpdate =
    job?.enRouteEtaUpdatedAt || latestPing?.timestamp
      ? formatDateTimeLabel(job?.enRouteEtaUpdatedAt || latestPing?.timestamp)
      : null;
  const canPauseDriving = job?.status === "EN_ROUTE" && !job?.drivingPausedAt && !job?.arrivedAt;
  const canResumeDriving = job?.status === "EN_ROUTE" && Boolean(job?.drivingPausedAt) && !job?.arrivedAt;
  const canArriveDriving = job?.status === "EN_ROUTE" && !job?.arrivedAt;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/cleaner">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{job?.property?.name}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{job?.property?.address}</span>
          </p>
        </div>
        <Badge variant={job?.status === "OFFERED" ? "warning" : "secondary"} className="shrink-0">
          {formatJobStatusLabel(job?.status)}
        </Badge>
        {/* Actions wrap onto their own full-width row on narrow screens so the
            long "Report fix / replace" trigger never overflows the viewport. */}
        {mapsUrl || (job?.jobType === "AIRBNB_TURNOVER" && job?.propertyId) ? (
          <div className="flex w-full flex-wrap items-center gap-2">
            {mapsUrl ? (
              <Button size="sm" variant="outline" asChild className="flex-1 sm:flex-none">
                <a href={mapsUrl} target="_blank" rel="noreferrer">
                  <MapPin className="mr-2 h-4 w-4" />
                  Open in Maps
                </a>
              </Button>
            ) : null}
            {job?.jobType === "AIRBNB_TURNOVER" && job?.propertyId ? (
              <ReportMaintenanceSheet
                propertyId={job.propertyId}
                jobId={jobId}
                triggerLabel="Report fix / replace"
                triggerClassName="flex-1 sm:flex-none"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {(cleanerTags.length > 0 || Boolean(cleanerInstructionText) || hasJobNotes) ? (
        <div className="flex flex-wrap gap-2">
          {cleanerTags.map((tag) => (
            <Badge
              key={`detail-tag-${tag}`}
              variant="secondary"
              className="border-info/30 bg-info/10 text-info"
            >
              {tag}
            </Badge>
          ))}
          {cleanerInstructionText ? (
            <Badge variant="secondary" className="border-info/30 bg-info/10 text-info">
              Cleaner Notes
            </Badge>
          ) : null}
          {hasJobNotes ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 rounded-full px-2 text-[11px]"
              onClick={() => setShowJobNotes((prev) => !prev)}
            >
              {showJobNotes ? "Hide job notes" : "Show job notes"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {job?.status === "EN_ROUTE" && (
        <DrivingPanel
          tripState={
            job?.arrivedAt
              ? "ARRIVED"
              : job?.drivingPausedAt
                ? "PAUSED"
                : job?.drivingDelayedAt
                  ? "DELAYED"
                  : "EN_ROUTE"
          }
          etaLabel={tripEtaLabel}
          lastUpdateLabel={tripLastUpdate}
          trackingLabel={job?.drivingPausedAt || job?.arrivedAt ? "Stopped" : trackingActive ? "Active" : "Starting"}
          trackingActive={trackingActive}
          pingFreshnessLabel={
            lastPingSentAt
              ? `Last ping ${Math.max(0, Math.round((pingClock - lastPingSentAt) / 1000))}s ago · ${formatAccuracy(lastPingAccuracy)}`
              : "Waiting for first GPS fix…"
          }
          trackingError={trackingError}
          pauseReason={job?.drivingPauseReason ?? null}
          delayReason={job?.drivingDelayedReason ? String(job.drivingDelayedReason).replace(/_/g, " ") : null}
          canPause={canPauseDriving}
          canResume={canResumeDriving}
          canArrive={canArriveDriving}
          pausing={pausingDriving}
          resuming={resumingDriving}
          arriving={arrivingDriving}
          stopping={stoppingDriving}
          markingDelayed={markingDelayed}
          pauseReasonValue={pauseReasonSelect}
          onPauseReasonChange={setPauseReasonSelect}
          delayReasonValue={delayedReason}
          onDelayReasonChange={setDelayedReason}
          showManualEta={job?.enRouteEtaMinutes == null && !job?.arrivedAt}
          manualEta={manualEta}
          onManualEtaChange={setManualEta}
          onSetManualEta={handleSetManualEta}
          navigateUrl={mapsUrl}
          onPause={handlePauseDriving}
          onResume={handleResumeDriving}
          onArrived={handleArrivedDriving}
          onStop={handleStopDriving}
          onMarkDelayed={handleMarkDelayed}
          onRetryGps={() => startLocationTracking()}
        />
      )}

      {/* Start Driving button (shown when ASSIGNED, before starting the job) */}
      {job?.status === "ASSIGNED" && !finished && (
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Heading to the property? Let the client know you&apos;re on the way.
          </p>
          <Button
            className="h-11"
            disabled={startingDriving}
            onClick={handleStartDriving}
          >
            <Navigation className="mr-2 h-4 w-4" />
            {startingDriving ? "Getting GPS..." : "Start driving"}
          </Button>
        </div>
      )}

      {pendingSync ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
          A previous submission is queued for sync. It will auto-submit when internet is available.
        </div>
      ) : null}

      {hasContinuationCarryover ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          Continuation mode: progress from the previous cleaner has been prefilled for this job.
        </div>
      ) : null}

      {canManageAssignment ? (
        <Card className={assignmentResponseStatus === "PENDING" ? "border-warning/40 bg-warning/10" : "border-info/30 bg-info/10"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {assignmentResponseStatus === "PENDING" ? "Job Confirmation Required" : "Assignment Status"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={assignmentResponseStatus === "PENDING" ? "warning" : "secondary"}>
                {assignmentResponseLabel ?? "Awaiting confirmation"}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {assignmentResponseStatus === "PENDING"
                  ? "Accept, decline, or transfer this job before the team relies on your schedule."
                  : "You have already confirmed this job. You can still transfer it before the work starts."}
              </p>
            </div>

            {(assignmentResponseStatus === "PENDING" || showTransferForm) ? (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Note for admin</Label>
                <Textarea
                  value={assignmentNote}
                  onChange={(event) => setAssignmentNote(event.target.value)}
                  placeholder={
                    showTransferForm
                      ? "Explain why this job should move to another cleaner"
                      : "Optional note"
                  }
                />
              </div>
            ) : null}

            {showTransferForm ? (
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Transfer to cleaner</Label>
                  <Select value={transferCleanerId} onValueChange={setTransferCleanerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose cleaner" />
                    </SelectTrigger>
                    <SelectContent>
                      {transferCandidates.map((candidate: any) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.name || candidate.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowTransferForm(false);
                      setTransferCleanerId("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleAssignmentResponse("TRANSFER")}
                    disabled={assignmentActionLoading === "TRANSFER"}
                  >
                    {assignmentActionLoading === "TRANSFER" ? "Sending..." : "Transfer job"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {assignmentResponseStatus === "PENDING" ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleAssignmentResponse("DECLINE")}
                      disabled={Boolean(assignmentActionLoading)}
                    >
                      {assignmentActionLoading === "DECLINE" ? "Declining..." : "Decline"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowTransferForm(true)}
                      disabled={Boolean(assignmentActionLoading)}
                    >
                      Transfer
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleAssignmentResponse("ACCEPT")}
                      disabled={Boolean(assignmentActionLoading)}
                    >
                      {assignmentActionLoading === "ACCEPT" ? "Accepting..." : "Accept job"}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowTransferForm(true)}
                    disabled={Boolean(assignmentActionLoading)}
                  >
                    Transfer to another cleaner
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {latestEarlyCheckoutRequest ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-destructive">Timing Update</p>
                <p className="mt-2 text-sm text-foreground">
                  {pendingEarlyCheckoutRequest
                    ? "Admin requested your approval for a timing change on this job."
                    : "This job had a timing update request."}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Type: {latestEarlyCheckoutRequest.requestType === "LATE_CHECKOUT" ? "Late checkout" : "Early check-in"}
                </p>
                {latestEarlyCheckoutRequest.requestedTime ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Requested time: {latestEarlyCheckoutRequest.requestedTime}
                  </p>
                ) : null}
                {latestEarlyCheckoutRequest.note ? (
                  <p className="mt-1 text-xs text-muted-foreground">Admin note: {latestEarlyCheckoutRequest.note}</p>
                ) : null}
              </div>
              {pendingEarlyCheckoutRequest ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => respondToTimingRequest(pendingEarlyCheckoutRequest.id, "DECLINE")}>
                    Decline
                  </Button>
                  <Button size="sm" onClick={() => respondToTimingRequest(pendingEarlyCheckoutRequest.id, "APPROVE")}>
                    Approve
                  </Button>
                </div>
              ) : (
                <Badge variant={latestEarlyCheckoutRequest.status === "APPROVED" ? "success" : "secondary"}>
                  {latestEarlyCheckoutRequest.status === "APPROVED" ? "Approved" : latestEarlyCheckoutRequest.status}
                </Badge>
              )}
            </div>
          </div>
      ) : null}

      {jobTimingHighlights.length > 0 ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-warning">Priority Timing</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {jobTimingHighlights.map((line) => (
              <Badge key={line} variant="warning">
                {line}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {cleanerInstructionText ? (
        <div className="rounded-lg border border-info/30 bg-info/10 px-3 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-info">Cleaner Notes</p>
          <p className="mt-2 text-sm text-foreground">{cleanerInstructionText}</p>
        </div>
      ) : null}

      {hasJobNotes && showJobNotes ? (
        <div className="rounded-md border border-border bg-surface-raised px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground/80">Job Notes</p>
          <p className="mt-2 text-sm text-foreground">{job.notes}</p>
        </div>
      ) : null}

      <Card className={isRunning ? "border-primary" : ""}>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="font-mono text-3xl font-bold">{formatDuration(elapsed)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {job?.startTime ? (
                <>
                  <Clock className="mr-1 inline h-3 w-3" />
                  {job.startTime} - {job.dueTime}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex gap-2">
            {!isRunning ? (
              <Button className="h-11" onClick={handleStart} disabled={finished}>
                <Play className="mr-2 h-4 w-4" />
                {elapsed > 0 || job?.status === "IN_PROGRESS" ? "Resume" : "Start"}
              </Button>
            ) : (
              <Button variant="outline" onClick={handleStop}>
                <Square className="mr-2 h-4 w-4" />
                Pause
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {payload?.canClockOutWithoutForm && hasStartedJob && !finished ? (
        <Card className="border-amber-300/60">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium">Clock out &amp; finish the form later</p>
            <p className="text-xs text-muted-foreground">
              Stops your clock now. This job stays open and is <strong>not counted as completed</strong> until you come back and submit the form.
            </p>
            <Button variant="outline" className="h-11 w-full" onClick={handleClockOutEarly} disabled={clockingOutEarly}>
              <Square className="mr-2 h-4 w-4" />
              {clockingOutEarly ? "Clocking out…" : "Clock out (finish form later)"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {job?.formPendingAfterClockOut ? (
        <Card className="border-amber-400 bg-amber-50/60 dark:bg-amber-950/10">
          <CardContent className="p-4 text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-400">Form still pending</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              You clocked out earlier. Finish and submit the form below to complete this job.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {payload?.laundryGuidance?.hasDrop ? (
        <Card className={payload.laundryGuidance.linenSittingOutside ? "border-emerald-300/60" : "border-amber-300/60"}>
          <CardContent className="p-4 text-sm">
            {payload.laundryGuidance.linenSittingOutside ? (
              <>
                <p className="font-medium text-emerald-700 dark:text-emerald-400">Fresh linen is on site</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Clean linen from the last laundry drop is still at the property (no clean since) — use it for this turnover.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-amber-700 dark:text-amber-400">Use the property buffer sets</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The last laundry drop was already used by a later clean, so no fresh linen is sitting out. Use the property&apos;s
                  {" "}{payload.laundryGuidance.bufferSets > 0 ? `${payload.laundryGuidance.bufferSets} buffer set(s)` : "buffer linen"}.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {(job?.gpsCheckInLat != null && job?.gpsCheckInLng != null) || (job?.gpsCheckOutLat != null && job?.gpsCheckOutLng != null) ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Your clock-in / clock-out location</CardTitle>
          </CardHeader>
          <CardContent>
            <ClockLocationsMap
              property={{ lat: job?.property?.latitude, lng: job?.property?.longitude, name: job?.property?.name }}
              checkIn={
                job?.gpsCheckInLat != null && job?.gpsCheckInLng != null
                  ? { lat: job.gpsCheckInLat, lng: job.gpsCheckInLng, at: job.gpsCheckInAt }
                  : null
              }
              checkOut={
                job?.gpsCheckOutLat != null && job?.gpsCheckOutLng != null
                  ? { lat: job.gpsCheckOutLat, lng: job.gpsCheckOutLng, at: job.gpsCheckOutAt }
                  : null
              }
              distanceMeters={job?.gpsDistanceMeters}
            />
          </CardContent>
        </Card>
      ) : null}

      {!finished && hasStartedJob ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pause & Continue Another Day</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              If this job cannot be completed today, submit a continuation request for admin approval.
            </p>
            <label className="flex items-center gap-2 rounded-md border p-2 text-sm">
              <Checkbox
                checked={showRescheduleForm}
                onCheckedChange={(checked) => setShowRescheduleForm(Boolean(checked))}
              />
              Pause this job and continue another day
            </label>

            {showRescheduleForm ? (
              <>
                <div className="space-y-1">
                  <Label>Reason</Label>
                  <Textarea
                    value={rescheduleReason}
                    onChange={(e) => setRescheduleReason(e.target.value)}
                    placeholder="Explain what remains and why reschedule is needed"
                  />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Preferred continuation date (optional)</Label>
                    <Input
                      type="date"
                      value={reschedulePreferredDate}
                      onChange={(e) => setReschedulePreferredDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Estimated remaining hours (optional)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.25"
                      value={rescheduleRemainingHours}
                      onChange={(e) => setRescheduleRemainingHours(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleRequestReschedule}
                  disabled={submittingReschedule || rescheduleRequests.some((row) => row.status === "PENDING")}
                >
                  {submittingReschedule
                    ? "Submitting..."
                    : rescheduleRequests.some((row) => row.status === "PENDING")
                      ? "Continuation request pending admin decision"
                      : "Request continuation approval"}
                </Button>
              </>
            ) : null}
            {rescheduleRequests.length > 0 ? (
              <div className="rounded-md border p-2">
                <p className="text-xs font-medium">Request history</p>
                <div className="mt-2 space-y-1">
                  {rescheduleRequests.slice(0, 4).map((row) => (
                    <p key={row.id} className="text-xs text-muted-foreground">
                      {new Date(row.requestedAt).toLocaleString("en-AU")} - {row.status}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <AccessInstructionsPanel accessInfo={accessInfo} title="Property Access Instructions" />

      {hasServiceContext ? (
        <Card className="border-border/70">
          <CardContent className="grid gap-3 p-3 text-sm md:grid-cols-2">
            {serviceContext.scopeOfWork ? <div><p className="text-xs text-muted-foreground">Scope of work</p><p>{serviceContext.scopeOfWork}</p></div> : null}
            {serviceContext.accessInstructions ? <div><p className="text-xs text-muted-foreground">Access instructions</p><p>{serviceContext.accessInstructions}</p></div> : null}
            {serviceContext.parkingInstructions ? <div><p className="text-xs text-muted-foreground">Parking / arrival</p><p>{serviceContext.parkingInstructions}</p></div> : null}
            {serviceContext.hazardNotes ? <div><p className="text-xs text-muted-foreground">Hazards / safety</p><p>{serviceContext.hazardNotes}</p></div> : null}
            {serviceContext.equipmentNotes ? <div><p className="text-xs text-muted-foreground">Equipment / utilities</p><p>{serviceContext.equipmentNotes}</p></div> : null}
            {serviceContext.siteContactName || serviceContext.siteContactPhone ? (
              <div>
                <p className="text-xs text-muted-foreground">On-site contact</p>
                <p>{[serviceContext.siteContactName, serviceContext.siteContactPhone].filter(Boolean).join(" · ")}</p>
              </div>
            ) : null}
            {serviceContext.serviceAreaSqm ? <div><p className="text-xs text-muted-foreground">Service area</p><p>{serviceContext.serviceAreaSqm} sqm</p></div> : null}
            {serviceContext.floorCount ? <div><p className="text-xs text-muted-foreground">Floors / levels</p><p>{serviceContext.floorCount}</p></div> : null}
          </CardContent>
        </Card>
      ) : null}

      {hasReservationContext ? (
        <Card className="border-border/70">
          <CardHeader className="pb-0">
            <CardTitle className="text-sm">
              {preparationSource === "PROPERTY_MAX" ? "Preparation Details" : "Incoming Booking Details"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-3 text-sm md:grid-cols-2">
            {reservationContext.guestName ? <div><p className="text-xs text-muted-foreground">Guest name</p><p>{reservationContext.guestName}</p></div> : null}
            {reservationContext.reservationCode ? <div><p className="text-xs text-muted-foreground">Reservation code</p><p>{reservationContext.reservationCode}</p></div> : null}
            {preparationGuestCount > 0 ? (
              <div>
                <p className="text-xs text-muted-foreground">Preparation guest count</p>
                <p>
                  {preparationGuestCount} guest{preparationGuestCount === 1 ? "" : "s"}
                  {preparationSource === "PROPERTY_MAX" ? " · property max fallback" : ""}
                  {preparationSource !== "PROPERTY_MAX" && reservationContext.adults != null ? ` · ${reservationContext.adults} adults` : ""}
                  {preparationSource !== "PROPERTY_MAX" && reservationContext.children != null ? ` · ${reservationContext.children} children` : ""}
                  {preparationSource !== "PROPERTY_MAX" && reservationContext.infants != null ? ` · ${reservationContext.infants} infants` : ""}
                </p>
              </div>
            ) : null}
            {preparationSource === "PROPERTY_MAX" ? (
              <div>
                <p className="text-xs text-muted-foreground">Booking status</p>
                <p>No same-day incoming booking linked. Prepare for maximum occupancy.</p>
              </div>
            ) : null}
            {reservationContext.guestPhone ? <div><p className="text-xs text-muted-foreground">Guest phone</p><p>{reservationContext.guestPhone}</p></div> : null}
            {reservationContext.guestEmail ? <div><p className="text-xs text-muted-foreground">Guest email</p><p>{reservationContext.guestEmail}</p></div> : null}
            {reservationContext.checkinAtLocal ? <div><p className="text-xs text-muted-foreground">Check-in</p><p>{formatDateTimeLabel(reservationContext.checkinAtLocal)}</p></div> : null}
            {reservationContext.checkoutAtLocal ? <div><p className="text-xs text-muted-foreground">Checkout</p><p>{formatDateTimeLabel(reservationContext.checkoutAtLocal)}</p></div> : null}
            {reservationContext.locationText ? <div><p className="text-xs text-muted-foreground">Location / booking details</p><p>{reservationContext.locationText}</p></div> : null}
            {reservationContext.guestProfileUrl ? (
              <div>
                <p className="text-xs text-muted-foreground">Guest profile</p>
                <a className="text-primary underline underline-offset-4" href={reservationContext.guestProfileUrl} target="_blank" rel="noreferrer">
                  Open profile
                </a>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {payload?.job?.requiresSafetyCheckin ? (
        <Card className={payload?.job?.safetyCheckinAt ? "border-success/40 bg-success/10" : "border-warning/40 bg-warning/10"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {payload?.job?.safetyCheckinAt ? "Safety check-in confirmed" : "Safety check-in required"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              {payload?.job?.safetyCheckinAt ? (
                <p>
                  Recorded at {formatDateTimeLabel(payload.job.safetyCheckinAt) ?? payload.job.safetyCheckinAt}.
                </p>
              ) : (
                <p>
                  This job is marked as a solo property visit. Tap <span className="font-medium">I&apos;m safe</span> after arrival.
                </p>
              )}
            </div>
            {!payload?.job?.safetyCheckinAt ? (
              <Button type="button" size="sm" variant="outline" onClick={handleSafetyCheckin} disabled={sendingSafetyCheckin}>
                {sendingSafetyCheckin ? "Saving..." : "I'm safe"}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex gap-1 text-xs">
        {["briefing", "checklist", "uploads", "laundry", "submit"].map((item, i) => (
          <div
            key={item}
            className={`h-1.5 flex-1 rounded-full ${
              step === item ? "bg-primary" : i < ["briefing", "checklist", "uploads", "laundry", "submit"].indexOf(step) ? "bg-primary/40" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {step === "briefing" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Job Briefing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {briefing?.priorQaWarning ? (
              <div
                className={`rounded-md border p-3 ${
                  briefing.priorQaWarning.band === "FAIL"
                    ? "border-destructive/40 bg-destructive/10"
                    : "border-warning/40 bg-warning/10"
                }`}
                data-testid="prior-qa-warning"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Previous QA at this property: {briefing.priorQaWarning.percent}% ({briefing.priorQaWarning.band})
                    </p>
                    {briefing.priorQaWarning.cleanerFeedback ? (
                      <p className="text-xs">{briefing.priorQaWarning.cleanerFeedback}</p>
                    ) : briefing.priorQaWarning.inspectorNotes ? (
                      <p className="text-xs text-muted-foreground">{briefing.priorQaWarning.inspectorNotes}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Take extra care today — review the cleaner checklist carefully.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            {Array.isArray(briefing?.qaReworkNotes) && briefing.qaReworkNotes.length > 0 ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3" data-testid="qa-rework-notes">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" aria-hidden />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">QA had to redo work on this job</p>
                    {briefing.qaReworkNotes.map((note: any) => (
                      <div key={note.id} className="space-y-0.5">
                        <p className="text-xs font-medium">
                          {String(note.severity).charAt(0) + String(note.severity).slice(1).toLowerCase()} ·
                          {note.qaUser?.name ? ` ${note.qaUser.name}` : " QA inspector"}
                          {note.minutesFromCleaner > 0 ? ` · ${note.minutesFromCleaner} min` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">{note.reason}</p>
                        {Array.isArray(note.areas) && note.areas.length > 0 ? (
                          <p className="text-xs text-muted-foreground">Areas: {note.areas.join(", ")}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            {briefing?.previousLaundryDrop ? (
              <div className="rounded-md border border-info/40 bg-info/10 p-3" data-testid="linen-drop-card">
                <div className="flex items-start gap-2">
                  <Package className="h-4 w-4 flex-shrink-0 mt-0.5 text-info" aria-hidden />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div>
                      <p className="text-sm font-medium">Linen drop — where to find it</p>
                      <p className="text-xs text-muted-foreground">
                        Fresh linen from the last drop-off
                        {briefing.previousLaundryDrop.droppedAt
                          ? ` on ${format(new Date(briefing.previousLaundryDrop.droppedAt), "EEE dd MMM, h:mm a")}`
                          : ""}
                        . Use this to locate the bags before you start.
                      </p>
                    </div>
                    {briefing.previousLaundryDrop.notes ? (
                      <p className="whitespace-pre-wrap rounded-md bg-background/60 px-2 py-1.5 text-xs">
                        {briefing.previousLaundryDrop.notes}
                      </p>
                    ) : null}
                    {briefing.previousLaundryDrop.photo ? (
                      <MediaGallery
                        items={[briefing.previousLaundryDrop.photo]}
                        emptyText="No drop-off photo available."
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No drop-off photo was captured — check the usual linen storage spot.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            {briefing?.lastPhotos?.length ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Recent property photos</p>
                <MediaGallery items={briefing.lastPhotos} emptyText="No previous photos yet." />
              </div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Access details</p>
                {briefing?.accessCode ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Access code</p>
                    <p className="font-medium">{briefing.accessCode}</p>
                  </div>
                ) : null}
                {briefing?.alarmCode ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Alarm code</p>
                    <p className="font-medium">{briefing.alarmCode}</p>
                  </div>
                ) : null}
                {briefing?.keyLocation ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Key location</p>
                    <p>{briefing.keyLocation}</p>
                  </div>
                ) : null}
                {briefing?.accessNotes ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Access notes</p>
                    <p className="whitespace-pre-wrap text-sm">{briefing.accessNotes}</p>
                  </div>
                ) : null}
                {!briefing?.accessCode && !briefing?.alarmCode && !briefing?.keyLocation && !briefing?.accessNotes ? (
                  <p className="text-xs text-muted-foreground">No extra access vault details saved for this property.</p>
                ) : null}
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Operational notes</p>
                {briefing?.jobNotes ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Job notes</p>
                    <p className="whitespace-pre-wrap text-sm">{briefing.jobNotes}</p>
                  </div>
                ) : null}
                {Array.isArray(briefing?.previousFlags) && briefing.previousFlags.length > 0 ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Previous QA flags</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {briefing.previousFlags.map((flag: string) => (
                        <Badge key={flag} variant="warning">
                          {flag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
                {briefing?.laundryInstructions ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Laundry schedule</p>
                    <p className="text-sm">
                      {briefing.laundryInstructions.status.replace(/_/g, " ")}
                      {briefing.laundryInstructions.pickupDate
                        ? ` · Pickup ${format(new Date(briefing.laundryInstructions.pickupDate), "dd MMM")}`
                        : ""}
                      {briefing.laundryInstructions.dropoffDate
                        ? ` · Drop-off ${format(new Date(briefing.laundryInstructions.dropoffDate), "dd MMM")}`
                        : ""}
                    </p>
                  </div>
                ) : null}
                {!briefing?.jobNotes && (!Array.isArray(briefing?.previousFlags) || briefing.previousFlags.length === 0) && !briefing?.laundryInstructions ? (
                  <p className="text-xs text-muted-foreground">No extra briefing notes for this job.</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button className="h-11" onClick={handleStart} disabled={finished}>
                <Play className="mr-2 h-4 w-4" />
                {elapsed > 0 || job?.status === "IN_PROGRESS" ? "Resume job" : "Begin job"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "checklist" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Checklist</h3>
            <span className="text-xs text-muted-foreground">
              {filledFields}/{totalFields}
            </span>
          </div>
          {canUseSelectAll && (
            <Button variant="outline" size="sm" onClick={selectAllChecklistItems}>
              Select all checklist items
            </Button>
          )}
          <Progress value={progress} className="h-2" />
          {unifiedJobTasks.length > 0 ? (
            <Card className="border-destructive bg-destructive/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-destructive">Priority Job Tasks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {unifiedJobTasks.map((task) => {
                  const taskId = String(task.id);
                  const decisionFieldId = jobTaskDecisionFieldId(taskId);
                  const noteFieldId = jobTaskNoteFieldId(taskId);
                  const proofFieldId = jobTaskProofFieldId(taskId);
                  const decision = String(formData[decisionFieldId] ?? "");
                  const proofCount = uploads[proofFieldId]?.length ?? 0;
                  return (
                    <div key={taskId} className="space-y-3 rounded-md border bg-background p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">{task.title}</p>
                          {task.description ? (
                            <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="destructive">Required</Badge>
                          <Badge variant="outline">{formatJobTaskSourceLabel(String(task.source ?? "ADMIN"))}</Badge>
                          {task.approvalStatus === "AUTO_APPROVED" ? (
                            <Badge variant="outline">Auto-approved</Badge>
                          ) : null}
                          {task.requiresPhoto ? <Badge variant="outline">Image proof</Badge> : null}
                          {task.requiresNote ? <Badge variant="outline">Cleaner note</Badge> : null}
                        </div>
                      </div>
                      {renderTaskReferenceAttachments(task)}
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Task outcome</Label>
                        <Select
                          value={decision}
                          onValueChange={(value) =>
                            setFormData((prev) => ({ ...prev, [decisionFieldId]: value }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select completed or not completed" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="COMPLETED">Completed</SelectItem>
                            <SelectItem value="NOT_COMPLETED">Not completed</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            {decision === "NOT_COMPLETED" ? "Reason *" : task.requiresNote ? "Cleaner note *" : "Cleaner note"}
                          </Label>
                          <Textarea
                            value={formData[noteFieldId] ?? ""}
                            onChange={(e) =>
                              setFormData((prev) => ({ ...prev, [noteFieldId]: e.target.value }))
                            }
                            placeholder={
                              decision === "NOT_COMPLETED"
                                ? "Explain why this task could not be completed"
                                : "Add proof notes if needed"
                            }
                          />
                        </div>
                        <div className="space-y-2 rounded-md border border-dashed p-3">
                          <p className="text-xs font-medium text-muted-foreground">
                            {decision === "NOT_COMPLETED" ? "Proof (optional)" : task.requiresPhoto ? "Image proof *" : "Proof"}
                            {proofCount > 0 ? ` (${proofCount} uploaded)` : ""}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                              <Camera className="h-3.5 w-3.5" />
                              Take photo
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={(e) => {
                                  if (e.target.files?.length) handleUpload(proofFieldId, e.target.files, "camera");
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>
                            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                              Upload proof
                              <input
                                type="file"
                                accept="image/*,video/*"
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                  if (e.target.files?.length) handleUpload(proofFieldId, e.target.files, "gallery");
                                  e.currentTarget.value = "";
                                }}
                              />
                            </label>
                          </div>
                          {renderUnifiedUploadList(proofFieldId)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
          {specialRequestTasks.length > 0 ? (
            <Card className="border-destructive bg-destructive/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-destructive">High Priority Admin Requested Tasks</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {specialRequestTasks.map((task) => {
                  const doneFieldId = adminRequestedTaskDoneFieldId(task.id);
                  const noteFieldId = adminRequestedTaskNoteFieldId(task.id);
                  const photoFieldId = adminRequestedTaskPhotoFieldId(task.id);
                  const completed = formData[doneFieldId] === true;
                  const photoCount = uploads[photoFieldId]?.length ?? 0;
                  return (
                    <div key={task.id} className="space-y-3 rounded-md border bg-background p-3">
                      <label className="flex items-start gap-3">
                        <Checkbox
                          checked={completed}
                          onCheckedChange={(value) =>
                            setFormData((prev) => ({ ...prev, [doneFieldId]: value === true }))
                          }
                        />
                        <span className="min-w-0 text-sm">
                          <span className="block font-medium">{task.title}</span>
                          {task.description ? (
                            <span className="mt-1 block text-xs text-muted-foreground">{task.description}</span>
                          ) : null}
                        </span>
                      </label>
                      {(task.requiresPhoto || task.requiresNote) ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          {task.requiresNote ? (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Cleaner note *</Label>
                              <Textarea
                                value={formData[noteFieldId] ?? ""}
                                onChange={(e) =>
                                  setFormData((prev) => ({ ...prev, [noteFieldId]: e.target.value }))
                                }
                                placeholder="Add the requested proof note"
                              />
                            </div>
                          ) : (
                            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                              No note required for this task.
                            </div>
                          )}
                          {task.requiresPhoto ? (
                            <div className="space-y-2 rounded-md border border-dashed p-3">
                              <p className="text-xs font-medium text-muted-foreground">
                                Image proof * {photoCount > 0 ? `(${photoCount} uploaded)` : ""}
                              </p>
                              <div className="flex flex-wrap items-center gap-2">
                                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                                  <Camera className="h-3.5 w-3.5" />
                                  Take photo
                                  <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={(e) => {
                                      if (e.target.files?.length) handleUpload(photoFieldId, e.target.files, "camera");
                                      e.currentTarget.value = "";
                                    }}
                                  />
                                </label>
                                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                                  Upload photo
                                  <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    onChange={(e) => {
                                      if (e.target.files?.length) handleUpload(photoFieldId, e.target.files, "gallery");
                                      e.currentTarget.value = "";
                                    }}
                                  />
                                </label>
                              </div>
                              {renderUnifiedUploadList(photoFieldId)}
                            </div>
                          ) : (
                            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                              No image proof required for this task.
                            </div>
                          )}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="destructive">Required</Badge>
                        {task.requiresPhoto ? <Badge variant="outline">Image proof</Badge> : null}
                        {task.requiresNote ? <Badge variant="outline">Cleaner note</Badge> : null}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
          {carryForwardTasks.length > 0 && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">High Priority From Previous Clean</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {carryForwardTasks.map((task) => {
                  const checked = resolvedCarryForwardIds.includes(task.id);
                  const fieldId = carryForwardPhotoFieldId(String(task.id));
                  const photoCount = uploads[fieldId]?.length ?? 0;
                  return (
                    <div key={task.id} className="space-y-2 rounded-md border bg-background p-2 text-sm">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => toggleResolvedTask(task.id, e.target.checked)}
                        />
                        <span>
                          {task.description || "No description"}
                          {task.sourceScheduledDate ? (
                            <span className="block text-xs text-muted-foreground">
                              From job on {new Date(task.sourceScheduledDate).toLocaleDateString("en-AU")}
                            </span>
                          ) : null}
                        </span>
                      </label>
                      <div className="rounded-md border border-dashed p-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Completion photos (recommended) {photoCount > 0 ? `(${photoCount} uploaded)` : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                            <Camera className="h-3.5 w-3.5" />
                            Take photo
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files?.length) handleUpload(fieldId, e.target.files, "camera");
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                            Upload photo
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files?.length) handleUpload(fieldId, e.target.files, "gallery");
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                          {photoCount === 0 ? (
                            <span className="text-[11px] text-muted-foreground">Optional</span>
                          ) : (
                            <span className="text-[11px] text-success">Ready</span>
                          )}
                        </div>
                        <div className="mt-2">{renderUnifiedUploadList(fieldId)}</div>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
          {checklistSections.map((section: any) => (
            <Card key={section.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{section.label}</CardTitle>
              </CardHeader>
                <CardContent className="space-y-3">
                {(section.fields ?? []).map((field: any) => (
                  <div key={field.id}>{renderDynamicFieldInput(field, section)}</div>
                ))}
              </CardContent>
            </Card>
          ))}
          {checklistSections.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                No checklist fields configured for this template.
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pass to Next Clean</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hasMissedTask}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setHasMissedTask(checked);
                    if (checked && missedTaskNotes.length === 0) {
                      setMissedTaskNotes([""]);
                    }
                  }}
                />
                Did you miss anything that must be done on the next clean?
              </label>
              {hasMissedTask && (
                <div className="space-y-2">
                  {missedTaskNotes.map((note, index) => (
                    <div key={index} className="space-y-2 rounded-md border p-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs text-muted-foreground">Task {index + 1}</Label>
                        {missedTaskNotes.length > 1 && (
                          <Button type="button" size="sm" variant="ghost" onClick={() => removeMissedTaskNote(index)}>
                            Remove
                          </Button>
                        )}
                      </div>
                      <Textarea
                        placeholder="Describe the missed item/task clearly for next cleaner..."
                        value={note}
                        onChange={(e) => updateMissedTaskNote(index, e.target.value)}
                      />
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="outline" onClick={addMissedTaskNote}>
                    Add another task
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Button className="w-full" onClick={() => setStep("uploads")} disabled={hasPendingUploads}>
            {"Continue to Uploads ->"}
          </Button>
        </div>
      )}

      {step === "uploads" && (
        <div className="space-y-4">
          <h3 className="font-semibold">Uploads</h3>
          <p className="text-xs text-muted-foreground">
            Images are resized and compressed automatically. Videos must be under 150MB before upload and are compressed to a much smaller stored file on the server.
          </p>
          {guidedCaptureItems.length > 0 ? (
            <Button
              type="button"
              className="h-12 w-full text-base font-semibold"
              onClick={() => {
                // Refresh the session GPS for the new capture run.
                stampGpsRef.current = null;
                stampGpsPromiseRef.current = null;
                void resolveStampGps();
                setGuidedCaptureOpen(true);
              }}
            >
              <Camera className="mr-2 h-5 w-5" />
              Guided photo capture
              <span className="ml-2 rounded-md bg-primary-foreground/20 px-1.5 py-0.5 text-xs tabular-nums">
                {guidedCaptureItems.length} fields
              </span>
            </Button>
          ) : null}
          {hasPendingUploads ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
              Uploading {pendingUploadCount} file(s). Please wait before continuing.
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            {checklistUploadFields.map((field: any) => {
              const isVideoField = field.type === "video";
              const isFileField = field.type === "file";
              const galleryAccept = isVideoField
                ? "video/*"
                : isFileField
                  ? "application/pdf,image/*,video/*"
                  : "image/*,video/*";
              if (isVideoField) {
                // In-app recording (MediaRecorder + canvas timestamp overlay)
                // with a file-upload fallback. Spans both columns.
                return (
                  <div key={field.id} className="col-span-2 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {field.label}
                      {field.required ? " *" : ""}
                    </p>
                    <FieldReferences references={field.references} />
                    <div
                      className={`space-y-2 rounded-lg border-2 border-dashed p-3 transition-colors ${
                        uploadFieldComplete(field.id) ? "border-primary bg-primary/5" : "border-muted-foreground/30"
                      }`}
                    >
                      <span className="text-xs text-muted-foreground">{uploadFieldStatus(field.id)}</span>
                      <VideoRecorder
                        capturerName={
                          (typeof payload?.viewerName === "string" && payload.viewerName.trim()) || "Cleaner"
                        }
                        timezone={
                          (typeof payload?.startVerification?.timezone === "string" &&
                            payload.startVerification.timezone) ||
                          "Australia/Sydney"
                        }
                        maxDurationSec={
                          typeof field.maxDurationSec === "number" && field.maxDurationSec > 0
                            ? field.maxDurationSec
                            : 60
                        }
                        disabled={
                          field.maxFiles !== undefined &&
                          (uploads[field.id]?.length ?? 0) >= field.maxFiles
                        }
                        onRecorded={async (file) => {
                          // Videos already carry the burned timestamp; route via
                          // "gallery" so they skip the image stamper.
                          await handleUpload(field.id, [file], "gallery");
                        }}
                      />
                    </div>
                    {renderUnifiedUploadList(field.id)}
                  </div>
                );
              }
              return (
              <div key={field.id} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {field.label}
                  {field.required ? " *" : ""}
                </p>
                <FieldReferences references={field.references} />
                <div
                  className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-2 transition-colors ${
                    uploadFieldComplete(field.id) ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary"
                  }`}
                >
                  <Camera className={`h-6 w-6 ${uploadFieldComplete(field.id) ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-center text-xs">{uploadFieldStatus(field.id)}</span>
                  <div className="flex w-full flex-wrap items-center justify-center gap-2">
                    {!isFileField ? (
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted">
                        <Camera className="h-3.5 w-3.5" />
                        Take photo
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            if (e.target.files?.length) handleUpload(field.id, e.target.files, "camera");
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                    ) : null}
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted">
                      {isFileField ? "Upload file" : "Upload media"}
                      <input
                        type="file"
                        accept={galleryAccept}
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.length) handleUpload(field.id, e.target.files, "gallery");
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {field.mediaMode === "both" ? (
                    <div className="mt-2 w-full border-t border-dashed border-muted-foreground/30 pt-2">
                      <p className="mb-1 text-center text-[11px] text-muted-foreground">or record a video</p>
                      <VideoRecorder
                        capturerName={
                          (typeof payload?.viewerName === "string" && payload.viewerName.trim()) || "Cleaner"
                        }
                        timezone={
                          (typeof payload?.startVerification?.timezone === "string" &&
                            payload.startVerification.timezone) ||
                          "Australia/Sydney"
                        }
                        maxDurationSec={
                          typeof field.maxDurationSec === "number" && field.maxDurationSec > 0
                            ? field.maxDurationSec
                            : 60
                        }
                        disabled={
                          field.maxFiles !== undefined &&
                          (uploads[field.id]?.length ?? 0) >= field.maxFiles
                        }
                        onRecorded={async (file) => {
                          await handleUpload(field.id, [file], "gallery");
                        }}
                      />
                    </div>
                  ) : null}
                </div>
                {renderUnifiedUploadList(field.id)}
              </div>
              );
            })}
            {checklistUploadFields.length === 0 && (
              <p className="col-span-2 text-xs text-muted-foreground">No upload fields configured in this template.</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("checklist")}>
              {"<- Back"}
            </Button>
            <Button className="flex-1" onClick={() => setStep("laundry")} disabled={hasPendingUploads}>
              {hasPendingUploads ? `Uploading ${pendingUploadCount}...` : "Continue ->"}
            </Button>
          </div>
        </div>
      )}

      {guidedCaptureOpen && guidedCaptureItems.length > 0 ? (
        <GuidedCapture
          items={guidedCaptureItems}
          counts={guidedCaptureCounts}
          pendingCounts={guidedCapturePending}
          thumbnails={guidedCaptureThumbnails}
          onFiles={async (fieldId, files, source) => {
            const result = await handleUpload(fieldId, files, source);
            return { failedCount: result?.failedCount ?? 0 };
          }}
          onClose={() => setGuidedCaptureOpen(false)}
        />
      ) : null}

      {step === "laundry" && (
        <div className="space-y-4">
          <h3 className="font-semibold">Laundry Confirmation</h3>
          {!laundryUpdateCollapsed ? (
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="space-y-2">
                <Label className="text-base">Laundry outcome</Label>
                <Select
                  value={laundryOutcome ?? "__NONE__"}
                  onValueChange={(value) =>
                    syncLaundryReadyFromOutcome(value === "__NONE__" ? null : (value as LaundryOutcome))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select laundry outcome" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__NONE__">None selected</SelectItem>
                    <SelectItem value="READY_FOR_PICKUP">Ready for pickup</SelectItem>
                    <SelectItem value="NOT_READY">Not ready</SelectItem>
                    <SelectItem value="NO_PICKUP_REQUIRED">No pickup required</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {laundryOutcome === "READY_FOR_PICKUP" ? (
                <div className="space-y-3 border-t pt-2">
                  <div>
                    <Label className="text-sm">Bag location / notes</Label>
                    {bagLocationOptions.length > 0 ? (
                      <div className="mt-1 space-y-2">
                        <Select value={bagLocationSelection} onValueChange={setBagLocationSelection}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select bag location" />
                          </SelectTrigger>
                          <SelectContent>
                            {bagLocationOptions.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                            <SelectItem value="__custom">Custom location</SelectItem>
                          </SelectContent>
                        </Select>
                        {bagLocationSelection === "__custom" && (
                          <Input
                            placeholder="Type custom bag location notes"
                            value={bagLocationCustom}
                            onChange={(e) => setBagLocationCustom(e.target.value)}
                          />
                        )}
                      </div>
                    ) : (
                      <Input
                        className="mt-1"
                        placeholder="Example: Laundry room shelf, labeled bags"
                        value={bagLocationCustom}
                        onChange={(e) => setBagLocationCustom(e.target.value)}
                      />
                    )}
                  </div>
                  <div>
                    <Label className="text-sm">Laundry photo (required)</Label>
                    <div className="mt-1 space-y-2 rounded-lg border-2 border-dashed p-3">
                      <div className="flex items-center gap-3">
                        <Camera className="h-5 w-5 text-muted-foreground" />
                        <span className="text-sm">
                          {(uploads.laundry_photo?.length ?? 0) > 0 || (laundryUploadField?.id && (uploads[laundryUploadField.id]?.length ?? 0) > 0)
                            ? `${uploads.laundry_photo?.length ?? uploads[laundryUploadField?.id ?? ""]?.length ?? 0} uploaded`
                            : "Take photo or upload from gallery"}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                          <Camera className="h-3.5 w-3.5" />
                          Take photo
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files?.length) handleLaundryPhotoUpload(e.target.files, "camera");
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                          Upload photo
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files?.length) handleLaundryPhotoUpload(e.target.files, "gallery");
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                      </div>
                    </div>
                    {renderUnifiedUploadList("laundry_photo")}
                  </div>
                </div>
              ) : laundryOutcome ? (
                <div className="space-y-3 border-t pt-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-sm">Reason</Label>
                      <Select value={laundrySkipReasonCode} onValueChange={setLaundrySkipReasonCode}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select reason" />
                        </SelectTrigger>
                        <SelectContent>
                          {LAUNDRY_SKIP_REASONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm">Notes for laundry/admin</Label>
                      <Textarea
                        rows={3}
                        placeholder="Add instructions or context for the laundry team"
                        value={laundrySkipReasonNote}
                        onChange={(e) => setLaundrySkipReasonNote(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {laundryOutcome === "NO_PICKUP_REQUIRED"
                        ? "Laundry will be marked as no pickup required and highlighted for the laundry team."
                        : "Admin and laundry will be notified that pickup should be skipped until resolved."}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                  No laundry update is selected yet. Nothing will be sent until you choose an outcome.
                </div>
              )}
            </CardContent>
          </Card>
          ) : null}
          {!laundryUpdateCollapsed && laundryNonUploadFields.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Additional Laundry Fields</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {laundryNonUploadFields.map((field: any) => (
                  <div key={field.id}>{renderDynamicFieldInput(field, field?._section)}</div>
                ))}
              </CardContent>
            </Card>
          ) : null}
          {!laundryUpdateCollapsed && laundryUploadFields.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Laundry Uploads</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {laundryUploadFields.map((field: any) => {
                  const usesDedicatedLaundryUpload =
                    String(field.id ?? "").toLowerCase() === "laundry_photo" ||
                    field.id === laundryUploadField?.id;
                  const onUpload = (files: FileList | File[], source: UploadSource) => {
                    if (usesDedicatedLaundryUpload) {
                      return handleLaundryPhotoUpload(files, source);
                    }
                    return handleUpload(field.id, files, source);
                  };
                  return (
                    <div key={field.id} className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {field.label}
                        {field.required ? " *" : ""}
                      </p>
                      <div className="space-y-2 rounded-lg border-2 border-dashed p-3">
                        <div className="flex items-center gap-3">
                          <Camera className="h-5 w-5 text-muted-foreground" />
                          <span className="text-sm">{uploadFieldStatus(field.id)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                            <Camera className="h-3.5 w-3.5" />
                            Take photo
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files?.length) onUpload(e.target.files, "camera");
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                            Upload media
                            <input
                              type="file"
                              accept="image/*,video/*"
                              multiple
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files?.length) onUpload(e.target.files, "gallery");
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                        </div>
                        {renderUnifiedUploadList(field.id)}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
          <Card className={laundryUpdateCollapsed ? "border-success/40 bg-success/10" : undefined}>
            <CardContent className="space-y-3 p-4 text-sm">
              {laundryUpdateCollapsed && savedLaundryUpdate ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">Laundry update sent</p>
                    <p className="mt-1 text-xs text-muted-foreground">{savedLaundryUpdateSummary}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sent at {formatDateTimeLabel(savedLaundryUpdate.submittedAt) ?? savedLaundryUpdate.submittedAt}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLaundryUpdateCollapsed(false)}
                  >
                    Edit update
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">Need to update laundry before the full form is done?</p>
                    <p className="text-xs text-muted-foreground">
                      Send the current laundry status now so the laundry team is not waiting.
                    </p>
                    {lastLaundrySubmittedAt ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Last sent: {formatDateTimeLabel(lastLaundrySubmittedAt) ?? lastLaundrySubmittedAt}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    className="h-11 bg-success text-success-foreground hover:bg-success/90"
                    onClick={handleSendLaundryUpdateNow}
                    disabled={savingLaundryUpdate || !hasStartedJob}
                  >
                    {savingLaundryUpdate ? "Sending..." : "Send laundry update now"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("uploads")}>
              {"<- Back"}
            </Button>
            <Button className="flex-1" onClick={() => setStep("submit")} disabled={hasPendingUploads}>
              {hasPendingUploads ? `Uploading ${pendingUploadCount}...` : "Continue ->"}
            </Button>
          </div>
        </div>
      )}

      {step === "submit" && (
        <div className="space-y-4">
          <h3 className="font-semibold">Ready to Submit?</h3>
          {totalFields > 0 && filledFields < totalFields ? (
            <ProcessNudge
              tone="caution"
              title="A few checklist items are still open"
              message={`${totalFields - filledFields} of ${totalFields} items aren't ticked. Each completed item is logged for quality + pay — finishing them keeps approval and payment quick.`}
            />
          ) : (
            <ProcessNudge
              tone="reassure"
              message="Your photos, GPS and checklist are logged with this submission for quality and accurate pay. Thanks for following the full process."
              compact
            />
          )}
          <Card>
            <CardContent className="space-y-2 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Checklist</span>
                <span>
                  {filledFields}/{totalFields} items
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Uploads</span>
                <span>{uploadedCount} uploaded</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Laundry</span>
                <span>{laundryOutcomeLabel}</span>
              </div>
              {damageItems.length > 0 ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Damage items</span>
                  <span>{damageItems.length} to report</span>
                </div>
              ) : null}
              {payRequestItems.length > 0 ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Extra pay requests</span>
                  <span>{payRequestItems.length} to submit</span>
                </div>
              ) : null}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Time logged</span>
                <span>{formatDuration(elapsed)}</span>
              </div>
            </CardContent>
          </Card>
          {submitFields.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Submission Fields</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {submitFields.map((field: any) => (
                  <div key={field.id}>{renderDynamicFieldInput(field, field?._section)}</div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <HandCoins className="h-4 w-4 text-muted-foreground" />
                  Extra Pay Requests
                </CardTitle>
                {payRequestItems.length > 0 ? (
                  <Badge variant="secondary">
                    {payRequestItems.length} added
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {payRequestItems.length > 0 ? (
                <div className="space-y-2">
                  {payRequestItems.map((item) => {
                    const photoCount = uploads[item.photoFieldId]?.length ?? 0;
                    return (
                      <div
                        key={item.id}
                        className={`rounded-md border p-2.5 ${
                          editingPayRequestId === item.id ? "border-primary bg-primary/5" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{item.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.type === "HOURLY"
                                ? `${item.hours || 0}h × $${Number(item.rate || 0).toFixed(2)} = $${payRequestItemAmount(item).toFixed(2)}`
                                : `Fixed · $${payRequestItemAmount(item).toFixed(2)}`}
                              {photoCount > 0 ? ` · ${photoCount} photo${photoCount === 1 ? "" : "s"}` : ""}
                            </p>
                            {item.description ? (
                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => handleEditPayRequestItem(item.id)}
                              aria-label="Edit pay request"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-destructive"
                              onClick={() => handleRemovePayRequestItem(item.id)}
                              aria-label="Remove pay request"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Need extra pay for this job? Fill the form below and tap "Add pay request". You can add more than one.
                </p>
              )}

              <div className="space-y-2 rounded-md border border-dashed p-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  {editingPayRequestId ? "Edit pay request" : "New pay request"}
                </p>
                <Input
                  className="h-11"
                  placeholder="Request title (e.g. extra hour for heavy soiling)"
                  value={approvalTitle}
                  onChange={(e) => setApprovalTitle(e.target.value)}
                />
                <Textarea
                  rows={2}
                  placeholder="Add details for admin review (optional)."
                  value={approvalDescription}
                  onChange={(e) => setApprovalDescription(e.target.value)}
                />
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Request type</p>
                  <Select value={approvalType} onValueChange={(value) => setApprovalType(value as "HOURLY" | "FIXED")}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIXED">Fixed amount</SelectItem>
                      <SelectItem value="HOURLY">Hourly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  {approvalType === "HOURLY" ? (
                    <>
                      <Input
                        className="h-11"
                        type="number"
                        min={0}
                        step="0.25"
                        placeholder="Extra hours"
                        value={approvalHours}
                        onChange={(e) => setApprovalHours(e.target.value)}
                      />
                      <Input
                        className="h-11"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Rate"
                        value={approvalRate}
                        onChange={(e) => setApprovalRate(e.target.value)}
                      />
                    </>
                  ) : (
                    <Input
                      className="h-11"
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Amount"
                      value={approvalAmount}
                      onChange={(e) => setApprovalAmount(e.target.value)}
                    />
                  )}
                </div>
                <div className="space-y-2 rounded-md border p-2">
                  <p className="text-xs font-medium text-muted-foreground">Evidence images (optional)</p>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-md border px-3 text-xs hover:bg-muted">
                      <Camera className="h-3.5 w-3.5" /> Take photo
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.length) handleUpload(PAY_REQUEST_UPLOAD_FIELD_ID, e.target.files, "camera");
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <label className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-md border px-3 text-xs hover:bg-muted">
                      <Plus className="h-3.5 w-3.5" /> Upload photos
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.length) handleUpload(PAY_REQUEST_UPLOAD_FIELD_ID, e.target.files, "gallery");
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {renderUnifiedUploadList(PAY_REQUEST_UPLOAD_FIELD_ID)}
                </div>
                <div className="flex gap-2">
                  <Button type="button" className="h-11 flex-1" onClick={handleAddPayRequestItem}>
                    <Plus className="mr-1 h-4 w-4" />
                    {editingPayRequestId ? "Save changes" : "Add pay request"}
                  </Button>
                  {editingPayRequestId || payRequestWorkingFieldsDirty() ? (
                    <Button type="button" variant="outline" className="h-11" onClick={resetPayRequestWorkingFields}>
                      Clear
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Added requests are submitted with the job and appear under Pay Requests with status Pending.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className={damageItems.length > 0 ? "border-destructive/50" : ""}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  Damage Report + Cost Recovery
                </CardTitle>
                {damageItems.length > 0 ? (
                  <Badge variant="destructive">
                    {damageItems.length} damage item{damageItems.length === 1 ? "" : "s"} added
                  </Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {damageItems.length > 0 ? (
                <div className="space-y-2">
                  {damageItems.map((item) => {
                    const photoCount = uploads[item.photoFieldId]?.length ?? 0;
                    return (
                      <div
                        key={item.id}
                        className={`rounded-md border p-2.5 ${
                          editingDamageId === item.id ? "border-primary bg-primary/5" : "border-destructive/30 bg-destructive/5"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{item.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {[
                                item.area ? item.area : null,
                                `Severity: ${item.severity}`,
                                Number(item.estimatedCost || 0) > 0
                                  ? `Est. $${Number(item.estimatedCost || 0).toFixed(2)}`
                                  : null,
                                `${photoCount} photo${photoCount === 1 ? "" : "s"}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                            {item.description ? (
                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => handleEditDamageItem(item.id)}
                              aria-label="Edit damage item"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-destructive"
                              onClick={() => handleRemoveDamageItem(item.id)}
                              aria-label="Remove damage item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Found damage? Fill the form below and tap "Add damage item". Each item opens its own priority case for admin
                  when you submit. You can add more than one.
                </p>
              )}

              <div className="space-y-2 rounded-md border border-dashed border-destructive/40 p-3">
                <p className="text-xs font-semibold text-destructive">
                  {editingDamageId ? "Edit damage item" : "New damage item"}
                </p>
                <Input
                  className="h-11"
                  placeholder="Damage title (e.g. cracked shower screen)"
                  value={damageTitle}
                  onChange={(e) => setDamageTitle(e.target.value)}
                />
                <Input
                  className="h-11"
                  placeholder="Area / room (e.g. main bathroom)"
                  value={damageArea}
                  onChange={(e) => setDamageArea(e.target.value)}
                />
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Severity</p>
                  <Select value={damageSeverity} onValueChange={(value) => setDamageSeverity(value as DamageItem["severity"])}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAMAGE_SEVERITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Textarea
                  rows={2}
                  placeholder="Describe the damage and context"
                  value={damageDescription}
                  onChange={(e) => setDamageDescription(e.target.value)}
                />
                <Input
                  className="h-11"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="Estimated recovery cost (optional)"
                  value={damageEstimatedCost}
                  onChange={(e) => setDamageEstimatedCost(e.target.value)}
                />
                <div className="space-y-2 rounded-md border p-2">
                  <p className="text-xs font-medium text-muted-foreground">Damage evidence photos (required)</p>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-md border px-3 text-xs hover:bg-muted">
                      <Camera className="h-3.5 w-3.5" /> Take photo
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.length) handleUpload(DAMAGE_UPLOAD_FIELD_ID, e.target.files, "camera");
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <label className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-md border px-3 text-xs hover:bg-muted">
                      <Plus className="h-3.5 w-3.5" /> Upload photos
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.length) handleUpload(DAMAGE_UPLOAD_FIELD_ID, e.target.files, "gallery");
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {renderUnifiedUploadList(DAMAGE_UPLOAD_FIELD_ID)}
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="destructive" className="h-11 flex-1" onClick={handleAddDamageItem}>
                    <Plus className="mr-1 h-4 w-4" />
                    {editingDamageId ? "Save changes" : "Add damage item"}
                  </Button>
                  {editingDamageId || damageWorkingFieldsDirty() ? (
                    <Button type="button" variant="outline" className="h-11" onClick={resetDamageWorkingFields}>
                      Clear
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Added items are submitted with the job; each opens a priority damage case for admin.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("laundry")}>
              {"<- Back"}
            </Button>
            <Button className="h-11 flex-1" onClick={handleSubmit} disabled={submitting || hasPendingUploads || hasPendingContinuationRequest}>
              <Send className="mr-2 h-4 w-4" />
              {submitting
                ? "Submitting..."
                : hasPendingContinuationRequest
                  ? "Waiting for continuation approval"
                  : hasPendingUploads
                    ? `Uploading ${pendingUploadCount}...`
                    : "Submit Job"}
            </Button>
          </div>
          {hasPendingContinuationRequest ? (
            <p className="text-xs text-destructive">
              Submission is blocked while a pause/continue request is pending admin decision.
            </p>
          ) : null}
        </div>
      )}

      <ProcessConfirm
        open={adherenceConfirmOpen}
        onOpenChange={(open) => {
          if (!open) setAdherenceConfirmOpen(false);
        }}
        title="Before you submit"
        message={adherenceConfirmMessage}
        confirmLabel="Submit anyway"
        cancelLabel="Go back & finish"
        loading={submitting}
        onConfirm={() => {
          // Acknowledged — let the next handleSubmit() pass straight through.
          adherenceBypassRef.current = true;
          setAdherenceConfirmOpen(false);
          void handleSubmit();
        }}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewLabel || "Image preview"}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[75vh] overflow-auto rounded-md border bg-black/5 p-2">
            {previewSrc ? (
              <img
                src={previewSrc}
                alt={previewLabel || "Preview"}
                className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md object-contain"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={gpsCheckinOpen}
        onOpenChange={(open) => {
          if (!open && !gpsCheckinSaving) setGpsCheckinOpen(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              Confirm your check-in location
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              We detected your location at the property. Confirm it&apos;s correct, or adjust the pin if it&apos;s off.
            </p>
            {gpsCheckinFix ? (
              <div className="rounded-xl border border-border bg-surface-raised p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Coordinates</span>
                  <span className="font-medium tabular-nums">
                    {gpsCheckinFix.lat.toFixed(5)}, {gpsCheckinFix.lng.toFixed(5)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Accuracy</span>
                  <span className="font-medium tabular-nums">{formatAccuracy(gpsCheckinFix.accuracy)}</span>
                </div>
                {gpsCheckinFix.adjusted ? (
                  <p className="mt-2 text-xs font-medium text-warning">Pin manually adjusted — admin will be notified.</p>
                ) : null}
              </div>
            ) : null}

            {gpsCheckinAdjustMode ? (
              <div className="space-y-2">
                <div
                  ref={gpsMapRef}
                  className="h-56 w-full overflow-hidden rounded-xl border border-border bg-muted"
                  aria-label="Drag the pin to your real location"
                />
                <p className="text-xs text-muted-foreground">
                  Drag the pin or tap the map to set your real location. If the map can&apos;t load, your captured
                  coordinates are still used.
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Why are you adjusting? (optional)</Label>
                  <Textarea
                    value={gpsCheckinNote}
                    onChange={(event) => setGpsCheckinNote(event.target.value)}
                    placeholder="e.g. GPS placed me on the wrong street"
                    className="min-h-[64px]"
                  />
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              {gpsCheckinAdjustMode ? (
                <Button
                  className="h-11"
                  disabled={gpsCheckinSaving}
                  onClick={() => void submitGpsCheckin(false)}
                >
                  {gpsCheckinSaving ? "Saving..." : "Save adjusted location"}
                </Button>
              ) : (
                <Button
                  className="h-11"
                  disabled={gpsCheckinSaving}
                  onClick={() => void submitGpsCheckin(true)}
                >
                  {gpsCheckinSaving ? "Saving..." : "Confirm location"}
                </Button>
              )}
              {!gpsCheckinAdjustMode ? (
                <Button
                  variant="outline"
                  className="h-11"
                  disabled={gpsCheckinSaving}
                  onClick={() => setGpsCheckinAdjustMode(true)}
                >
                  Adjust location
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="h-11"
                  disabled={gpsCheckinSaving}
                  onClick={() => {
                    setGpsCheckinAdjustMode(false);
                    setGpsCheckinFix((prev) => (prev ? { ...prev, adjusted: false } : prev));
                  }}
                >
                  Cancel adjustment
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={clockReviewOpen} onOpenChange={(open) => (open ? setClockReviewOpen(true) : resetClockReviewState())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review final clock time</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p>
                Current recorded time: <strong>{formatMinutesLabel(timeReview.currentMinutes)}</strong>
              </p>
              <p>
                System final time: <strong>{formatMinutesLabel(timeReview.proposedMinutes)}</strong>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                The system will stop this clock based on {clockLimitSourceLabel(timeReview.limitSource)}.
              </p>
              {timeReview.exceedsAllowedDuration ? (
                <p className="mt-2 text-xs text-warning">
                  The current running time is above the automatic limit. Submit now to use the capped time or request an adjustment for admin approval.
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  If the current clock is still correct, submit without any adjustment.
                </p>
              )}
            </div>

            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                checked={requestClockAdjustment}
                onCheckedChange={(checked) => setRequestClockAdjustment(checked === true)}
              />
              <span>
                Request a clock adjustment for admin approval
                <span className="mt-1 block text-xs text-muted-foreground">
                  Use this if you forgot to pause the clock and need the final time changed.
                </span>
              </span>
            </label>

            {requestClockAdjustment ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Requested final total minutes</Label>
                  <Input
                    type="number"
                    min={1}
                    max={24 * 60}
                    value={clockAdjustmentMinutes}
                    onChange={(e) => setClockAdjustmentMinutes(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Reason</Label>
                  <Textarea
                    rows={3}
                    value={clockAdjustmentReason}
                    onChange={(e) => setClockAdjustmentReason(e.target.value)}
                    placeholder="Explain what happened and what the final clock time should be."
                  />
                </div>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetClockReviewState} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={confirmClockReviewAndSubmit} disabled={submitting}>
                {submitting ? "Submitting..." : requestClockAdjustment ? "Submit and request approval" : "Submit with system time"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
