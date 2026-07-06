"use client";

/**
 * Estate WEBSITE CMS — shared editor building blocks.
 *
 * Native Estate primitives only (no @/components/{admin,ui,shared}). Styled
 * through the `--e-*` token scope. These helpers are consumed by the section
 * editors under ./sections and the reorderable list editors.
 */
import * as React from "react";
import { UploadCloud, ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import { EButton, ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EInput, ETextarea, EField } from "@/components/v2/admin/estate-kit";

/* ── Small util: clone + id ─────────────────────────────────────────────── */
export function cloneContent<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/* ── Section shell (hairline Estate card with header) ───────────────────── */
export function ESectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <ECard className="p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em]">{title}</h3>
          {description ? (
            <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </ECard>
  );
}

/* ── Image field (URL + alt + direct upload, mirrors v1 ImageField) ─────── */
export function EImageField({
  label,
  value,
  alt,
  onChange,
  onAltChange,
  onUpload,
  uploading,
  disabled,
}: {
  label: string;
  value: string;
  alt: string;
  onChange: (value: string) => void;
  onAltChange: (value: string) => void;
  onUpload: (file: File) => Promise<void>;
  uploading: boolean;
  disabled?: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
      <div className="flex h-40 items-center justify-center overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={alt || label} className="h-full w-full object-cover" />
        ) : (
          <span className="text-[0.75rem] uppercase tracking-[0.12em] text-[hsl(var(--e-text-faint))]">
            No image
          </span>
        )}
      </div>
      <div className="space-y-3">
        <EField label={`${label} URL`}>
          <EInput
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://…"
            disabled={disabled}
          />
        </EField>
        <EField label={`${label} alt text`}>
          <EInput value={alt} onChange={(e) => onAltChange(e.target.value)} disabled={disabled} />
        </EField>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            await onUpload(file);
            e.currentTarget.value = "";
          }}
        />
        {!disabled ? (
          <EButton
            variant="ghost"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <UploadCloud className="h-3.5 w-3.5" />
            {uploading ? "Uploading…" : "Upload image"}
          </EButton>
        ) : null}
      </div>
    </div>
  );
}

/* ── Reorderable list-item frame: up / down / remove ───────────────────── */
export function EListItem({
  index,
  count,
  title,
  onMoveUp,
  onMoveDown,
  onRemove,
  disabled,
  children,
}: {
  index: number;
  count: number;
  title: React.ReactNode;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
      <div className="flex items-center justify-between gap-2">
        <EEyebrow className="text-[0.625rem]">{title}</EEyebrow>
        {!disabled ? (
          <div className="flex items-center gap-1">
            <EButton
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onMoveUp}
              disabled={index === 0}
              aria-label="Move up"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </EButton>
            <EButton
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onMoveDown}
              disabled={index === count - 1}
              aria-label="Move down"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </EButton>
            <EButton
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-[hsl(var(--e-danger))]"
              onClick={onRemove}
              aria-label="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </EButton>
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/* ── Add-item button row ────────────────────────────────────────────────── */
export function EAddRow({
  hint,
  label,
  onAdd,
  disabled,
}: {
  hint?: React.ReactNode;
  label: string;
  onAdd: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      {hint ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{hint}</p>
      ) : (
        <span />
      )}
      {!disabled ? (
        <EButton variant="outline" size="sm" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          {label}
        </EButton>
      ) : null}
    </div>
  );
}

/* ── Array move helper ──────────────────────────────────────────────────── */
export function moveItem<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const next = [...arr];
  const target = index + dir;
  if (target < 0 || target >= next.length) return arr;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export { EInput, ETextarea, EField };
