"use client";

import * as React from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";

/**
 * v1 (shadcn) SETUP GUIDE editor — the legacy counterpart of the Estate
 * PropertySetupGuideEditor. Controlled: edits the `Property.setupGuide` array in
 * the parent form state; the parent persists through the property PATCH payload.
 * Entry shape mirrors accessGuide:
 *   { id, kind, label, instructions?, images:[{url,key,caption?}] }
 * kinds SETUP | REFERENCE_POSITION | SOFA_BED | OTHER.
 */
export type SetupKind = "SETUP" | "REFERENCE_POSITION" | "SOFA_BED" | "OTHER";
export type SetupGuideImage = { url: string; key: string; caption?: string };
export type SetupGuideEntry = {
  id: string;
  kind: SetupKind;
  label: string;
  instructions?: string;
  images: SetupGuideImage[];
};

const KIND_LABELS: Record<SetupKind, string> = {
  SETUP: "Setup",
  REFERENCE_POSITION: "Reference position",
  SOFA_BED: "Sofa bed",
  OTHER: "Other",
};
const KIND_ORDER = Object.keys(KIND_LABELS) as SetupKind[];

/** Laundry bag colour swatches (stored lowercase name). Shared v1 helper. */
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
              (selected ? "border-primary ring-2 ring-primary ring-offset-1 scale-105" : "border-border hover:scale-105")
            }
            style={{ backgroundColor: swatch.hex }}
          />
        );
      })}
      <span className="text-xs capitalize text-muted-foreground">{value || "No colour"}</span>
    </div>
  );
}

function uid() {
  return `sg-${Math.random().toString(36).slice(2, 9)}`;
}

async function uploadDirect(file: File, folder: string): Promise<{ key: string; url: string }> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.key) throw new Error(body?.error ?? "Upload failed");
  return { key: body.key, url: body.url };
}

export function PropertySetupGuideEditor({
  value,
  onChange,
}: {
  value: SetupGuideEntry[];
  onChange: (entries: SetupGuideEntry[]) => void;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);

  const patchEntry = (id: string, patch: Partial<SetupGuideEntry>) =>
    onChange(value.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const addEntry = () =>
    onChange([...value, { id: uid(), kind: "SETUP", label: "", instructions: "", images: [] }]);

  async function addImages(entryId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(entryId);
    try {
      const uploaded: SetupGuideImage[] = [];
      for (const file of Array.from(files)) {
        const { key, url } = await uploadDirect(file, "property-setup");
        uploaded.push({ key, url });
      }
      const target = value.find((e) => e.id === entryId);
      if (target) patchEntry(entryId, { images: [...target.images, ...uploaded] });
    } catch (err: any) {
      toast({ title: "Photo upload failed", description: err.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {value.map((entry) => (
        <div key={entry.id} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <Select value={entry.kind} onValueChange={(v) => patchEntry(entry.id, { kind: v as SetupKind })}>
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_ORDER.map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">
                    {KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-8 flex-1 text-xs"
              placeholder="Label (e.g. Master bed — hotel fold, 4 pillows)"
              value={entry.label}
              onChange={(e) => patchEntry(entry.id, { label: e.target.value })}
            />
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:text-destructive"
              onClick={() => onChange(value.filter((e) => e.id !== entry.id))}
              aria-label="Remove entry"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <Textarea
            rows={2}
            className="text-xs"
            placeholder="Instructions — how to set it up and what it should look like when done."
            value={entry.instructions ?? ""}
            onChange={(e) => patchEntry(entry.id, { instructions: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-2">
            {entry.images.map((img, i) => (
              <div key={img.key ?? img.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.caption ?? "Setup photo"} className="h-16 w-16 rounded border object-cover" />
                <button
                  type="button"
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-background p-0.5 text-destructive shadow"
                  onClick={() => patchEntry(entry.id, { images: entry.images.filter((_, idx) => idx !== i) })}
                  aria-label="Remove photo"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 text-xs hover:bg-muted">
              <Plus className="h-3.5 w-3.5" /> {busy === entry.id ? "Uploading…" : "Add photos"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                disabled={busy === entry.id}
                onChange={(e) => {
                  const el = e.currentTarget;
                  void addImages(entry.id, el.files).then(() => (el.value = ""));
                }}
              />
            </label>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addEntry}>
        <Plus className="mr-1 h-3.5 w-3.5" /> Add setup entry
      </Button>
    </div>
  );
}
