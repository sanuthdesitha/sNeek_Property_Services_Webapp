"use client";

/**
 * Bulk photo upload + categorise sheet (cleaner job form).
 *
 * The problem it solves: filing photos field-by-field means opening the phone
 * gallery once per upload section and hunting for the right shots each time. A
 * cleaner shooting 60 photos on a turnover did that 15+ times.
 *
 * Here the cleaner uploads the WHOLE batch once (same stamp → compress → POST
 * /api/uploads/direct pipeline `MediaCapture` uses — `prepareAndUploadFiles`,
 * never a second uploader), the results land in an unassigned `pool`, and then
 * they file them: multi-select photos → tap a destination field → assigned.
 * Assigned shots grey out (or hide) so only the unfiled ones remain in view,
 * and past decisions can be moved or returned to the pool at any time.
 *
 * All mutation rules live in `lib/cleaner/bulk-assign.ts` (pure + unit tested):
 * one media key is only ever in ONE place — the pool or exactly one field.
 * Assignment writes straight into the workspace's existing `UploadMap`, so
 * validation, autosave/draft and submit need no knowledge of this component.
 */
import * as React from "react";
import {
  Camera,
  Check,
  CheckCircle2,
  ImagePlus,
  Loader2,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import type { StampOptions } from "@/lib/uploads/stamp";
import {
  prepareAndUploadFiles,
  type CaptureSource,
  type CapturedMedia,
} from "@/components/v2/cleaner/media-capture";
import type { UploadMap } from "@/components/v2/cleaner/form-renderer";
import {
  addToPool,
  assignToField,
  assignmentIndex,
  nextUnmetField,
  shortfall,
  unassignKeys,
  type AssignField,
} from "@/lib/cleaner/bulk-assign";

export type BulkAssignField = AssignField;

interface PendingUpload {
  id: string;
  name: string;
  file: File;
  source: CaptureSource;
  status: "uploading" | "failed";
}

export function BulkPhotoAssign({
  open,
  onClose,
  pool,
  setPool,
  uploads,
  setUploads,
  fields,
  folder = "evidence",
  stamp,
}: {
  open: boolean;
  onClose: () => void;
  /** Uploaded-but-unfiled media. */
  pool: CapturedMedia[];
  setPool: (next: CapturedMedia[]) => void;
  /** The form's live upload map — assignment writes directly into it. */
  uploads: UploadMap;
  setUploads: (next: UploadMap) => void;
  /** Flat list of the form's upload fields, in form order. */
  fields: BulkAssignField[];
  folder?: string;
  /** Evidence-stamp context (address/reference) — same shape MediaCapture takes. */
  stamp?: StampOptions | null;
}) {
  const [selected, setSelected] = React.useState<string[]>([]);
  const [activeFieldId, setActiveFieldId] = React.useState<string | null>(null);
  const [hideAssigned, setHideAssigned] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pending, setPending] = React.useState<PendingUpload[]>([]);
  const [uploadNote, setUploadNote] = React.useState<string | null>(null);

  const state = React.useMemo(() => ({ pool, uploads }), [pool, uploads]);
  const assignedBy = React.useMemo(() => assignmentIndex(uploads), [uploads]);
  const fieldById = React.useMemo(() => {
    const map = new Map<string, BulkAssignField>();
    for (const f of fields) map.set(f.id, f);
    return map;
  }, [fields]);

  /** Everything the cleaner can act on: unfiled first (newest first), then filed. */
  const gallery = React.useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ media: CapturedMedia; fieldId: string | null }> = [];
    for (const m of [...pool].reverse()) {
      if (!m || seen.has(m.key)) continue;
      seen.add(m.key);
      out.push({ media: m, fieldId: null });
    }
    for (const f of fields) {
      const list = uploads[f.id];
      if (!Array.isArray(list)) continue;
      for (const m of [...list].reverse()) {
        if (!m || seen.has(m.key)) continue;
        seen.add(m.key);
        out.push({ media: m, fieldId: f.id });
      }
    }
    return out;
  }, [pool, uploads, fields]);

  const visible = hideAssigned ? gallery.filter((g) => g.fieldId === null) : gallery;
  const unassignedCount = pool.length;
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);

  // Reset transient UI whenever the sheet is reopened, and point the cleaner at
  // the first field still short of its minimum.
  React.useEffect(() => {
    if (!open) return;
    setSelected([]);
    setPickerOpen(false);
    setUploadNote(null);
    setActiveFieldId((prev) => prev ?? nextUnmetField(fields, uploads)?.id ?? fields[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = React.useCallback(
    (next: { pool: CapturedMedia[]; uploads: UploadMap }) => {
      if (next.pool !== pool) setPool(next.pool);
      if (next.uploads !== uploads) setUploads(next.uploads);
    },
    [pool, uploads, setPool, setUploads]
  );

  /* ── Upload ───────────────────────────────────────────────────────────── */

  // Latest-value refs: uploads resolve out of order, so the queue must append to
  // the CURRENT pool rather than the pool captured when the batch started.
  const poolRef = React.useRef(pool);
  poolRef.current = pool;
  const uploadsRef = React.useRef(uploads);
  uploadsRef.current = uploads;

  const runUpload = React.useCallback(
    async (items: PendingUpload[]) => {
      for (const item of items) {
        // One request per file so each tile reports its own success/failure and
        // can be retried without re-uploading the whole batch.
        // eslint-disable-next-line no-await-in-loop
        const { results, failedCount } = await prepareAndUploadFiles([item.file], {
          folder,
          stamp,
          source: item.source,
        });
        if (failedCount > 0 || results.length === 0) {
          setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "failed" } : p)));
          setUploadNote("Some photos failed to upload — tap Retry on the red tiles.");
          continue;
        }
        setPool(addToPool({ pool: poolRef.current, uploads: uploadsRef.current }, results).pool);
        setPending((prev) => prev.filter((p) => p.id !== item.id));
      }
    },
    [folder, stamp, setPool]
  );

  function queueFiles(files: FileList | null, source: CaptureSource) {
    if (!files || files.length === 0) return;
    setUploadNote(null);
    const items: PendingUpload[] = Array.from(files).map((file, i) => ({
      id: `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      file,
      source,
      status: "uploading",
    }));
    setPending((prev) => [...prev, ...items]);
    void runUpload(items);
  }

  function retry(item: PendingUpload) {
    setPending((prev) => prev.map((p) => (p.id === item.id ? { ...p, status: "uploading" } : p)));
    void runUpload([{ ...item, status: "uploading" }]);
  }

  /* ── Assignment ───────────────────────────────────────────────────────── */

  function assign(fieldId: string) {
    if (selected.length === 0 || !fieldId) return;
    const next = assignToField(state, selected, fieldId);
    commit(next);
    setSelected([]);
    setPickerOpen(false);
    // Assign-next loop: jump the highlight to the next field still short.
    setActiveFieldId(nextUnmetField(fields, next.uploads, fieldId)?.id ?? fieldId);
  }

  function returnToPool() {
    if (selected.length === 0) return;
    commit(unassignKeys(state, selected));
    setSelected([]);
  }

  function toggle(key: string) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const selectedAssignedCount = selected.filter((k) => assignedBy[k]).length;
  const sections = React.useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, BulkAssignField[]>();
    for (const f of fields) {
      const title = f.sectionTitle || "Photos";
      if (!map.has(title)) {
        map.set(title, []);
        order.push(title);
      }
      map.get(title)!.push(f);
    }
    return order.map((title) => ({ title, fields: map.get(title)! }));
  }, [fields]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-[hsl(var(--e-background))]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-4 py-3">
        <div className="min-w-0">
          <p className="e-eyebrow">Bulk photos</p>
          <p className="truncate text-[0.9375rem] font-[600]">
            Unassigned: <span className="tabular-nums">{unassignedCount}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close bulk photos"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-40 pt-4">
        {/* Step 1 — upload the whole batch in one go */}
        <section className="space-y-2">
          <p className="e-eyebrow">1 · Upload everything</p>
          <div className="flex flex-wrap gap-2">
            <PickerButton
              label="Choose photos"
              icon={<ImagePlus className="h-4 w-4" />}
              onFiles={(f) => queueFiles(f, "gallery")}
            />
            <PickerButton
              label="Take photos"
              icon={<Camera className="h-4 w-4" />}
              capture="environment"
              onFiles={(f) => queueFiles(f, "camera")}
            />
          </div>
          {pending.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {pending.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "flex h-16 w-28 flex-col items-center justify-center gap-1 rounded-[var(--e-radius-sm)] border px-2 text-center text-[0.625rem]",
                    p.status === "failed"
                      ? "border-[hsl(var(--e-danger))] text-[hsl(var(--e-danger))]"
                      : "border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))]"
                  )}
                >
                  {p.status === "uploading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => retry(p)}
                      className="inline-flex items-center gap-1 font-[600] underline-offset-2 hover:underline"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Retry
                    </button>
                  )}
                  <span className="line-clamp-1 w-full">{p.name}</span>
                </div>
              ))}
            </div>
          ) : null}
          {uploadNote ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{uploadNote}</p>
          ) : null}
        </section>

        {/* Step 2 — categorise */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="e-eyebrow">2 · Categorise</p>
            <label className="inline-flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <input
                type="checkbox"
                checked={hideAssigned}
                onChange={(e) => setHideAssigned(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Hide assigned
            </label>
          </div>

          {visible.length === 0 ? (
            <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {gallery.length === 0
                ? "Upload photos above, then tap them to file into sections."
                : "Everything is filed. Untick “Hide assigned” to review."}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {visible.map(({ media, fieldId }) => {
                const isSelected = selectedSet.has(media.key);
                const label = fieldId ? fieldById.get(fieldId)?.label ?? fieldId : null;
                return (
                  <button
                    key={media.key}
                    type="button"
                    onClick={() => toggle(media.key)}
                    aria-pressed={isSelected}
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-[var(--e-radius-sm)] border bg-[hsl(var(--e-surface-sunken))]",
                      isSelected
                        ? "border-[hsl(var(--e-gold))] ring-2 ring-[hsl(var(--e-gold))]"
                        : "border-[hsl(var(--e-border))]"
                    )}
                  >
                    {media.kind === "video" ? (
                      <video src={media.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={media.url}
                        alt={media.name || "photo"}
                        loading="lazy"
                        className={cn("h-full w-full object-cover", fieldId ? "opacity-40 grayscale" : null)}
                      />
                    )}
                    {isSelected ? (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))]">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                    {label ? (
                      <span className="absolute inset-x-0 bottom-0 line-clamp-1 bg-[hsl(var(--e-background)/0.8)] px-1 py-0.5 text-[0.5625rem] font-[600]">
                        {label}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Step 3 — destinations */}
        <section className="space-y-3">
          <p className="e-eyebrow">3 · Sections</p>
          {sections.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              This form has no photo sections.
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.title} className="space-y-1.5">
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                  {section.title}
                </p>
                {section.fields.map((field) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    media={uploads[field.id] ?? []}
                    active={activeFieldId === field.id}
                    short={shortfall(field, uploads)}
                    onSelect={() => setActiveFieldId(field.id)}
                  />
                ))}
              </div>
            ))
          )}
        </section>
      </div>

      {/* Sticky action footer */}
      <div className="border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3">
        <div className="flex items-center justify-between gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <span className="tabular-nums">
            {selected.length} selected
            {selectedAssignedCount > 0 ? ` · ${selectedAssignedCount} already filed` : ""}
          </span>
          {selected.length > 0 ? (
            <button type="button" onClick={() => setSelected([])} className="underline-offset-2 hover:underline">
              Clear
            </button>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <EButton
            variant="gold"
            size="sm"
            className="flex-1"
            disabled={selected.length === 0 || !activeFieldId}
            onClick={() => activeFieldId && assign(activeFieldId)}
          >
            <CheckCircle2 className="h-4 w-4" />
            Assign {selected.length || ""} to {activeFieldId ? fieldById.get(activeFieldId)?.label ?? "section" : "…"}
          </EButton>
          <EButton
            variant="outline"
            size="sm"
            disabled={selected.length === 0 || fields.length === 0}
            onClick={() => setPickerOpen(true)}
          >
            Assign to…
          </EButton>
          <EButton
            variant="ghost"
            size="sm"
            disabled={selectedAssignedCount === 0}
            onClick={returnToPool}
          >
            <Undo2 className="h-4 w-4" /> Unassign
          </EButton>
          <EButton variant="outline" size="sm" onClick={onClose}>
            Done
          </EButton>
        </div>
      </div>

      {/* Field picker (flow b: pick photos first, then choose the destination) */}
      {pickerOpen ? (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-[hsl(160_18%_8%/0.45)]">
          <div
            className="max-h-[70vh] overflow-y-auto rounded-t-[var(--e-radius)] border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[0.9375rem] font-[600]">
                Move {selected.length} photo{selected.length === 1 ? "" : "s"} to…
              </p>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                aria-label="Close picker"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border))]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-1.5">
              {sections.map((section) => (
                <div key={section.title} className="space-y-1">
                  <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                    {section.title}
                  </p>
                  {section.fields.map((field) => (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() => assign(field.id)}
                      className="flex w-full items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-3 py-2 text-left text-[0.8125rem] hover:bg-[hsl(var(--e-muted))]"
                    >
                      <span className="min-w-0 truncate">{field.label}</span>
                      <CountChip field={field} count={(uploads[field.id] ?? []).length} />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CountChip({ field, count }: { field: BulkAssignField; count: number }) {
  const need = Math.max(field.minPhotos ?? 0, field.required ? 1 : 0);
  if (need === 0) return <EBadge tone="neutral">{count}</EBadge>;
  return (
    <EBadge tone={count >= need ? "success" : "warning"}>
      {count}/{need}
    </EBadge>
  );
}

function FieldRow({
  field,
  media,
  active,
  short,
  onSelect,
}: {
  field: BulkAssignField;
  media: CapturedMedia[];
  active: boolean;
  short: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-[var(--e-radius-sm)] border px-3 py-2 text-left",
        active
          ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]"
          : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-[550]">{field.label}</span>
        {media.length > 0 ? (
          <span className="mt-1 flex gap-1">
            {media.slice(0, 4).map((m) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={m.key}
                src={m.url}
                alt=""
                loading="lazy"
                className="h-8 w-8 rounded-[3px] object-cover"
              />
            ))}
            {media.length > 4 ? (
              <span className="flex h-8 items-center text-[0.625rem] text-[hsl(var(--e-muted-foreground))]">
                +{media.length - 4}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
            {short > 0 ? `Needs ${short} more` : "No photos yet"}
          </span>
        )}
      </span>
      <CountChip field={field} count={media.length} />
    </button>
  );
}

function PickerButton({
  label,
  icon,
  capture,
  onFiles,
}: {
  label: string;
  icon: React.ReactNode;
  capture?: "environment" | "user";
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] font-[550]">
      <input
        type="file"
        accept="image/*"
        multiple
        {...(capture ? { capture } : {})}
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      {icon}
      {label}
    </label>
  );
}
