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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { prepareUploadFile } from "@/lib/uploads/compress";
import { isStampableImage, type StampOptions } from "@/lib/uploads/stamp";

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

/* ── A photo thumbnail with remove control ────────────────────────────── */
function Thumb({
  url,
  video,
  onRemove,
}: {
  url?: string;
  video?: boolean;
  onRemove: () => void;
}) {
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

  const QA_STEPS = ["Inspect & log findings", "Score, sign off & submit"];

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
        localStorage.setItem(draftKey, JSON.stringify({ data, notes, tools, savedAt }));
        setDraftSavedAt(savedAt);
      } catch {
        /* ignore */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [data, notes, tools, draftKey]);

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
      if (rework.assignee === "OTHER") {
        if (!rework.payeeCleanerId) {
          pushToast({ title: "Choose the cleaner who will redo this clean.", tone: "danger" });
          return;
        }
        if (!(rework.payAmount > 0)) {
          pushToast({ title: "Enter the pay amount for the new cleaner.", tone: "danger" });
          return;
        }
      }
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
    if (body.reworkTransferId) extras.push("rework transfer pending");
    pushToast({
      title: "QA submitted",
      description: `Score ${Math.round(body.review?.score ?? 0)}%.${extras.length ? ` Created: ${extras.join(", ")}.` : ""}`,
      tone: "info",
    });
    setTimer({ running: false, elapsedMs: 0, runningSince: null });
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
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

      {/* ── STEP 0: inspect & log findings ── */}
      <div className={step === 0 ? "space-y-6" : "hidden"}>
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
                    {entry.photoKeys.map((key) => (
                      <Thumb key={key} url={urlByKey[key]} onRemove={() => removeDamagePhoto(entry.id, key)} />
                    ))}
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

      {/* ── STEP 1: score, sign off & submit ── */}
      <div className={step === 1 ? "space-y-6" : "hidden"}>
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
                          {area.photoKeys.map((key) => (
                            <Thumb key={key} url={urlByKey[key]} onRemove={() => removeFlaggedAreaPhoto(area.id, key)} />
                          ))}
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

                <EField label="Who redoes it?">
                  <ESelect value={rework.assignee} onChange={(e) => setRework({ assignee: e.target.value as "SAME" | "OTHER" })}>
                    <option value="SAME">Same cleaner — no extra pay</option>
                    <option value="OTHER">Different cleaner — paid (deducted from original)</option>
                  </ESelect>
                </EField>
                {rework.assignee === "OTHER" ? (
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
                <EAlert tone="warning">
                  {rework.assignee === "OTHER"
                    ? `A rework job is created for the new cleaner. ${rework.payAmount > 0 ? `$${Number(rework.payAmount).toFixed(2)}` : "The amount"} is paid to them and deducted from the original cleaner.`
                    : "A rework job is created for the same cleaner to fix the flagged areas — no extra pay for the redo."}
                </EAlert>
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
                      {sectionPhotoKeys.map((key) => (
                        <Thumb key={key} url={urlByKey[key]} video={isVideoKey(key)} onRemove={() => removeSectionPhoto(section.id, key)} />
                      ))}
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
                    .filter((field: any) => !SKIP_FIELD_TYPES.has(field.type))
                    .map((field: any) => (
                      <div key={field.id} className="space-y-1.5">
                        <EFieldInput field={field} value={data[field.id]} onChange={(v) => setField(field.id, v)} />
                      </div>
                    ))}
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
            Score &amp; sign off <ArrowRight className="h-4 w-4" />
          </EButton>
        ) : (
          <span className="text-[0.75rem] font-medium text-[hsl(var(--e-gold-ink))]">Submit below ↓</span>
        )}
      </div>
    </div>
  );
}
