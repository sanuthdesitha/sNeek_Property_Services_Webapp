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
import { EConfirmButton, EInput, ETextarea, EField, EModal } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import { CHANGED_OUTLINE_CLASS, ChangedNote, useChangeCount, useFieldChange } from "./changes-context";

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

/* ── Image library (marketing images) offered to every image field ───────── */
export type LibraryImage = { id: string; name: string; url: string };

const LibraryImagesContext = React.createContext<LibraryImage[]>([]);

export function LibraryImagesProvider({ images, children }: { images: LibraryImage[]; children: React.ReactNode }) {
  return <LibraryImagesContext.Provider value={images}>{children}</LibraryImagesContext.Provider>;
}

function fileNameOf(url: string): string {
  try {
    const last = new URL(url, "https://example.invalid").pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last) || url;
  } catch {
    return url;
  }
}

/* ── Image field (picture, upload, image library, required alt text) ─────── */
/*
 * Alt text is required before publishing (owner default 2026-11-16, pending
 * owner confirmation); the server refuses a publish without it as well.
 * `path` is the image URL's content path: it drives the unsaved-change
 * outline and the alt-text check.
 */
export function EImageField({
  label,
  value,
  alt,
  onChange,
  onAltChange,
  onUpload,
  uploading,
  disabled,
  path,
  altPath,
}: {
  label: string;
  value: string;
  alt: string;
  onChange: (value: string) => void;
  onAltChange: (value: string) => void;
  onUpload: (file: File) => Promise<void>;
  uploading: boolean;
  disabled?: boolean;
  path?: string;
  altPath?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const images = React.useContext(LibraryImagesContext);
  const change = useFieldChange(path);
  const altChange = useFieldChange(altPath);
  const altMissing = Boolean(value.trim()) && !alt.trim();
  const altId = React.useId();
  const altErrorId = `${altId}-error`;
  return (
    <div className="space-y-2">
      <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">
        {label}
        <ChangedNote change={change} showWas={false} />
      </p>
      <div
        className={cn(
          "relative flex h-24 items-end justify-between gap-2 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2",
          change.changed && CHANGED_OUTLINE_CLASS
        )}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
        <span className="relative min-w-0 truncate rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface)/0.85)] px-1.5 py-0.5 text-[0.6875rem] text-[hsl(var(--e-foreground))]">
          {value ? fileNameOf(value) : "No image"}
        </span>
        {!disabled ? (
          <span className="relative flex shrink-0 gap-1">
            <EButton variant="outline" size="sm" className="bg-[hsl(var(--e-surface)/0.9)]" onClick={() => inputRef.current?.click()} disabled={uploading}>
              <UploadCloud className="h-3.5 w-3.5" aria-hidden />
              {uploading ? "Uploading…" : value ? "Replace" : "Upload"}
            </EButton>
            {images.length > 0 ? (
              <EButton variant="outline" size="sm" className="bg-[hsl(var(--e-surface)/0.9)]" onClick={() => setPickerOpen(true)}>
                From image library
              </EButton>
            ) : null}
          </span>
        ) : null}
      </div>
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
      <div className="space-y-1">
        <label htmlFor={altId} className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">
          Alt text <span className="font-normal text-[hsl(var(--e-muted-foreground))]">· required before publishing</span>
          <ChangedNote change={altChange} />
        </label>
        <EInput
          id={altId}
          value={alt}
          onChange={(e) => onAltChange(e.target.value)}
          disabled={disabled}
          placeholder="Describe the picture, e.g. Bright living room in a Bondi apartment"
          aria-invalid={altMissing || undefined}
          aria-describedby={altMissing ? altErrorId : undefined}
        />
        {altMissing ? (
          <p id={altErrorId} className="text-[0.75rem] text-[hsl(var(--e-danger))]">
            Add alt text: the website cannot be published while this image has none.
          </p>
        ) : null}
      </div>
      <details className="text-[0.75rem]">
        <summary className="cursor-pointer text-[hsl(var(--e-muted-foreground))]">Image address</summary>
        <div className="mt-2">
          <EField label={`${label} address`}>
            <EInput value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://…" disabled={disabled} />
          </EField>
        </div>
      </details>
      <EModal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Choose from the image library" eyebrow="Images">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((image) => (
            <li key={image.id}>
              <button
                type="button"
                className="w-full overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]"
                onClick={() => {
                  onChange(image.url);
                  setPickerOpen(false);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" className="h-24 w-full object-cover" />
                <span className="block truncate px-2 py-1.5 text-[0.75rem]">{image.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </EModal>
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
            {/* Low tier: one block of an unpublished page draft. */}
            <EConfirmButton
              ariaLabel="Remove"
              confirmLabel={<span className="text-[0.625rem] font-[600]">Sure?</span>}
              onConfirm={onRemove}
              className="inline-flex h-7 items-center justify-center rounded-[var(--e-radius-sm)] px-1.5 text-[hsl(var(--e-danger))] hover:bg-[hsl(var(--e-muted))]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </EConfirmButton>
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

/* ── Folding sub-section (stays mounted when closed, keeps the draft) ────── */
export function EFoldSection({
  title,
  changePath,
  extraPaths = [],
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Content paths whose unsaved changes are counted on the summary. */
  changePath: string;
  extraPaths?: string[];
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const count = useChangeCount([changePath, ...extraPaths]);
  return (
    <details open={defaultOpen || undefined} className="group rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-[0.875rem] font-[600] [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {count > 0 ? (
            <span className="text-[0.6875rem] font-[600] text-[hsl(var(--e-warning))]">
              {count} unsaved
            </span>
          ) : null}
          <span aria-hidden className="text-[hsl(var(--e-muted-foreground))] transition-transform group-open:rotate-90">›</span>
        </span>
      </summary>
      <div className="space-y-4 border-t border-[hsl(var(--e-border))] p-3">{children}</div>
    </details>
  );
}
