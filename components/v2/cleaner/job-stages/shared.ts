/**
 * Shared prop contract for the cleaner job "journey" stages.
 *
 * The workspace (`job-workspace.tsx`) still owns ALL state, handlers, autosave,
 * gates and validation — exactly as before. It bundles the slice of that state
 * each stage needs into one `WorkspaceApi` object and hands it down. The stages
 * are presentation only: they render the workspace's existing state/handlers,
 * they never introduce their own business logic.
 *
 * Types that the workspace already treats as loosely-typed payload (`payload`,
 * `job`, `property`, `briefing`) stay `any` here to mirror the workspace and
 * avoid inventing a schema the API doesn't guarantee.
 */
import type * as React from "react";
import type { AnswerMap, UploadMap } from "@/components/v2/cleaner/form-renderer";
import type { CapturedMedia } from "@/components/v2/cleaner/media-capture";
import type { FormSchema } from "@/lib/forms/types";
import type { ReadFirstItem } from "@/components/v2/cleaner/read-first-block";
import type { JobContact } from "@/components/v2/cleaner/contact-sheet";
import type { JobStage } from "@/lib/cleaner/job-stage";

export interface JobTask {
  id: string;
  title: string;
  description?: string | null;
  source: string;
  requiresPhoto?: boolean;
  requiresNote?: boolean;
}

export interface TaskDraft {
  decision: "OPEN" | "COMPLETED" | "NOT_COMPLETED";
  note: string;
  proof: CapturedMedia[];
}

export interface ImportantRequest {
  key: string;
  title: string;
  detail?: string;
  source: string;
}

export type LaundryOutcome = "READY_FOR_PICKUP" | "NOT_READY" | "NO_PICKUP_REQUIRED";

export interface WorkspaceApi {
  /* ── Raw payload + derived job/property ──────────────────────────────── */
  payload: any;
  job: any;
  property: any;
  briefing: any;
  template: any;
  schema: FormSchema | null;

  jobId: string;
  status: string;
  locked: boolean;
  needsAcceptance: boolean;
  hasStarted: boolean;
  hasCheckin: boolean;
  propertyId: string | null;

  /** Full one-line address: "address, suburb STATE postcode". */
  addressLine: string;
  /** Property short code (e.g. "J04"). */
  propertyCode: string;
  /** Turn-by-turn Google Maps directions URL to this property ("" if none). */
  navUrl: string;

  /* ── Job summary bits (Accept) ───────────────────────────────────────── */
  jobTypeLabel: string;
  expectedDurationMinutes: number | null;
  formatDurationMinutes: (mins: number) => string;

  /* ── Content collections ─────────────────────────────────────────────── */
  jobTasks: JobTask[];
  importantRequests: ImportantRequest[];
  readFirstItems: ReadFirstItem[];
  contact: JobContact | null;
  restockNeeds: Array<{ name: string; needed: number; unit?: string | null }>;
  recurringIssues: string[];
  setupGuideEntries: Array<{
    id?: string;
    kind?: string;
    label?: string;
    instructions?: string;
    images?: Array<{ url?: string; caption?: string }>;
  }>;

  /* ── Laundry identity + capture ──────────────────────────────────────── */
  laundryEnabled: boolean;
  bagLabel: string;
  bagColor: string;
  /** Admin-configured bag drop-off locations (settings.laundryBagLocationOptions). */
  laundryBagLocationOptions: string[];

  /* ── Time / clock ────────────────────────────────────────────────────── */
  timeState: any;
  busy: string | null;

  /* ── Stage control ───────────────────────────────────────────────────── */
  activeStage: JobStage;
  setActiveStage: (stage: JobStage) => void;

  /* ── Start gate ──────────────────────────────────────────────────────── */
  startGateBlocks: boolean;
  startGateSatisfied: boolean;
  clockInDisabled: boolean;
  propertyCodeConfirmed: boolean;
  setPropertyCodeConfirmed: (v: boolean) => void;
  laundryBagConfirmRequired: boolean;
  laundryBagConfirmed: boolean;
  setLaundryBagConfirmed: (v: boolean) => void;

  /* ── Form + checklist state ──────────────────────────────────────────── */
  answers: AnswerMap;
  uploads: UploadMap;
  onAnswer: (fieldId: string, value: unknown) => void;
  onUpload: (fieldId: string, media: CapturedMedia[]) => void;
  taskDrafts: Record<string, TaskDraft>;
  setTask: (id: string, patch: Partial<TaskDraft>) => void;
  allTasksDecided: boolean;

  /* ── Laundry outcome (Wrap up) ───────────────────────────────────────── */
  laundryOutcome: LaundryOutcome | "";
  setLaundryOutcome: (v: LaundryOutcome | "") => void;
  laundryBagLocation: string;
  setLaundryBagLocation: (v: string) => void;
  laundryPhoto: CapturedMedia[];
  setLaundryPhoto: (v: CapturedMedia[]) => void;
  laundrySkipCode: string;
  setLaundrySkipCode: (v: string) => void;
  laundrySkipNote: string;
  setLaundrySkipNote: (v: string) => void;
  laundryEarlySending: boolean;
  laundryEarlySentAt: string | null;
  laundryEarlyNotice: { tone: "success" | "danger"; text: string } | null;
  sendLaundryEarlyUpdate: () => void;

  /* ── Carry forward (Wrap up) ─────────────────────────────────────────── */
  carryHasNew: boolean;
  setCarryHasNew: (v: boolean) => void;
  carryNotes: string[];
  setCarryNotes: React.Dispatch<React.SetStateAction<string[]>>;
  carryPhotos: CapturedMedia[];
  setCarryPhotos: (v: CapturedMedia[]) => void;

  /* ── Actions ─────────────────────────────────────────────────────────── */
  flash: (tone: "success" | "danger" | "info", text: string) => void;
  clockIn: () => void;
  pauseClock: () => void;
  clockOutEarly: () => void;
  submit: () => void;
  load: () => void;

  /* ── Drawers / sheets opened from the header + FAB ───────────────────── */
  openInfoDrawer: () => void;
  openContactSheet: () => void;
}

export const LAUNDRY_SKIP_REASONS: Array<{ value: string; label: string }> = [
  { value: "LINEN_STILL_WASHING", label: "Linen still washing" },
  { value: "LINEN_STILL_DRYING", label: "Linen still drying" },
  { value: "NO_LINEN_ON_SITE", label: "No linen on site" },
  { value: "NO_PICKUP_REQUIRED", label: "No pickup required" },
  { value: "OTHER", label: "Other" },
];

export function titleCase(v: string) {
  return v
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
