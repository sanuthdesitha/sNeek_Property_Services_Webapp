"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, Camera, Clock, Eye, MapPin, Play, Send, Square } from "lucide-react";
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
import { SignaturePad } from "@/components/shared/signature-pad";
import type { JobSpecialRequestTask } from "@/lib/jobs/meta";
import { collectRequiredAnswerFields, isTemplateNodeVisible } from "@/lib/forms/visibility";
import {
  INVENTORY_LOCATIONS,
  INVENTORY_LOCATION_LABELS,
  normalizeInventoryLocation,
  type InventoryLocation,
} from "@/lib/inventory/locations";

type Step = "overview" | "checklist" | "uploads" | "laundry" | "submit";
type FormPageSlot = "auto" | "checklist" | "uploads" | "laundry" | "submit";
type RenderableFormStep = Exclude<Step, "overview">;
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
const IMAGE_MAX_DIMENSION = 1600;
const IMAGE_TARGET_BYTES = 1.5 * 1024 * 1024;
const IMAGE_MIN_QUALITY = 0.45;
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

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

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

  if (field?.type === "upload") return "uploads";
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

function carryForwardPhotoFieldId(taskId: string) {
  return `carry_forward_photo_${taskId}`;
}

const DAMAGE_UPLOAD_FIELD_ID = "__damage_report_photos";
const PAY_REQUEST_UPLOAD_FIELD_ID = "__pay_request_photos";

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
  if (draft.step && draft.step !== "overview") return true;
  if (hasMeaningfulDraftValue(draft.formData)) return true;
  if (hasMeaningfulDraftValue(draft.uploads)) return true;
  if (hasMeaningfulDraftValue(draft.savedLaundryUpdate)) return true;
  if (draft.hasMissedTask || draft.extraPaymentRequired || draft.damageFound || draft.showRescheduleForm) {
    return true;
  }
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
  const [step, setStep] = useState<Step>("overview");
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
  const [damageDescription, setDamageDescription] = useState("");
  const [damageEstimatedCost, setDamageEstimatedCost] = useState("0");
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

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hydratedRef = useRef(false);
  const carryoverNoticeShownRef = useRef(false);
  const logoImagePromiseRef = useRef<Promise<HTMLImageElement | null> | null>(null);
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
    if (!activeStartedAt) {
      setIsRunning(false);
      setElapsed(completedSeconds);
      return;
    }

    const startedMs = new Date(activeStartedAt).getTime();
    const tick = () => {
      const activeSeconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
      setElapsed(completedSeconds + activeSeconds);
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
      damageDescription,
      damageEstimatedCost,
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
    setStep((draft.step as Step) ?? options.fallbackStep);
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
    setDamageDescription(typeof draft.damageDescription === "string" ? draft.damageDescription : "");
    setDamageEstimatedCost(typeof draft.damageEstimatedCost === "string" ? draft.damageEstimatedCost : "0");
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

function formatPhotoTimestamp(timezone: string) {
    try {
      return new Intl.DateTimeFormat("en-AU", {
        timeZone: timezone || "Australia/Sydney",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date());
    } catch {
      return new Date().toLocaleString("en-AU");
  }
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

  async function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Could not load image."));
      image.src = url;
    });
  }

  async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
    const objectUrl = URL.createObjectURL(file);
    try {
      return await loadImageFromUrl(objectUrl);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  function getScaledDimensions(width: number, height: number, maxDimension: number) {
    if (!width || !height) return { width: maxDimension, height: maxDimension };
    const ratio = Math.min(1, maxDimension / Math.max(width, height));
    return {
      width: Math.max(1, Math.round(width * ratio)),
      height: Math.max(1, Math.round(height * ratio)),
    };
  }

  async function canvasToCompressedJpeg(
    canvas: HTMLCanvasElement,
    originalName: string,
    targetBytes: number
  ): Promise<File | null> {
    let quality = 0.82;
    let width = canvas.width;
    let height = canvas.height;
    let workingCanvas = canvas;
    let blob: Blob | null = null;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      blob = await new Promise<Blob | null>((resolve) =>
        workingCanvas.toBlob(resolve, "image/jpeg", quality)
      );
      if (!blob) return null;
      if (blob.size <= targetBytes || (quality <= IMAGE_MIN_QUALITY && attempt >= 2)) {
        break;
      }

      if (quality > IMAGE_MIN_QUALITY) {
        quality = Math.max(IMAGE_MIN_QUALITY, quality - 0.1);
        continue;
      }

      width = Math.max(900, Math.round(width * 0.85));
      height = Math.max(900, Math.round(height * 0.85));
      const resized = document.createElement("canvas");
      resized.width = width;
      resized.height = height;
      const ctx = resized.getContext("2d");
      if (!ctx) break;
      ctx.drawImage(workingCanvas, 0, 0, width, height);
      workingCanvas = resized;
    }

    if (!blob) return null;
    const baseName = originalName.replace(/\.[^.]+$/, "") || "upload";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  }

  async function getBrandLogoImage(logoUrl: string): Promise<HTMLImageElement | null> {
    if (!logoUrl) return null;
    if (!logoImagePromiseRef.current) {
      logoImagePromiseRef.current = (async () => {
        try {
          const response = await fetch(logoUrl, { cache: "force-cache" });
          if (!response.ok) return null;
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          try {
            return await loadImageFromUrl(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        } catch {
          return null;
        }
      })();
    }
    return logoImagePromiseRef.current;
  }

  async function stampCameraPhoto(file: File, options: { cleanerName: string; companyName: string; logoUrl: string; timezone: string }) {
    const sourceImage = await loadImageFromFile(file);
    const canvas = document.createElement("canvas");
    const dimensions = getScaledDimensions(
      sourceImage.naturalWidth || sourceImage.width,
      sourceImage.naturalHeight || sourceImage.height,
      IMAGE_MAX_DIMENSION
    );
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

    const padding = Math.max(14, Math.round(canvas.width * 0.015));
    const fontSize = Math.max(14, Math.round(canvas.width * 0.018));
    const lineHeight = Math.round(fontSize * 1.3);
    const logoSize = Math.max(26, Math.round(fontSize * 1.9));
    const gap = Math.max(8, Math.round(fontSize * 0.6));
    const timestamp = formatPhotoTimestamp(options.timezone);
    const lines = [options.cleanerName || "Cleaner", timestamp, options.companyName || "sNeek Property Services"];

    ctx.font = `600 ${fontSize}px Arial, sans-serif`;
    const maxTextWidth = lines.reduce((max, line) => Math.max(max, Math.ceil(ctx.measureText(line).width)), 0);
    const blockHeight = Math.max(logoSize, lineHeight * lines.length);
    const hasLogo = Boolean(options.logoUrl);
    const contentWidth = (hasLogo ? logoSize + gap : 0) + maxTextWidth;
    const boxWidth = contentWidth + padding * 2;
    const boxHeight = blockHeight + padding * 2;
    const boxX = padding;
    const boxY = Math.max(padding, canvas.height - boxHeight - padding);

    ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    const logo = hasLogo ? await getBrandLogoImage(options.logoUrl) : null;
    const leftContentX = boxX + padding;
    const centerY = boxY + padding + blockHeight / 2;
    let textStartX = leftContentX;
    if (logo) {
      const logoY = Math.round(centerY - logoSize / 2);
      ctx.drawImage(logo, leftContentX, logoY, logoSize, logoSize);
      textStartX = leftContentX + logoSize + gap;
    }

    ctx.fillStyle = "#FFFFFF";
    ctx.textBaseline = "top";
    let textY = boxY + padding + Math.max(0, Math.floor((blockHeight - lineHeight * lines.length) / 2));
    for (const line of lines) {
      ctx.fillText(line, textStartX, textY);
      textY += lineHeight;
    }

    const compressed = await canvasToCompressedJpeg(canvas, file.name, IMAGE_TARGET_BYTES);
    return compressed ?? file;
  }

  async function compressGalleryImage(file: File): Promise<File> {
    const sourceImage = await loadImageFromFile(file);
    const canvas = document.createElement("canvas");
    const dimensions = getScaledDimensions(
      sourceImage.naturalWidth || sourceImage.width,
      sourceImage.naturalHeight || sourceImage.height,
      IMAGE_MAX_DIMENSION
    );
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
    const compressed = await canvasToCompressedJpeg(canvas, file.name, IMAGE_TARGET_BYTES);
    return compressed ?? file;
  }

  async function preprocessFilesForUpload(files: File[], source: UploadSource): Promise<File[]> {
    const cleanerName =
      (typeof payload?.viewerName === "string" && payload.viewerName.trim()) ||
      "Cleaner";
    const companyName =
      (typeof payload?.branding?.companyName === "string" && payload.branding.companyName.trim()) ||
      "sNeek Property Services";
    const logoUrl =
      typeof payload?.branding?.logoUrl === "string" ? payload.branding.logoUrl : "";
    const timezone =
      (typeof payload?.startVerification?.timezone === "string" && payload.startVerification.timezone) ||
      "Australia/Sydney";

    const processed: File[] = [];
    let imagePrepFailures = 0;
    for (const file of files) {
      if (!isImageFile(file) || isVideoFile(file)) {
        processed.push(file);
        continue;
      }
      try {
        const prepared =
          source === "camera"
            ? await stampCameraPhoto(file, { cleanerName, companyName, logoUrl, timezone })
            : await compressGalleryImage(file);
        processed.push(prepared);
      } catch {
        imagePrepFailures += 1;
        processed.push(file);
      }
    }
    if (imagePrepFailures > 0) {
      toast({
        title: "Some images were not compressed",
        description:
          source === "camera"
            ? `${imagePrepFailures} camera photo(s) were uploaded without full optimization.`
            : `${imagePrepFailures} gallery image(s) were uploaded without compression.`,
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
        fallbackStep: body?.timeState?.isRunning ? "checklist" : "overview",
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
            : "overview"
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
      setDamageDescription(
        typeof carryoverSnapshot?.damageDescription === "string" ? carryoverSnapshot.damageDescription : ""
      );
      setDamageEstimatedCost(
        typeof carryoverSnapshot?.damageEstimatedCost === "string" ? carryoverSnapshot.damageEstimatedCost : "0"
      );
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
              fallbackStep: body?.timeState?.isRunning ? "checklist" : "overview",
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
    hydratedRef.current = true;
  }

  async function acknowledgeEarlyCheckout(requestId: string) {
    const res = await fetch(`/api/cleaner/job-early-checkouts/${requestId}`, {
      method: "PATCH",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({
        title: "Could not acknowledge update",
        description: body.error ?? "Please retry.",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Early checkout update acknowledged" });
    await load();
  }

  useEffect(() => {
    load();
    return () => {
      stopTicking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

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
    damageDescription,
    damageEstimatedCost,
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
    damageDescription,
    damageEstimatedCost,
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
          fallbackStep: payload?.timeState?.isRunning ? "checklist" : "overview",
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
  const specialRequestTasks: JobSpecialRequestTask[] = Array.isArray(payload?.jobMeta?.specialRequestTasks)
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
  const carryForwardTasks: Array<any> = Array.isArray(payload?.carryForwardTasks) ? payload.carryForwardTasks : [];
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
          fields: (section.fields ?? [])
            .filter((field: any) => isFieldVisible(field, formData, property))
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
            (field: any) => field._resolvedStep === "checklist" && field.type !== "upload"
          ),
        }))
        .filter((section: any) => (section.fields?.length ?? 0) > 0),
    [visibleSections]
  );

  const uploadFields = useMemo(() => {
    const all = visibleSections
      .flatMap((section) =>
        (section.fields ?? [])
          .filter((field: any) => field._resolvedStep === "uploads" && field.type === "upload")
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
    () => laundryFields.filter((field: any) => field.type === "upload"),
    [laundryFields]
  );

  const laundryNonUploadFields = useMemo(
    () => laundryFields.filter((field: any) => field.type !== "upload"),
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
          .filter((field: any) => field._resolvedStep === "submit" && field.type !== "upload")
          .map((field: any) => ({ ...field, sectionLabel: section.label, _section: section }))
      );
    return all.filter(
      (field: any, index: number, arr: any[]) => arr.findIndex((x: any) => x.id === field.id) === index
    );
  }, [visibleSections]);

  const progressFields = useMemo(
    () =>
      visibleSections.flatMap((section: any) =>
        (section.fields ?? []).filter((field: any) => field.type !== "upload")
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

  function startTimer() {
    setIsRunning(true);
    timerRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
  }

  function stopTimer() {
    setIsRunning(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  function resetClockReviewState() {
    setClockReviewOpen(false);
    setRequestClockAdjustment(false);
    setClockAdjustmentMinutes("");
    setClockAdjustmentReason("");
    setPendingSubmitPayload(null);
  }

  async function handleStart() {
    async function submitStart(allowFutureStart: boolean) {
      const res = await fetch(`/api/cleaner/jobs/${params.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationDate,
          confirmOnSite,
          confirmChecklist,
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
    setConfirmOnSite(false);
    setConfirmChecklist(false);
    showPopupNotification("Timer stopped", "You can now start another assigned job.");
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
    const fileArray = await preprocessFilesForUpload(originalFiles, source);
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
                            ? "text-emerald-600"
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
    if (field.type === "checkbox") {
      return (
        <div className="flex items-start gap-3">
          <Checkbox
            id={field.id}
            checked={!!formData[field.id]}
            onCheckedChange={(value) => setFormData((prev) => ({ ...prev, [field.id]: value }))}
          />
          <Label htmlFor={field.id} className="cursor-pointer text-sm leading-snug">
            {field.label}
          </Label>
        </div>
      );
    }

    if (field.type === "textarea") {
      return (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{field.label}</Label>
          <Textarea
            value={formData[field.id] ?? ""}
            onChange={(e) => setFormData((prev) => ({ ...prev, [field.id]: e.target.value }))}
          />
        </div>
      );
    }

    if (field.type === "inventory") {
      return <div>{renderInventoryField(field, section)}</div>;
    }

    if (field.type === "signature") {
      return (
        <SignaturePad
          label={field.label}
          value={typeof formData[field.id] === "string" ? formData[field.id] : ""}
          required={Boolean(field.required)}
          onChange={(value) => setFormData((prev) => ({ ...prev, [field.id]: value }))}
        />
      );
    }

    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">{field.label}</Label>
        <Input
          type={field.type === "number" ? "number" : "text"}
          value={formData[field.id] ?? ""}
          onChange={(e) => setFormData((prev) => ({ ...prev, [field.id]: e.target.value }))}
        />
      </div>
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
    if (damageFound) {
      const damageMediaKeys = uploads[DAMAGE_UPLOAD_FIELD_ID] ?? [];
      if (!damageTitle.trim()) {
        toast({ title: "Damage title is required", variant: "destructive" });
        return null;
      }
      if (damageMediaKeys.length === 0) {
        toast({
          title: "Damage evidence required",
          description: "Upload at least one damage photo before submitting.",
          variant: "destructive",
        });
        return null;
      }
    }
    if (extraPaymentRequired) {
      const pendingPayUploads = (uploadStates[PAY_REQUEST_UPLOAD_FIELD_ID] ?? []).some(
        (item) => item.status === "queued" || item.status === "uploading"
      );
      if (pendingPayUploads) {
        toast({
          title: "Pay request uploads in progress",
          description: "Wait until pay request evidence uploads finish.",
          variant: "destructive",
        });
        return null;
      }
      if (!approvalTitle.trim()) {
        toast({ title: "Pay request title is required", variant: "destructive" });
        return null;
      }
      if (approvalType === "HOURLY") {
        const hours = Number(approvalHours || 0);
        const rate = Number(approvalRate || 0);
        if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(rate) || rate <= 0) {
          toast({ title: "Enter valid hours and rate", variant: "destructive" });
          return null;
        }
      } else {
        const amount = Number(approvalAmount || 0);
        if (!Number.isFinite(amount) || amount <= 0) {
          toast({ title: "Enter a valid pay request amount", variant: "destructive" });
          return null;
        }
      }
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
    const carryForwardTaskPhotoKeys = Object.fromEntries(
      carryForwardTasks.map((task) => {
        const taskId = String(task.id);
        const fieldId = carryForwardPhotoFieldId(taskId);
        return [taskId, uploads[fieldId] ?? []];
      })
    );
    const payloadToSubmit = {
      templateId: template.id,
      laundryOutcome: laundryOutcome ?? undefined,
      laundryReady: laundryOutcome ? laundryReady : undefined,
      laundrySkipReasonCode,
      laundrySkipReasonNote,
      bagLocation,
      draftDamagePayload: damageFound
        ? {
            title: damageTitle.trim(),
            description: damageDescription.trim(),
            estimatedCost: Number(damageEstimatedCost || 0),
            severity: "HIGH",
            mediaKeys: uploads[DAMAGE_UPLOAD_FIELD_ID] ?? [],
          }
        : undefined,
      draftPayRequestPayload: extraPaymentRequired
        ? {
            title: approvalTitle.trim(),
            cleanerNote: approvalDescription.trim(),
            type: approvalType,
            requestedHours: approvalType === "HOURLY" ? Number(approvalHours || 0) : undefined,
            requestedRate: approvalType === "HOURLY" ? Number(approvalRate || 0) : undefined,
            requestedAmount:
              approvalType === "HOURLY"
                ? Number(approvalHours || 0) * Number(approvalRate || 0)
                : Number(approvalAmount || 0),
            mediaKeys: uploads[PAY_REQUEST_UPLOAD_FIELD_ID] ?? [],
          }
        : undefined,
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

  async function handleRequestClientApproval() {
    if (!extraPaymentRequired) {
      toast({ title: "Select extra payment required first.", variant: "destructive" });
      return;
    }
    const pendingPayUploads = (uploadStates[PAY_REQUEST_UPLOAD_FIELD_ID] ?? []).some(
      (item) => item.status === "queued" || item.status === "uploading"
    );
    if (pendingPayUploads) {
      toast({
        title: "Pay request uploads in progress",
        description: "Wait until pay request evidence uploads finish.",
        variant: "destructive",
      });
      return;
    }
    if (!approvalTitle.trim()) {
      toast({ title: "Request title is required", variant: "destructive" });
      return;
    }
    if (approvalType === "HOURLY") {
      const hours = Number(approvalHours || 0);
      const rate = Number(approvalRate || 0);
      if (!Number.isFinite(hours) || hours <= 0) {
        toast({ title: "Hours must be greater than 0", variant: "destructive" });
        return;
      }
      if (!Number.isFinite(rate) || rate <= 0) {
        toast({ title: "Rate must be greater than 0", variant: "destructive" });
        return;
      }
    } else {
      const amount = Number(approvalAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast({ title: "Amount must be greater than 0", variant: "destructive" });
        return;
      }
    }
    showPopupNotification("Pay request saved", "It will be submitted together with the job form.");
  }

  async function handleReportDamage() {
    if (!damageFound) {
      toast({ title: "Tick damage found first.", variant: "destructive" });
      return;
    }
    if (!damageTitle.trim()) {
      toast({ title: "Damage title is required", variant: "destructive" });
      return;
    }
    const mediaKeys = uploads[DAMAGE_UPLOAD_FIELD_ID] ?? [];
    const pendingDamageUploads = (uploadStates[DAMAGE_UPLOAD_FIELD_ID] ?? []).some(
      (item) => item.status === "queued" || item.status === "uploading"
    );
    if (pendingDamageUploads) {
      toast({
        title: "Damage uploads in progress",
        description: "Wait until evidence uploads finish.",
        variant: "destructive",
      });
      return;
    }
    if (mediaKeys.length === 0) {
      toast({
        title: "Damage photo required",
        description: "Upload or capture at least one photo as evidence.",
        variant: "destructive",
      });
      return;
    }
    showPopupNotification("Damage report saved", "It will be submitted with the full job form.");
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
          damageDescription,
          damageEstimatedCost,
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/cleaner">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{job?.property?.name}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {job?.property?.address}
          </p>
        </div>
        <Badge>{job?.status?.replace(/_/g, " ")}</Badge>
      </div>

      {(cleanerTags.length > 0 || Boolean(cleanerInstructionText) || hasJobNotes) ? (
        <div className="flex flex-wrap gap-2">
          {cleanerTags.map((tag) => (
            <Badge
              key={`detail-tag-${tag}`}
              variant="secondary"
              className="border-sky-200 bg-sky-50 text-sky-800"
            >
              {tag}
            </Badge>
          ))}
          {cleanerInstructionText ? (
            <Badge variant="secondary" className="border-blue-200 bg-blue-50 text-blue-800">
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

      {pendingSync ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          A previous submission is queued for sync. It will auto-submit when internet is available.
        </div>
      ) : null}

      {hasContinuationCarryover ? (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          Continuation mode: progress from the previous cleaner has been prefilled for this job.
        </div>
      ) : null}

      {latestEarlyCheckoutRequest ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-900">Early Checkout Update</p>
              <p className="mt-2 text-sm text-rose-950">
                {pendingEarlyCheckoutRequest ? "Admin requested an earlier start/update for this job." : "This job had an early checkout update."}
              </p>
              {latestEarlyCheckoutRequest.requestedStartTime ? (
                <p className="mt-1 text-xs text-rose-900">Requested earlier start: {latestEarlyCheckoutRequest.requestedStartTime}</p>
              ) : null}
              {latestEarlyCheckoutRequest.note ? (
                <p className="mt-1 text-xs text-rose-900">Admin note: {latestEarlyCheckoutRequest.note}</p>
              ) : null}
            </div>
            {pendingEarlyCheckoutRequest ? (
              <Button size="sm" variant="outline" onClick={() => acknowledgeEarlyCheckout(pendingEarlyCheckoutRequest.id)}>
                Acknowledge
              </Button>
            ) : (
              <Badge variant="success">Acknowledged</Badge>
            )}
          </div>
        </div>
      ) : null}

      {jobTimingHighlights.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Priority Timing</p>
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
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-900">Cleaner Notes</p>
          <p className="mt-2 text-sm text-blue-950">{cleanerInstructionText}</p>
        </div>
      ) : null}

      {hasJobNotes && showJobNotes ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Job Notes</p>
          <p className="mt-2 text-sm text-slate-950">{job.notes}</p>
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
              <Button onClick={handleStart} disabled={finished}>
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

      <div className="flex gap-1 text-xs">
        {["overview", "checklist", "uploads", "laundry", "submit"].map((item, i) => (
          <div
            key={item}
            className={`h-1.5 flex-1 rounded-full ${
              step === item ? "bg-primary" : i < ["overview", "checklist", "uploads", "laundry", "submit"].indexOf(step) ? "bg-primary/40" : "bg-muted"
            }`}
          />
        ))}
      </div>

      {step === "overview" && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{job?.jobType?.replace(/_/g, " ")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Review timing, notes, and any admin-requested tasks above before starting.
            </p>

            <div className="mt-4 space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Start verification</p>
              {startVerification?.requireDateMatch && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Enter scheduled date ({startVerification?.timezone ?? "Australia/Sydney"})
                  </Label>
                  <Input type="date" value={verificationDate} onChange={(e) => setVerificationDate(e.target.value)} />
                </div>
              )}
              {startVerification?.requireChecklistConfirm && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={confirmOnSite} onChange={(e) => setConfirmOnSite(e.target.checked)} />
                    I confirm I am on site and have property access.
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={confirmChecklist}
                      onChange={(e) => setConfirmChecklist(e.target.checked)}
                    />
                    I confirm I checked notes and safety requirements.
                  </label>
                </div>
              )}
            </div>

            {finished && (
              <p className="mt-3 text-xs text-destructive">
                This job is already submitted/completed. Admin must reset status before it can start again.
              </p>
            )}

            <Button className="mt-4 w-full" onClick={handleStart} disabled={finished}>
              <Play className="mr-2 h-4 w-4" />
              {elapsed > 0 || job?.status === "IN_PROGRESS" ? "Resume Job" : "Start Job"}
            </Button>
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
                            <span className="text-[11px] text-emerald-700">Ready</span>
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
          {hasPendingUploads ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Uploading {pendingUploadCount} file(s). Please wait before continuing.
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            {checklistUploadFields.map((field: any) => (
              <div key={field.id} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {field.label}
                  {field.required ? " *" : ""}
                </p>
                <div
                  className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-2 transition-colors ${
                    uploadFieldComplete(field.id) ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary"
                  }`}
                >
                  <Camera className={`h-6 w-6 ${uploadFieldComplete(field.id) ? "text-primary" : "text-muted-foreground"}`} />
                  <span className="text-center text-xs">{uploadFieldStatus(field.id)}</span>
                  <div className="flex w-full flex-wrap items-center justify-center gap-2">
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
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted">
                      Upload media
                      <input
                        type="file"
                        accept="image/*,video/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files?.length) handleUpload(field.id, e.target.files, "gallery");
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
                {renderUnifiedUploadList(field.id)}
              </div>
            ))}
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
          <Card className={laundryUpdateCollapsed ? "border-emerald-200 bg-emerald-50/70" : undefined}>
            <CardContent className="space-y-3 p-4 text-sm">
              {laundryUpdateCollapsed && savedLaundryUpdate ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-emerald-900">Laundry update sent</p>
                    <p className="mt-1 text-xs text-emerald-900">{savedLaundryUpdateSummary}</p>
                    <p className="mt-1 text-xs text-emerald-800">
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
                    className="bg-emerald-600 text-white shadow-[0_10px_24px_-12px_rgba(5,150,105,0.8)] hover:bg-emerald-700 hover:text-white"
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
              <CardTitle className="text-sm">Extra Pay Request (Admin Review)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <label className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
                <Checkbox
                  checked={extraPaymentRequired}
                  onCheckedChange={(checked) => setExtraPaymentRequired(checked === true)}
                />
                Extra payment required for this job
              </label>
              {extraPaymentRequired ? (
                <>
                  <Input
                    placeholder="Request title"
                    value={approvalTitle}
                    onChange={(e) => setApprovalTitle(e.target.value)}
                  />
                  <Textarea
                    rows={2}
                    placeholder="Add details for admin review (optional)."
                    value={approvalDescription}
                    onChange={(e) => setApprovalDescription(e.target.value)}
                  />
                  <div className="space-y-2 rounded-md border p-2">
                    <p className="text-xs font-medium text-muted-foreground">Pay request evidence images (optional)</p>
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                        Take photo
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
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                        Upload photos
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
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Request type</p>
                    <Select value={approvalType} onValueChange={(value) => setApprovalType(value as "HOURLY" | "FIXED")}>
                      <SelectTrigger>
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
                          type="number"
                          min={0}
                          step="0.25"
                          placeholder="Hours"
                          value={approvalHours}
                          onChange={(e) => setApprovalHours(e.target.value)}
                        />
                        <Input
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
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Amount"
                        value={approvalAmount}
                        onChange={(e) => setApprovalAmount(e.target.value)}
                      />
                    )}
                    <Button variant="outline" onClick={handleRequestClientApproval}>
                      Save draft
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This request stays attached to the form and is submitted with the full job submission.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Select the option above to create an extra pay request.</p>
              )}
            </CardContent>
          </Card>

          <Card className={damageFound ? "border-destructive/50" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Damage Report + Cost Recovery</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <label className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                <Checkbox
                  checked={damageFound}
                  onCheckedChange={(checked) => setDamageFound(checked === true)}
                />
                Damage found at this property
              </label>
              {damageFound ? (
                <>
                  <p className="text-xs font-medium text-destructive">
                    This opens a priority case for admin. Evidence photos are required.
                  </p>
                  <Input placeholder="Damage title" value={damageTitle} onChange={(e) => setDamageTitle(e.target.value)} />
                  <Textarea
                    rows={2}
                    placeholder="Describe damage evidence and context"
                    value={damageDescription}
                    onChange={(e) => setDamageDescription(e.target.value)}
                  />
                  <div className="space-y-2 rounded-md border p-2">
                    <p className="text-xs font-medium text-muted-foreground">Damage evidence photos</p>
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                        Take photo
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
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                        Upload photos
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
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="Estimated recovery cost"
                      value={damageEstimatedCost}
                      onChange={(e) => setDamageEstimatedCost(e.target.value)}
                    />
                    <Button variant="outline" onClick={handleReportDamage}>
                      Save draft
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The damage case is created only when the full form is submitted.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Tick "Damage found" to open a damage case.</p>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep("laundry")}>
              {"<- Back"}
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={submitting || hasPendingUploads || hasPendingContinuationRequest}>
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
                <p className="mt-2 text-xs text-amber-700">
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
