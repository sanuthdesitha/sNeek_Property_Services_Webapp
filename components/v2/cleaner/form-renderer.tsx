"use client";

/**
 * Native Estate renderer for a lib/forms FormSchema. Renders every field type
 * from lib/forms/field-types natively (no v1 components), tracks answers +
 * uploads, applies conditional visibility via the shared lib/forms/visibility
 * helpers, and lifts state to the parent workspace.
 *
 * Answer values are stored by fieldId in `answers`; media uploads are stored by
 * fieldId in `uploads` as arrays of S3 keys — exactly the shape the submit
 * endpoint reads (`data.uploads[fieldId]`).
 */
import * as React from "react";
import {
  Info,
  Star,
  MapPin,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { FormField, FormSchema, FormSection } from "@/lib/forms/types";
import {
  flattenFieldsOneLevel,
  isTemplateNodeVisible,
  isFlattenedFieldVisible,
  fieldDetailsKey,
} from "@/lib/forms/visibility";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { cn } from "@/lib/utils";
import { EInput, ETextarea, ESelect, ECheckbox } from "@/components/v2/cleaner/fields";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";

export type AnswerMap = Record<string, unknown>;
export type UploadMap = Record<string, CapturedMedia[]>;

export function FormRenderer({
  schema,
  answers,
  uploads,
  property,
  onAnswer,
  onUpload,
  disabled = false,
}: {
  schema: FormSchema;
  answers: AnswerMap;
  uploads: UploadMap;
  property: Record<string, unknown>;
  onAnswer: (fieldId: string, value: unknown) => void;
  onUpload: (fieldId: string, media: CapturedMedia[]) => void;
  disabled?: boolean;
}) {
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];
  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <SectionBlock
          key={section.id}
          section={section}
          answers={answers}
          uploads={uploads}
          property={property}
          onAnswer={onAnswer}
          onUpload={onUpload}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function SectionBlock({
  section,
  answers,
  uploads,
  property,
  onAnswer,
  onUpload,
  disabled,
}: {
  section: FormSection;
  answers: AnswerMap;
  uploads: UploadMap;
  property: Record<string, unknown>;
  onAnswer: (fieldId: string, value: unknown) => void;
  onUpload: (fieldId: string, media: CapturedMedia[]) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = React.useState(true);
  if (!isTemplateNodeVisible(section as any, answers, property)) return null;

  const fields = flattenFieldsOneLevel(section.fields);

  return (
    <section className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <button
        type="button"
        onClick={() => section.collapsible && setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 p-4 text-left"
      >
        <div className="min-w-0">
          <p className="e-eyebrow">{section.title}</p>
          {section.description ? (
            <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {section.description}
            </p>
          ) : null}
        </div>
        {section.collapsible ? (
          open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />
        ) : null}
      </button>
      {open ? (
        <div className="space-y-4 border-t border-[hsl(var(--e-border))] p-4">
          {fields.map((field: any) => (
            <FieldBlock
              key={field.id}
              field={field}
              answers={answers}
              uploads={uploads}
              property={property}
              onAnswer={onAnswer}
              onUpload={onUpload}
              disabled={disabled}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function FieldBlock({
  field,
  answers,
  uploads,
  property,
  onAnswer,
  onUpload,
  disabled,
}: {
  field: FormField & { _isChild?: boolean };
  answers: AnswerMap;
  uploads: UploadMap;
  property: Record<string, unknown>;
  onAnswer: (fieldId: string, value: unknown) => void;
  onUpload: (fieldId: string, media: CapturedMedia[]) => void;
  disabled: boolean;
}) {
  if (!isFlattenedFieldVisible(field as any, answers, property)) return null;

  const value = answers[field.id];
  const set = (v: unknown) => onAnswer(field.id, v);
  const indent = (field as any)._isChild ? "border-l-2 border-[hsl(var(--e-border-strong))] pl-4" : "";

  // Read-only instruction block.
  if (field.type === "instruction") {
    return (
      <div className={cn("rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-info))] bg-[hsl(var(--e-info-soft))] p-3", indent)}>
        <p className="flex items-center gap-1.5 text-[0.875rem] font-[550]">
          <Info className="h-4 w-4" /> {field.label}
        </p>
        {field.helpText ? (
          <p className="mt-1 whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
            {field.helpText}
          </p>
        ) : null}
      </div>
    );
  }

  const label = (
    <div className="flex flex-wrap items-baseline gap-2">
      <label className="text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">
        {field.label}
        {field.required ? <span className="text-[hsl(var(--e-danger))]"> *</span> : null}
      </label>
      {field.severity && field.severity !== "low" ? (
        <span className="text-[0.625rem] font-[550] uppercase tracking-[0.06em] text-[hsl(var(--e-warning))]">
          {field.severity}
        </span>
      ) : null}
    </div>
  );

  const help = field.helpText ? (
    <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{field.helpText}</p>
  ) : null;

  const instructions = field.instructions ? (
    <details className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
      <summary className="cursor-pointer select-none">How to do this</summary>
      <p className="mt-1 whitespace-pre-wrap">{field.instructions}</p>
    </details>
  ) : null;

  const references =
    Array.isArray(field.references) && field.references.length > 0 ? (
      <div className="flex flex-wrap gap-2">
        {field.references.map((ref, i) =>
          ref.kind === "image" && ref.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={ref.url}
              alt={ref.caption || "reference"}
              className="h-16 w-16 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] object-cover"
            />
          ) : ref.url ? (
            <a
              key={i}
              href={ref.url}
              target="_blank"
              rel="noreferrer"
              className="text-[0.75rem] underline"
            >
              {ref.caption || ref.kind}
            </a>
          ) : null
        )}
      </div>
    ) : null;

  return (
    <div className={cn("space-y-1.5", indent)}>
      {label}
      {references}
      <FieldControl field={field} value={value} set={set} uploads={uploads} onUpload={onUpload} disabled={disabled} />
      {/* yes/no detail note when answered "No" */}
      {field.type === "yesno" && field.detailsWhenNo && (value === "no" || value === false) ? (
        <ETextarea
          placeholder="Add details (required)"
          value={String(answers[fieldDetailsKey(field.id)] ?? "")}
          disabled={disabled}
          onChange={(e) => onAnswer(fieldDetailsKey(field.id), e.target.value)}
        />
      ) : null}
      {help}
      {instructions}
    </div>
  );
}

function FieldControl({
  field,
  value,
  set,
  uploads,
  onUpload,
  disabled,
}: {
  field: FormField;
  value: unknown;
  set: (v: unknown) => void;
  uploads: UploadMap;
  onUpload: (fieldId: string, media: CapturedMedia[]) => void;
  disabled: boolean;
}) {
  // Media/upload fields → native capture.
  if (isUploadFieldType(field.type)) {
    const mode =
      field.mediaMode === "both"
        ? "both"
        : field.type === "video"
          ? "video"
          : field.type === "file"
            ? "file"
            : "photo";
    return (
      <MediaCapture
        value={uploads[field.id] ?? []}
        onChange={(m) => onUpload(field.id, m)}
        mode={mode as any}
        folder="forms"
        multiple={(field.maxFiles ?? 10) !== 1}
        minPhotos={field.type === "photo" ? field.minPhotos : undefined}
        disabled={disabled}
      />
    );
  }

  switch (field.type) {
    case "longtext":
      return (
        <ETextarea
          placeholder={field.placeholder}
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "number":
    case "currency":
    case "temperature":
      return (
        <div className="flex items-center gap-2">
          <EInput
            type="number"
            inputMode="decimal"
            min={field.min}
            max={field.max}
            step={field.step}
            placeholder={field.placeholder}
            value={value === undefined || value === null ? "" : String(value)}
            disabled={disabled}
            onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))}
          />
          {field.unit ? (
            <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{field.unit}</span>
          ) : field.type === "currency" ? (
            <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">$</span>
          ) : null}
        </div>
      );

    case "date":
    case "time":
    case "datetime":
      return (
        <EInput
          type={field.type === "datetime" ? "datetime-local" : field.type}
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "email":
    case "phone":
      return (
        <EInput
          type={field.type === "email" ? "email" : "tel"}
          placeholder={field.placeholder}
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "select":
      return (
        <ESelect value={String(value ?? "")} disabled={disabled} onChange={(e) => set(e.target.value)}>
          <option value="">Select…</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </ESelect>
      );

    case "radio":
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => (
            <OptionChip key={opt} active={value === opt} disabled={disabled} onClick={() => set(opt)}>
              {opt}
            </OptionChip>
          ))}
        </div>
      );

    case "multiselect": {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((opt) => {
            const active = arr.includes(opt);
            return (
              <OptionChip
                key={opt}
                active={active}
                disabled={disabled}
                onClick={() => set(active ? arr.filter((o) => o !== opt) : [...arr, opt])}
              >
                {opt}
              </OptionChip>
            );
          })}
        </div>
      );
    }

    case "checkbox":
      return (
        <label className="inline-flex items-center gap-2 text-[0.875rem]">
          <ECheckbox checked={value === true} disabled={disabled} onChange={(e) => set(e.target.checked)} />
          {field.placeholder || "Yes"}
        </label>
      );

    case "yesno":
      return (
        <div className="flex flex-wrap gap-2">
          <OptionChip active={value === "yes" || value === true} disabled={disabled} onClick={() => set("yes")}>
            Yes
          </OptionChip>
          <OptionChip active={value === "no" || value === false} disabled={disabled} onClick={() => set("no")}>
            No
          </OptionChip>
          {field.includeNa ? (
            <OptionChip active={value === "na"} disabled={disabled} onClick={() => set("na")}>
              N/A
            </OptionChip>
          ) : null}
        </div>
      );

    case "rating": {
      const max = field.max ?? 5;
      const current = Number(value ?? 0);
      return (
        <div className="flex gap-1">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => set(n)}
              aria-label={`${n} star`}
              className="text-[hsl(var(--e-gold))] disabled:opacity-50"
            >
              <Star className="h-6 w-6" fill={n <= current ? "currentColor" : "none"} />
            </button>
          ))}
        </div>
      );
    }

    case "slider":
    case "scale": {
      const min = field.min ?? (field.type === "scale" ? 1 : 0);
      const max = field.max ?? (field.type === "scale" ? 5 : 10);
      const step = field.step ?? 1;
      const current = value === undefined || value === null ? min : Number(value);
      return (
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={current}
            disabled={disabled}
            onChange={(e) => set(Number(e.target.value))}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-[hsl(var(--e-surface-sunken))]"
            style={{ accentColor: "hsl(var(--e-primary))" }}
          />
          <span className="w-12 text-right text-[0.875rem] font-[550] tabular-nums">
            {current}
            {field.unit ? ` ${field.unit}` : ""}
          </span>
        </div>
      );
    }

    case "counter": {
      const min = field.min ?? 0;
      const step = field.step ?? 1;
      const current = value === undefined || value === null ? min : Number(value);
      return (
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            disabled={disabled || current <= min}
            onClick={() => set(Math.max(min, current - step))}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] disabled:opacity-50"
          >
            −
          </button>
          <span className="w-12 text-center text-[0.9375rem] font-semibold tabular-nums">{current}</span>
          <button
            type="button"
            disabled={disabled || (field.max != null && current >= field.max)}
            onClick={() => set(current + step)}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] disabled:opacity-50"
          >
            +
          </button>
        </div>
      );
    }

    case "signature":
      return <SignaturePad value={typeof value === "string" ? value : null} onChange={set} disabled={disabled} />;

    case "location":
      return <LocationCapture value={value as any} onChange={set} disabled={disabled} />;

    case "barcode":
      return (
        <EInput
          placeholder="Scan or type code"
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
        />
      );

    case "text":
    default:
      return (
        <EInput
          placeholder={field.placeholder}
          value={String(value ?? "")}
          disabled={disabled}
          onChange={(e) => set(e.target.value)}
        />
      );
  }
}

function OptionChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-[var(--e-radius-pill)] border px-3.5 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms] disabled:opacity-50",
        active
          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] hover:bg-[hsl(var(--e-muted))]"
      )}
    >
      {children}
    </button>
  );
}

function LocationCapture({
  value,
  onChange,
  disabled,
}: {
  value: { lat: number; lng: number } | null | undefined;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  function grab() {
    setErr(null);
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setBusy(false);
      },
      (e) => {
        setErr(e.message || "Could not get location");
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={grab}
        className="inline-flex h-9 items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] font-[550] hover:bg-[hsl(var(--e-muted))] disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
        Capture GPS
      </button>
      {value && typeof value.lat === "number" ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] tabular-nums">
          {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
        </p>
      ) : null}
      {err ? <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{err}</p> : null}
    </div>
  );
}

function SignaturePad({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (v: unknown) => void;
  disabled?: boolean;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const drawing = React.useRef(false);

  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function start(e: React.PointerEvent) {
    if (disabled) return;
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvasRef.current!.toDataURL("image/png"));
  }
  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    onChange("");
  }

  return (
    <div className="space-y-1.5">
      <canvas
        ref={canvasRef}
        width={480}
        height={160}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full max-w-md touch-none rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-white"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] underline disabled:opacity-50"
        >
          Clear
        </button>
        {value && value.startsWith("data:image/") ? (
          <span className="text-[0.75rem] text-[hsl(var(--e-success))]">Signed</span>
        ) : null}
      </div>
    </div>
  );
}
