"use client";

import * as React from "react";
import { Minus, Plus, Star, MapPin, Loader2, QrCode, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { SignaturePad } from "@/components/shared/signature-pad";
import type { FormField } from "@/lib/forms/types";
import { ExampleOnTickReferences, FieldReferences } from "./field-references";
import { InstructionsReveal } from "./instructions-reveal";
import { useFormTheme } from "./form-theme";
import { isDividerField } from "./form-blocks";

export interface FieldInputProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  className?: string;
  /** Suppress the field's own label — used by the builder canvas, which renders
   *  its own inline-editable label above the control. */
  hideLabel?: boolean;
}

const OTHER = "__other__";

/**
 * Reference example media for a data-entry field. When the field opts into
 * "show on tick" (default true whenever references exist), this renders the
 * compact "See example" affordance and auto-pops the example image when the
 * cleaner answers the item. When opted out, it falls back to static thumbnails.
 */
function FieldReferenceBlock({
  field,
  value,
  className,
}: {
  field: FormField;
  value: unknown;
  className?: string;
}) {
  if (!field.references || field.references.length === 0) return null;
  const onTick = field.showExampleOnTick !== false;
  if (onTick) {
    return (
      <ExampleOnTickReferences references={field.references} value={value} className={className} />
    );
  }
  return <FieldReferences references={field.references} className={className} />;
}

function FieldShell({
  field,
  value,
  children,
  hideLabel,
}: {
  field: FormField;
  value?: unknown;
  children: React.ReactNode;
  hideLabel?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {!hideLabel && (
        <Label className="text-sm leading-snug">
          {field.label}
          {field.required ? <span className="text-destructive"> *</span> : null}
        </Label>
      )}
      {!hideLabel && field.helpText ? <p className="text-xs text-muted-foreground">{field.helpText}</p> : null}
      <InstructionsReveal title={field.label} instructions={field.instructions} references={field.references} />
      <FieldReferenceBlock field={field} value={value} />
      {children}
    </div>
  );
}

/**
 * Renders the data-entry control for a single form field. Handles every field
 * type EXCEPT media uploads (photo/video/file) and inventory, which the cleaner
 * page routes to dedicated steps.
 */
export function FieldInput({ field, value, onChange, hideLabel }: FieldInputProps) {
  const id = `fi-${field.id}`;
  const theme = useFormTheme();
  const headingFontStyle: React.CSSProperties | undefined = theme?.headingFont
    ? { fontFamily: theme.headingFont }
    : undefined;

  switch (field.type) {
    case "instruction":
      if (isDividerField(field)) {
        return <hr className="my-2 border-t border-border" aria-hidden />;
      }
      return (
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-sm font-medium" style={headingFontStyle}>
            {field.label}
          </p>
          {field.helpText ? <p className="mt-1 text-xs text-muted-foreground">{field.helpText}</p> : null}
          <FieldReferences references={field.references} className="mt-2" />
        </div>
      );

    case "longtext":
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <Textarea
            id={id}
            placeholder={field.placeholder}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </FieldShell>
      );

    case "temperature":
    case "number":
    case "currency": {
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <div className="relative">
            {field.type === "currency" ? (
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
            ) : null}
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              min={field.min}
              max={field.max}
              step={field.step}
              placeholder={field.placeholder}
              className={field.type === "currency" ? "pl-7" : undefined}
              value={value === undefined || value === null ? "" : String(value)}
              onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            />
            {field.unit || field.type === "temperature" ? (
              <span className="ml-2 text-xs text-muted-foreground">
                {field.unit ?? "°C"}
              </span>
            ) : null}
          </div>
        </FieldShell>
      );
    }

    case "email":
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <Input id={id} type="email" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );

    case "phone":
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <Input id={id} type="tel" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );

    case "date":
    case "time":
    case "datetime":
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <Input
            id={id}
            type={field.type === "datetime" ? "datetime-local" : field.type}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </FieldShell>
      );

    case "checkbox":
      return (
        <FieldShell field={field} value={value} hideLabel>
          <FieldReferenceBlock field={field} value={value} />
          <label className="flex items-start gap-3 text-sm leading-snug">
            <Checkbox checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} />
            {hideLabel ? (
              <span className="text-muted-foreground">Checkbox</span>
            ) : (
              <span>
                {field.label}
                {field.required ? <span className="text-destructive"> *</span> : null}
              </span>
            )}
          </label>
        </FieldShell>
      );

    case "yesno": {
      const choices: Array<{ key: string; label: string; val: unknown }> = [
        { key: "yes", label: "Yes", val: true },
        { key: "no", label: "No", val: false },
        ...(field.includeNa ? [{ key: "na", label: "N/A", val: "na" as unknown }] : []),
      ];
      const isActive = (val: unknown) =>
        (val === true && value === true) ||
        (val === false && value === false) ||
        (val === "na" && value === "na");
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <div className="flex gap-2">
            {choices.map((c) => (
              <Button
                key={c.key}
                type="button"
                variant={isActive(c.val) ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => onChange(c.val)}
              >
                {c.label}
              </Button>
            ))}
          </div>
        </FieldShell>
      );
    }

    case "select": {
      const options = field.options ?? [];
      const isOther = field.allowOther && typeof value === "string" && value !== "" && !options.includes(value);
      const selectValue = isOther ? OTHER : typeof value === "string" ? value : "";
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <Select
            value={selectValue}
            onValueChange={(v) => onChange(v === OTHER ? "" : v)}
          >
            <SelectTrigger id={id}>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
              {field.allowOther ? <SelectItem value={OTHER}>Other…</SelectItem> : null}
            </SelectContent>
          </Select>
          {isOther ? (
            <Input
              className="mt-2"
              placeholder="Please specify"
              value={typeof value === "string" ? value : ""}
              onChange={(e) => onChange(e.target.value)}
            />
          ) : null}
        </FieldShell>
      );
    }

    case "radio": {
      const options = field.options ?? [];
      const isOther = field.allowOther && typeof value === "string" && value !== "" && !options.includes(value);
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <div className="space-y-1.5">
            {options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={id}
                  checked={value === opt}
                  onChange={() => onChange(opt)}
                  className="size-4"
                />
                {opt}
              </label>
            ))}
            {field.allowOther ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name={id} checked={Boolean(isOther)} onChange={() => onChange("")} className="size-4" />
                Other
              </label>
            ) : null}
            {isOther ? (
              <Input
                placeholder="Please specify"
                value={typeof value === "string" ? value : ""}
                onChange={(e) => onChange(e.target.value)}
              />
            ) : null}
          </div>
        </FieldShell>
      );
    }

    case "multiselect": {
      const options = field.options ?? [];
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (opt: string) =>
        onChange(selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt]);
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <div className="space-y-1.5">
            {options.map((opt) => (
              <label key={opt} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.includes(opt)} onCheckedChange={() => toggle(opt)} />
                {opt}
              </label>
            ))}
          </div>
        </FieldShell>
      );
    }

    case "rating": {
      const maxStars = Math.round(field.max ?? 5);
      const current = typeof value === "number" ? value : 0;
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <div className="flex gap-1">
            {Array.from({ length: maxStars }, (_, i) => i + 1).map((star) => (
              <button key={star} type="button" onClick={() => onChange(star)} aria-label={`${star} star`}>
                <Star className={`size-7 ${star <= current ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
              </button>
            ))}
          </div>
        </FieldShell>
      );
    }

    case "slider": {
      const min = field.min ?? 0;
      const max = field.max ?? 10;
      const step = field.step ?? 1;
      const current = typeof value === "number" ? value : min;
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={current}
              onChange={(e) => onChange(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-primary"
            />
            <span className="w-16 text-right text-sm font-medium tabular-nums">
              {current}
              {field.unit ? ` ${field.unit}` : ""}
            </span>
          </div>
        </FieldShell>
      );
    }

    case "counter": {
      const min = field.min ?? 0;
      const max = field.max;
      const step = field.step ?? 1;
      const current = typeof value === "number" ? value : min;
      const set = (next: number) => {
        let n = next;
        if (n < min) n = min;
        if (max !== undefined && n > max) n = max;
        onChange(n);
      };
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" onClick={() => set(current - step)}>
              <Minus className="size-4" />
            </Button>
            <span className="w-12 text-center text-lg font-semibold tabular-nums">{current}</span>
            <Button type="button" variant="outline" size="icon" onClick={() => set(current + step)}>
              <Plus className="size-4" />
            </Button>
            {field.unit ? <span className="text-xs text-muted-foreground">{field.unit}</span> : null}
          </div>
        </FieldShell>
      );
    }

    case "scale": {
      const min = Math.round(field.min ?? 1);
      const max = Math.round(field.max ?? 5);
      const points = Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <div className="flex flex-wrap gap-2">
            {points.map((p) => (
              <Button
                key={p}
                type="button"
                variant={value === p ? "default" : "outline"}
                size="sm"
                className="min-w-10"
                onClick={() => onChange(p)}
              >
                {p}
              </Button>
            ))}
          </div>
        </FieldShell>
      );
    }

    case "location":
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <LocationCapture value={value} onChange={onChange} />
        </FieldShell>
      );

    case "barcode":
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <BarcodeCapture value={value} onChange={onChange} placeholder={field.placeholder} />
        </FieldShell>
      );

    case "signature":
      return (
        <FieldShell field={field} value={value} hideLabel>
          <FieldReferenceBlock field={field} value={value} />
          <SignaturePad
            label={field.label}
            value={typeof value === "string" ? value : ""}
            required={Boolean(field.required)}
            onChange={(v) => onChange(v)}
          />
        </FieldShell>
      );

    default:
      // text + any unknown type fall back to a text input.
      return (
        <FieldShell field={field} value={value} hideLabel={hideLabel}>
          <Input id={id} type="text" placeholder={field.placeholder} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );
  }
}

/**
 * Live QR / barcode scanner built on getUserMedia + jsqr, with a manual text
 * fallback so the field still works without camera permission.
 */
function BarcodeCapture({
  value,
  onChange,
  placeholder,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  placeholder?: string;
}) {
  const [scanning, setScanning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const rafRef = React.useRef<number>(0);

  const stopScanning = React.useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }, []);

  React.useEffect(() => stopScanning, [stopScanning]);

  async function startScanning() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera not available — type the code instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setScanning(true);
      const { default: jsQR } = await import("jsqr");
      const video = videoRef.current;
      if (!video) {
        stopScanning();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = () => {
        if (!streamRef.current) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA && ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });
          if (code?.data) {
            onChange(code.data);
            stopScanning();
            return;
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      stopScanning();
      setError("Could not open the camera — type the code instead.");
    }
  }

  return (
    <div className="space-y-2">
      {scanning ? (
        <div className="relative overflow-hidden rounded-lg border bg-black">
          <video ref={videoRef} className="h-48 w-full object-cover" muted playsInline />
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute right-2 top-2 h-9 w-9"
            onClick={stopScanning}
            aria-label="Stop scanning"
          >
            <X className="size-4" />
          </Button>
          <p className="absolute bottom-2 left-0 right-0 text-center text-xs text-white/90">
            Point the camera at the QR / barcode
          </p>
        </div>
      ) : (
        <Button type="button" variant="outline" className="h-11 w-full" onClick={startScanning}>
          <QrCode className="mr-2 size-4" />
          {typeof value === "string" && value ? "Scan again" : "Scan QR / barcode"}
        </Button>
      )}
      <Input
        placeholder={placeholder ?? "Or type the code manually"}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function LocationCapture({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const coords = value && typeof value === "object" && "lat" in (value as any) ? (value as { lat: number; lng: number }) : null;

  function capture() {
    if (!navigator.geolocation) {
      setError("Location is not available on this device.");
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setLoading(false);
      },
      (err) => {
        setError(err.message || "Could not get location.");
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" size="sm" onClick={capture} disabled={loading}>
        {loading ? <Loader2 className="mr-1 size-4 animate-spin" /> : <MapPin className="mr-1 size-4" />}
        {coords ? "Update location" : "Capture current location"}
      </Button>
      {coords ? (
        <p className="text-xs text-muted-foreground">
          {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
