"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, format, startOfDay, startOfWeek } from "date-fns";
import { AlertTriangle, Camera, CheckCircle2, ChevronDown, ChevronRight, Copy, FilePenLine, History, Shirt, Trash2, Truck, Undo2 } from "lucide-react";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MediaGallery } from "@/components/shared/media-gallery";
import { ImmediateAttentionPanel } from "@/components/shared/immediate-attention-panel";
import { AccessInstructionsPanel } from "@/components/shared/access-instructions-panel";
import { LAUNDRY_SKIP_REASONS } from "@/lib/laundry/constants";
import { WorkforceDashboardPosts } from "@/components/workforce/dashboard-posts";

type ActionType =
  | "PICKED_UP"
  | "RETURNED"
  | "REVERT_TO_CONFIRMED"
  | "REVERT_TO_PICKED_UP"
  | "EDIT_COMPLETED"
  | "FAILED_PICKUP";
type FailedPickupMode = "RESCHEDULE" | "REQUEST_SKIP" | "REQUEST_DELETE";
type RangeMode = "day" | "week" | "month" | "all";
type ReadyFilter = "all" | "today" | "tomorrow";
type SortMode = "pickup_asc" | "pickup_desc" | "updated_desc" | "property_asc";
type ViewMode = "compact" | "full";
type UploadSource = "camera" | "gallery";
const LAUNDRY_PREFS_KEY = "sneek_laundry_prefs";

function parseEventNotes(notes: string | null | undefined): any {
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch {
    return null;
  }
}

function getAccessInfo(task: any) {
  const accessInfo = task?.property?.accessInfo;
  if (!accessInfo || typeof accessInfo !== "object") return null;
  return accessInfo as Record<string, any>;
}

function LaundryAccessInstructions({ task }: { task: any }) {
  const accessInfo = getAccessInfo(task);
  return (
    <AccessInstructionsPanel
      accessInfo={accessInfo}
      title="Property Access Instructions"
      className="mt-3"
    />
  );
}

function buildTimeline(task: any) {
  const events: Array<{ at: Date; label: string }> = [];
  if (task.createdAt) events.push({ at: new Date(task.createdAt), label: "Task created" });
  if (task.confirmedAt) events.push({ at: new Date(task.confirmedAt), label: "Laundry confirmed by cleaner" });

  if (Array.isArray(task.confirmations)) {
    for (const confirmation of task.confirmations) {
      const meta = parseEventNotes(confirmation.notes);
      if (meta?.event === "PICKED_UP") {
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Picked up${meta.bagCount ? ` (${meta.bagCount} bag${meta.bagCount > 1 ? "s" : ""})` : ""}`,
        });
        continue;
      }
      if (meta?.event === "DROPPED") {
        const droppedEarly = isEarlyDropoffDay(meta?.actualDroppedAt, meta?.intendedDropoffDate);
        events.push({
          at: new Date(confirmation.createdAt),
          label: `${droppedEarly ? "Returned early" : "Returned"}${meta.dropoffLocation ? ` to ${meta.dropoffLocation}` : ""}${
            typeof meta.totalPrice === "number" ? ` ($${Number(meta.totalPrice).toFixed(2)})` : ""
          }${
            typeof meta.loadWeightKg === "number" ? ` (${Number(meta.loadWeightKg).toFixed(1)} kg)` : ""
          }${
            droppedEarly && meta?.intendedDropoffDate && meta?.actualDroppedAt
              ? ` [planned ${format(new Date(meta.intendedDropoffDate), "dd MMM")}, actual ${format(new Date(meta.actualDroppedAt), "dd MMM")}]`
              : ""
          }`,
        });
        continue;
      }
      if (meta?.event === "EDIT_COMPLETED") {
        const changedCount = Array.isArray(meta.changedFields) ? meta.changedFields.length : 0;
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Completion details edited${changedCount > 0 ? ` (${changedCount} fields)` : ""}`,
        });
        continue;
      }
      if (meta?.event === "REVERT_TO_CONFIRMED") {
        events.push({ at: new Date(confirmation.createdAt), label: "Reverted back to Confirmed" });
        continue;
      }
      if (meta?.event === "REVERT_TO_PICKED_UP") {
        events.push({ at: new Date(confirmation.createdAt), label: "Reverted back to Picked Up" });
        continue;
      }
      if (meta?.event === "FAILED_PICKUP_RESCHEDULE") {
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Failed pickup rescheduled to ${
            meta.rescheduledPickupDate ? format(new Date(meta.rescheduledPickupDate), "dd MMM") : "a new date"
          }${meta.reason ? ` (${meta.reason})` : ""}`,
        });
        continue;
      }
      if (meta?.event === "FAILED_PICKUP_REQUEST") {
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Failed pickup approval requested for ${String(meta.requestedAction ?? "SKIP").toLowerCase()}${
            meta.reason ? ` (${meta.reason})` : ""
          }`,
        });
        continue;
      }
      if (meta?.event === "FAILED_PICKUP_SKIP_APPROVED") {
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Admin approved skipped pickup${meta.resolutionNotes ? ` (${meta.resolutionNotes})` : ""}`,
        });
        continue;
      }
      if (meta?.event === "FAILED_PICKUP_REQUEST_REJECTED") {
        events.push({
          at: new Date(confirmation.createdAt),
          label: `Admin rejected failed pickup request${meta.resolutionNotes ? ` (${meta.resolutionNotes})` : ""}`,
        });
        continue;
      }
      events.push({
        at: new Date(confirmation.createdAt),
        label: confirmation.laundryReady
          ? `Cleaner marked ready${confirmation.bagLocation ? ` (${confirmation.bagLocation})` : ""}`
          : "Cleaner marked not ready",
      });
    }
  }

  if (task.pickedUpAt) events.push({ at: new Date(task.pickedUpAt), label: "Picked up" });
  if (task.droppedAt) events.push({ at: new Date(task.droppedAt), label: "Returned" });
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

function getCleanerLaundryConfirmation(task: any) {
  const confirmations = Array.isArray(task?.confirmations) ? task.confirmations : [];
  return confirmations.find((confirmation: any) => {
    const meta = parseEventNotes(confirmation.notes);
    return confirmation?.laundryReady === true && Boolean(confirmation?.photoUrl) && !meta?.event;
  });
}

function getEventConfirmation(task: any, eventName: string) {
  const confirmations = Array.isArray(task?.confirmations) ? [...task.confirmations] : [];
  return confirmations.reverse().find((confirmation: any) => {
    const meta = parseEventNotes(confirmation.notes);
    return meta?.event === eventName;
  });
}

function getEventMeta(task: any, eventName: string) {
  const confirmation = getEventConfirmation(task, eventName);
  return parseEventNotes(confirmation?.notes);
}

function getPendingFailedPickupRequest(task: any) {
  const confirmations = Array.isArray(task?.confirmations) ? [...task.confirmations] : [];
  const row = confirmations.reverse().find((confirmation: any) => {
    const meta = parseEventNotes(confirmation?.notes);
    return meta?.event === "FAILED_PICKUP_REQUEST" && meta?.approvalStatus === "PENDING";
  });
  return row ? parseEventNotes(row.notes) : null;
}

function getTaskCompletionDetails(task: any) {
  const pickupMeta = getEventMeta(task, "PICKED_UP") ?? {};
  const droppedConfirmation = getEventConfirmation(task, "DROPPED");
  const droppedMeta = getEventMeta(task, "DROPPED") ?? {};
  const dropoffLocation =
    typeof droppedMeta.dropoffLocation === "string" && droppedMeta.dropoffLocation.trim()
      ? droppedMeta.dropoffLocation.trim()
      : droppedConfirmation?.bagLocation || "";

  return {
    bagCount:
      typeof pickupMeta.bagCount === "number" && Number.isFinite(pickupMeta.bagCount)
        ? Math.max(1, Math.round(pickupMeta.bagCount))
        : 1,
    dropoffLocation,
    totalPrice:
      typeof droppedMeta.totalPrice === "number" && Number.isFinite(droppedMeta.totalPrice)
        ? droppedMeta.totalPrice
        : null,
    loadWeightKg:
      typeof droppedMeta.loadWeightKg === "number" && Number.isFinite(droppedMeta.loadWeightKg)
        ? droppedMeta.loadWeightKg
        : null,
    supplierId:
      typeof droppedMeta.supplierId === "string" && droppedMeta.supplierId.trim()
        ? droppedMeta.supplierId.trim()
        : typeof task?.supplierId === "string" && task.supplierId.trim()
          ? task.supplierId.trim()
          : "",
    receiptImageUrl:
      typeof task?.receiptImageUrl === "string" && task.receiptImageUrl.trim()
        ? task.receiptImageUrl.trim()
        : "",
    earlyDropoffReason:
      typeof droppedMeta.earlyDropoffReason === "string" ? droppedMeta.earlyDropoffReason : "",
    notes:
      typeof droppedMeta.notes === "string" && droppedMeta.notes.trim()
        ? droppedMeta.notes
        : typeof task?.flagNotes === "string"
          ? task.flagNotes
          : "",
  };
}

function isEarlyDropoffDay(actual: Date | string | null | undefined, planned: Date | string | null | undefined) {
  if (!actual || !planned) return false;
  return startOfDay(new Date(actual)).getTime() < startOfDay(new Date(planned)).getTime();
}

function isEarlyDropoffCandidate(task: any) {
  if (!task?.dropoffDate) return false;
  return isEarlyDropoffDay(new Date(), task.dropoffDate);
}

function toDayKey(value: Date | string) {
  const d = new Date(value);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function isOlderCompletedTask(task: any) {
  if (task?.status !== "DROPPED" || !task?.droppedAt) return false;
  return new Date(task.droppedAt).getTime() < Date.now() - 3 * 24 * 60 * 60 * 1000;
}

function isImageFile(file: File) {
  return file.type?.toLowerCase().startsWith("image/") || /\.(jpg|jpeg|png|webp|gif|bmp|heic|heif)$/i.test(file.name ?? "");
}

export default function LaundryPortal() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [historyTasks, setHistoryTasks] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [dropoffOptions, setDropoffOptions] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [laundryConfig, setLaundryConfig] = useState({
    showHistoryTab: true,
    showCostTracking: true,
    showPickupPhoto: true,
    requireDropoffPhoto: true,
    requireEarlyDropoffReason: true,
    pickupCutoffTime: "10:00",
    defaultPickupTime: "09:00",
    defaultDropoffTime: "16:00",
    maxOutdoorDays: 3,
  });
  const [rangeMode, setRangeMode] = useState<RangeMode>("week");
  const [readyFilter, setReadyFilter] = useState<ReadyFilter>("today");
  const [sortMode, setSortMode] = useState<SortMode>("pickup_asc");
  const [viewMode, setViewMode] = useState<ViewMode>("full");
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(new Set());
  const [activeLaundryTab, setActiveLaundryTab] = useState("active");

  const [actionTask, setActionTask] = useState<any | null>(null);
  const [actionType, setActionType] = useState<ActionType | null>(null);
  const [bagCount, setBagCount] = useState("1");
  const [pickupPhoto, setPickupPhoto] = useState<File | null>(null);
  const [dropoffSelection, setDropoffSelection] = useState<string>("__custom");
  const [dropoffCustom, setDropoffCustom] = useState("");
  const [dropoffPhoto, setDropoffPhoto] = useState<File | null>(null);
  const [receiptPhoto, setReceiptPhoto] = useState<File | null>(null);
  const [supplierSelection, setSupplierSelection] = useState<string>("__none");
  const [dropoffTotalPrice, setDropoffTotalPrice] = useState("");
  const [dropoffWeightKg, setDropoffWeightKg] = useState("");
  const [earlyDropoffReason, setEarlyDropoffReason] = useState("");
  const [actionNotes, setActionNotes] = useState("");
  const [failedPickupMode, setFailedPickupMode] = useState<FailedPickupMode>("RESCHEDULE");
  const [failedPickupDate, setFailedPickupDate] = useState("");
  const [failedPickupReason, setFailedPickupReason] = useState("");
  const [confirmAction, setConfirmAction] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pickupPhotoPreviewUrl, setPickupPhotoPreviewUrl] = useState("");
  const [dropoffPhotoPreviewUrl, setDropoffPhotoPreviewUrl] = useState("");
  const [receiptPhotoPreviewUrl, setReceiptPhotoPreviewUrl] = useState("");
  const [viewerName, setViewerName] = useState("Laundry Team");
  const [companyName, setCompanyName] = useState("sNeek Property Services");
  const [companyLogoUrl, setCompanyLogoUrl] = useState("");
  const [appTimezone, setAppTimezone] = useState("Australia/Sydney");
  const [teamPosts, setTeamPosts] = useState<any[]>([]);
  const [qrTask, setQrTask] = useState<any | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [scanningQr, setScanningQr] = useState(false);
  const logoImagePromiseRef = useRef<Promise<HTMLImageElement | null> | null>(null);

  function resetActionState() {
    setActionTask(null);
    setActionType(null);
    setBagCount("1");
    setPickupPhoto(null);
    setDropoffSelection(dropoffOptions[0] ?? "__custom");
    setDropoffCustom("");
    setDropoffPhoto(null);
    setReceiptPhoto(null);
    setSupplierSelection("__none");
    setDropoffTotalPrice("");
    setDropoffWeightKg("");
    setEarlyDropoffReason("");
    setActionNotes("");
    setFailedPickupMode("RESCHEDULE");
    setFailedPickupDate("");
    setFailedPickupReason("");
    setConfirmAction(false);
  }

  useEffect(() => {
    if (!pickupPhoto) {
      setPickupPhotoPreviewUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(pickupPhoto);
    setPickupPhotoPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [pickupPhoto]);

  useEffect(() => {
    if (!dropoffPhoto) {
      setDropoffPhotoPreviewUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(dropoffPhoto);
    setDropoffPhotoPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [dropoffPhoto]);

  useEffect(() => {
    if (!receiptPhoto) {
      setReceiptPhotoPreviewUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(receiptPhoto);
    setReceiptPhotoPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [receiptPhoto]);

  function openAction(task: any, type: ActionType) {
    setActionTask(task);
    setActionType(type);
    const completion = getTaskCompletionDetails(task);
    setBagCount(type === "EDIT_COMPLETED" ? String(completion.bagCount) : "1");
    setPickupPhoto(null);
    if (type === "EDIT_COMPLETED") {
      if (completion.dropoffLocation && dropoffOptions.includes(completion.dropoffLocation)) {
        setDropoffSelection(completion.dropoffLocation);
        setDropoffCustom("");
      } else {
        setDropoffSelection(completion.dropoffLocation ? "__custom" : dropoffOptions[0] ?? "__custom");
        setDropoffCustom(completion.dropoffLocation || "");
      }
    } else {
      setDropoffSelection(dropoffOptions[0] ?? "__custom");
      setDropoffCustom("");
    }
    setDropoffPhoto(null);
    setReceiptPhoto(null);
    setSupplierSelection(type === "EDIT_COMPLETED" && completion.supplierId ? completion.supplierId : "__none");
    setDropoffTotalPrice(type === "EDIT_COMPLETED" && completion.totalPrice != null ? String(completion.totalPrice) : "");
    setDropoffWeightKg(type === "EDIT_COMPLETED" && completion.loadWeightKg != null ? String(completion.loadWeightKg) : "");
    setEarlyDropoffReason(type === "EDIT_COMPLETED" ? completion.earlyDropoffReason : "");
    setActionNotes(type === "EDIT_COMPLETED" ? completion.notes : "");
    setFailedPickupMode("RESCHEDULE");
    setFailedPickupDate("");
    setFailedPickupReason("");
    setConfirmAction(false);
  }

  function load() {
    const days = rangeMode === "day" ? 1 : rangeMode === "month" ? 31 : rangeMode === "all" ? 366 : 7;
    fetch(`/api/laundry/week?start=${weekStart.toISOString()}&days=${days}`).then((r) => r.json()).then((data) => setTasks(Array.isArray(data) ? data : []));
    fetch(`/api/laundry/history`).then((r) => r.json()).then((data) => setHistoryTasks(Array.isArray(data) ? data : []));
    fetch(`/api/me/workforce`).then((r) => r.json()).then((data) => setTeamPosts(Array.isArray(data?.posts) ? data.posts.slice(0, 3) : []));
    fetch(`/api/laundry/options`).then((r) => r.json()).then((data) => {
      const options = Array.isArray(data?.dropoffLocationOptions) ? data.dropoffLocationOptions : [];
      const supplierRows = Array.isArray(data?.suppliers) ? data.suppliers : [];
      setDropoffOptions(options);
      setSuppliers(supplierRows);
      if (options.length > 0) setDropoffSelection(options[0]);
      setViewerName(typeof data?.viewerName === "string" && data.viewerName.trim() ? data.viewerName.trim() : "Laundry Team");
      setCompanyName(
        typeof data?.branding?.companyName === "string" && data.branding.companyName.trim()
          ? data.branding.companyName.trim()
          : "sNeek Property Services"
      );
      setCompanyLogoUrl(typeof data?.branding?.logoUrl === "string" ? data.branding.logoUrl : "");
      setAppTimezone(
        typeof data?.timezone === "string" && data.timezone.trim() ? data.timezone.trim() : "Australia/Sydney"
      );
      setLaundryConfig((prev) => ({
        showHistoryTab: typeof data?.portalVisibility?.showHistoryTab === "boolean" ? data.portalVisibility.showHistoryTab : prev.showHistoryTab,
        showCostTracking: typeof data?.portalVisibility?.showCostTracking === "boolean" ? data.portalVisibility.showCostTracking : prev.showCostTracking,
        showPickupPhoto: typeof data?.portalVisibility?.showPickupPhoto === "boolean" ? data.portalVisibility.showPickupPhoto : prev.showPickupPhoto,
        requireDropoffPhoto:
          typeof data?.portalVisibility?.requireDropoffPhoto === "boolean"
            ? data.portalVisibility.requireDropoffPhoto
            : prev.requireDropoffPhoto,
        requireEarlyDropoffReason:
          typeof data?.portalVisibility?.requireEarlyDropoffReason === "boolean"
            ? data.portalVisibility.requireEarlyDropoffReason
            : prev.requireEarlyDropoffReason,
        pickupCutoffTime:
          typeof data?.operations?.pickupCutoffTime === "string" ? data.operations.pickupCutoffTime : prev.pickupCutoffTime,
        defaultPickupTime:
          typeof data?.operations?.defaultPickupTime === "string" ? data.operations.defaultPickupTime : prev.defaultPickupTime,
        defaultDropoffTime:
          typeof data?.operations?.defaultDropoffTime === "string" ? data.operations.defaultDropoffTime : prev.defaultDropoffTime,
        maxOutdoorDays:
          typeof data?.operations?.maxOutdoorDays === "number" ? data.operations.maxOutdoorDays : prev.maxOutdoorDays,
      }));
    });
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAUNDRY_PREFS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.rangeMode) setRangeMode(parsed.rangeMode as RangeMode);
      if (parsed?.readyFilter) setReadyFilter(parsed.readyFilter as ReadyFilter);
      if (parsed?.sortMode) setSortMode(parsed.sortMode as SortMode);
      if (parsed?.viewMode) setViewMode(parsed.viewMode as ViewMode);
      if (parsed?.activeLaundryTab) setActiveLaundryTab(parsed.activeLaundryTab);
    } catch {
      // Ignore invalid saved prefs.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        LAUNDRY_PREFS_KEY,
        JSON.stringify({ rangeMode, readyFilter, sortMode, viewMode, activeLaundryTab })
      );
    } catch {
      // Ignore storage failures.
    }
  }, [rangeMode, readyFilter, sortMode, viewMode, activeLaundryTab]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, rangeMode]);

  useEffect(() => {
    logoImagePromiseRef.current = null;
  }, [companyLogoUrl]);

  useEffect(() => {
    if (!qrTask?.id) {
      setQrCodeUrl("");
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(qrTask.id, { width: 280, margin: 1 })
      .then((url: string) => {
        if (!cancelled) setQrCodeUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrCodeUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [qrTask]);

  async function decodeQrFromFile(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("Could not read QR image."));
      reader.readAsDataURL(file);
    });

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Could not load QR image."));
      nextImage.src = dataUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not open QR scanner.");
    context.drawImage(image, 0, 0);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height);
    return result?.data?.trim() || null;
  }

  function openTaskFromQrValue(value: string) {
    const target = [...tasks, ...historyTasks].find((task) => task.id === value);
    if (!target) {
      toast({ title: "QR code not recognised", description: "No laundry task matched that QR code.", variant: "destructive" });
      return;
    }

    if (target.status === "CONFIRMED" || target.status === "PENDING") {
      openAction(target, "PICKED_UP");
      return;
    }
    if (target.status === "PICKED_UP") {
      openAction(target, "RETURNED");
      return;
    }
    if (target.status === "DROPPED") {
      openAction(target, "EDIT_COMPLETED");
      return;
    }

    toast({
      title: "Task found",
      description: `${target.property?.name ?? "Laundry task"} is currently ${String(target.status).replace(/_/g, " ").toLowerCase()}.`,
    });
  }

  async function handleQrScanSelection(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setScanningQr(true);
    try {
      const value = await decodeQrFromFile(file);
      if (!value) {
        toast({ title: "Scan failed", description: "No QR code was detected in that image.", variant: "destructive" });
        return;
      }
      openTaskFromQrValue(value);
    } catch (error: any) {
      toast({ title: "Scan failed", description: error?.message ?? "Could not scan the QR code.", variant: "destructive" });
    } finally {
      setScanningQr(false);
    }
  }

  function formatPhotoTimestamp() {
    try {
      return new Intl.DateTimeFormat("en-AU", {
        timeZone: appTimezone || "Australia/Sydney",
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

  async function getBrandLogoImage(): Promise<HTMLImageElement | null> {
    if (!companyLogoUrl) return null;
    if (!logoImagePromiseRef.current) {
      logoImagePromiseRef.current = (async () => {
        try {
          const response = await fetch(companyLogoUrl, { cache: "force-cache" });
          if (!response.ok) return null;
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          try {
            return await loadImageFromUrl(objectUrl);
          } finally {
            URL.revokeObjectURL(objectUrl);
          }
        } catch {
          return null;
        }
      })();
    }
    return logoImagePromiseRef.current;
  }

  async function stampCameraPhoto(file: File): Promise<File> {
    const sourceImage = await loadImageFromFile(file);
    const canvas = document.createElement("canvas");
    canvas.width = sourceImage.naturalWidth || sourceImage.width;
    canvas.height = sourceImage.naturalHeight || sourceImage.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

    const padding = Math.max(14, Math.round(canvas.width * 0.015));
    const fontSize = Math.max(14, Math.round(canvas.width * 0.018));
    const lineHeight = Math.round(fontSize * 1.3);
    const logoSize = Math.max(26, Math.round(fontSize * 1.9));
    const gap = Math.max(8, Math.round(fontSize * 0.6));
    const lines = [viewerName || "Laundry Team", formatPhotoTimestamp(), companyName || "sNeek Property Services"];

    ctx.font = `600 ${fontSize}px Arial, sans-serif`;
    const maxTextWidth = lines.reduce((max, line) => Math.max(max, Math.ceil(ctx.measureText(line).width)), 0);
    const hasLogo = Boolean(companyLogoUrl);
    const blockHeight = Math.max(logoSize, lineHeight * lines.length);
    const contentWidth = (hasLogo ? logoSize + gap : 0) + maxTextWidth;
    const boxWidth = contentWidth + padding * 2;
    const boxHeight = blockHeight + padding * 2;
    const boxX = padding;
    const boxY = Math.max(padding, canvas.height - boxHeight - padding);

    ctx.fillStyle = "rgba(0, 0, 0, 0.58)";
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);

    const logo = hasLogo ? await getBrandLogoImage() : null;
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

    const outputType = file.type && file.type.startsWith("image/") ? file.type : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outputType === "image/png" ? "image/png" : "image/jpeg", 0.92)
    );
    if (!blob) return file;
    return new File([blob], file.name, {
      type: blob.type || outputType,
      lastModified: Date.now(),
    });
  }

  async function prepareLaundryPhoto(file: File, source: UploadSource) {
    if (source !== "camera" || !isImageFile(file)) return file;
    try {
      return await stampCameraPhoto(file);
    } catch {
      toast({
        title: "Photo watermark skipped",
        description: "Could not apply timestamp/logo. Original photo kept.",
        variant: "destructive",
      });
      return file;
    }
  }

  async function setPickupPhotoFromSelection(fileList: FileList | null, source: UploadSource) {
    const selected = fileList?.[0] ?? null;
    if (!selected) {
      setPickupPhoto(null);
      return;
    }
    const prepared = await prepareLaundryPhoto(selected, source);
    setPickupPhoto(prepared);
  }

  async function setDropoffPhotoFromSelection(fileList: FileList | null, source: UploadSource) {
    const selected = fileList?.[0] ?? null;
    if (!selected) {
      setDropoffPhoto(null);
      return;
    }
    const prepared = await prepareLaundryPhoto(selected, source);
    setDropoffPhoto(prepared);
  }

  async function uploadViaDirect(file: File, folder: string): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", folder);

    const response = await fetch("/api/uploads/direct", {
      method: "POST",
      body: form,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error ?? "Could not upload file.");
    }
    if (!body?.key) {
      throw new Error("Upload succeeded but no file key returned.");
    }
    return body.key;
  }

  async function uploadViaPresign(file: File, folder: string): Promise<string> {
    const contentType = file.type || "application/octet-stream";
    const presignRes = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentType, folder }),
    });
    const presignBody = await presignRes.json();
    if (!presignRes.ok) throw new Error(presignBody.error ?? "Failed to create upload URL.");

    const putRes = await fetch(presignBody.uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": contentType },
    });
    if (!putRes.ok) throw new Error("Upload failed");
    return presignBody.key;
  }

  async function uploadOneFile(file: File, folder: string): Promise<string> {
    try {
      return await uploadViaDirect(file, folder);
    } catch (directErr) {
      try {
        return await uploadViaPresign(file, folder);
      } catch (presignErr: any) {
        const directMessage =
          directErr instanceof Error ? directErr.message : "Direct upload failed";
        const presignMessage =
          presignErr instanceof Error ? presignErr.message : "Presigned upload failed";
        throw new Error(`${directMessage} / ${presignMessage}`);
      }
    }
  }

  async function submitActionUpdate() {
    if (!actionTask || !actionType) return;
    if (!confirmAction) {
      toast({ title: "Confirm action first", description: "Tick the confirmation checkbox.", variant: "destructive" });
      return;
    }

    const isEditCompleted = actionType === "EDIT_COMPLETED";
    if (isEditCompleted) {
      const payload: any = {
        confirm: true,
        notes: actionNotes.trim(),
      };
      if (!payload.notes || payload.notes.length < 3) {
        toast({
          title: "Correction reason required",
          description: "Add a short reason for this post-completion edit.",
          variant: "destructive",
        });
        return;
      }

      const n = Number(bagCount || 0);
      if (!Number.isFinite(n) || n < 1) {
        toast({ title: "Bag count required", description: "Enter how many bags were picked up.", variant: "destructive" });
        return;
      }
      payload.bagCount = Math.round(n);

      const location = dropoffSelection === "__custom" ? dropoffCustom.trim() : dropoffSelection;
      if (!location) {
        toast({ title: "Location required", description: "Select or type drop-off location.", variant: "destructive" });
        return;
      }
      payload.dropoffLocation = location;

      if (dropoffTotalPrice.trim()) {
        const price = Number(dropoffTotalPrice);
        if (!Number.isFinite(price) || price < 0) {
          toast({ title: "Invalid price", description: "Enter a valid total laundry price.", variant: "destructive" });
          return;
        }
        payload.totalPrice = Number(price.toFixed(2));
      }

      if (dropoffWeightKg.trim()) {
        const weight = Number(dropoffWeightKg);
        if (!Number.isFinite(weight) || weight < 0) {
          toast({ title: "Invalid weight", description: "Enter a valid laundry load weight (kg).", variant: "destructive" });
          return;
        }
        payload.loadWeightKg = Number(weight.toFixed(2));
      }
      if (supplierSelection !== "__none") {
        payload.supplierId = supplierSelection;
      }

      if (earlyDropoffReason.trim()) {
        payload.earlyDropoffReason = earlyDropoffReason.trim();
      }

      if (pickupPhoto) {
        try {
          const key = await uploadOneFile(pickupPhoto, "laundry/pickup");
          payload.pickupPhotoKey = key;
        } catch (err: any) {
          toast({ title: "Photo upload failed", description: err.message ?? "Could not upload pickup photo.", variant: "destructive" });
          return;
        }
      }
      if (dropoffPhoto) {
        try {
          const key = await uploadOneFile(dropoffPhoto, "laundry/dropoff");
          payload.dropoffPhotoKey = key;
        } catch (err: any) {
          toast({ title: "Photo upload failed", description: err.message ?? "Could not upload drop-off photo.", variant: "destructive" });
          return;
        }
      }
      if (receiptPhoto) {
        try {
          const key = await uploadOneFile(receiptPhoto, "laundry/receipt");
          payload.receiptImageKey = key;
        } catch (err: any) {
          toast({ title: "Receipt upload failed", description: err.message ?? "Could not upload receipt photo.", variant: "destructive" });
          return;
        }
      }

      setSubmitting(true);
      const res = await fetch(`/api/laundry/${actionTask.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      setSubmitting(false);
      if (!res.ok) {
        toast({ title: "Update failed", description: body.error ?? "Could not update completed laundry details.", variant: "destructive" });
        return;
      }
      toast({ title: "Completed laundry details updated" });
      resetActionState();
      load();
      return;
    }

    if (actionType === "FAILED_PICKUP") {
      const reason = failedPickupReason.trim();
      if (!reason) {
        toast({ title: "Reason required", description: "Explain why the pickup failed.", variant: "destructive" });
        return;
      }

      const payload: any = {
        confirm: true,
        notes: actionNotes || undefined,
        failedPickupReason: reason,
      };

      if (failedPickupMode === "RESCHEDULE") {
        const nextDate = failedPickupDate.trim();
        if (!nextDate) {
          toast({ title: "New pickup date required", description: "Choose the rescheduled pickup date.", variant: "destructive" });
          return;
        }
        const iso = `${nextDate}T00:00:00.000Z`;
        payload.status = "FAILED_PICKUP_RESCHEDULE";
        payload.rescheduledPickupDate = iso;
      } else {
        payload.status = "FAILED_PICKUP_REQUEST";
        payload.requestedAction = failedPickupMode === "REQUEST_DELETE" ? "DELETE" : "SKIP";
      }

      setSubmitting(true);
      const res = await fetch(`/api/laundry/${actionTask.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      setSubmitting(false);

      if (!res.ok) {
        toast({ title: "Update failed", description: body.error ?? "Could not save failed pickup update.", variant: "destructive" });
        return;
      }

      toast({
        title: failedPickupMode === "RESCHEDULE" ? "Pickup rescheduled" : "Approval request sent",
        description:
          failedPickupMode === "RESCHEDULE"
            ? "The pickup date has been updated and admin has been notified."
            : "Admin approval is now required before this pickup can be skipped or deleted.",
      });
      resetActionState();
      load();
      return;
    }

    const status = actionType;
    const payload: any = {
      status,
      confirm: true,
      notes: actionNotes || undefined,
    };

    if (status === "PICKED_UP") {
      const n = Number(bagCount || 0);
      if (!Number.isFinite(n) || n < 1) {
        toast({ title: "Bag count required", description: "Enter how many bags were picked up.", variant: "destructive" });
        return;
      }
      payload.bagCount = Math.round(n);
      if (pickupPhoto) {
        try {
          const key = await uploadOneFile(pickupPhoto, "laundry/pickup");
          payload.pickupPhotoKey = key;
        } catch (err: any) {
          toast({ title: "Photo upload failed", description: err.message ?? "Could not upload pickup photo.", variant: "destructive" });
          return;
        }
      }
    }

    if (status === "RETURNED") {
      const location = dropoffSelection === "__custom" ? dropoffCustom.trim() : dropoffSelection;
      if (!location) {
        toast({ title: "Location required", description: "Select or type drop-off location.", variant: "destructive" });
        return;
      }
      if (laundryConfig.requireDropoffPhoto && !dropoffPhoto) {
        toast({ title: "Photo required", description: "Upload drop-off evidence photo.", variant: "destructive" });
        return;
      }
      payload.dropoffLocation = location;
      if (dropoffTotalPrice.trim()) {
        const price = Number(dropoffTotalPrice);
        if (!Number.isFinite(price) || price < 0) {
          toast({ title: "Invalid price", description: "Enter a valid total laundry price.", variant: "destructive" });
          return;
        }
        payload.totalPrice = Number(price.toFixed(2));
      }
      if (dropoffWeightKg.trim()) {
        const weight = Number(dropoffWeightKg);
        if (!Number.isFinite(weight) || weight < 0) {
          toast({ title: "Invalid weight", description: "Enter a valid laundry load weight (kg).", variant: "destructive" });
          return;
        }
        payload.loadWeightKg = Number(weight.toFixed(2));
      }
      if (supplierSelection !== "__none") {
        payload.supplierId = supplierSelection;
      }
      if (laundryConfig.requireEarlyDropoffReason && isEarlyDropoffCandidate(actionTask)) {
        const reason = earlyDropoffReason.trim();
        if (!reason) {
          toast({
            title: "Reason required",
            description: "Explain why this linen was returned earlier than the planned date.",
            variant: "destructive",
          });
          return;
        }
        payload.earlyDropoffReason = reason;
      }
      if (dropoffPhoto) {
        try {
          const key = await uploadOneFile(dropoffPhoto, "laundry/dropoff");
          payload.dropoffPhotoKey = key;
        } catch (err: any) {
          toast({ title: "Photo upload failed", description: err.message ?? "Could not upload photo.", variant: "destructive" });
          return;
        }
      }
      if (receiptPhoto) {
        try {
          const key = await uploadOneFile(receiptPhoto, "laundry/receipt");
          payload.receiptImageKey = key;
        } catch (err: any) {
          toast({ title: "Receipt upload failed", description: err.message ?? "Could not upload receipt photo.", variant: "destructive" });
          return;
        }
      }
    }

    setSubmitting(true);
    const res = await fetch(`/api/laundry/${actionTask.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSubmitting(false);

    if (!res.ok) {
      toast({ title: "Update failed", description: body.error ?? "Could not update status.", variant: "destructive" });
      return;
    }

    toast({ title: "Laundry updated" });
    resetActionState();
    load();
  }

  const sortedTasks = useMemo(() => {
    const copy = [...tasks];
    const todayStart = startOfDay(new Date()).getTime();
    const tomorrowStart = addDays(startOfDay(new Date()), 1).getTime();
    copy.sort((a, b) => {
      const aPickup = startOfDay(new Date(a.pickupDate)).getTime();
      const bPickup = startOfDay(new Date(b.pickupDate)).getTime();
      if (sortMode === "pickup_asc") {
        const bucket = (task: any) => {
          if (task.status === "DROPPED") return 4;
          const pickup = startOfDay(new Date(task.pickupDate)).getTime();
          if (pickup <= todayStart) return 0;
          if (pickup === tomorrowStart) return 1;
          return 2;
        };
        const bucketDiff = bucket(a) - bucket(b);
        if (bucketDiff !== 0) return bucketDiff;
        return aPickup - bPickup;
      }
      if (sortMode === "pickup_desc") return new Date(b.pickupDate).getTime() - new Date(a.pickupDate).getTime();
      if (sortMode === "updated_desc") return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      if (sortMode === "property_asc") return String(a.property?.name ?? "").localeCompare(String(b.property?.name ?? ""));
      return aPickup - bPickup;
    });
    return copy;
  }, [tasks, sortMode]);

  const todayKey = toDayKey(new Date());
  const tomorrowKey = toDayKey(addDays(new Date(), 1));

  const readyQueue = sortedTasks
    .filter((task) => ["CONFIRMED", "PICKED_UP"].includes(task.status))
    .filter((task) => {
      if (readyFilter === "all") return true;
      const pickupKey = toDayKey(task.pickupDate);
      if (readyFilter === "today") return pickupKey === todayKey;
      if (readyFilter === "tomorrow") return pickupKey === tomorrowKey;
      return true;
    });
  const confirmedTasks = sortedTasks.filter((task) => task.status === "CONFIRMED");
  const pickedUpTasksList = sortedTasks.filter((task) => task.status === "PICKED_UP");
  const skippedTasks = sortedTasks.filter((task) => task.status === "SKIPPED_PICKUP");
  const allTasks = sortedTasks.filter((task) => !["FLAGGED", "SKIPPED_PICKUP"].includes(task.status));
  const scheduleActiveTasks = allTasks.filter((task) => task.status !== "DROPPED");
  const completedScheduleTasks = allTasks.filter((task) => task.status === "DROPPED");
  const pickedUpCount = allTasks.filter((task) => task.status === "PICKED_UP").length;
  const returnedCount = allTasks.filter((task) => task.status === "DROPPED").length;
  const trackedReturnCost = allTasks
    .flatMap((task) => (Array.isArray(task.confirmations) ? task.confirmations : []))
    .reduce((sum, confirmation: any) => {
      const meta = parseEventNotes(confirmation.notes);
      return sum + (meta?.event === "DROPPED" && typeof meta.totalPrice === "number" ? Number(meta.totalPrice) : 0);
    }, 0);

  const STATUS_BADGE: Record<string, any> = {
    PENDING: "secondary",
    CONFIRMED: "default",
    PICKED_UP: "default",
    DROPPED: "success",
    FLAGGED: "destructive",
    SKIPPED_PICKUP: "warning",
  };

  const actionTitle = useMemo(() => {
    if (actionType === "PICKED_UP") return "Confirm Pickup";
    if (actionType === "RETURNED") return "Confirm Drop-off";
    if (actionType === "EDIT_COMPLETED") return "Edit Completed Laundry";
    if (actionType === "FAILED_PICKUP") return "Report Failed Pickup";
    if (actionType === "REVERT_TO_CONFIRMED") return "Revert to Confirmed";
    if (actionType === "REVERT_TO_PICKED_UP") return "Revert to Picked Up";
    return "Update Laundry";
  }, [actionType]);
  const earlyReturnCandidate = useMemo(
    () => (actionType === "RETURNED" && actionTask ? isEarlyDropoffCandidate(actionTask) : false),
    [actionTask, actionType]
  );
  const actionPickedUpConfirmation = useMemo(
    () => (actionTask ? getEventConfirmation(actionTask, "PICKED_UP") : null),
    [actionTask]
  );
  const actionDroppedConfirmation = useMemo(
    () => (actionTask ? getEventConfirmation(actionTask, "DROPPED") : null),
    [actionTask]
  );
  const urgentItems = useMemo(() => {
    const todayStart = startOfDay(new Date());
    const tomorrowStart = addDays(todayStart, 1);
    const dayAfterTomorrow = addDays(todayStart, 2);

    const pickupDueNow = sortedTasks.filter((task) => {
      if (task.status !== "CONFIRMED") return false;
      const pickupAt = startOfDay(new Date(task.pickupDate));
      return pickupAt.getTime() < dayAfterTomorrow.getTime();
    }).length;

    const overdueDropoff = sortedTasks.filter((task) => {
      if (task.status !== "PICKED_UP") return false;
      const plannedDropoff = startOfDay(new Date(task.dropoffDate));
      return plannedDropoff.getTime() < todayStart.getTime();
    }).length;

    const flagged = sortedTasks.filter((task) => task.status === "FLAGGED").length;
    const skipped = skippedTasks.length;

    const waitingCleanerConfirmation = sortedTasks.filter((task) => {
      if (task.status !== "PENDING") return false;
      const pickupAt = startOfDay(new Date(task.pickupDate));
      return pickupAt.getTime() <= tomorrowStart.getTime();
    }).length;

    return [
      {
        id: "laundry-pickups-now",
        title: "Pickups due now",
        description: "Confirmed linen pickups scheduled for today/tomorrow.",
        count: pickupDueNow,
        tone: "critical" as const,
      },
      {
        id: "laundry-overdue-dropoffs",
        title: "Overdue drop-offs",
        description: "Picked-up loads passed their planned return date.",
        count: overdueDropoff,
        tone: "critical" as const,
      },
      {
        id: "laundry-flagged",
        title: "Flagged laundry tasks",
        description: "Planner flagged these for manual handling.",
        count: flagged,
        tone: "warning" as const,
      },
      {
        id: "laundry-skipped-pickups",
        title: "Skipped pickups",
        description: "No-pickup-required tasks from cleaner/admin instructions.",
        count: skipped,
        tone: "warning" as const,
      },
      {
        id: "laundry-pending-cleaner",
        title: "Waiting cleaner confirmation",
        description: "Upcoming pickups still not marked laundry-ready by cleaners.",
        count: waitingCleanerConfirmation,
        tone: "warning" as const,
      },
    ];
  }, [skippedTasks.length, sortedTasks]);

  const scheduleSummaryText = useMemo(() => {
    const visibleTasks = [...scheduleActiveTasks, ...completedScheduleTasks];
    if (visibleTasks.length === 0) {
      return "No laundry schedule items in the selected range.";
    }
    return visibleTasks
      .map((task) => {
        const statusLabel = String(task.status).replace(/_/g, " ");
        return `${format(new Date(task.pickupDate), "EEE dd MMM yyyy")} - ${task.property.name}${task.property.suburb ? ` (${task.property.suburb})` : ""} | Pickup ${format(new Date(task.pickupDate), "dd MMM")} | Drop ${format(new Date(task.dropoffDate), "dd MMM")} | ${statusLabel}`;
      })
      .join("\n");
  }, [completedScheduleTasks, scheduleActiveTasks]);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-primary/20">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="p-5 sm:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Laundry Overview
              </p>
              <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Laundry Planner</h1>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                {format(weekStart, "d MMM")} -{" "}
                {format(addDays(weekStart, rangeMode === "day" ? 0 : rangeMode === "month" ? 30 : rangeMode === "all" ? 365 : 6), "d MMM yyyy")}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Pickup cutoff {laundryConfig.pickupCutoffTime} | Default pickup {laundryConfig.defaultPickupTime} | Default drop-off {laundryConfig.defaultDropoffTime} | Fallback outside {laundryConfig.maxOutdoorDays} day{laundryConfig.maxOutdoorDays === 1 ? "" : "s"} (manual jobs only)
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                You are viewing the {rangeMode === "day" ? "day" : rangeMode === "month" ? "month" : rangeMode === "all" ? "all upcoming" : "week"} schedule. Use Previous and Next to move through the planner, then switch tabs to confirm pickups, returns, and history.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setWeekStart((w) =>
                      addDays(w, rangeMode === "day" ? -1 : rangeMode === "month" ? -31 : rangeMode === "all" ? -366 : -7)
                    )
                  }
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setWeekStart((w) =>
                      addDays(w, rangeMode === "day" ? 1 : rangeMode === "month" ? 31 : rangeMode === "all" ? 366 : 7)
                    )
                  }
                >
                  Next
                </Button>
                <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
                  {scanningQr ? "Scanning..." : "Scan bag QR"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={async (e) => {
                      const input = e.currentTarget;
                      await handleQrScanSelection(input.files);
                      input.value = "";
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-3 border-t border-border/60 bg-muted/20 p-5 sm:grid-cols-3 sm:p-6 lg:border-l lg:border-t-0 lg:grid-cols-1">
              <div>
                <p className="text-xs text-muted-foreground">Confirmed</p>
                <p className="text-2xl font-semibold">{confirmedTasks.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">At laundry</p>
                <p className="text-2xl font-semibold">{pickedUpCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{laundryConfig.showCostTracking ? "Revenue" : "Returned"}</p>
                <p className="text-2xl font-semibold">{laundryConfig.showCostTracking ? `$${trackedReturnCost.toFixed(2)}` : returnedCount}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <ImmediateAttentionPanel
        title="Immediate Attention"
        description="Priority laundry actions that need quick follow-up."
        items={urgentItems}
      />

      <WorkforceDashboardPosts title="Team Updates" posts={teamPosts} />

      <Card>
        <CardContent className="grid gap-3 p-4 text-sm text-muted-foreground md:grid-cols-3">
          <div>
            <p className="font-semibold text-foreground">1. Active tab — confirmed pickups</p>
            <p className="mt-1">Start here. Confirmed tasks are bags marked ready by cleaners waiting for you to collect.</p>
          </div>
          <div>
            <p className="font-semibold text-foreground">2. Mark picked up → returned</p>
            <p className="mt-1">Tap "Mark Picked Up" once you have the bags. When dropped off, tap "Mark Returned" with photo and cost details.</p>
          </div>
          <div>
            <p className="font-semibold text-foreground">3. Returned tab tracks costs</p>
            <p className="mt-1">Completed jobs move to the Returned tab. Edit details if the price or weight needs updating after the fact.</p>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Shirt className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Awaiting pickup</p>
              <p className="text-2xl font-semibold">{confirmedTasks.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100">
              <Truck className="h-4 w-4 text-amber-700" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">At laundry</p>
              <p className="text-2xl font-semibold">{pickedUpCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Returned</p>
              <p className="text-2xl font-semibold">{returnedCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <AlertTriangle className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{laundryConfig.showCostTracking ? "Revenue tracked" : "Skipped pickups"}</p>
              <p className="text-2xl font-semibold">{laundryConfig.showCostTracking ? `$${trackedReturnCost.toFixed(0)}` : skippedTasks.length}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      {skippedTasks.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Skipped Pickups</CardTitle>
            <CardDescription>
              These bookings should be skipped by the laundry team unless admin changes the instruction.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {skippedTasks.map((task) => {
              const reasonLabel =
                LAUNDRY_SKIP_REASONS.find((reason) => reason.value === task.skipReasonCode)?.label ??
                String(task.skipReasonCode ?? "Not set").replace(/_/g, " ");
              return (
                <div key={task.id} className="rounded-xl border border-amber-300 bg-white/80 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold">{task.property.name}</p>
                      <p className="text-sm text-muted-foreground">{task.property.suburb}</p>
                      <LaundryAccessInstructions task={task} />
                      <p className="mt-2 text-sm">
                        <strong>Scheduled pickup:</strong> {format(new Date(task.pickupDate), "EEE dd MMM yyyy")}
                      </p>
                      <p className="text-sm">
                        <strong>Scheduled drop-off:</strong> {format(new Date(task.dropoffDate), "EEE dd MMM yyyy")}
                      </p>
                      <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                        <p><strong>Reason:</strong> {reasonLabel}</p>
                        {task.skipReasonNote ? <p className="mt-1">Cleaner note: {task.skipReasonNote}</p> : null}
                        {task.adminOverrideNote ? <p className="mt-1">Admin note: {task.adminOverrideNote}</p> : null}
                      </div>
                    </div>
                    <Badge variant="warning">Skipped Pickup</Badge>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Filters</CardTitle>
          <CardDescription>Sort and narrow the current schedule without leaving the page.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">View range</Label>
            <Select value={rangeMode} onValueChange={(v) => setRangeMode(v as RangeMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="week">Week</SelectItem>
                <SelectItem value="month">Month</SelectItem>
                <SelectItem value="all">All Upcoming</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Ready queue filter</Label>
            <Select value={readyFilter} onValueChange={(v) => setReadyFilter(v as ReadyFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ready</SelectItem>
                <SelectItem value="today">Pickup today</SelectItem>
                <SelectItem value="tomorrow">Pickup tomorrow</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sort tasks</Label>
            <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pickup_asc">Pickup date (oldest first)</SelectItem>
                <SelectItem value="pickup_desc">Pickup date (newest first)</SelectItem>
                <SelectItem value="updated_desc">Recently updated</SelectItem>
                <SelectItem value="property_asc">Property name</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-3">
            <p className="text-xs text-muted-foreground">Tracked return costs (loaded tasks)</p>
            <p className="mt-1 text-lg font-semibold">{laundryConfig.showCostTracking ? `$${trackedReturnCost.toFixed(2)}` : "Hidden"}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">View mode</Label>
            <div className="flex rounded-md border">
              <Button type="button" variant={viewMode === "full" ? "default" : "ghost"} className="flex-1 rounded-r-none" onClick={() => setViewMode("full")}>Full</Button>
              <Button type="button" variant={viewMode === "compact" ? "default" : "ghost"} className="flex-1 rounded-l-none" onClick={() => setViewMode("compact")}>Compact</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeLaundryTab} onValueChange={setActiveLaundryTab}>
        <TabsList className={`grid w-full ${laundryConfig.showHistoryTab ? "grid-cols-3" : "grid-cols-2"} h-auto gap-1 p-1`}>
          <TabsTrigger value="active" className="flex-1 py-2 text-xs sm:text-sm">
            Active{readyQueue.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                {confirmedTasks.length > 0 && pickedUpTasksList.length > 0
                  ? `${confirmedTasks.length}+${pickedUpTasksList.length}`
                  : readyQueue.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="returned" className="flex-1 py-2 text-xs sm:text-sm">
            Returned{completedScheduleTasks.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {completedScheduleTasks.length}
              </span>
            )}
          </TabsTrigger>
          {laundryConfig.showHistoryTab && (
            <TabsTrigger value="history" className="flex-1 py-2 text-xs sm:text-sm">
              History{historyTasks.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {historyTasks.length}
                </span>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="active" className="space-y-3">
          {confirmedTasks.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Awaiting Pickup — {confirmedTasks.length} task{confirmedTasks.length === 1 ? "" : "s"}
              </p>
            </div>
          )}
          {pickedUpTasksList.length > 0 && confirmedTasks.length === 0 && (
            <div className="flex items-center gap-2 pt-1">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                At Laundry — {pickedUpTasksList.length} task{pickedUpTasksList.length === 1 ? "" : "s"}
              </p>
            </div>
          )}
          {readyQueue.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <Shirt className="mx-auto mb-2 h-10 w-10 opacity-30" />
              <p>No active laundry tasks.</p>
              <p className="mt-1 text-xs">Confirmed when cleaners mark laundry ready.</p>
            </div>
          ) : (
            readyQueue.map((task) => {
              const latestConfirmation = Array.isArray(task.confirmations)
                ? task.confirmations[task.confirmations.length - 1]
                : null;
              const cleanerConfirmation = getCleanerLaundryConfirmation(task);
              const pickedUpConfirmation = getEventConfirmation(task, "PICKED_UP");
              const droppedConfirmation = getEventConfirmation(task, "DROPPED");
              const droppedMeta = parseEventNotes(droppedConfirmation?.notes);
              const pendingFailedPickup = getPendingFailedPickupRequest(task);
              const completion = getTaskCompletionDetails(task);
              const droppedEarly = isEarlyDropoffDay(task.droppedAt, task.dropoffDate);
              if (viewMode === "compact") {
                return (
                  <Card key={task.id} className="border-primary/20">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-medium">{task.property.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Pickup {format(new Date(task.pickupDate), "dd MMM")} · Drop {format(new Date(task.dropoffDate), "dd MMM")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={task.status === "PICKED_UP" ? "secondary" : task.status === "DROPPED" ? "success" : "default"}>
                          {task.status === "PICKED_UP" ? "Picked Up" : task.status === "DROPPED" ? "Returned" : "Confirmed"}
                        </Badge>
                        {task.status === "CONFIRMED" ? (
                          <Button size="sm" onClick={() => openAction(task, "PICKED_UP")}>Pick up</Button>
                        ) : task.status === "PICKED_UP" ? (
                          <Button size="sm" variant="outline" onClick={() => openAction(task, "RETURNED")}>Return</Button>
                        ) : task.status === "DROPPED" ? (
                          <Button size="sm" variant="outline" onClick={() => openAction(task, "EDIT_COMPLETED")}>Edit</Button>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              }
              return (
                <Card key={task.id} className="border-primary/30">
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold">{task.property.name}</p>
                        <p className="text-sm text-muted-foreground">{task.property.suburb}</p>
                        <LaundryAccessInstructions task={task} />
                        <p className="mt-2 text-sm">
                          <strong>Pickup:</strong> {format(new Date(task.pickupDate), "EEE dd MMM")}
                        </p>
                        <p className="text-sm">
                          <strong>Drop-off:</strong> {format(new Date(task.dropoffDate), "EEE dd MMM")}
                        </p>
                        {pickedUpConfirmation?.photoUrl && (
                          <div className="mt-3">
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Pickup photo</p>
                            <MediaGallery
                              items={[
                                {
                                  id: pickedUpConfirmation.id ?? `${task.id}-pickup-photo`,
                                  url: pickedUpConfirmation.photoUrl,
                                  label: "Pickup proof",
                                  mediaType: "PHOTO",
                                },
                              ]}
                              title="Laundry Pickup Photo"
                              className="grid grid-cols-1 gap-2"
                            />
                          </div>
                        )}
                        {latestConfirmation?.bagLocation && (
                          <p className="mt-1 text-xs text-muted-foreground">{latestConfirmation.bagLocation}</p>
                        )}
                        {cleanerConfirmation?.photoUrl && (
                          <div className="mt-3">
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Cleaner laundry photo</p>
                            <MediaGallery
                              items={[
                                {
                                  id: cleanerConfirmation.id ?? `${task.id}-cleaner-photo`,
                                  url: cleanerConfirmation.photoUrl,
                                  label: "Cleaner laundry proof",
                                  mediaType: "PHOTO",
                                },
                              ]}
                              title="Cleaner Laundry Photo"
                              className="grid grid-cols-1 gap-2"
                            />
                          </div>
                        )}
                        {droppedConfirmation?.photoUrl && (
                          <div className="mt-3">
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Drop-off confirmation photo</p>
                            <MediaGallery
                              items={[
                                {
                                  id: droppedConfirmation.id ?? `${task.id}-dropoff-photo`,
                                  url: droppedConfirmation.photoUrl,
                                  label: "Drop-off proof",
                                  mediaType: "PHOTO",
                                },
                              ]}
                              title="Laundry Drop-off Photo"
                              className="grid grid-cols-1 gap-2"
                            />
                          </div>
                        )}
                        {laundryConfig.showCostTracking && completion.totalPrice != null && (
                          <p className="mt-2 text-sm">
                            <strong>Laundry total charged:</strong> ${Number(completion.totalPrice).toFixed(2)}
                          </p>
                        )}
                        {completion.loadWeightKg != null && (
                          <p className="text-sm">
                            <strong>Load weight:</strong> {Number(completion.loadWeightKg).toFixed(1)} kg
                          </p>
                        )}
                        {task.supplier?.name ? (
                          <p className="text-sm">
                            <strong>Supplier:</strong> {task.supplier.name}
                          </p>
                        ) : null}
                        {task.receiptImageUrl ? (
                          <div className="mt-3">
                            <p className="mb-1 text-xs font-medium text-muted-foreground">Receipt</p>
                            <MediaGallery
                              items={[
                                {
                                  id: `${task.id}-receipt`,
                                  url: task.receiptImageUrl,
                                  label: "Laundry receipt",
                                  mediaType: "PHOTO",
                                },
                              ]}
                              title="Laundry Receipt"
                              className="grid grid-cols-1 gap-2"
                            />
                          </div>
                        ) : null}
                        {droppedEarly && (
                          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs">
                            <p>
                              <strong>Early return.</strong> Intended drop-off: {format(new Date(task.dropoffDate), "dd MMM yyyy")} | Actual:{" "}
                              {task.droppedAt ? format(new Date(task.droppedAt), "dd MMM yyyy") : "-"}
                            </p>
                            {droppedMeta?.earlyDropoffReason ? (
                              <p className="mt-1 text-muted-foreground">Reason: {droppedMeta.earlyDropoffReason}</p>
                            ) : null}
                          </div>
                        )}
                        {pendingFailedPickup ? (
                          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                            Awaiting admin approval to {String(pendingFailedPickup.requestedAction ?? "SKIP").toLowerCase()} this pickup.
                          </div>
                        ) : null}
                      </div>
                      <Badge variant={task.status === "PICKED_UP" ? "secondary" : task.status === "DROPPED" ? "success" : "default"}>
                        {task.status === "PICKED_UP" ? "Picked Up" : task.status === "DROPPED" ? "Returned" : "Confirmed"}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {task.status === "CONFIRMED" && (
                        <Button
                          size="sm"
                          className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => openAction(task, "PICKED_UP")}
                        >
                          <Truck className="mr-1 h-4 w-4" />
                          Mark Picked Up
                        </Button>
                      )}
                      {task.status === "CONFIRMED" && (
                        <Button size="sm" className="flex-1" variant="outline" onClick={() => openAction(task, "FAILED_PICKUP")}>
                          <AlertTriangle className="mr-1 h-4 w-4" />
                          Failed Pickup
                        </Button>
                      )}
                      {task.status === "PICKED_UP" && (
                        <Button size="sm" className="flex-1" variant="outline" onClick={() => openAction(task, "RETURNED")}>
                          <CheckCircle2 className="mr-1 h-4 w-4" />
                          Mark Returned
                        </Button>
                      )}
                      {task.status === "PICKED_UP" && (
                        <Button size="sm" variant="ghost" onClick={() => openAction(task, "REVERT_TO_CONFIRMED")}>
                          <Undo2 className="mr-1 h-4 w-4" />
                          Revert
                        </Button>
                      )}
                      {task.status === "DROPPED" && (
                        <Button size="sm" variant="outline" onClick={() => openAction(task, "EDIT_COMPLETED")}>
                          <FilePenLine className="mr-1 h-4 w-4" />
                          Edit details
                        </Button>
                      )}
                      {task.status === "DROPPED" && (
                        <Button size="sm" variant="ghost" onClick={() => openAction(task, "REVERT_TO_PICKED_UP")}>
                          <Undo2 className="mr-1 h-4 w-4" />
                          Revert Return
                        </Button>
                      )}
                    </div>

                    <div className="mt-3 rounded-md bg-muted/40 p-2">
                      <p className="mb-1 text-xs font-medium">Timeline</p>
                      <div className="space-y-1">
                        {buildTimeline(task).map((event, index) => (
                          <p key={index} className="text-xs text-muted-foreground">
                            {format(event.at, "dd MMM HH:mm")} - {event.label}
                          </p>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="returned" className="space-y-3">
          {completedScheduleTasks.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-2 h-10 w-10 opacity-30" />
              <p>No returned laundry in this range.</p>
              <p className="mt-1 text-xs">Returned loads appear here once the drop-off is confirmed.</p>
            </div>
          ) : (
            completedScheduleTasks.map((task) => {
              const droppedConfirmation = getEventConfirmation(task, "DROPPED");
              const droppedMeta = parseEventNotes(droppedConfirmation?.notes);
              const droppedEarly = isEarlyDropoffDay(task.droppedAt, task.dropoffDate);
              const completion = getTaskCompletionDetails(task);
              return (
                <Card key={task.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{task.property.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Pickup {format(new Date(task.pickupDate), "dd MMM")} → Drop {format(new Date(task.dropoffDate), "dd MMM")}
                        </p>
                        {droppedEarly && (
                          <p className="mt-1 text-xs text-amber-700">
                            Early return: planned {format(new Date(task.dropoffDate), "dd MMM yyyy")}, actual{" "}
                            {task.droppedAt ? format(new Date(task.droppedAt), "dd MMM yyyy") : "-"}
                            {droppedMeta?.earlyDropoffReason ? ` — ${droppedMeta.earlyDropoffReason}` : ""}
                          </p>
                        )}
                        {laundryConfig.showCostTracking && completion.totalPrice != null && (
                          <p className="mt-1 text-xs font-medium text-primary">
                            ${Number(completion.totalPrice).toFixed(2)}{completion.loadWeightKg != null ? ` · ${Number(completion.loadWeightKg).toFixed(1)} kg` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <Badge variant="success">Returned</Badge>
                        <Button size="sm" variant="outline" onClick={() => openAction(task, "EDIT_COMPLETED")}>
                          <FilePenLine className="mr-1 h-3.5 w-3.5" />
                          Edit
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
          {/* Schedule summary copy tool — still useful for route planning */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Schedule Summary</CardTitle>
                  <CardDescription>Copy for route planning or messages.</CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(scheduleSummaryText);
                      toast({ title: "Schedule summary copied" });
                    } catch {
                      toast({ title: "Copy failed", variant: "destructive" });
                    }
                  }}
                >
                  <Copy className="mr-1 h-4 w-4" />
                  Copy
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={scheduleSummaryText} readOnly rows={Math.min(8, Math.max(3, scheduleSummaryText.split("\n").length))} />
            </CardContent>
          </Card>
        </TabsContent>

        {laundryConfig.showHistoryTab && <TabsContent value="history" className="space-y-2">
          {historyTasks.map((task) => {
            const droppedConfirmation = getEventConfirmation(task, "DROPPED");
            const droppedMeta = parseEventNotes(droppedConfirmation?.notes);
            const completion = getTaskCompletionDetails(task);
            const droppedEarly = isEarlyDropoffDay(task.droppedAt, task.dropoffDate);
            const olderCompleted = isOlderCompletedTask(task);
            const historyExpanded = !olderCompleted || expandedHistoryIds.has(task.id);
            return (
              <Card key={task.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <History className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{task.property.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Pickup {format(new Date(task.pickupDate), "dd MMM yyyy")} - Drop {format(new Date(task.dropoffDate), "dd MMM yyyy")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_BADGE[task.status]}>{task.status.replace(/_/g, " ")}</Badge>
                      {olderCompleted ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setExpandedHistoryIds((current) => {
                              const next = new Set(current);
                              if (next.has(task.id)) next.delete(task.id);
                              else next.add(task.id);
                              return next;
                            })
                          }
                        >
                          {historyExpanded ? "Collapse" : "Expand"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {historyExpanded ? (
                    <>
                      {laundryConfig.showCostTracking && completion.totalPrice != null && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Price: ${Number(completion.totalPrice).toFixed(2)}
                        </p>
                      )}
                      {completion.loadWeightKg != null && (
                        <p className="text-xs text-muted-foreground">Weight: {Number(completion.loadWeightKg).toFixed(1)} kg</p>
                      )}
                      {task.supplier?.name ? (
                        <p className="text-xs text-muted-foreground">Supplier: {task.supplier.name}</p>
                      ) : null}
                      {droppedEarly && (
                        <p className="mt-1 text-xs text-amber-700">
                          Returned early. Planned {format(new Date(task.dropoffDate), "dd MMM yyyy")}, actual{" "}
                          {task.droppedAt ? format(new Date(task.droppedAt), "dd MMM yyyy") : "-"}
                          {droppedMeta?.earlyDropoffReason ? ` - ${droppedMeta.earlyDropoffReason}` : ""}
                        </p>
                      )}
                      {task.status === "DROPPED" ? (
                        <div className="mt-3">
                          <Button size="sm" variant="outline" onClick={() => openAction(task, "EDIT_COMPLETED")}>
                            <FilePenLine className="mr-1 h-4 w-4" />
                            Edit completed details
                          </Button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
          {historyTasks.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No laundry history available.</p>}
        </TabsContent>}
      </Tabs>

      <Dialog open={Boolean(actionTask && actionType)} onOpenChange={(open) => (!open ? resetActionState() : null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{actionTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {actionTask && (
              <p className="text-sm text-muted-foreground">
                {actionTask.property?.name} - {actionTask.property?.suburb}
              </p>
            )}

            {actionType === "PICKED_UP" && (
              <>
                <div className="space-y-1.5">
                  <Label>How many bags picked up?</Label>
                  <Input type="number" min="1" max="50" value={bagCount} onChange={(e) => setBagCount(e.target.value)} />
                </div>
                {laundryConfig.showPickupPhoto && (
                  <div className="space-y-1.5">
                    <Label>Pickup photo (optional)</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                        <Camera className="h-3.5 w-3.5" />
                        Take photo
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={async (e) => {
                            const input = e.currentTarget;
                            const files = input.files;
                            await setPickupPhotoFromSelection(files, "camera");
                            input.value = "";
                          }}
                        />
                      </label>
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                        Upload photo
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const input = e.currentTarget;
                            const files = input.files;
                            await setPickupPhotoFromSelection(files, "gallery");
                            input.value = "";
                          }}
                        />
                      </label>
                    </div>
                    {pickupPhoto && pickupPhotoPreviewUrl ? (
                      <div className="space-y-2 rounded-md border p-2">
                        <p className="text-xs font-medium text-muted-foreground">Selected pickup photo</p>
                        <MediaGallery
                          items={[
                            {
                              id: "pickup-selected",
                              url: pickupPhotoPreviewUrl,
                              label: pickupPhoto.name,
                              mediaType: "PHOTO",
                            },
                          ]}
                          title="Pickup Photo Preview"
                          className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3"
                        />
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => setPickupPhoto(null)}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No pickup photo selected.</p>
                    )}
                  </div>
                )}
              </>
            )}

            {actionType === "EDIT_COMPLETED" && (
              <div className="space-y-3 rounded-md border border-border/60 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pickup corrections</p>
                <div className="space-y-1.5">
                  <Label>Bag count</Label>
                  <Input type="number" min="1" max="50" value={bagCount} onChange={(e) => setBagCount(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Pickup photo (optional replacement)</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                      <Camera className="h-3.5 w-3.5" />
                      Take photo
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={async (e) => {
                          const input = e.currentTarget;
                          const files = input.files;
                          await setPickupPhotoFromSelection(files, "camera");
                          input.value = "";
                        }}
                      />
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                      Upload photo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const input = e.currentTarget;
                          const files = input.files;
                          await setPickupPhotoFromSelection(files, "gallery");
                          input.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {actionPickedUpConfirmation?.photoUrl ? (
                    <div className="space-y-2 rounded-md border p-2">
                      <p className="text-xs font-medium text-muted-foreground">Current pickup photo</p>
                      <MediaGallery
                        items={[
                          {
                            id: String(actionPickedUpConfirmation.id ?? "pickup-current"),
                            url: actionPickedUpConfirmation.photoUrl,
                            label: "Current pickup photo",
                            mediaType: "PHOTO",
                          },
                        ]}
                        title="Current Pickup Photo"
                        className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3"
                      />
                    </div>
                  ) : null}
                  {pickupPhoto && pickupPhotoPreviewUrl ? (
                    <div className="space-y-2 rounded-md border border-primary/30 p-2">
                      <p className="text-xs font-medium text-primary">Selected replacement photo</p>
                      <MediaGallery
                        items={[
                          {
                            id: "pickup-replacement",
                            url: pickupPhotoPreviewUrl,
                            label: pickupPhoto.name,
                            mediaType: "PHOTO",
                          },
                        ]}
                        title="Replacement Pickup Photo Preview"
                        className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setPickupPhoto(null)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Remove replacement
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {actionPickedUpConfirmation?.photoUrl ? "Keep existing pickup photo." : "No pickup photo selected."}
                    </p>
                  )}
                </div>
              </div>
            )}

            {(actionType === "RETURNED" || actionType === "EDIT_COMPLETED") && (
              <>
                {laundryConfig.requireEarlyDropoffReason && earlyReturnCandidate && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                    <p className="font-medium">Early drop-off detected</p>
                    <p className="mt-1 text-muted-foreground">
                      Intended drop-off: {actionTask?.dropoffDate ? format(new Date(actionTask.dropoffDate), "dd MMM yyyy") : "-"}
                    </p>
                    <p className="text-muted-foreground">Actual drop-off: {format(new Date(), "dd MMM yyyy")}</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Drop-off location</Label>
                  {dropoffOptions.length > 0 ? (
                    <>
                      <Select value={dropoffSelection} onValueChange={setDropoffSelection}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select location" />
                        </SelectTrigger>
                        <SelectContent>
                          {dropoffOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                          <SelectItem value="__custom">Custom location</SelectItem>
                        </SelectContent>
                      </Select>
                      {dropoffSelection === "__custom" && (
                        <Input value={dropoffCustom} onChange={(e) => setDropoffCustom(e.target.value)} placeholder="Type custom location" />
                      )}
                    </>
                  ) : (
                    <Input value={dropoffCustom} onChange={(e) => setDropoffCustom(e.target.value)} placeholder="Type location" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Drop-off photo {actionType === "EDIT_COMPLETED" ? "(optional replacement)" : laundryConfig.requireDropoffPhoto ? "" : "(optional)"}
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                      <Camera className="h-3.5 w-3.5" />
                      Take photo
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={async (e) => {
                          const input = e.currentTarget;
                          const files = input.files;
                          await setDropoffPhotoFromSelection(files, "camera");
                          input.value = "";
                        }}
                      />
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                      Upload photo
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const input = e.currentTarget;
                          const files = input.files;
                          await setDropoffPhotoFromSelection(files, "gallery");
                          input.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {actionType === "EDIT_COMPLETED" && actionDroppedConfirmation?.photoUrl ? (
                    <div className="space-y-2 rounded-md border p-2">
                      <p className="text-xs font-medium text-muted-foreground">Current drop-off photo</p>
                      <MediaGallery
                        items={[
                          {
                            id: String(actionDroppedConfirmation.id ?? "dropoff-current"),
                            url: actionDroppedConfirmation.photoUrl,
                            label: "Current drop-off photo",
                            mediaType: "PHOTO",
                          },
                        ]}
                        title="Current Drop-off Photo"
                        className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3"
                      />
                    </div>
                  ) : null}
                  {dropoffPhoto && dropoffPhotoPreviewUrl ? (
                    <div className="space-y-2 rounded-md border border-primary/30 p-2">
                      <p className="text-xs font-medium text-primary">
                        {actionType === "EDIT_COMPLETED" ? "Selected replacement photo" : "Selected drop-off photo"}
                      </p>
                      <MediaGallery
                        items={[
                          {
                            id: actionType === "EDIT_COMPLETED" ? "dropoff-replacement" : "dropoff-selected",
                            url: dropoffPhotoPreviewUrl,
                            label: dropoffPhoto.name,
                            mediaType: "PHOTO",
                          },
                        ]}
                        title={actionType === "EDIT_COMPLETED" ? "Replacement Drop-off Photo Preview" : "Drop-off Photo Preview"}
                        className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3"
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setDropoffPhoto(null)}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          {actionType === "EDIT_COMPLETED" ? "Remove replacement" : "Remove"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {actionType === "EDIT_COMPLETED" && actionDroppedConfirmation?.photoUrl
                        ? "Keep existing drop-off photo."
                        : "No drop-off photo selected."}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Total price charged (optional)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={dropoffTotalPrice}
                    onChange={(e) => setDropoffTotalPrice(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Laundry load weight in kg (optional)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    inputMode="decimal"
                    value={dropoffWeightKg}
                    onChange={(e) => setDropoffWeightKg(e.target.value)}
                    placeholder="0.0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Supplier (optional)</Label>
                  <Select value={supplierSelection} onValueChange={setSupplierSelection}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">No supplier selected</SelectItem>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Receipt photo (optional)</Label>
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
                          const file = e.currentTarget.files?.[0] ?? null;
                          setReceiptPhoto(file);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted">
                      Upload receipt
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.currentTarget.files?.[0] ?? null;
                          setReceiptPhoto(file);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {actionType === "EDIT_COMPLETED" && actionTask?.receiptImageUrl ? (
                    <div className="space-y-2 rounded-md border p-2">
                      <p className="text-xs font-medium text-muted-foreground">Current receipt image</p>
                      <MediaGallery
                        items={[
                          {
                            id: `${actionTask.id}-receipt-current`,
                            url: actionTask.receiptImageUrl,
                            label: "Current receipt",
                            mediaType: "PHOTO",
                          },
                        ]}
                        title="Current Receipt"
                        className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3"
                      />
                    </div>
                  ) : null}
                  {receiptPhoto && receiptPhotoPreviewUrl ? (
                    <div className="space-y-2 rounded-md border border-primary/30 p-2">
                      <p className="text-xs font-medium text-primary">Selected receipt image</p>
                      <MediaGallery
                        items={[
                          {
                            id: `${actionTask?.id ?? "receipt"}-selected`,
                            url: receiptPhotoPreviewUrl,
                            label: receiptPhoto.name,
                            mediaType: "PHOTO",
                          },
                        ]}
                        title="Receipt Preview"
                        className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3"
                      />
                      <div className="flex justify-end">
                        <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setReceiptPhoto(null)}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Remove receipt
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {actionType === "EDIT_COMPLETED" && actionTask?.receiptImageUrl
                        ? "Keep existing receipt image."
                        : "No receipt image selected."}
                    </p>
                  )}
                </div>
                {laundryConfig.requireEarlyDropoffReason && earlyReturnCandidate && (
                  <div className="space-y-1.5">
                    <Label>Reason for early drop-off</Label>
                    <Textarea
                      value={earlyDropoffReason}
                      onChange={(e) => setEarlyDropoffReason(e.target.value)}
                      placeholder="Explain why this was returned earlier than planned"
                    />
                  </div>
                )}
              </>
            )}

            {actionType === "FAILED_PICKUP" && (
              <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50/60 p-3">
                <div className="space-y-1.5">
                  <Label>What should happen next?</Label>
                  <Select value={failedPickupMode} onValueChange={(value) => setFailedPickupMode(value as FailedPickupMode)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RESCHEDULE">Reschedule pickup</SelectItem>
                      <SelectItem value="REQUEST_SKIP">Request skip approval</SelectItem>
                      <SelectItem value="REQUEST_DELETE">Request delete approval</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Why did the pickup fail?</Label>
                  <Textarea
                    value={failedPickupReason}
                    onChange={(e) => setFailedPickupReason(e.target.value)}
                    placeholder="No bag outside, access issue, property not ready, cleaner delayed..."
                  />
                </div>
                {failedPickupMode === "RESCHEDULE" ? (
                  <div className="space-y-1.5">
                    <Label>New pickup date</Label>
                    <Input
                      type="date"
                      value={failedPickupDate}
                      min={actionTask?.pickupDate ? format(addDays(new Date(actionTask.pickupDate), 1), "yyyy-MM-dd") : undefined}
                      onChange={(e) => setFailedPickupDate(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Rescheduling updates the pickup date immediately and keeps the task live.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    This will flag the task and send an approval request to admin before it can be skipped or deleted.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{actionType === "EDIT_COMPLETED" ? "Correction reason (required)" : "Notes (optional)"}</Label>
              <Textarea
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
                placeholder={actionType === "EDIT_COMPLETED" ? "Explain why you are changing completed task details" : undefined}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirmAction} onChange={(e) => setConfirmAction(e.target.checked)} />
              I confirm this action is correct.
            </label>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={resetActionState} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submitActionUpdate} disabled={submitting}>
                {submitting ? "Saving..." : "Confirm"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}





