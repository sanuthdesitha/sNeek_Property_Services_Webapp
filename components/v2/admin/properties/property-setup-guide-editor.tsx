"use client";

/**
 * ESTATE — Property SETUP GUIDE editor (ADMIN / OPS_MANAGER).
 *
 * Controlled sibling of PropertyAccessGuideEditor. Instead of a dedicated
 * save endpoint, this edits the `Property.setupGuide` array in the parent
 * form's state; the parent persists it through the main property POST/PATCH
 * payload. Same entry shape as accessGuide:
 *   { id, kind, label, instructions?, images:[{url,key,caption?}] }
 * with kinds SETUP | REFERENCE_POSITION | SOFA_BED | OTHER.
 * Images upload through POST /api/uploads/direct (folder "property-setup").
 * Estate token scope only — no components/ui/* or v1 dependency.
 */
import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BedDouble,
  ImagePlus,
  Info,
  Move,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton, EEmptyState } from "@/components/v2/ui/primitives";
import { EField, EInput, ETextarea, ESelect } from "@/components/v2/admin/estate-kit";

export type SetupKind = "SETUP" | "REFERENCE_POSITION" | "SOFA_BED" | "OTHER";

export type SetupGuideImage = { url: string; key: string; caption?: string };
export type SetupGuideEntry = {
  id: string;
  kind: SetupKind;
  label: string;
  instructions?: string;
  images: SetupGuideImage[];
};

export const SETUP_KIND_META: Record<SetupKind, { label: string; icon: React.ReactNode }> = {
  SETUP: { label: "Setup", icon: <Sparkles className="h-4 w-4" /> },
  REFERENCE_POSITION: { label: "Reference position", icon: <Move className="h-4 w-4" /> },
  SOFA_BED: { label: "Sofa bed", icon: <BedDouble className="h-4 w-4" /> },
  OTHER: { label: "Other", icon: <Info className="h-4 w-4" /> },
};

const KIND_ORDER = Object.keys(SETUP_KIND_META) as SetupKind[];

function makeId() {
  return `sg_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function PropertySetupGuideEditor({
  value,
  onChange,
}: {
  value: SetupGuideEntry[];
  onChange: (entries: SetupGuideEntry[]) => void;
}) {
  function addEntry() {
    onChange([...value, { id: makeId(), kind: "SETUP", label: "", instructions: "", images: [] }]);
  }

  function updateEntry(id: string, patch: Partial<SetupGuideEntry>) {
    onChange(value.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function removeEntry(id: string) {
    onChange(value.filter((e) => e.id !== id));
  }

  function move(id: string, dir: -1 | 1) {
    const idx = value.findIndex((e) => e.id === id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= value.length) return;
    const copy = [...value];
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    onChange(copy);
  }

  return (
    <div className="space-y-4 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-[550]">Setup guide</p>
          <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Image-backed setup + reference-position steps cleaners follow — bed setup, sofa-bed
            configuration, how a room should look when finished.
          </p>
        </div>
        <EButton type="button" variant="outline" size="sm" onClick={addEntry}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add entry
        </EButton>
      </div>

      {value.length === 0 ? (
        <EEmptyState
          eyebrow="No setup steps"
          title="Build the property setup guide"
          description="Add setup steps and reference-position photos so every clean finishes to the same standard."
          action={
            <EButton type="button" variant="gold" size="sm" onClick={addEntry}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add first entry
            </EButton>
          }
        />
      ) : (
        <div className="space-y-4">
          {value.map((entry, i) => (
            <SetupEntryCard
              key={entry.id}
              entry={entry}
              index={i}
              total={value.length}
              onChange={(patch) => updateEntry(entry.id, patch)}
              onRemove={() => removeEntry(entry.id)}
              onMove={(dir) => move(entry.id, dir)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SetupEntryCard({
  entry,
  index,
  total,
  onChange,
  onRemove,
  onMove,
}: {
  entry: SetupGuideEntry;
  index: number;
  total: number;
  onChange: (patch: Partial<SetupGuideEntry>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const meta = SETUP_KIND_META[entry.kind] ?? SETUP_KIND_META.OTHER;

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const added: SetupGuideImage[] = [];
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", "property-setup");
        const res = await fetch("/api/uploads/direct", { method: "POST", body: fd });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.url || !body.key) {
          toast({ title: "Upload failed", description: body.error ?? file.name, variant: "destructive" });
          continue;
        }
        added.push({ url: body.url, key: body.key });
      }
      if (added.length > 0) onChange({ images: [...entry.images, ...added] });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function updateImage(idx: number, patch: Partial<SetupGuideImage>) {
    onChange({ images: entry.images.map((img, i) => (i === idx ? { ...img, ...patch } : img)) });
  }

  function removeImage(idx: number) {
    onChange({ images: entry.images.filter((_, i) => i !== idx) });
  }

  return (
    <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]">
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
            <EField label="Type">
              <ESelect value={entry.kind} onChange={(e) => onChange({ kind: e.target.value as SetupKind })}>
                {KIND_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {SETUP_KIND_META[k].label}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Label">
              <EInput
                value={entry.label}
                placeholder="e.g. Master bed — hotel fold, 4 pillows"
                onChange={(e) => onChange({ label: e.target.value })}
              />
            </EField>
          </div>

          <EField label="Instructions">
            <ETextarea
              value={entry.instructions ?? ""}
              placeholder="Step-by-step: how to set it up, what it should look like when done…"
              onChange={(e) => onChange({ instructions: e.target.value })}
            />
          </EField>

          {/* Images */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">
                Reference photos
              </p>
              <EButton
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus className="mr-1 h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Add photos"}
              </EButton>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </div>
            {entry.images.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {entry.images.map((img, idx) => (
                  <div
                    key={img.key || idx}
                    className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]"
                  >
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt={img.caption ?? "Setup photo"} className="h-28 w-full object-cover" />
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() => removeImage(idx)}
                        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(160_18%_8%/0.6)] text-white transition-colors hover:bg-[hsl(var(--e-danger))]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <input
                      value={img.caption ?? ""}
                      placeholder="Caption (optional)"
                      onChange={(e) => updateImage(idx, { caption: e.target.value })}
                      className="w-full border-t border-[hsl(var(--e-border))] bg-transparent px-2 py-1.5 text-[0.75rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))] focus:outline-none"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                No photos yet — add a "done right" reference shot for this step.
              </p>
            )}
          </div>
        </div>

        {/* Entry controls */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <EButton type="button" variant="ghost" size="icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp className="h-4 w-4" />
          </EButton>
          <EButton type="button" variant="ghost" size="icon" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown className="h-4 w-4" />
          </EButton>
          <EButton type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Delete entry">
            <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
          </EButton>
        </div>
      </div>
    </div>
  );
}

/** Shared laundry-bag colour swatch picker (stores lowercase colour name). */
export const LAUNDRY_BAG_COLOR_SWATCHES: { name: string; hex: string }[] = [
  { name: "blue", hex: "#2563eb" },
  { name: "red", hex: "#dc2626" },
  { name: "green", hex: "#16a34a" },
  { name: "yellow", hex: "#eab308" },
  { name: "black", hex: "#1f2937" },
  { name: "white", hex: "#f8fafc" },
  { name: "orange", hex: "#ea580c" },
  { name: "purple", hex: "#9333ea" },
];

export function LaundryBagColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {LAUNDRY_BAG_COLOR_SWATCHES.map((swatch) => {
        const selected = value === swatch.name;
        return (
          <button
            key={swatch.name}
            type="button"
            aria-label={swatch.name}
            aria-pressed={selected}
            title={swatch.name}
            onClick={() => onChange(selected ? "" : swatch.name)}
            className={
              "h-7 w-7 rounded-full border transition-transform " +
              (selected
                ? "border-[hsl(var(--e-gold-ink))] ring-2 ring-[hsl(var(--e-gold-ink))] ring-offset-1 ring-offset-[hsl(var(--e-surface))] scale-105"
                : "border-[hsl(var(--e-border-strong))] hover:scale-105")
            }
            style={{ backgroundColor: swatch.hex }}
          />
        );
      })}
      {value ? (
        <span className="text-[0.75rem] capitalize text-[hsl(var(--e-text-secondary))]">{value}</span>
      ) : (
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">No colour</span>
      )}
    </div>
  );
}
