"use client";

import * as React from "react";
import { Minus, Plus, Star, MapPin, Loader2 } from "lucide-react";
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
import { FieldReferences } from "./field-references";

export interface FieldInputProps {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  className?: string;
}

const OTHER = "__other__";

function FieldShell({
  field,
  children,
  hideLabel,
}: {
  field: FormField;
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
      {field.helpText ? <p className="text-xs text-muted-foreground">{field.helpText}</p> : null}
      <FieldReferences references={field.references} />
      {children}
    </div>
  );
}

/**
 * Renders the data-entry control for a single form field. Handles every field
 * type EXCEPT media uploads (photo/video/file) and inventory, which the cleaner
 * page routes to dedicated steps.
 */
export function FieldInput({ field, value, onChange }: FieldInputProps) {
  const id = `fi-${field.id}`;

  switch (field.type) {
    case "instruction":
      return (
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-sm font-medium">{field.label}</p>
          {field.helpText ? <p className="mt-1 text-xs text-muted-foreground">{field.helpText}</p> : null}
          <FieldReferences references={field.references} className="mt-2" />
        </div>
      );

    case "longtext":
      return (
        <FieldShell field={field}>
          <Textarea
            id={id}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          />
        </FieldShell>
      );

    case "number":
    case "currency": {
      return (
        <FieldShell field={field}>
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
              className={field.type === "currency" ? "pl-7" : undefined}
              value={value === undefined || value === null ? "" : String(value)}
              onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
            />
            {field.unit ? <span className="ml-2 text-xs text-muted-foreground">{field.unit}</span> : null}
          </div>
        </FieldShell>
      );
    }

    case "email":
      return (
        <FieldShell field={field}>
          <Input id={id} type="email" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );

    case "phone":
      return (
        <FieldShell field={field}>
          <Input id={id} type="tel" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );

    case "date":
    case "time":
    case "datetime":
      return (
        <FieldShell field={field}>
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
        <FieldShell field={field} hideLabel>
          <FieldReferences references={field.references} />
          <label className="flex items-start gap-3 text-sm leading-snug">
            <Checkbox checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} />
            <span>
              {field.label}
              {field.required ? <span className="text-destructive"> *</span> : null}
            </span>
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
        <FieldShell field={field}>
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
        <FieldShell field={field}>
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
        <FieldShell field={field}>
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
        <FieldShell field={field}>
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
        <FieldShell field={field}>
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
        <FieldShell field={field}>
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
        <FieldShell field={field}>
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
        <FieldShell field={field}>
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
        <FieldShell field={field}>
          <LocationCapture value={value} onChange={onChange} />
        </FieldShell>
      );

    case "signature":
      return (
        <FieldShell field={field} hideLabel>
          <FieldReferences references={field.references} />
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
        <FieldShell field={field}>
          <Input id={id} type="text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );
  }
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
