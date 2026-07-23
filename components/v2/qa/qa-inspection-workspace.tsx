"use client";

/**
 * ESTATE v2 — QA inspection workspace.
 *
 * A ground-up Estate-native rebuild of the QA inspection flow. It talks to the
 * SAME endpoints the v1 workspace uses:
 *   GET  /api/qa/jobs/[id]              → job, template, assignment, propertyStock,
 *                                          cleanerCandidates, sectionPhotos, mediaOverrides
 *   POST /api/qa/jobs/[id]             → submit review (data + tools + signOff)
 *   POST /api/qa/jobs/[id]/timer      → persist on-site start/pause
 *   POST /api/uploads/direct          → upload a stamped photo → { key, url }
 *   GET  /api/uploads/access?key&jobId → presigned thumbnail URL → { url }
 *
 * The wire contract for `tools` is lib/qa/inspection-tools.ts; scoring is
 * lib/qa/templates.ts (0–5 ratings per section, blank = not assessed, pass ≥ 80
 * and no rework flag). No dependency on components/{qa,ui,shared,forms}.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  Star,
  AlertTriangle,
  ClipboardList,
  Package,
  Clock,
  RotateCcw,
  Plus,
  Trash2,
  Play,
  Pause,
  Square,
  X,
  Download,
  Loader2,
  Image as ImageIcon,
  MapPin,
  Pencil,
  ChevronDown,
  Info,
  Undo2,
} from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EThread,
} from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  ESelect,
  ETextarea,
  ESwitch,
} from "@/components/v2/admin/estate-kit";
import {
  emptyInspectionTools,
  emptyReworkProposal,
  type QaDamageEntry,
  type QaInspectionTools,
  type QaNextCleanRequest,
} from "@/lib/qa/inspection-tools";
import { buildEvidenceStamp } from "@/components/v2/cleaner/media-capture";
import { MediaGallery } from "@/components/shared/media-gallery";
import { ImageAnnotator } from "@/components/shared/image-annotator";
import { prepareUploadFile } from "@/lib/uploads/compress";
import { getAccuratePosition, formatAccuracy } from "@/lib/geo/get-position";
import type { BriefItem } from "@/lib/qa/brief-rules";
import { predictionBasis } from "@/lib/qa/progress";
import { googleMapsDirectionsUrl } from "@/lib/maps/google-maps-url";
import { isStampableImage, type StampOptions } from "@/lib/uploads/stamp";
import { isUploadFieldType } from "@/lib/forms/field-types";
import {
  DEFAULT_ACCOUNTABILITY_SCORING,
  DEFAULT_ISSUE_CATEGORIES,
  VERDICT_LABELS,
  VERDICT_OPTIONS,
  buildAccountabilityBlob,
  cleanerAnsweredAffirmatively,
  computeAccountabilityPreview,
  emptyVerdictState,
  gradingExplainer,
  validateAccountability,
  verdictGuide,
  verdictRequiresIssue,
  type AccountabilityScoring,
  type AccountabilityVerdict,
  type ItemMeta,
  type VerdictState,
} from "@/components/v2/qa/accountability";

/* ── helpers ──────────────────────────────────────────────────────────── */
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
function titleCase(value: string): string {
  return String(value)
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const DAMAGE_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const REWORK_SEVERITIES = ["MINOR", "MODERATE", "MAJOR"] as const;

/* Pass/Minor/Fail radio scoring — must match lib/qa/scoring.ts RADIO_SCORES. */
const RADIO_SCORES: Record<string, number> = { Pass: 2, "Minor issues": 1, Fail: 0 };

/** Field types the inspector answers with a numeric value (rating/scale style). */
const NUMERIC_FIELD_TYPES = new Set(["rating", "slider", "scale", "counter", "number"]);
/** Field types the inspector answers by picking one option string. */
const CHOICE_FIELD_TYPES = new Set(["radio", "select"]);
/** Field types that are display-only or captured elsewhere (never rendered as an answer input here). */
const SKIP_FIELD_TYPES = new Set(["signature", "photo", "video", "file", "upload", "instruction", "inventory"]);

/**
 * Score a single answered field, mirroring lib/qa/scoring.ts computeQaScore.
 * Returns { points, max } contribution, or null when the field isn't scorable
 * or wasn't answered. Supports BOTH the seeded templates (field.scoring +
 * radio/yesno/select) and the auto-generated default template (type:"rating"
 * with a top-level field.max/field.weight and no field.scoring).
 */
function scoreField(field: any, value: unknown): { points: number; max: number } | null {
  // Seeded templates carry an explicit scoring block.
  if (field?.scoring && typeof field.scoring === "object") {
    const weight = Number(field.scoring.weight ?? 1) || 1;
    const scoreMax = Number(field.scoring.max ?? 0) || 0;
    if (scoreMax <= 0) return null;
    const fieldMax = scoreMax * weight;
    if (CHOICE_FIELD_TYPES.has(field.type) && typeof value === "string" && value in RADIO_SCORES) {
      return { points: RADIO_SCORES[value] * weight, max: fieldMax };
    }
    if (NUMERIC_FIELD_TYPES.has(field.type) && typeof value === "number" && Number.isFinite(value)) {
      return { points: Math.max(0, Math.min(value, scoreMax)) * weight, max: fieldMax };
    }
    if (field.type === "checkbox") {
      return { points: value ? scoreMax * weight : 0, max: fieldMax };
    }
    if (field.type === "yesno") {
      const isYes = value === true || (typeof value === "string" && ["true", "yes"].includes(value.trim().toLowerCase()));
      return { points: isYes ? scoreMax * weight : 0, max: fieldMax };
    }
    // Answered but of an unscored type, or unanswered → contributes its max only
    // when we can tell it was answerable. Unanswered choice/rating → excluded.
    if (value === undefined || value === null || value === "") return null;
    return { points: 0, max: fieldMax };
  }
  // Legacy default template: type:"rating" with a top-level max/weight. Blank =
  // "not assessed" (excluded), so area templates aren't penalised for N/A areas.
  if (field?.type === "rating") {
    if (value === undefined || value === null || value === "") return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const max = Number(field.max ?? 5) || 5;
    const weight = Number(field.weight ?? 1) || 1;
    const clamped = Math.max(0, Math.min(max, num));
    return { points: (clamped / max) * 100 * weight, max: 100 * weight };
  }
  return null;
}

type Toast = { id: string; title: string; description?: string; tone: "info" | "danger" };

/* ── Estate 0–5 rating control ────────────────────────────────────────── */
function ERating({
  value,
  onChange,
  max = 5,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const active = value != null && n <= value;
        return (
          <button
            key={n}
            type="button"
            aria-label={`${n} of ${max}`}
            onClick={() => onChange(value === n ? null : n)}
            className="rounded-[var(--e-radius-sm)] p-0.5 transition-transform active:scale-90"
          >
            <Star
              className="h-6 w-6"
              style={{
                color: active ? "hsl(var(--e-gold))" : "hsl(var(--e-border-strong))",
                fill: active ? "hsl(var(--e-gold))" : "transparent",
              }}
            />
          </button>
        );
      })}
      {value != null ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-1 text-[0.75rem] text-[hsl(var(--e-text-faint))] underline underline-offset-2 hover:text-[hsl(var(--e-foreground))]"
        >
          clear
        </button>
      ) : (
        <span className="ml-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">not assessed</span>
      )}
    </div>
  );
}

/* ── Estate segmented choice control (radio / select / yesno) ─────────── */
function EChoice({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
}) {
  // Colour Pass/Fail-style options so a failing answer reads at a glance.
  const toneFor = (opt: string): { on: string; onFg: string } => {
    if (opt === "Pass" || /^yes$/i.test(opt)) return { on: "hsl(var(--e-success))", onFg: "hsl(var(--e-success-foreground, 0 0% 100%))" };
    if (opt === "Fail" || /^no$/i.test(opt)) return { on: "hsl(var(--e-danger))", onFg: "hsl(var(--e-danger-foreground))" };
    if (opt === "Minor issues") return { on: "hsl(var(--e-warning))", onFg: "hsl(var(--e-warning-foreground, 0 0% 12%))" };
    return { on: "hsl(var(--e-gold))", onFg: "hsl(var(--e-gold-foreground))" };
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt;
        const tone = toneFor(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? null : opt)}
            className="rounded-[var(--e-radius-sm)] border px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors"
            style={{
              backgroundColor: active ? tone.on : "hsl(var(--e-surface))",
              color: active ? tone.onFg : "hsl(var(--e-text-secondary))",
              borderColor: active ? tone.on : "hsl(var(--e-border-strong))",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/* ── A single scored/answered template field (radio, select, yesno, rating,
 *    numeric, checkbox, text) rendered natively in the Estate skin. Signature +
 *    media/upload/instruction types are skipped by the caller. Mirrors the value
 *    shapes lib/qa/scoring.ts + the report generator expect: option STRING for
 *    radio/select, boolean for checkbox, "Yes"/"No"/"N/A" string for yesno,
 *    number for rating/numeric, string for text. ─────────────────────────── */
function EFieldInput({
  field,
  value,
  onChange,
}: {
  field: any;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const weightBadge =
    field?.scoring?.weight && field.scoring.weight > 1 ? (
      <span className="ml-1.5 text-[0.6875rem] text-[hsl(var(--e-gold-ink))]">×{field.scoring.weight}</span>
    ) : field?.weight && field.weight > 1 ? (
      <span className="ml-1.5 text-[0.6875rem] text-[hsl(var(--e-gold-ink))]">×{field.weight}</span>
    ) : null;
  const labelEl = (
    <label className="text-[0.8125rem] font-medium text-[hsl(var(--e-foreground))]">
      {field.label}
      {field.required ? <span className="ml-1 text-[hsl(var(--e-danger))]">*</span> : null}
      {weightBadge}
    </label>
  );

  if (CHOICE_FIELD_TYPES.has(field.type)) {
    const options: string[] = Array.isArray(field.options) && field.options.length > 0 ? field.options : [];
    if (options.length === 0) {
      return (
        <div className="space-y-1.5">
          {labelEl}
          <ETextarea value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder || field.label} />
        </div>
      );
    }
    return (
      <div className="space-y-1.5">
        {labelEl}
        <EChoice value={typeof value === "string" ? value : null} options={options} onChange={(v) => onChange(v)} />
      </div>
    );
  }

  if (field.type === "yesno") {
    const options = field.includeNa || field.incNa ? ["Yes", "No", "N/A"] : ["Yes", "No"];
    return (
      <div className="space-y-1.5">
        {labelEl}
        <EChoice value={typeof value === "string" ? value : null} options={options} onChange={(v) => onChange(v)} />
      </div>
    );
  }

  if (field.type === "rating") {
    const max = Number(field?.scoring?.max ?? field.max ?? 5) || 5;
    return (
      <div className="space-y-1.5">
        {labelEl}
        <ERating value={typeof value === "number" ? value : null} onChange={(v) => onChange(v)} max={max} />
      </div>
    );
  }

  if (NUMERIC_FIELD_TYPES.has(field.type)) {
    // slider / scale / counter / number → numeric input (kept simple + native).
    return (
      <div className="space-y-1.5">
        {labelEl}
        <EInput
          type="number"
          min={field.min ?? 0}
          max={field.max ?? undefined}
          step={field.step ?? 1}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          placeholder={field.placeholder || (field.unit ? String(field.unit) : "")}
          className="max-w-[200px]"
        />
      </div>
    );
  }

  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-[0.875rem]">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[hsl(var(--e-primary))]"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
        {weightBadge}
      </label>
    );
  }

  if (field.type === "text" || field.type === "email" || field.type === "phone" || field.type === "date" || field.type === "time") {
    return (
      <EField label={field.label}>
        <EInput
          type={field.type === "text" ? "text" : field.type}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || field.label}
        />
      </EField>
    );
  }

  // longtext + anything else answerable as free text.
  return (
    <EField label={field.label}>
      <ETextarea value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder || field.label} />
    </EField>
  );
}

/* ── A photo thumbnail with remove control, and (for images) an "Annotate"
 *    action that opens the shared full-screen markup tool. The markup overlay
 *    is layered over the thumbnail so a marked-up photo reads at a glance.
 *    Annotation is always optional — it never blocks submit and the original
 *    photo is kept untouched (the overlay is stored alongside it). ────────── */
function Thumb({
  url,
  overlayUrl,
  video,
  annotated,
  annotateTitle,
  onAnnotate,
  onRemove,
}: {
  url?: string;
  /** Transparent markup PNG stored against this photo, if any. */
  overlayUrl?: string;
  video?: boolean;
  annotated?: boolean;
  annotateTitle?: string;
  /** Omit to render a plain thumbnail (e.g. read-only contexts). */
  onAnnotate?: () => void;
  onRemove: () => void;
}) {
  const canAnnotate = Boolean(onAnnotate) && !video && Boolean(url);
  return (
    <div className="relative">
      {url && video ? (
        <video src={url} muted playsInline className="h-16 w-16 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] object-cover" />
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="QA evidence" className="h-16 w-16 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] object-cover" />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]">
          <ImageIcon className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" />
        </div>
      )}
      {overlayUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={overlayUrl} alt="" className="pointer-events-none absolute inset-0 h-16 w-16 rounded-[var(--e-radius)] object-cover" />
      ) : null}
      {canAnnotate ? (
        <button
          type="button"
          aria-label="Annotate photo"
          title={annotateTitle || "Circle, arrow or label what's wrong on this photo"}
          className="absolute -bottom-1.5 -left-1.5 rounded-full bg-[hsl(var(--e-primary))] p-1 text-[hsl(var(--e-primary-foreground))] shadow"
          onClick={onAnnotate}
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : null}
      {annotated ? (
        <span className="pointer-events-none absolute left-0 top-0 rounded-br-[var(--e-radius)] rounded-tl-[var(--e-radius)] bg-[hsl(var(--e-primary))] px-1 py-0.5 text-[8px] font-bold text-[hsl(var(--e-primary-foreground))]">
          ✎
        </span>
      ) : null}
      <button
        type="button"
        aria-label="Remove"
        className="absolute -right-1.5 -top-1.5 rounded-full bg-[hsl(var(--e-danger))] p-0.5 text-[hsl(var(--e-danger-foreground))] shadow"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ── A native file-input photo uploader. Images get the same evidence stamp
 *    v1 QA burns in (branding + timestamp + GPS via lib/uploads, merged with
 *    the caller's `stamp` context — v1 QA stamps every image upload). Videos
 *    and other files pass through untouched; upload endpoint is unchanged. ─ */
function Uploader({
  jobId,
  folder,
  accept = "image/*",
  label = "Add photos",
  onUploaded,
  onError,
  stamp,
}: {
  jobId?: string;
  folder: string;
  accept?: string;
  label?: string;
  onUploaded: (key: string, url?: string) => void;
  onError?: (msg: string) => void;
  /** Evidence-stamp context merged over the branding/GPS base; null disables. */
  stamp?: StampOptions | null;
}) {
  const [busy, setBusy] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setBusy((b) => b + list.length);
    for (const file of list) {
      try {
        let prepared = file;
        if (stamp !== null && isStampableImage(file)) {
          try {
            prepared = await prepareUploadFile(file, await buildEvidenceStamp(stamp));
          } catch {
            prepared = file; // never lose the photo over a failed stamp
          }
        }
        const form = new FormData();
        form.append("file", prepared);
        form.append("folder", folder);
        if (jobId) form.append("jobId", jobId);
        const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body?.key) onUploaded(body.key, body.url);
        else onError?.(body?.error ?? "Upload failed.");
      } catch {
        onError?.("Upload failed.");
      } finally {
        setBusy((b) => Math.max(0, b - 1));
      }
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <EButton
        type="button"
        variant="outline"
        size="sm"
        disabled={busy > 0}
        onClick={() => inputRef.current?.click()}
      >
        {busy > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        {busy > 0 ? `Uploading ${busy}…` : label}
      </EButton>
    </div>
  );
}

/* ── Estate signature pad (canvas) ────────────────────────────────────── */
function ESignaturePad({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const dirty = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1c2b26";
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    last.current = pos(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !last.current) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    dirty.current = true;
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (dirty.current && canvasRef.current) onChange(canvasRef.current.toDataURL("image/png"));
  }
  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange("");
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        width={520}
        height={150}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        className="h-[150px] w-full touch-none rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))]"
        style={{ touchAction: "none" }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          {value ? "Signed" : "Draw your signature above"}
        </span>
        <EButton type="button" variant="ghost" size="sm" onClick={clear}>
          Clear
        </EButton>
      </div>
    </div>
  );
}

/* ── Accountability verdict colours (pass green, minor amber, major orange,
 *    critical red, NA neutral). ──────────────────────────────────────────── */
const VERDICT_TONE: Record<AccountabilityVerdict, { on: string; onFg: string }> = {
  PASS: { on: "hsl(var(--e-success))", onFg: "hsl(var(--e-success-foreground, 0 0% 100%))" },
  MINOR: { on: "hsl(var(--e-warning))", onFg: "hsl(var(--e-warning-foreground, 0 0% 12%))" },
  MAJOR: { on: "#d9730d", onFg: "#ffffff" },
  CRITICAL: { on: "hsl(var(--e-danger))", onFg: "hsl(var(--e-danger-foreground))" },
  NA: { on: "hsl(var(--e-border-strong))", onFg: "hsl(var(--e-foreground))" },
};

/* ── A single reviewed checklist item's accountability verdict control:
 *    5-way segmented verdict, issue drawer (category/description/guest-ready/
 *    QA photos/false-confirmation) for MINOR+, and a missing-evidence toggle
 *    for required-photo fields. Additive to the legacy scoring input (which the
 *    parent still renders as `children`). ──────────────────────────────────── */
function AccountabilityItemV2({
  field,
  requiredPhoto,
  meta,
  state,
  onPatch,
  missing,
  onToggleMissing,
  issueCategories,
  jobId,
  qaStamp,
  urlByKey,
  scoring,
  onAddPhoto,
  onRemovePhoto,
  onAnnotatePhoto,
  onError,
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
  jobId?: string;
  qaStamp: StampOptions;
  urlByKey: Record<string, string>;
  /** Live scoring settings — the guidance quotes the numbers actually applied. */
  scoring: AccountabilityScoring;
  onAddPhoto: (key: string, url?: string) => void;
  onRemovePhoto: (key: string) => void;
  onAnnotatePhoto: (key: string, url: string) => void;
  onError: (msg: string) => void;
  children?: ReactNode;
}) {
  const showIssue = verdictRequiresIssue(state.verdict);
  const guide = verdictGuide(state.verdict, scoring);
  const missingCategory = showIssue && !(state.category && state.category.trim());
  const missingDescription = showIssue && !(state.description && state.description.trim());
  return (
    <div className="space-y-2.5">
      {children}
      <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">
            How was it done?
          </span>
          {meta.cleanerMarkedComplete ? (
            <EBadge tone="neutral" soft>Cleaner marked complete</EBadge>
          ) : null}
          <div className="ml-auto flex flex-wrap gap-1">
            {VERDICT_OPTIONS.map((v) => {
              const active = state.verdict === v;
              const tone = VERDICT_TONE[v];
              const g = verdictGuide(v, scoring);
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={active}
                  title={`${g.label} — ${g.meaning} ${g.consequence}`}
                  onClick={() => onPatch({ verdict: v })}
                  className="rounded-[var(--e-radius-sm)] border px-2.5 py-1 text-[0.75rem] font-[600] transition-colors"
                  style={{
                    backgroundColor: active ? tone.on : "hsl(var(--e-surface))",
                    color: active ? tone.onFg : "hsl(var(--e-text-secondary))",
                    borderColor: active ? tone.on : "hsl(var(--e-border-strong))",
                  }}
                >
                  {VERDICT_LABELS[v]}
                </button>
              );
            })}
          </div>
        </div>

        {/* What the grade you picked means, and what it actually does. Written
            from the scoring code (see verdictGuide in accountability.ts) so the
            inspector never has to guess what a button costs someone. */}
        <p className="mt-1.5 text-[0.6875rem] leading-snug text-[hsl(var(--e-text-secondary))]">
          <span className="font-[600] text-[hsl(var(--e-foreground))]">{guide.label}:</span> {guide.meaning}{" "}
          <span className="text-[hsl(var(--e-muted-foreground))]">{guide.consequence}</span>
          {!showIssue ? (
            <span className="text-[hsl(var(--e-text-faint))]">
              {" "}
              Pick Minor, Major or Critical and you&apos;ll be asked what kind of problem it was and what was wrong.
            </span>
          ) : null}
        </p>

        {requiredPhoto ? (
          <label className="mt-2 flex items-center gap-2 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[hsl(var(--e-danger))]"
              checked={missing}
              onChange={(e) => onToggleMissing(e.target.checked)}
            />
            Missing / insufficient evidence (−5)
          </label>
        ) : null}

        {showIssue ? (
          <div className="mt-2.5 space-y-2.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2.5">
            <p className="text-[0.6875rem] text-[hsl(var(--e-text-secondary))]">
              Both boxes below are required before you can submit — they are what the cleaner is shown and what the
              repeat-problem reports are built from. A photo helps; you can circle or label the problem on it.
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <EField label="Issue category *">
                <ESelect
                  value={state.category ?? ""}
                  onChange={(e) => onPatch({ category: e.target.value || null })}
                  style={missingCategory ? { borderColor: "hsl(var(--e-danger))" } : undefined}
                >
                  <option value="">Select category…</option>
                  {issueCategories.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </ESelect>
              </EField>
              <div className="flex items-end">
                <ESwitch
                  checked={Boolean(state.guestReadyImpact)}
                  onCheckedChange={(v) => onPatch({ guestReadyImpact: v })}
                  label="Guest-ready impact"
                />
              </div>
            </div>
            <EField label="Description *">
              <ETextarea
                value={state.description ?? ""}
                onChange={(e) => onPatch({ description: e.target.value })}
                placeholder="What was wrong and where?"
                style={missingDescription ? { borderColor: "hsl(var(--e-danger))" } : undefined}
              />
            </EField>
            {state.qaPhotoKeys && state.qaPhotoKeys.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {state.qaPhotoKeys.map((p) => (
                  <Thumb
                    key={p.key}
                    url={urlByKey[p.key]}
                    overlayUrl={p.annotatedKey ? urlByKey[p.annotatedKey] : undefined}
                    annotated={Boolean(p.annotatedKey)}
                    onAnnotate={urlByKey[p.key] ? () => onAnnotatePhoto(p.key, urlByKey[p.key]) : undefined}
                    onRemove={() => onRemovePhoto(p.key)}
                  />
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Uploader
                jobId={jobId}
                folder="qa-accountability"
                label="Attach QA photo"
                stamp={{ ...qaStamp, contextLabel: ["QA", typeof field.label === "string" ? field.label : ""].filter(Boolean).join(" · ") }}
                onUploaded={onAddPhoto}
                onError={onError}
              />
              {meta.cleanerMarkedComplete ? (
                <label className="flex items-center gap-2 text-[0.75rem] font-medium text-[hsl(var(--e-danger))]">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--e-danger))]"
                    checked={Boolean(state.falseConfirmation)}
                    onChange={(e) => onPatch({ falseConfirmation: e.target.checked })}
                  />
                  Flag as false confirmation (−10)
                </label>
              ) : null}
            </div>
            {(missingCategory || missingDescription) ? (
              <p className="text-[0.6875rem] text-[hsl(var(--e-danger))]">
                A category and description are required for {VERDICT_LABELS[state.verdict]} verdicts.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── monitor mode (job assigned before the clean finished) ──────────────
   Rendered INSTEAD of the check-in gate + grading steps while the cleaner is
   still working. Everything on it is knowable without a submission: where the
   property is, who is on site, how long they've been there, when we expect them
   to finish, and the brief rules that don't depend on submitted work. */
function monitorHhmm(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function monitorDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(Number(minutes))) return null;
  const total = Math.max(0, Math.round(Number(minutes)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function QaMonitorPanel({
  readiness,
  progress,
  job,
  brief,
  refreshing,
  onRefresh,
}: {
  readiness: "CLEANING" | "READY" | "REWORK_PENDING";
  progress: any;
  job: any;
  brief: BriefItem[];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const property = progress?.property ?? job?.property ?? null;
  const directionsUrl = googleMapsDirectionsUrl({
    address: property?.address ?? null,
    suburb: property?.suburb ?? null,
    state: property?.state ?? null,
    postcode: property?.postcode ?? null,
    latitude: property?.lat ?? property?.latitude ?? null,
    longitude: property?.lng ?? property?.longitude ?? null,
  });
  const estFinish = monitorHhmm(progress?.estFinishAt);
  const onSite = monitorDuration(progress?.elapsedMinutes);
  const remaining = monitorDuration(progress?.minutesRemaining);
  const basis = predictionBasis(progress?.prediction, progress?.prediction?.sampleCount);
  const cleaners: Array<{ id: string; name: string; elapsedMinutes: number | null }> = progress?.cleaners ?? [];
  const highlights: string[] = progress?.timingHighlights ?? [];

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle className="flex flex-wrap items-center gap-2">
          <Clock className="h-4 w-4" style={{ color: "hsl(var(--e-accent-portal))" }} />
          {readiness === "REWORK_PENDING" ? "Rework in progress" : "Clean in progress"}
          <EBadge tone="warning" soft>{titleCase(String(progress?.status ?? job?.status ?? ""))}</EBadge>
          {progress?.runningOver ? <EBadge tone="danger" soft>Running over</EBadge> : null}
        </ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-4">
        {/* big live state */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
            <p className="e-eyebrow">On site</p>
            <p className="mt-1 text-[1.5rem] font-semibold leading-none">{onSite ?? "—"}</p>
            <p className="mt-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {cleaners.length > 0 ? cleaners.map((c) => c.name).join(", ") : "No cleaner clocked in yet"}
            </p>
          </div>
          <div
            className="rounded-[var(--e-radius)] border p-4"
            style={{
              borderColor: progress?.runningOver ? "hsl(var(--e-danger))" : "hsl(var(--e-border))",
              backgroundColor: progress?.runningOver ? "hsl(var(--e-danger-soft))" : "hsl(var(--e-surface-raised))",
            }}
          >
            <p className="e-eyebrow">EST finish</p>
            <p className="mt-1 text-[1.5rem] font-semibold leading-none">{estFinish ?? "Unknown"}</p>
            <p className="mt-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {progress?.runningOver
                ? "Past the estimate — check in with the cleaner."
                : [remaining ? `${remaining} to go` : null, basis].filter(Boolean).join(" · ") ||
                  "Not enough history to estimate yet."}
            </p>
          </div>
        </div>

        {progress?.checklist ? (
          <div>
            <div className="flex items-center justify-between text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <span>Cleaner checklist</span>
              <span>
                {progress.checklist.answered}/{progress.checklist.total} · {progress.checklist.percent}%
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--e-surface-raised))]">
              <div
                className="h-full rounded-full"
                style={{ width: `${progress.checklist.percent}%`, backgroundColor: "hsl(var(--e-gold))" }}
              />
            </div>
          </div>
        ) : null}

        {/* travel planning */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-medium">{property?.name ?? "Property"}</p>
            <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {[property?.address, property?.suburb].filter(Boolean).join(", ") || "No address on file"}
            </p>
          </div>
          {directionsUrl ? (
            <EButton asChild variant="outline" size="sm">
              <a href={directionsUrl} target="_blank" rel="noopener noreferrer">
                <MapPin className="h-4 w-4" /> Navigate
              </a>
            </EButton>
          ) : null}
        </div>

        {/* timing highlights + guest arrival */}
        {highlights.length > 0 || progress?.guestArrivalAt ? (
          <div className="space-y-1.5">
            {highlights.map((item) => (
              <p key={item} className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                • {item}
              </p>
            ))}
            {progress?.guestArrivalAt ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                • Guest arrival: {progress.guestArrivalAt}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* brief items that are already knowable */}
        {brief.length > 0 ? (
          <div className="space-y-2">
            <p className="e-eyebrow">Know before you go</p>
            {brief.map((item) => (
              <EAlert key={item.id} tone={item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : "info"}>
                <span className="font-[550]">{item.title}</span> — {item.detail}
              </EAlert>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] pt-3">
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Inspection unlocks when the cleaner submits — this page updates itself every 45 seconds.
          </p>
          <EButton variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Refresh
          </EButton>
        </div>
      </ECardBody>
    </ECard>
  );
}

/* ── main workspace ───────────────────────────────────────────────────── */
export function QaInspectionWorkspace({
  jobId,
  returnHref = "/v2/qa",
}: {
  jobId: string;
  /** Where "Back to queue" and the post-submit redirect go. Defaults to the QA
   *  inspector queue; the admin Quality surface passes its own queue path so the
   *  same workspace can be deep-linked from /v2/admin/quality. */
  returnHref?: string;
}) {
  const router = useRouter();
  const { data: authSession } = useSession();
  const inspectorName = authSession?.user?.name || authSession?.user?.email || "QA Inspector";

  const [payload, setPayload] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [data, setData] = useState<Record<string, any>>({});
  const [notes, setNotes] = useState("");
  const [tools, setTools] = useState<QaInspectionTools>(() => emptyInspectionTools());
  const [signatureDataUrl, setSignatureDataUrl] = useState("");
  const [attested, setAttested] = useState(false);

  // key → presigned display URL (seeded from GET, augmented on upload)
  const [urlByKey, setUrlByKey] = useState<Record<string, string>>({});

  // ── Accountability Phase 4b — per-item verdicts + evidence flags ──
  const [verdicts, setVerdicts] = useState<Record<string, VerdictState>>({});
  const [missingEvidence, setMissingEvidence] = useState<Record<string, boolean>>({});

  // ── Photo markup ──
  // EVERY image the inspector uploads in this workspace can be annotated: the
  // per-section evidence photos, the per-item issue photos, damage photos and
  // rework flagged-area photos. All four go through the SAME shared annotator
  // (components/shared/image-annotator) and the SAME storage shape — the
  // transparent overlay PNG is uploaded as its own object and the original photo
  // is never overwritten. `scope` says which collection owns the photo.
  const [annotateTarget, setAnnotateTarget] = useState<
    | {
        scope: "section" | "damage" | "flagged" | "issue";
        sectionId?: string;
        entryId?: string;
        areaId?: string;
        fieldId?: string;
        key: string;
        url: string;
      }
    | null
  >(null);
  const [savingAnnotation, setSavingAnnotation] = useState(false);

  // ── Reopen / amend a submitted inspection (lib/qa/reopen.ts) ──
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);
  // Set once this session (or seeded from the server) when the open assignment
  // is an amendment: submitting UPDATES that review instead of creating one.
  const [amendingReviewId, setAmendingReviewId] = useState<string | null>(null);
  const [showGradingHelp, setShowGradingHelp] = useState(false);

  // ── local draft autosave ──
  const draftRestoredRef = useRef(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const draftKey = useMemo(() => {
    const u = (authSession?.user as { id?: string } | undefined)?.id || authSession?.user?.email || "anon";
    return `qa-v2-draft:${jobId}:${u}`;
  }, [jobId, authSession?.user]);

  // ── on-site timer ──
  const [timer, setTimer] = useState<{ running: boolean; elapsedMs: number; runningSince: number | null }>({
    running: false,
    elapsedMs: 0,
    runningSince: null,
  });
  const [, setTick] = useState(0);

  // ── QA arrival check-in (Phase 4 Stage 1) ──
  // The inspection is gated behind an arrival stamp. `checkIn.at` is IMMUTABLE
  // server-side, so re-entering the job never rewrites the original arrival.
  const [checkIn, setCheckIn] = useState<{
    at: string | null;
    accuracy: number | null;
    distanceMeters: number | null;
    skippedReason: string | null;
  }>({ at: null, accuracy: null, distanceMeters: null, skippedReason: null });
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [remoteMode, setRemoteMode] = useState(false);
  const [remoteReason, setRemoteReason] = useState("");

  const QA_STEPS = ["Pre-inspection brief", "Inspect & log findings", "Score, sign off & submit"];

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = uid();
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/qa/jobs/${jobId}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      pushToast({ title: "Could not load QA job", description: body.error ?? "Please retry.", tone: "danger" });
      return;
    }
    setPayload(body);
  }, [jobId, pushToast]);

  useEffect(() => {
    void load();
  }, [load]);

  // tick the live clock
  useEffect(() => {
    if (!timer.running) return;
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, [timer.running]);

  // restore draft once
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
      /* ignore */
    }
  }, [payload, draftKey]);

  // debounced autosave
  useEffect(() => {
    if (!draftRestoredRef.current) return;
    const t = setTimeout(() => {
      try {
        const savedAt = Date.now();
        localStorage.setItem(draftKey, JSON.stringify({ data, notes, tools, verdicts, missingEvidence, savedAt }));
        setDraftSavedAt(savedAt);
      } catch {
        /* ignore */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [data, notes, tools, verdicts, missingEvidence, draftKey]);

  // seed section photos + urls from payload
  useEffect(() => {
    const saved = payload?.sectionPhotos as Record<string, Array<{ key: string; url: string }>> | undefined;
    if (!saved) return;
    const keysBySection: Record<string, string[]> = {};
    const urls: Record<string, string> = {};
    for (const [sectionId, entries] of Object.entries(saved)) {
      const keys = (entries ?? []).map((e) => e.key).filter(Boolean);
      if (keys.length === 0) continue;
      keysBySection[sectionId] = keys;
      for (const e of entries ?? []) if (e?.key && e?.url) urls[e.key] = e.url;
    }
    setTools((prev) => ({ ...prev, sectionPhotos: keysBySection }));
    setUrlByKey((prev) => ({ ...prev, ...urls }));
  }, [payload]);

  const template = payload?.template;
  const job = payload?.job;

  // Recurring-issue watch-outs (Phase 7a) — where to look, compiled from the
  // property's + primary cleaner's repeating QA categories. Read-only advisory.
  const watchOuts = useMemo(() => {
    const raw = (payload as any)?.watchOuts;
    const norm = (arr: unknown): Array<{ label: string; count: number; category: string }> =>
      Array.isArray(arr)
        ? arr
            .filter((x): x is { label: string; count: number; category: string } => Boolean(x) && typeof x === "object")
            .map((x) => ({ label: String((x as any).label ?? ""), count: Number((x as any).count ?? 0), category: String((x as any).category ?? "") }))
        : [];
    return { cleaner: norm(raw?.cleaner), property: norm(raw?.property) };
  }, [payload]);
  const hasWatchOuts = watchOuts.cleaner.length > 0 || watchOuts.property.length > 0;

  // Base evidence-stamp context shared by every QA photo (v1 parity: inspector
  // name, property address + name, "qa" tag). Branding + GPS are added by the
  // shared buildEvidenceStamp helper inside the Uploader.
  const qaStamp = useMemo<StampOptions>(() => {
    const propertyName =
      (typeof job?.property?.name === "string" && job.property.name.trim()) || "";
    const addressParts = [
      job?.property?.address,
      job?.property?.suburb,
      job?.property?.state,
      job?.property?.postcode,
    ]
      .filter((v: unknown) => typeof v === "string" && (v as string).trim())
      .map((v: string) => v.trim());
    return {
      capturerName: authSession?.user?.name?.trim() || "QA Inspector",
      address: addressParts.join(", ") || undefined,
      reference: propertyName || undefined,
      tag: "qa",
    };
  }, [
    authSession?.user?.name,
    job?.property?.name,
    job?.property?.address,
    job?.property?.suburb,
    job?.property?.state,
    job?.property?.postcode,
  ]);
  const propertyStock: any[] = payload?.propertyStock ?? [];
  const cleanerCandidates: Array<{ id: string; name: string | null; email: string }> = payload?.cleanerCandidates ?? [];
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

  /* ── pre-inspection brief (server-built, lib/qa/brief-rules.ts) ── */
  const brief: BriefItem[] = useMemo(() => {
    const raw = (payload as any)?.brief;
    return Array.isArray(raw) ? (raw as BriefItem[]) : [];
  }, [payload]);
  const briefCtx = (payload as any)?.briefContext ?? null;
  const briefJob = briefCtx?.job ?? null;
  const briefCleaners: Array<{ id: string; name: string }> = briefCtx?.cleaners ?? [];
  const briefSubmission = briefCtx?.submission ?? null;
  const briefLowStock: Array<{ name: string; onHand: number; threshold: number }> = briefCtx?.lowStock ?? [];
  const timeTone = useMemo(() => {
    const expected = Number(briefJob?.expectedHours ?? 0);
    const actual = Number(briefJob?.actualHours ?? 0);
    if (!expected || !actual) return "hsl(var(--e-foreground))";
    const ratio = actual / expected;
    if (ratio < 0.7) return "hsl(var(--e-danger))";
    if (ratio > 1.3) return "hsl(var(--e-warning))";
    return "hsl(var(--e-success))";
  }, [briefJob?.expectedHours, briefJob?.actualHours]);

  /* ── MONITOR MODE (early assignment) ──────────────────────────────────
     An admin can hand out this inspection BEFORE the cleaner submits, so the
     workspace must not dead-end on "nothing to grade". While the job is not
     READY we render a live monitor panel (EST finish, navigation, brief items
     that are already knowable) and poll /progress; the moment readiness flips
     to READY the normal check-in → brief → grade flow appears in place, with no
     page reload and no loss of the local draft. */
  const [progress, setProgress] = useState<any>(null);
  const [progressLoading, setProgressLoading] = useState(false);
  const readiness: "CLEANING" | "READY" | "REWORK_PENDING" = useMemo(() => {
    if (progress?.readiness) return progress.readiness;
    const status = String(job?.status ?? "").toUpperCase();
    if ((job?.formSubmissions?.length ?? 0) > 0) return "READY";
    if (["SUBMITTED", "QA_REVIEW", "COMPLETED", "INVOICED"].includes(status)) return "READY";
    if (!job) return "READY"; // don't flash the monitor before the job loads
    return job?.isRework ? "REWORK_PENDING" : "CLEANING";
  }, [progress?.readiness, job]);
  const monitoring = readiness !== "READY";

  const loadProgress = useCallback(async () => {
    setProgressLoading(true);
    try {
      const res = await fetch(`/api/qa/jobs/${jobId}/progress`, { cache: "no-store" });
      if (res.ok) setProgress(await res.json());
    } catch {
      /* the monitor is advisory — a failed poll just leaves the last values */
    } finally {
      setProgressLoading(false);
    }
  }, [jobId]);

  // Fetch once the job is known, then poll while the clean is still running.
  useEffect(() => {
    if (!job) return;
    void loadProgress();
  }, [job?.id, loadProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!monitoring) return;
    const interval = setInterval(() => void loadProgress(), 45_000);
    return () => clearInterval(interval);
  }, [monitoring, loadProgress]);

  // Readiness flipped while we were watching — pull the full inspection payload
  // (template, submission, media) so the grading flow renders complete.
  const wasMonitoringRef = useRef(false);
  useEffect(() => {
    if (wasMonitoringRef.current && !monitoring) void load();
    wasMonitoringRef.current = monitoring;
  }, [monitoring, load]);

  // The gate: an assignment exists and nothing has been stamped yet. Ad-hoc
  // reviews without an assignment (admin) are never gated.
  const needsCheckIn = Boolean(payload?.assignment) && !checkIn.at;

  /* ── REOPEN A SUBMITTED INSPECTION ───────────────────────────────────────
     `payload.reopen` is present when this job's inspection is submitted and
     closed; `payload.amendingReviewId` when it is open again on top of an
     existing review (so submitting amends that review rather than adding a
     second one). Both come from GET /api/qa/jobs/[id]. */
  const reopenState = (payload as any)?.reopen ?? null;
  useEffect(() => {
    setAmendingReviewId(((payload as any)?.amendingReviewId as string | null) ?? null);
  }, [payload]);

  const doReopen = useCallback(async () => {
    setReopening(true);
    setReopenError(null);
    try {
      const res = await fetch(`/api/qa/jobs/${jobId}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: reopenState?.assignmentId ?? null, reason: reopenReason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReopenError(body?.error ?? "Could not reopen this inspection.");
        return;
      }
      setAmendingReviewId(body?.amendingReviewId ?? null);
      setReopenReason("");
      pushToast({
        title: "Inspection reopened",
        description: "Amend it and submit again — your changes update the existing review.",
        tone: "info",
      });
      await load();
    } finally {
      setReopening(false);
    }
  }, [jobId, reopenReason, reopenState?.assignmentId, pushToast, load]);

  // seed the arrival check-in from the server assignment
  useEffect(() => {
    const a = payload?.assignment;
    if (!a) return;
    setCheckIn({
      at: a.checkInAt ?? null,
      accuracy: a.checkInAccuracyM ?? null,
      distanceMeters: null,
      skippedReason: a.checkInSkippedReason ?? null,
    });
  }, [payload?.assignment?.id, payload?.assignment?.checkInAt]);

  const doCheckIn = useCallback(
    async (skippedReason?: string) => {
      setCheckingIn(true);
      setCheckInError(null);
      let fix: { lat: number; lng: number; accuracy: number | null } | null = null;
      if (!skippedReason) {
        try {
          const position = await getAccuratePosition();
          fix = { lat: position.lat, lng: position.lng, accuracy: position.accuracy };
        } catch (err) {
          setCheckingIn(false);
          setCheckInError(
            err instanceof Error
              ? `${err.message} — use "Can't check in" to review remotely.`
              : "Could not read your location."
          );
          return;
        }
      }
      const res = await fetch(`/api/qa/jobs/${jobId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(fix ?? {}), skippedReason: skippedReason ?? null }),
      });
      const body = await res.json().catch(() => ({}));
      setCheckingIn(false);
      if (!res.ok) {
        setCheckInError(body.error ?? "Could not record the check-in.");
        return;
      }
      setCheckIn({
        at: body.checkInAt ?? new Date().toISOString(),
        accuracy: body.accuracy ?? fix?.accuracy ?? null,
        distanceMeters: body.distanceMeters ?? null,
        skippedReason: skippedReason ?? null,
      });
      // Arrival starts the on-site clock server-side; mirror it locally.
      if (!tools.onSite.startedAt) {
        setTimer((p) => (p.running ? p : { ...p, running: true, runningSince: Date.now() }));
        setTools((prev) => ({
          ...prev,
          onSite: { startedAt: new Date().toISOString(), endedAt: null, minutes: null },
        }));
      }
      pushToast({
        title: skippedReason ? "Remote review recorded" : "Checked in",
        description: body.message,
        tone: "info",
      });
    },
    [jobId, pushToast, tools.onSite.startedAt]
  );

  // seed timer from server assignment
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

  const liveMs = timer.elapsedMs + (timer.running && timer.runningSince != null ? Date.now() - timer.runningSince : 0);
  const onSiteMinutes = Math.round(liveMs / 60000);
  const timerEnded = Boolean(tools.onSite.endedAt);

  function persistTimer(action: "start" | "pause") {
    fetch(`/api/qa/jobs/${jobId}/timer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
  }
  function startOrResumeOnSite() {
    setTimer((p) => (p.running ? p : { ...p, running: true, runningSince: Date.now() }));
    setTools((prev) => ({
      ...prev,
      onSite: { startedAt: prev.onSite.startedAt ?? new Date().toISOString(), endedAt: null, minutes: null },
    }));
    persistTimer("start");
  }
  function pauseOnSite() {
    setTimer((p) =>
      !p.running || p.runningSince == null
        ? p
        : { running: false, elapsedMs: p.elapsedMs + (Date.now() - p.runningSince), runningSince: null }
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

  function setField(id: string, value: unknown) {
    setData((prev) => ({ ...prev, [id]: value }));
  }

  // ── live score preview (mirrors lib/qa/templates.scoreQaSubmission) ──
  const scorePreview = useMemo(() => {
    const sections = template?.schema?.sections ?? [];
    let points = 0;
    let maxPoints = 0;
    for (const section of sections) {
      for (const field of section.fields ?? []) {
        const contribution = scoreField(field, data[field.id]);
        if (!contribution) continue;
        points += contribution.points;
        maxPoints += contribution.max;
      }
    }
    const score = maxPoints > 0 ? Math.round((points / maxPoints) * 100) : 100;
    const reworkFlag = data.rework_required === true || Boolean(tools.rework?.enabled);
    return { score, assessed: maxPoints, passed: score >= 80 && !reworkFlag };
  }, [template, data, tools.rework?.enabled]);

  /* ── Accountability: scoring/categories (settings when exposed, else defaults) ── */
  const acctScoring: AccountabilityScoring =
    (payload?.settings?.accountability?.scoring as AccountabilityScoring | undefined) ?? DEFAULT_ACCOUNTABILITY_SCORING;
  const issueCategories: { key: string; label: string }[] =
    (payload?.settings?.accountability?.issueCategories as { key: string; label: string }[] | undefined) ??
    DEFAULT_ISSUE_CATEGORIES;

  // Cleaner-submission signals per field: their affirmative answer (false-
  // confirmation basis) + their media ids attached to that field.
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

  // Which template fields are reviewed checklist items (answerable OR evidence
  // uploads; signature/instruction/inventory are display-only). Build per-item
  // metadata for the verdict entries.
  const itemMeta = useMemo(() => {
    const map: Record<string, ItemMeta> = {};
    const sections = template?.schema?.sections ?? [];
    for (const section of sections) {
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
  const gradingHelp = useMemo(() => gradingExplainer(acctScoring), [acctScoring]);

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
  function addVerdictPhoto(fieldId: string, key: string, url?: string) {
    if (url) setUrlByKey((p) => ({ ...p, [key]: url }));
    setVerdicts((prev) => {
      const cur = prev[fieldId] ?? emptyVerdictState();
      const existing = cur.qaPhotoKeys ?? [];
      if (existing.some((p) => p.key === key)) return prev;
      return { ...prev, [fieldId]: { ...cur, qaPhotoKeys: [...existing, { key }] } };
    });
  }
  function removeVerdictPhoto(fieldId: string, key: string) {
    setVerdicts((prev) => {
      const cur = prev[fieldId];
      if (!cur) return prev;
      return { ...prev, [fieldId]: { ...cur, qaPhotoKeys: (cur.qaPhotoKeys ?? []).filter((p) => p.key !== key) } };
    });
  }

  /* ── photo markup ──────────────────────────────────────────────────────
     Upload the transparent overlay PNG the annotator exports, then record it
     against the ORIGINAL key in whichever collection owns the photo. The
     original upload is untouched — the markup is stored in addition to it:
       section  → tools.mediaAnnotations[key]           = { overlayKey, comment }
       damage   → damage[].annotations[key]             = { overlayKey, comment }
       flagged  → rework.flaggedAreas[].annotations[key]= { overlayKey, comment }
                  (lib/qa/rework-jobs flattens these onto the photo for the
                   cleaner's fix checklist)
       issue    → verdict.qaPhotoKeys[].annotatedKey    (the wire shape the QA
                  submit route already sanitises into QaIssue.qaPhotoKeys)
     Markup is always optional and never gates submit. */
  const annotationFor = useCallback(
    (target: NonNullable<typeof annotateTarget>): { overlayKey?: string; comment?: string } | undefined => {
      if (target.scope === "damage") return tools.damage.find((d) => d.id === target.entryId)?.annotations?.[target.key];
      if (target.scope === "flagged") {
        return (tools.rework ?? emptyReworkProposal()).flaggedAreas.find((a) => a.id === target.areaId)?.annotations?.[
          target.key
        ];
      }
      if (target.scope === "issue") {
        const entry = (verdicts[target.fieldId ?? ""]?.qaPhotoKeys ?? []).find((p) => p.key === target.key);
        return entry?.annotatedKey ? { overlayKey: entry.annotatedKey } : undefined;
      }
      return tools.mediaAnnotations[target.key];
    },
    [tools.damage, tools.rework, tools.mediaAnnotations, verdicts]
  );

  async function saveAnnotation(blob: Blob, comment: string) {
    const target = annotateTarget;
    if (!target) return;
    setSavingAnnotation(true);
    try {
      const fd = new FormData();
      fd.append("file", new File([blob], `qa-markup-${Date.now()}.png`, { type: "image/png" }));
      fd.append("folder", "qa-annotations");
      if (jobId) fd.append("jobId", jobId);
      const res = await fetch("/api/uploads/direct", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.key) {
        pushToast({ title: "Could not save the markup", description: body?.error ?? "Please retry.", tone: "danger" });
        return;
      }
      const overlayKey = String(body.key);
      const markup = { overlayKey, comment: comment || undefined };
      if (body.url) setUrlByKey((prev) => ({ ...prev, [overlayKey]: body.url }));

      if (target.scope === "damage" && target.entryId) {
        setTools((prev) => ({
          ...prev,
          damage: prev.damage.map((d) =>
            d.id === target.entryId ? { ...d, annotations: { ...(d.annotations ?? {}), [target.key]: markup } } : d
          ),
        }));
      } else if (target.scope === "flagged" && target.areaId) {
        setTools((prev) => {
          const rw = prev.rework ?? emptyReworkProposal();
          return {
            ...prev,
            rework: {
              ...rw,
              flaggedAreas: rw.flaggedAreas.map((a) =>
                a.id === target.areaId ? { ...a, annotations: { ...(a.annotations ?? {}), [target.key]: markup } } : a
              ),
            },
          };
        });
      } else if (target.scope === "issue" && target.fieldId) {
        const fieldId = target.fieldId;
        setVerdicts((prev) => {
          const cur = prev[fieldId] ?? emptyVerdictState();
          return {
            ...prev,
            [fieldId]: {
              ...cur,
              qaPhotoKeys: (cur.qaPhotoKeys ?? []).map((p) =>
                p.key === target.key ? { ...p, annotatedKey: overlayKey } : p
              ),
            },
          };
        });
      } else {
        setTools((prev) => ({
          ...prev,
          mediaAnnotations: { ...prev.mediaAnnotations, [target.key]: markup },
        }));
      }
      pushToast({ title: "Markup saved", tone: "info" });
      setAnnotateTarget(null);
    } catch {
      pushToast({ title: "Could not save the markup", description: "Please retry.", tone: "danger" });
    } finally {
      setSavingAnnotation(false);
    }
  }

  /* ── damage ── */
  function addDamage() {
    setTools((prev) => ({
      ...prev,
      damage: [...prev.damage, { id: uid(), area: "", description: "", severity: "MEDIUM", photoKeys: [], estimatedCost: null }],
    }));
  }
  function updateDamage(id: string, patch: Partial<QaDamageEntry>) {
    setTools((prev) => ({ ...prev, damage: prev.damage.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
  }
  function removeDamage(id: string) {
    setTools((prev) => ({ ...prev, damage: prev.damage.filter((d) => d.id !== id) }));
  }
  function addDamagePhoto(entryId: string, key: string, url?: string) {
    if (url) setUrlByKey((p) => ({ ...p, [key]: url }));
    setTools((prev) => ({
      ...prev,
      damage: prev.damage.map((d) =>
        d.id === entryId && !d.photoKeys.includes(key) ? { ...d, photoKeys: [...d.photoKeys, key] } : d
      ),
    }));
  }
  function removeDamagePhoto(entryId: string, key: string) {
    setTools((prev) => ({
      ...prev,
      damage: prev.damage.map((d) =>
        d.id === entryId ? { ...d, photoKeys: d.photoKeys.filter((k) => k !== key) } : d
      ),
    }));
  }

  /* ── next clean ── */
  function addNextClean(kind: QaNextCleanRequest["kind"]) {
    setTools((prev) => ({ ...prev, nextClean: [...prev.nextClean, { id: uid(), kind, area: "", note: "" }] }));
  }
  function updateNextClean(id: string, patch: Partial<QaNextCleanRequest>) {
    setTools((prev) => ({ ...prev, nextClean: prev.nextClean.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  }
  function removeNextClean(id: string) {
    setTools((prev) => ({ ...prev, nextClean: prev.nextClean.filter((r) => r.id !== id) }));
  }

  /* ── inventory ── */
  function setRestockQty(propertyStockId: string, quantity: number) {
    setTools((prev) => {
      const others = prev.restock.filter((l) => l.propertyStockId !== propertyStockId);
      return { ...prev, restock: quantity > 0 ? [...others, { propertyStockId, quantity }] : others };
    });
  }
  function setCount(propertyStockId: string, countedOnHand: number | null) {
    setTools((prev) => {
      const others = prev.inventoryCount.filter((l) => l.propertyStockId !== propertyStockId);
      return { ...prev, inventoryCount: countedOnHand == null ? others : [...others, { propertyStockId, countedOnHand }] };
    });
  }

  /* ── section photos ── */
  function addSectionPhoto(sectionId: string, key: string, url?: string) {
    if (url) setUrlByKey((p) => ({ ...p, [key]: url }));
    setTools((prev) => {
      const existing = prev.sectionPhotos[sectionId] ?? [];
      if (existing.includes(key)) return prev;
      return { ...prev, sectionPhotos: { ...prev.sectionPhotos, [sectionId]: [...existing, key] } };
    });
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

  /* ── rework ── */
  const rework = tools.rework ?? emptyReworkProposal();
  function setRework(patch: Partial<typeof rework>) {
    setTools((prev) => ({ ...prev, rework: { ...(prev.rework ?? emptyReworkProposal()), ...patch } }));
  }
  const reworkDecision: "OFFER_ORIGINAL" | "OTHER" | "QA_SELF" =
    rework.decision ?? (rework.assignee === "OTHER" ? "OTHER" : "OFFER_ORIGINAL");

  /** What the chosen rework path actually costs, line by line. */
  const reworkMoneyPreview = useMemo(() => {
    const originalName = cleanerCandidates[0]?.name || cleanerCandidates[0]?.email || "Original cleaner";
    const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
    if (reworkDecision === "OTHER") {
      const payee =
        cleanerCandidates.find((c) => c.id === rework.payeeCleanerId)?.name ?? "New cleaner";
      return [
        { label: `Paid to ${payee}`, value: money(rework.payAmount), color: "hsl(var(--e-success))" },
        {
          label: `Deducted from ${originalName}`,
          value: `−${money(rework.payAmount)}`,
          color: "hsl(var(--e-danger))",
        },
        { label: "Rework job invoiceable", value: rework.payAmount > 0 ? "Yes" : "No", color: "inherit" },
        { label: "Approval", value: "Both adjustments PENDING", color: "hsl(var(--e-warning))" },
      ];
    }
    if (reworkDecision === "QA_SELF") {
      return [
        {
          label: "Moved to you (QA)",
          value: money(rework.amountFromCleaner),
          color: "hsl(var(--e-success))",
        },
        {
          label: `Deducted from ${originalName}`,
          value: `−${money(rework.amountFromCleaner)}`,
          color: "hsl(var(--e-danger))",
        },
        { label: "Time moved", value: `${rework.minutesFromCleaner || 0} min`, color: "inherit" },
        { label: "Approval", value: "Transfer PENDING", color: "hsl(var(--e-warning))" },
      ];
    }
    return [
      { label: `Paid to ${originalName}`, value: money(0), color: "inherit" },
      { label: "Deduction", value: "None", color: "inherit" },
      { label: "Rework job invoiceable", value: "No", color: "inherit" },
      { label: "Offer", value: "Expires if not accepted", color: "hsl(var(--e-warning))" },
    ];
  }, [
    reworkDecision,
    rework.payAmount,
    rework.payeeCleanerId,
    rework.amountFromCleaner,
    rework.minutesFromCleaner,
    cleanerCandidates,
  ]);

  const [reworkAreaDraft, setReworkAreaDraft] = useState("");
  function addFlaggedArea() {
    const value = reworkAreaDraft.trim();
    setRework({ flaggedAreas: [...rework.flaggedAreas, { id: uid(), label: value || "Flagged area", note: "", photoKeys: [] }] });
    setReworkAreaDraft("");
  }
  function updateFlaggedArea(id: string, patch: Partial<(typeof rework.flaggedAreas)[number]>) {
    setRework({ flaggedAreas: rework.flaggedAreas.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  }
  function removeFlaggedArea(id: string) {
    setRework({ flaggedAreas: rework.flaggedAreas.filter((a) => a.id !== id) });
  }
  function addFlaggedAreaPhoto(areaId: string, key: string, url?: string) {
    if (url) setUrlByKey((p) => ({ ...p, [key]: url }));
    setRework({
      flaggedAreas: rework.flaggedAreas.map((a) =>
        a.id === areaId && !a.photoKeys.includes(key) ? { ...a, photoKeys: [...a.photoKeys, key] } : a
      ),
    });
  }
  function removeFlaggedAreaPhoto(areaId: string, key: string) {
    setRework({
      flaggedAreas: rework.flaggedAreas.map((a) =>
        a.id === areaId ? { ...a, photoKeys: a.photoKeys.filter((k) => k !== key) } : a
      ),
    });
  }

  /* ── submit ── */
  async function submit() {
    if (!template?.id) return;
    if (rework.enabled) {
      if (!rework.reason.trim()) {
        pushToast({ title: "Add a reason for the rework.", tone: "danger" });
        return;
      }
      if (rework.flaggedAreas.filter((a) => a.label.trim()).length === 0) {
        pushToast({ title: "Flag at least one area for the cleaner to fix.", tone: "danger" });
        return;
      }
      if (reworkDecision === "OTHER") {
        if (!rework.payeeCleanerId) {
          pushToast({ title: "Choose the cleaner who will redo this clean.", tone: "danger" });
          return;
        }
        if (!(rework.payAmount > 0)) {
          pushToast({ title: "Enter the pay amount for the new cleaner.", tone: "danger" });
          return;
        }
      }
      if (reworkDecision === "QA_SELF") {
        if (!rework.cleanerUserId) {
          pushToast({ title: "Choose whose job the rework time comes from.", tone: "danger" });
          return;
        }
        if (!(rework.minutesFromCleaner > 0)) {
          pushToast({ title: "Enter the minutes you spent fixing it.", tone: "danger" });
          return;
        }
        if (rework.minutesFromCleaner > onSiteMinutes + 15) {
          pushToast({
            title: "That's longer than your on-site visit",
            description: `You recorded ${onSiteMinutes} min on site — the claim has to fit inside that window.`,
            tone: "danger",
          });
          return;
        }
      }
    }
    const acctInvalid = validateAccountability(verdicts, itemMeta);
    if (acctInvalid.length > 0) {
      pushToast({
        title: "Add a category and description for flagged items",
        description: `${acctInvalid.length} flagged item(s) need an issue category and description: ${acctInvalid.map((i) => i.label).join(", ")}.`,
        tone: "danger",
      });
      return;
    }
    if (!attested) {
      pushToast({ title: "Tick the attestation to sign off this inspection.", tone: "danger" });
      return;
    }
    if (!signatureDataUrl) {
      pushToast({ title: "Add your signature to sign off this inspection.", tone: "danger" });
      return;
    }
    setSaving(true);

    // upload signature
    let signatureKey: string | null = null;
    let sigError = "Please retry.";
    try {
      const sigBlob = dataUrlToBlob(signatureDataUrl);
      const fd = new FormData();
      fd.append("file", new File([sigBlob], `qa-signature-${Date.now()}.png`, { type: "image/png" }));
      fd.append("folder", "qa-signoff");
      const upRes = await fetch("/api/uploads/direct", { method: "POST", body: fd });
      const upBody = await upRes.json().catch(() => ({}));
      if (upRes.ok && upBody?.key) signatureKey = upBody.key as string;
      else if (upBody?.error) sigError = String(upBody.error);
    } catch (err) {
      sigError = err instanceof Error ? err.message : "Please retry.";
    }
    if (!signatureKey) {
      setSaving(false);
      pushToast({ title: "Could not save your signature", description: sigError, tone: "danger" });
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
        // Amending a reopened inspection updates that review in place instead of
        // stacking a second one on the job (see lib/qa/reopen.ts).
        ...(amendingReviewId ? { reopenedReviewId: amendingReviewId } : {}),
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
      pushToast({ title: "QA submission failed", description: body.error ?? "Please retry.", tone: "danger" });
      return;
    }
    const extras: string[] = [];
    if (body.createdCaseIds?.length) extras.push(`${body.createdCaseIds.length} case(s)`);
    if (body.restockRunId) extras.push("restock run");
    if (body.countRunId) extras.push("inventory count");
    if (body.reworkJobId) extras.push("rework job created");
    if (body.reworkOffer) extras.push("offered to the original cleaner");
    if (body.reworkTransferId) extras.push("rework transfer pending");
    pushToast({
      title: body.amended ? "QA updated" : "QA submitted",
      description: `Score ${Math.round(body.review?.score ?? 0)}%.${extras.length ? ` Created: ${extras.join(", ")}.` : ""}`,
      tone: "info",
    });
    if (body.reworkBlockedReason) {
      pushToast({ title: "Rework not duplicated", description: String(body.reworkBlockedReason), tone: "danger" });
    }
    setAmendingReviewId(null);
    setTimer({ running: false, elapsedMs: 0, runningSince: null });
    setVerdicts({});
    setMissingEvidence({});
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    // QA self-rework: continue straight into the fix checklist for this job.
    if (rework.enabled && reworkDecision === "QA_SELF" && body.reworkJobId) {
      router.push(`/v2/qa/jobs/${jobId}/self-rework`);
      router.refresh();
      return;
    }
    router.push(returnHref);
    router.refresh();
  }

  /* ── render states ── */
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-6 py-16 text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading QA inspection…
      </div>
    );
  }
  if (!payload || !job) {
    return (
      <ECard>
        <ECardBody className="pt-6 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          QA job not found.
        </ECardBody>
      </ECard>
    );
  }

  const restockByStock = new Map(tools.restock.map((l) => [l.propertyStockId, l.quantity]));
  const countByStock = new Map(tools.inventoryCount.map((l) => [l.propertyStockId, l.countedOnHand]));
  const hasQaSubmission = (job?.qaFormSubmissions?.length ?? 0) > 0;
  const sections = template?.schema?.sections ?? [];

  return (
    <div className="space-y-6">
      {/* toasts */}
      {toasts.length > 0 ? (
        <div className="fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="w-full max-w-sm rounded-[var(--e-radius-lg)] border px-4 py-3 shadow-[var(--e-elevation-2)]"
              style={{
                backgroundColor: t.tone === "danger" ? "hsl(var(--e-danger-soft))" : "hsl(var(--e-surface))",
                borderColor: t.tone === "danger" ? "hsl(var(--e-danger))" : "hsl(var(--e-border-strong))",
              }}
            >
              <p className="text-[0.8125rem] font-semibold text-[hsl(var(--e-foreground))]">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{t.description}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* header */}
      <div className="flex items-start gap-3">
        <EButton asChild variant="ghost" size="icon" className="shrink-0">
          <Link href={returnHref} aria-label="Back to queue">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </EButton>
        <div className="min-w-0 flex-1">
          <p className="e-eyebrow">QA inspection · Sydney</p>
          <h1 className="e-display-md mt-1 truncate">{job.property?.name ?? "Property"}</h1>
          <p className="truncate text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            {[job.property?.address, job.property?.suburb].filter(Boolean).join(", ")}
          </p>
        </div>
        <EBadge tone={job.status === "COMPLETED" ? "success" : "warning"} soft>
          {titleCase(String(job.status))}
        </EBadge>
      </div>
      <div className="e-signature-rule" />

      {/* ── REOPEN A SUBMITTED INSPECTION ──
          A submitted inspection is not a dead end: the inspector who did it (or
          an admin / ops manager) can put it back into progress to fix a wrong
          grade, add a photo they missed or correct a score. It is a pay- and
          scoring-relevant record, so it costs a written reason and is recorded
          in the audit trail — and it never quietly unwinds money that has
          already moved (those warnings are listed before the button). */}
      {reopenState ? (
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex flex-wrap items-center gap-2">
              <Undo2 className="h-4 w-4" style={{ color: "hsl(var(--e-accent-portal))" }} /> This inspection is submitted
              {reopenState.completedAt ? (
                <EBadge tone="neutral" soft>
                  {new Date(reopenState.completedAt).toLocaleString()}
                </EBadge>
              ) : null}
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            {reopenState.eligible ? (
              <>
                <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  Need to change something — a wrong grade, a missed photo, a score that isn&apos;t right? Reopen it,
                  make the change and submit again. Your changes update the existing review rather than adding a second
                  one, and who reopened it and why is recorded.
                </p>
                {(reopenState.warnings ?? []).length > 0 ? (
                  <div className="space-y-2">
                    {(reopenState.warnings as string[]).map((w) => (
                      <EAlert key={w} tone="warning">
                        {w}
                      </EAlert>
                    ))}
                  </div>
                ) : null}
                {reopenError ? <EAlert tone="danger">{reopenError}</EAlert> : null}
                <EField label="Why are you reopening it?" hint="Required — this goes on the record with your name.">
                  <ETextarea
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                    placeholder="e.g. Graded the ensuite Major by mistake — it was a Minor smudge on the mirror."
                  />
                </EField>
                <EButton
                  variant="primary"
                  size="lg"
                  className="w-full"
                  disabled={reopening || reopenReason.trim().length < 10}
                  onClick={() => void doReopen()}
                >
                  {reopening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                  {reopening ? "Reopening…" : "Reopen inspection"}
                </EButton>
              </>
            ) : (
              <EAlert tone="info">{reopenState.blockedReason ?? "This inspection can't be reopened."}</EAlert>
            )}
          </ECardBody>
        </ECard>
      ) : null}

      {amendingReviewId ? (
        <EAlert tone="warning">
          <span className="font-[550]">You&apos;re amending a submitted inspection.</span> Submitting updates the
          existing review and its findings — it does not create a second one. Anything already actioned (a rework job,
          or pay that has been proposed or approved) stays as it is; change that in the Approval Center.
        </EAlert>
      ) : null}

      {/* ── ARRIVAL CHECK-IN GATE ──
          The inspection is locked until the inspector stamps an arrival (or
          explicitly records a remote review with a reason). */}
      {monitoring ? (
        <QaMonitorPanel
          readiness={readiness}
          progress={progress}
          job={job}
          brief={brief}
          refreshing={progressLoading}
          onRefresh={() => void loadProgress()}
        />
      ) : null}

      {!monitoring && needsCheckIn ? (
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4" style={{ color: "hsl(var(--e-accent-portal))" }} /> Check in at the property to start
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              Your arrival is stamped once and can&apos;t be changed later — it is the evidence that this inspection
              happened on site. Checking in also starts your on-site timer.
            </p>
            {checkInError ? <EAlert tone="danger">{checkInError}</EAlert> : null}
            <EButton
              variant="gold"
              size="lg"
              className="w-full"
              disabled={checkingIn}
              onClick={() => void doCheckIn()}
            >
              {checkingIn ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              {checkingIn ? "Getting your location…" : "Check in with GPS"}
            </EButton>

            {remoteMode ? (
              <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
                <EField label="Why can't you check in on site?" hint="Required — the review is flagged as remote.">
                  <ETextarea
                    value={remoteReason}
                    onChange={(e) => setRemoteReason(e.target.value)}
                    placeholder="e.g. Guests checked in early — reviewing from the cleaner's photos."
                  />
                </EField>
                <div className="flex gap-2">
                  <EButton
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setRemoteMode(false);
                      setRemoteReason("");
                    }}
                  >
                    Cancel
                  </EButton>
                  <EButton
                    variant="primary"
                    size="sm"
                    className="flex-1"
                    disabled={checkingIn || remoteReason.trim().length < 5}
                    onClick={() => void doCheckIn(remoteReason.trim())}
                  >
                    Review remotely
                  </EButton>
                </div>
              </div>
            ) : (
              <EButton variant="ghost" size="sm" className="w-full" onClick={() => setRemoteMode(true)}>
                Can&apos;t check in — review remotely
              </EButton>
            )}
          </ECardBody>
        </ECard>
      ) : null}

      {checkIn.at ? (
        <div className="flex flex-wrap items-center gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <EBadge tone={checkIn.skippedReason ? "warning" : "success"} soft>
            {checkIn.skippedReason ? "Remote review" : "Checked in"}
          </EBadge>
          <span>{new Date(checkIn.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {checkIn.accuracy != null ? <span>· {formatAccuracy(checkIn.accuracy)}</span> : null}
          {checkIn.distanceMeters != null ? <span>· {checkIn.distanceMeters}m from property</span> : null}
          {checkIn.skippedReason ? <span>· {checkIn.skippedReason}</span> : null}
        </div>
      ) : null}

      <div className={needsCheckIn || monitoring ? "hidden" : "space-y-6"}>
      {/* step tabs */}
      <div className="sticky top-0 z-20 flex gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]/95 p-2 backdrop-blur">
        {QA_STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setStep(i);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="flex flex-1 items-center gap-2 rounded-[var(--e-radius)] px-2.5 py-1.5 text-left text-[0.8125rem] font-[550] transition-colors"
            style={{
              backgroundColor: i === step ? "hsl(var(--e-gold-soft))" : "transparent",
              color: i === step ? "hsl(var(--e-gold-ink))" : "hsl(var(--e-muted-foreground))",
            }}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-bold"
              style={{
                backgroundColor: i === step ? "hsl(var(--e-gold))" : "transparent",
                color: i === step ? "hsl(var(--e-gold-foreground))" : "hsl(var(--e-muted-foreground))",
                border: i === step ? "none" : "1px solid hsl(var(--e-border-strong))",
              }}
            >
              {i + 1}
            </span>
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {/* ── STEP 0: PRE-INSPECTION BRIEF ──
          Who cleaned, how long they took vs expected, what they submitted, then
          the rule cards from lib/qa/brief-rules.ts. */}
      <div className={step === 0 ? "space-y-6" : "hidden"}>
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" style={{ color: "hsl(var(--e-accent-portal))" }} /> Before you walk in
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.6875rem] uppercase tracking-[0.1em] text-[hsl(var(--e-muted-foreground))]">
                  Cleaner{briefCleaners.length > 1 ? "s" : ""}
                </p>
                <p className="mt-1 text-[0.875rem] font-medium">
                  {briefCleaners.length > 0 ? briefCleaners.map((c) => c.name).join(", ") : "Unassigned"}
                </p>
              </div>
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.6875rem] uppercase tracking-[0.1em] text-[hsl(var(--e-muted-foreground))]">
                  Time on job
                </p>
                <p className="mt-1 text-[0.875rem] font-medium" style={{ color: timeTone }}>
                  {briefJob?.actualHours != null ? `${briefJob.actualHours}h` : "—"}
                  <span className="text-[hsl(var(--e-muted-foreground))]">
                    {" "}
                    of {briefJob?.expectedHours != null ? `${briefJob.expectedHours}h` : "—"}
                  </span>
                </p>
              </div>
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.6875rem] uppercase tracking-[0.1em] text-[hsl(var(--e-muted-foreground))]">
                  Submission
                </p>
                <p className="mt-1 text-[0.875rem] font-medium">
                  {briefJob?.formPendingAfterClockOut
                    ? "Form pending"
                    : briefSubmission
                      ? `${briefSubmission.photoCount} photo${briefSubmission.photoCount === 1 ? "" : "s"}`
                      : "Not submitted"}
                </p>
              </div>
            </div>

            {/* submitted photo grid (or the "form pending" note) */}
            {briefJob?.formPendingAfterClockOut && mediaItems.length === 0 ? (
              <EAlert tone="warning">
                The cleaner clocked out before submitting their form — there are no submitted photos to review against.
              </EAlert>
            ) : mediaItems.length > 0 ? (
              <div>
                <p className="mb-2 text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
                  What the cleaner submitted
                </p>
                <MediaGallery items={mediaItems.slice(0, 12)} />
              </div>
            ) : null}

            {/* low stock */}
            {briefLowStock.length > 0 ? (
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="flex items-center gap-1.5 text-[0.8125rem] font-[600]">
                  <Package className="h-4 w-4" /> Low stock
                </p>
                <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  {briefLowStock.map((s) => `${s.name} (${s.onHand})`).join(", ")}
                </p>
              </div>
            ) : null}

            {/* rule cards */}
            {brief.length > 0 ? (
              <div className="space-y-2">
                {brief.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[var(--e-radius-lg)] border-l-[3px] p-3"
                    style={{
                      borderLeftColor:
                        item.tone === "danger"
                          ? "hsl(var(--e-danger))"
                          : item.tone === "warning"
                            ? "hsl(var(--e-warning))"
                            : "hsl(var(--e-accent-portal))",
                      backgroundColor:
                        item.tone === "danger"
                          ? "hsl(var(--e-danger-soft))"
                          : item.tone === "warning"
                            ? "hsl(var(--e-warning-soft))"
                            : "hsl(var(--e-surface-raised))",
                    }}
                  >
                    <p className="text-[0.8125rem] font-[600]">{item.title}</p>
                    <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{item.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Nothing unusual flagged for this clean — inspect to the standard.
              </p>
            )}

            <EButton
              variant="gold"
              size="lg"
              className="w-full"
              onClick={() => {
                setStep(1);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Begin inspection <ArrowRight className="h-4 w-4" />
            </EButton>
          </ECardBody>
        </ECard>
      </div>

      {/* ── STEP 1: inspect & log findings ── */}
      <div className={step === 1 ? "space-y-6" : "hidden"}>
        {/* Recurring-issue watch-outs (Phase 7a) — where to look this clean. */}
        {hasWatchOuts ? (
          <div className="rounded-[var(--e-radius-lg)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-[600]">
              <AlertTriangle className="h-4 w-4" /> Recurring — check these closely
            </p>
            <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              {[
                ...watchOuts.cleaner.map((r) => `${r.label.toLowerCase()} ×${r.count} (cleaner)`),
                ...watchOuts.property.map((r) => `${r.label.toLowerCase()} ×${r.count} (property)`),
              ].join(", ")}
            </p>
          </div>
        ) : null}

        <ECard>
          <ECardHeader><ECardTitle>Cleaner submission evidence</ECardTitle></ECardHeader>
          <ECardBody className="space-y-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Submitted by {latestSubmission?.submittedBy?.name || latestSubmission?.submittedBy?.email || "Unknown"}.
            </p>
            {mediaItems.length > 0 ? (
              <MediaGallery
                items={mediaItems}
                title="Cleaner submission evidence"
                className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6"
              />
            ) : (
              <EAlert tone="info">No cleaner media was attached to this submission.</EAlert>
            )}
          </ECardBody>
        </ECard>

        <ECard>
          <ECardHeader><ECardTitle>Job context</ECardTitle></ECardHeader>
          <ECardBody className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
              <p className="e-eyebrow">Job tasks</p>
              <p className="e-numeral mt-1 text-[1.5rem] leading-none">{job.jobTasks?.length ?? 0}</p>
            </div>
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
              <p className="e-eyebrow">Laundry</p>
              <p className="mt-1 text-[0.875rem] font-medium">{job.laundryTask?.status ? titleCase(job.laundryTask.status) : "None"}</p>
            </div>
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
              <p className="e-eyebrow">Open cases</p>
              <p className="e-numeral mt-1 text-[1.5rem] leading-none">{job.issueTickets?.length ?? 0}</p>
            </div>
          </ECardBody>
        </ECard>

        {existingReworks.length > 0 ? (
          <ECard>
            <ECardHeader><ECardTitle>Rework transfers on this job</ECardTitle></ECardHeader>
            <ECardBody className="space-y-2">
              {existingReworks.map((rw) => (
                <div key={rw.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <EBadge tone={rw.status === "APPROVED" ? "success" : rw.status === "REJECTED" ? "danger" : "warning"} soft>
                      {titleCase(String(rw.status))}
                    </EBadge>
                    <span className="text-[0.6875rem] uppercase tracking-[0.1em] text-[hsl(var(--e-muted-foreground))]">{rw.severity}</span>
                    <span className="e-tnum text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {rw.minutesFromCleaner}m · ${Number(rw.amountFromCleaner).toFixed(2)}
                    </span>
                  </div>
                  <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {rw.cleaner?.name ?? "Cleaner"} → {rw.qaUser?.name ?? "QA"}: {rw.reason}
                  </p>
                </div>
              ))}
            </ECardBody>
          </ECard>
        ) : null}

        {/* damage */}
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" style={{ color: "hsl(var(--e-danger))" }} /> Damage report
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Each entry opens a linked Damage case on submit (photos attach to the case).
            </p>
            {tools.damage.map((entry) => (
              <div key={entry.id} className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
                  <EField label="Area">
                    <EInput value={entry.area} onChange={(e) => updateDamage(entry.id, { area: e.target.value })} placeholder="e.g. Master bathroom" />
                  </EField>
                  <EField label="Severity">
                    <ESelect value={entry.severity} onChange={(e) => updateDamage(entry.id, { severity: e.target.value as any })}>
                      {DAMAGE_SEVERITIES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </ESelect>
                  </EField>
                </div>
                <EField label="Description">
                  <ETextarea value={entry.description} onChange={(e) => updateDamage(entry.id, { description: e.target.value })} placeholder="What's damaged and how?" />
                </EField>
                <EField label="Est. cost ($)" className="max-w-[200px]">
                  <EInput
                    type="number"
                    min={0}
                    step="0.01"
                    value={entry.estimatedCost ?? ""}
                    onChange={(e) => updateDamage(entry.id, { estimatedCost: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </EField>
                {entry.photoKeys.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {entry.photoKeys.map((key) => {
                      const annotation = entry.annotations?.[key];
                      return (
                        <Thumb
                          key={key}
                          url={urlByKey[key]}
                          overlayUrl={annotation?.overlayKey ? urlByKey[annotation.overlayKey] : undefined}
                          annotated={Boolean(annotation)}
                          annotateTitle={annotation?.comment || undefined}
                          onAnnotate={
                            urlByKey[key]
                              ? () => setAnnotateTarget({ scope: "damage", entryId: entry.id, key, url: urlByKey[key] })
                              : undefined
                          }
                          onRemove={() => removeDamagePhoto(entry.id, key)}
                        />
                      );
                    })}
                  </div>
                ) : null}
                <div className="flex items-center justify-between">
                  <Uploader
                    jobId={jobId}
                    folder="qa-damage"
                    label="Add damage photo"
                    stamp={{ ...qaStamp, tag: "damage", contextLabel: "QA · Damage" }}
                    onUploaded={(key, url) => addDamagePhoto(entry.id, key, url)}
                    onError={(msg) => pushToast({ title: "Upload failed", description: msg, tone: "danger" })}
                  />
                  <EButton variant="ghost" size="sm" onClick={() => removeDamage(entry.id)}>
                    <Trash2 className="h-4 w-4" /> Remove
                  </EButton>
                </div>
              </div>
            ))}
            <EButton variant="outline" size="sm" onClick={addDamage}>
              <Plus className="h-4 w-4" /> Add damage entry
            </EButton>
          </ECardBody>
        </ECard>

        {/* next clean */}
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" style={{ color: "hsl(var(--e-accent-portal))" }} /> Next-clean actions
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Attaches to the property + this job&apos;s notes so the next cleaner sees it.
            </p>
            {tools.nextClean.map((r) => (
              <div key={r.id} className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                <div className="flex items-center gap-2">
                  <EBadge tone="neutral" soft>{r.kind === "DEEP_CLEAN_AREA" ? "Deep clean area" : "Special request"}</EBadge>
                  <EButton variant="ghost" size="sm" className="ml-auto" onClick={() => removeNextClean(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </EButton>
                </div>
                {r.kind === "DEEP_CLEAN_AREA" ? (
                  <EInput value={r.area ?? ""} onChange={(e) => updateNextClean(r.id, { area: e.target.value })} placeholder="Which area? e.g. Oven, balcony" />
                ) : null}
                <ETextarea value={r.note} onChange={(e) => updateNextClean(r.id, { note: e.target.value })} placeholder="Instruction for the next clean" />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <EButton variant="outline" size="sm" onClick={() => addNextClean("DEEP_CLEAN_AREA")}>
                <Plus className="h-4 w-4" /> Deep clean area
              </EButton>
              <EButton variant="outline" size="sm" onClick={() => addNextClean("SPECIAL_REQUEST")}>
                <Plus className="h-4 w-4" /> Special request
              </EButton>
            </div>
          </ECardBody>
        </ECard>

        {/* inventory */}
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2">
              <Package className="h-4 w-4" style={{ color: "hsl(var(--e-accent-portal))" }} /> Inventory — restock &amp; count
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            {propertyStock.length === 0 ? (
              <EAlert tone="info">No property stock configured.</EAlert>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_90px_110px] gap-2 px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-[hsl(var(--e-muted-foreground))]">
                  <span>Item (on hand)</span>
                  <span className="text-right">Restock</span>
                  <span className="text-right">Count</span>
                </div>
                <div className="space-y-1.5">
                  {propertyStock.map((stock) => (
                    <div key={stock.id} className="grid grid-cols-[1fr_90px_110px] items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2">
                      <div className="min-w-0">
                        <p className="truncate text-[0.875rem] font-medium">{stock.item?.name ?? "Item"}</p>
                        <p className="e-tnum text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          On hand: {Number(stock.onHand)} {stock.item?.unit ?? ""}
                        </p>
                      </div>
                      <EInput
                        type="number"
                        min={0}
                        className="h-9 text-right"
                        value={restockByStock.get(stock.id) ?? ""}
                        onChange={(e) => setRestockQty(stock.id, Number(e.target.value || 0))}
                        placeholder="0"
                      />
                      <EInput
                        type="number"
                        min={0}
                        className="h-9 text-right"
                        value={countByStock.get(stock.id) ?? ""}
                        onChange={(e) => setCount(stock.id, e.target.value === "" ? null : Number(e.target.value))}
                        placeholder="—"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Restock qty &gt; 0 → DRAFT restock run · counts → DRAFT count run (admin applies).
                </p>
              </>
            )}
          </ECardBody>
        </ECard>
      </div>

      {/* ── STEP 2: score, sign off & submit ── */}
      <div className={step === 2 ? "space-y-6" : "hidden"}>
        {/* time on site */}
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" style={{ color: "hsl(var(--e-accent-portal))" }} /> Time on site
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            <div className="flex flex-col items-center rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
              <span className="e-numeral text-[2.5rem] leading-none">{formatHMS(liveMs)}</span>
              <span className="mt-1 text-[0.6875rem] uppercase tracking-[0.1em] text-[hsl(var(--e-muted-foreground))]">
                {timerEnded ? "Ended" : timer.running ? "Running" : liveMs > 0 ? "Paused" : "Not started"} · {onSiteMinutes} min
              </span>
            </div>
            <div className="flex gap-2">
              {timer.running ? (
                <EButton variant="outline" size="lg" className="flex-1" onClick={pauseOnSite}>
                  <Pause className="h-4 w-4" /> Pause
                </EButton>
              ) : (
                <EButton variant="primary" size="lg" className="flex-1" disabled={timerEnded} onClick={startOrResumeOnSite}>
                  <Play className="h-4 w-4" /> {liveMs > 0 ? "Resume" : "Start"}
                </EButton>
              )}
              <EButton variant="outline" size="lg" className="flex-1" disabled={liveMs === 0 || timerEnded} onClick={endOnSite}>
                <Square className="h-4 w-4" /> End
              </EButton>
            </div>
          </ECardBody>
        </ECard>

        {/* rework */}
        <ECard>
          <ECardHeader>
            <ECardTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4" style={{ color: "hsl(var(--e-warning))" }} /> Send back for rework
            </ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            <ESwitch
              checked={rework.enabled}
              onCheckedChange={(v) => setRework({ enabled: v })}
              label="Create a rework job — flag the areas to fix (each with your photo)"
            />
            {rework.enabled ? (
              <div className="space-y-3">
                <EField label="Severity">
                  <ESelect value={rework.severity} onChange={(e) => setRework({ severity: e.target.value as any })}>
                    {REWORK_SEVERITIES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </ESelect>
                </EField>
                <EField label="Summary / reason">
                  <ETextarea
                    value={rework.reason}
                    onChange={(e) => setRework({ reason: e.target.value })}
                    placeholder="e.g. Bathroom not sanitized and floors not mopped — see flagged areas."
                  />
                </EField>
                <div className="grid gap-3 sm:grid-cols-2">
                  <EField label="Allocated hours for the rework" hint="Blank keeps the original job's hours. Same-cleaner reworks are unpaid.">
                    <EInput
                      type="number"
                      min="0"
                      step="0.25"
                      value={rework.allocatedHours ?? ""}
                      onChange={(e) => setRework({ allocatedHours: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </EField>
                  <EField label="Fix checklist layout" hint="One section per area, or a single flat list.">
                    <div className="flex h-10 items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] px-3">
                      <span className="text-[0.8125rem]">{rework.categorized ? "One section per area" : "Single flat list"}</span>
                      <ESwitch checked={rework.categorized} onCheckedChange={(v) => setRework({ categorized: v })} />
                    </div>
                  </EField>
                </div>

                <div className="space-y-2">
                  <label className={"text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]"}>
                    Flagged areas (the cleaner re-cleans each and uploads an after photo)
                  </label>
                  {rework.flaggedAreas.map((area) => (
                    <div key={area.id} className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                      <div className="flex items-center gap-2">
                        <EInput value={area.label} onChange={(e) => updateFlaggedArea(area.id, { label: e.target.value })} placeholder="Area (e.g. Main bathroom)" />
                        <EButton variant="ghost" size="icon" aria-label="Remove area" onClick={() => removeFlaggedArea(area.id)}>
                          <Trash2 className="h-4 w-4" />
                        </EButton>
                      </div>
                      <ETextarea value={area.note ?? ""} onChange={(e) => updateFlaggedArea(area.id, { note: e.target.value })} placeholder="What's wrong / what to fix" />
                      {area.photoKeys.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {area.photoKeys.map((key) => {
                            const annotation = area.annotations?.[key];
                            return (
                              <Thumb
                                key={key}
                                url={urlByKey[key]}
                                overlayUrl={annotation?.overlayKey ? urlByKey[annotation.overlayKey] : undefined}
                                annotated={Boolean(annotation)}
                                annotateTitle={annotation?.comment || undefined}
                                onAnnotate={
                                  urlByKey[key]
                                    ? () =>
                                        setAnnotateTarget({ scope: "flagged", areaId: area.id, key, url: urlByKey[key] })
                                    : undefined
                                }
                                onRemove={() => removeFlaggedAreaPhoto(area.id, key)}
                              />
                            );
                          })}
                        </div>
                      ) : null}
                      <Uploader
                        jobId={jobId}
                        folder="qa-damage"
                        label="Add photo of the problem"
                        stamp={{ ...qaStamp, contextLabel: "QA · Flagged area" }}
                        onUploaded={(key, url) => addFlaggedAreaPhoto(area.id, key, url)}
                        onError={(msg) => pushToast({ title: "Upload failed", description: msg, tone: "danger" })}
                      />
                    </div>
                  ))}
                  <EButton variant="outline" size="sm" onClick={addFlaggedArea}>
                    <Plus className="h-4 w-4" /> Add flagged area
                  </EButton>
                </div>

                {/* ── THE REWORK DECISION — three explicit paths ──
                    (a) offer it back to the original cleaner (free, TTL),
                    (b) reassign to someone else (paid + equal deduction),
                    (c) the inspector fixes it and claims time/pay.
                    Every money effect below lands PENDING for admin approval. */}
                <EField label="Who fixes it?">
                  <div className="space-y-2">
                    {(
                      [
                        [
                          "OFFER_ORIGINAL",
                          "Offer it back to the original cleaner",
                          "They come back and fix it. No pay, no deduction. The offer expires if they don't respond.",
                        ],
                        [
                          "OTHER",
                          "Assign a different cleaner",
                          "The new cleaner is paid and the same amount is deducted from the original cleaner.",
                        ],
                        [
                          "QA_SELF",
                          "I'll fix it myself (QA rework)",
                          "You complete the fix checklist and claim the time/pay from the cleaner's job.",
                        ],
                      ] as const
                    ).map(([value, label, help]) => {
                      const active = reworkDecision === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() =>
                            setRework({
                              decision: value,
                              assignee: value === "OTHER" ? "OTHER" : "SAME",
                              ...(value === "OTHER" ? {} : { payeeCleanerId: null, payAmount: 0 }),
                              ...(value === "QA_SELF"
                                ? { cleanerUserId: rework.cleanerUserId ?? cleanerCandidates[0]?.id ?? null }
                                : { minutesFromCleaner: 0, amountFromCleaner: 0 }),
                            })
                          }
                          className="w-full rounded-[var(--e-radius)] border p-3 text-left transition-colors"
                          style={{
                            borderColor: active ? "hsl(var(--e-gold))" : "hsl(var(--e-border))",
                            backgroundColor: active ? "hsl(var(--e-gold-soft))" : "transparent",
                          }}
                        >
                          <p className="text-[0.8125rem] font-[600]">{label}</p>
                          <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{help}</p>
                        </button>
                      );
                    })}
                  </div>
                </EField>

                {reworkDecision === "QA_SELF" ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <EField label="Whose job it comes from">
                      <ESelect
                        value={rework.cleanerUserId ?? ""}
                        onChange={(e) => setRework({ cleanerUserId: e.target.value || null })}
                      >
                        <option value="">Select cleaner</option>
                        {cleanerCandidates.map((c) => (
                          <option key={c.id} value={c.id}>{c.name || c.email}</option>
                        ))}
                      </ESelect>
                    </EField>
                    <EField label="Minutes you spent fixing" hint={`On site: ${onSiteMinutes} min`}>
                      <EInput
                        type="number"
                        min={0}
                        value={rework.minutesFromCleaner || ""}
                        onChange={(e) => setRework({ minutesFromCleaner: Number(e.target.value || 0) })}
                      />
                    </EField>
                    <EField label="Amount to move ($)">
                      <EInput
                        type="number"
                        min={0}
                        step="0.01"
                        value={rework.amountFromCleaner || ""}
                        onChange={(e) => setRework({ amountFromCleaner: Number(e.target.value || 0) })}
                      />
                    </EField>
                  </div>
                ) : null}

                {reworkDecision === "OTHER" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <EField label="New cleaner">
                      <ESelect value={rework.payeeCleanerId ?? ""} onChange={(e) => setRework({ payeeCleanerId: e.target.value })}>
                        <option value="">Select cleaner</option>
                        {cleanerCandidates.map((c) => (
                          <option key={c.id} value={c.id}>{c.name || c.email}</option>
                        ))}
                      </ESelect>
                    </EField>
                    <EField label="Pay amount ($)">
                      <EInput type="number" min={0} step="0.01" value={rework.payAmount || ""} onChange={(e) => setRework({ payAmount: Number(e.target.value || 0) })} />
                    </EField>
                  </div>
                ) : null}
                {/* money preview — what this decision actually costs */}
                <div className="space-y-1.5 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised))] p-3">
                  <p className="text-[0.75rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">
                    Money preview
                  </p>
                  {reworkMoneyPreview.map((line) => (
                    <div key={line.label} className="flex items-center justify-between gap-3 text-[0.8125rem]">
                      <span className="text-[hsl(var(--e-text-secondary))]">{line.label}</span>
                      <span className="e-numeral font-medium" style={{ color: line.color }}>
                        {line.value}
                      </span>
                    </div>
                  ))}
                  <p className="pt-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                    All pay and time effects are created PENDING and only reach payroll once an admin approves them.
                  </p>
                </div>
              </div>
            ) : null}
          </ECardBody>
        </ECard>

        {/* ── HOW GRADING WORKS ──
            The five grade buttons used to be five bare words. This says, in
            plain English and using the numbers actually configured, what each
            one costs and what it sets off. Copy lives in accountability.ts
            (verdictGuide / gradingExplainer) and is derived from the scoring
            code, so it can't drift into wishful thinking. */}
        <ECard>
          <ECardBody className="pt-6">
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left"
              aria-expanded={showGradingHelp}
              onClick={() => setShowGradingHelp((v) => !v)}
            >
              <Info className="h-4 w-4 shrink-0" style={{ color: "hsl(var(--e-accent-portal))" }} />
              <span className="flex-1 text-[0.875rem] font-semibold">How grading works</span>
              <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {showGradingHelp ? "Hide" : "Read this"}
              </span>
              <ChevronDown
                className="h-4 w-4 shrink-0 transition-transform"
                style={{ transform: showGradingHelp ? "rotate(180deg)" : undefined }}
              />
            </button>
            <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{gradingHelp.passLine}</p>
            {showGradingHelp ? (
              <div className="mt-3 space-y-3">
                <ul className="space-y-1.5">
                  {gradingHelp.gradeLines.map((line) => (
                    <li key={line} className="text-[0.8125rem] leading-snug text-[hsl(var(--e-text-secondary))]">
                      • {line}
                    </li>
                  ))}
                </ul>
                <ul className="space-y-1.5 border-t border-[hsl(var(--e-border))] pt-3">
                  {gradingHelp.extraLines.map((line) => (
                    <li key={line} className="text-[0.8125rem] leading-snug text-[hsl(var(--e-text-secondary))]">
                      • {line}
                    </li>
                  ))}
                </ul>
                <EAlert tone="info">{gradingHelp.notAutomatic}</EAlert>
                <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                  Anything below Pass asks you for the kind of problem and a short description — that&apos;s what the
                  cleaner is shown, so write it as if they&apos;ll read it, because they will.
                </p>
              </div>
            ) : null}
          </ECardBody>
        </ECard>

        {/* accountability live score */}
        <ECard className="sticky top-[68px] z-10">
          <ECardHeader>
            <div className="flex items-center justify-between gap-3">
              <ECardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" style={{ color: "hsl(var(--e-gold))" }} /> Accountability score
              </ECardTitle>
              <div className="text-right">
                <p
                  className="e-numeral text-[1.5rem] leading-none"
                  style={{
                    color: acctPreview.managementReview
                      ? "hsl(var(--e-danger))"
                      : acctPreview.rating === "FAILED"
                        ? "hsl(var(--e-danger))"
                        : acctPreview.rating === "NEEDS IMPROVEMENT"
                          ? "hsl(var(--e-warning))"
                          : "hsl(var(--e-success))",
                  }}
                >
                  {acctPreview.raw}
                </p>
                <p className="text-[0.6875rem] uppercase tracking-[0.1em] text-[hsl(var(--e-muted-foreground))]">
                  {acctPreview.active ? "of 100" : "no findings"}
                </p>
              </div>
            </div>
          </ECardHeader>
          <ECardBody className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <EBadge tone={acctPreview.managementReview ? "danger" : acctPreview.rating === "EXCELLENT" || acctPreview.rating === "PASS" ? "success" : acctPreview.rating === "NEEDS IMPROVEMENT" ? "warning" : "danger"}>
                {acctPreview.managementReview ? "MANAGEMENT REVIEW" : acctPreview.rating}
              </EBadge>
              {!acctPreview.active ? (
                <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  All items pass — no accountability data will be sent.
                </span>
              ) : null}
            </div>
            {acctPreview.active ? (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                <span>Minor ×{acctPreview.minor} <span className="text-[hsl(var(--e-text-faint))]">(−{acctPreview.minor * acctScoring.minorDeduction})</span></span>
                <span>Major ×{acctPreview.major} <span className="text-[hsl(var(--e-text-faint))]">(−{acctPreview.major * acctScoring.majorDeduction})</span></span>
                <span>Critical ×{acctPreview.critical} <span className="text-[hsl(var(--e-text-faint))]">(−{acctPreview.critical * acctScoring.criticalDeduction})</span></span>
                <span>Missing evidence ×{acctPreview.missingEvidence} <span className="text-[hsl(var(--e-text-faint))]">(−{acctPreview.missingEvidence * acctScoring.missingMandatoryEvidenceDeduction})</span></span>
                <span>False confirmations ×{acctPreview.falseConfirmations} <span className="text-[hsl(var(--e-text-faint))]">(−{acctPreview.falseConfirmations * acctScoring.falseConfirmationExtraDeduction})</span></span>
                {acctPreview.na > 0 ? <span>N/A ×{acctPreview.na}</span> : null}
              </div>
            ) : null}
          </ECardBody>
        </ECard>

        {/* scored form */}
        <ECard>
          <ECardHeader>
            <div className="flex items-center justify-between gap-3">
              <ECardTitle className="flex items-center gap-2">
                <Star className="h-4 w-4" style={{ color: "hsl(var(--e-gold))" }} /> {template?.name ?? "QA form"}
              </ECardTitle>
              <div className="text-right">
                <p className="e-numeral text-[1.5rem] leading-none" style={{ color: scorePreview.passed ? "hsl(var(--e-success))" : "hsl(var(--e-danger))" }}>
                  {scorePreview.assessed > 0 ? `${scorePreview.score}%` : "—"}
                </p>
                <p className="text-[0.6875rem] uppercase tracking-[0.1em] text-[hsl(var(--e-muted-foreground))]">
                  {scorePreview.assessed > 0 ? (scorePreview.passed ? "Passing" : "Failing") : "Not scored"}
                </p>
              </div>
            </div>
          </ECardHeader>
          <ECardBody className="space-y-6">
            {sections.map((section: any) => {
              const sectionPhotoKeys = tools.sectionPhotos[section.id] ?? [];
              const roomLabel =
                (typeof section.label === "string" && section.label.trim()) ||
                (typeof section.title === "string" && section.title.trim()) ||
                "Area";
              return (
                <div key={section.id} className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-[0.9375rem] font-semibold">
                      <span className="flex h-6 w-6 items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-gold-soft))] text-[0.6875rem] font-bold text-[hsl(var(--e-gold-ink))]">
                        {roomLabel.charAt(0).toUpperCase()}
                      </span>
                      {roomLabel}
                    </p>
                    {sectionPhotoKeys.length > 0 ? (
                      <EBadge tone="neutral" soft>{sectionPhotoKeys.length} media</EBadge>
                    ) : null}
                  </div>

                  {sectionPhotoKeys.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {sectionPhotoKeys.map((key) => {
                        const annotation = tools.mediaAnnotations[key];
                        return (
                          <Thumb
                            key={key}
                            url={urlByKey[key]}
                            overlayUrl={annotation?.overlayKey ? urlByKey[annotation.overlayKey] : undefined}
                            annotated={Boolean(annotation)}
                            annotateTitle={annotation?.comment || undefined}
                            video={isVideoKey(key)}
                            onAnnotate={
                              urlByKey[key]
                                ? () => setAnnotateTarget({ scope: "section", sectionId: section.id, key, url: urlByKey[key] })
                                : undefined
                            }
                            onRemove={() => removeSectionPhoto(section.id, key)}
                          />
                        );
                      })}
                    </div>
                  ) : null}

                  <Uploader
                    jobId={jobId}
                    folder="qa-section"
                    accept="image/*,video/*"
                    label="Capture evidence"
                    stamp={{ ...qaStamp, contextLabel: ["QA", typeof section.title === "string" ? section.title : ""].filter(Boolean).join(" · ") }}
                    onUploaded={(key, url) => addSectionPhoto(section.id, key, url)}
                    onError={(msg) => pushToast({ title: "Upload failed", description: msg, tone: "danger" })}
                  />

                  {(section.fields ?? [])
                    .filter((field: any) => !["signature", "instruction", "inventory"].includes(field.type))
                    .map((field: any) => {
                      const answerable = !SKIP_FIELD_TYPES.has(field.type);
                      const requiredPhoto =
                        isUploadFieldType(field.type) && (Boolean(field.required) || Number(field.minPhotos) > 0);
                      const meta = itemMeta[field.id];
                      if (!meta) return null;
                      return (
                        <AccountabilityItemV2
                          key={field.id}
                          field={field}
                          requiredPhoto={requiredPhoto}
                          meta={meta}
                          state={verdictState(field.id)}
                          onPatch={(patch) => patchVerdict(field.id, patch)}
                          missing={Boolean(missingEvidence[field.id])}
                          onToggleMissing={(v) => toggleMissing(field.id, v)}
                          issueCategories={issueCategories}
                          jobId={jobId}
                          qaStamp={qaStamp}
                          urlByKey={urlByKey}
                          scoring={acctScoring}
                          onAddPhoto={(key, url) => addVerdictPhoto(field.id, key, url)}
                          onRemovePhoto={(key) => removeVerdictPhoto(field.id, key)}
                          onAnnotatePhoto={(key, url) =>
                            setAnnotateTarget({ scope: "issue", fieldId: field.id, key, url })
                          }
                          onError={(msg) => pushToast({ title: "Upload failed", description: msg, tone: "danger" })}
                        >
                          {answerable ? (
                            <EFieldInput field={field} value={data[field.id]} onChange={(v) => setField(field.id, v)} />
                          ) : (
                            <div className="flex items-center gap-2 text-[0.8125rem] font-medium text-[hsl(var(--e-foreground))]">
                              <Camera className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" />
                              {field.label}
                              {field.required ? <span className="text-[hsl(var(--e-danger))]">*</span> : null}
                              <span className="text-[0.75rem] font-normal text-[hsl(var(--e-muted-foreground))]">
                                · {meta.cleanerMediaIds.length} cleaner photo{meta.cleanerMediaIds.length === 1 ? "" : "s"}
                              </span>
                            </div>
                          )}
                        </AccountabilityItemV2>
                      );
                    })}
                </div>
              );
            })}

            <EField label="QA notes">
              <ETextarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes and follow-up instructions" />
            </EField>

            {/* sign-off */}
            <div className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-gold-soft))] p-4">
              <div>
                <p className="text-[0.875rem] font-semibold">Inspector sign-off</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Required — your signature is recorded on the inspection report.</p>
              </div>
              <ESignaturePad value={signatureDataUrl} onChange={setSignatureDataUrl} />
              <label className="flex items-start gap-2.5 text-[0.75rem] leading-snug">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--e-primary))]" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                <span>I attest that this QA inspection is accurate and complete, and was carried out by me ({inspectorName}).</span>
              </label>
            </div>

            <p className="text-center text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
              {draftSavedAt ? `Draft saved ${new Date(draftSavedAt).toLocaleTimeString()}` : "Changes save automatically as you go."}
            </p>

            <EButton variant="gold" size="lg" className="w-full" onClick={() => void submit()} disabled={saving || !attested || !signatureDataUrl}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {saving ? "Submitting…" : !signatureDataUrl ? "Sign to submit" : !attested ? "Confirm attestation to submit" : "Sign off & submit QA review"}
            </EButton>

            {hasQaSubmission ? (
              <EButton asChild variant="outline" size="lg" className="w-full">
                <a href={`/api/qa/jobs/${jobId}/report`} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" /> Download QA report
                </a>
              </EButton>
            ) : null}
          </ECardBody>
        </ECard>
      </div>

      {/* step nav */}
      <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]/95 px-3 py-2.5 backdrop-blur">
        <EButton
          variant="outline"
          size="sm"
          disabled={step === 0}
          onClick={() => {
            setStep((s) => Math.max(0, s - 1));
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </EButton>
        <span className="text-[0.75rem] font-medium text-[hsl(var(--e-muted-foreground))]">
          Step {step + 1} of {QA_STEPS.length}
        </span>
        {step < QA_STEPS.length - 1 ? (
          <EButton
            variant="primary"
            size="sm"
            onClick={() => {
              setStep((s) => Math.min(QA_STEPS.length - 1, s + 1));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          >
            {step === 0 ? "Begin inspection" : "Score & sign off"} <ArrowRight className="h-4 w-4" />
          </EButton>
        ) : (
          <span className="text-[0.75rem] font-medium text-[hsl(var(--e-gold-ink))]">Submit below ↓</span>
        )}
      </div>
      </div>

      {/* Shared photo markup tool — the same annotator every other QA photo in
          the product uses. Optional everywhere: closing it changes nothing and
          the original photo is always kept. */}
      {annotateTarget ? (
        <ImageAnnotator
          src={annotateTarget.url}
          open={Boolean(annotateTarget)}
          onOpenChange={(v) => {
            if (!v) setAnnotateTarget(null);
          }}
          initialComment={annotationFor(annotateTarget)?.comment ?? ""}
          saving={savingAnnotation}
          onSave={({ blob, comment }) => saveAnnotation(blob, comment)}
        />
      ) : null}
    </div>
  );
}
