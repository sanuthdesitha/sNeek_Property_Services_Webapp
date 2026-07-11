"use client";

/**
 * ESTATE — Property access guide editor (ADMIN / OPS_MANAGER).
 *
 * Manages the rich, image-backed access guide persisted to
 * `Property.accessGuide`:
 *   GET  /api/admin/properties/:id/access-guide
 *   POST /api/admin/properties/:id/access-guide
 *
 * Each entry = { id, kind, label, instructions?, images:[{url,key,caption?}] }.
 * Images upload through POST /api/uploads/direct (folder "property-access").
 * Estate token scope only — no components/ui/* or v1 dependency.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlarmSmoke,
  ArrowDown,
  ArrowUp,
  Boxes,
  Car,
  DoorOpen,
  ImagePlus,
  Info,
  KeyRound,
  Lock,
  Plus,
  Save,
  Trash2,
  Trash,
  Wifi,
  X,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ETextarea, ESelect } from "@/components/v2/admin/estate-kit";

type AccessKind =
  | "LOCKBOX"
  | "KEYS"
  | "ENTRY"
  | "ALARM"
  | "PARKING"
  | "BIN_ROOM"
  | "SUPPLIES_CUPBOARD"
  | "WIFI"
  | "OTHER";

type GuideImage = { url: string; key: string; caption?: string };
type GuideEntry = {
  id: string;
  kind: AccessKind;
  label: string;
  instructions?: string;
  images: GuideImage[];
};

export const ACCESS_KIND_META: Record<AccessKind, { label: string; icon: React.ReactNode }> = {
  LOCKBOX: { label: "Lockbox", icon: <Lock className="h-4 w-4" /> },
  KEYS: { label: "Keys", icon: <KeyRound className="h-4 w-4" /> },
  ENTRY: { label: "Entry", icon: <DoorOpen className="h-4 w-4" /> },
  ALARM: { label: "Alarm", icon: <AlarmSmoke className="h-4 w-4" /> },
  PARKING: { label: "Parking", icon: <Car className="h-4 w-4" /> },
  BIN_ROOM: { label: "Bin room", icon: <Trash className="h-4 w-4" /> },
  SUPPLIES_CUPBOARD: { label: "Supplies cupboard", icon: <Boxes className="h-4 w-4" /> },
  WIFI: { label: "Wi-Fi", icon: <Wifi className="h-4 w-4" /> },
  OTHER: { label: "Other", icon: <Info className="h-4 w-4" /> },
};

const KIND_ORDER = Object.keys(ACCESS_KIND_META) as AccessKind[];

function makeId() {
  return `ag_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function PropertyAccessGuideEditor({ propertyId }: { propertyId: string }) {
  const [entries, setEntries] = useState<GuideEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/properties/${propertyId}/access-guide`);
      const data = await res.json().catch(() => null);
      if (res.ok && data && Array.isArray(data.accessGuide)) {
        setEntries(data.accessGuide);
      } else {
        setEntries([]);
      }
    } finally {
      setDirty(false);
      setLoading(false);
    }
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback((fn: (prev: GuideEntry[]) => GuideEntry[]) => {
    setEntries((prev) => fn(prev));
    setDirty(true);
  }, []);

  function addEntry() {
    mutate((prev) => [
      ...prev,
      { id: makeId(), kind: "OTHER", label: "", instructions: "", images: [] },
    ]);
  }

  function updateEntry(id: string, patch: Partial<GuideEntry>) {
    mutate((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function removeEntry(id: string) {
    mutate((prev) => prev.filter((e) => e.id !== id));
  }

  function move(id: string, dir: -1 | 1) {
    mutate((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[next]] = [copy[next], copy[idx]];
      return copy;
    });
  }

  async function save() {
    // Client-side guard so we never persist an entry without a label.
    const cleaned = entries
      .map((e) => ({ ...e, label: e.label.trim() }))
      .filter((e) => e.label || (e.instructions ?? "").trim() || e.images.length > 0);
    const missingLabel = cleaned.find((e) => !e.label);
    if (missingLabel) {
      toast({ title: "Add a label", description: "Every access entry needs a short label.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/properties/${propertyId}/access-guide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessGuide: cleaned }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Save failed", description: body.error ?? "Could not save access guide.", variant: "destructive" });
        return;
      }
      setEntries(Array.isArray(body.accessGuide) ? body.accessGuide : cleaned);
      setDirty(false);
      toast({ title: "Access guide saved", description: `${(body.accessGuide ?? cleaned).length} entr${(body.accessGuide ?? cleaned).length === 1 ? "y" : "ies"} live for cleaners.` });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <ECard>
        <ECardBody className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          Loading access guide…
        </ECardBody>
      </ECard>
    );
  }

  return (
    <ECard>
      <ECardHeader className="flex-row items-center justify-between gap-3 pb-2">
        <div className="min-w-0">
          <ECardTitle className="text-[0.95rem]">Access guide</ECardTitle>
          <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Detailed, image-backed access points cleaners see on the job — lockbox, keys, entry, alarm, parking, bins, supplies, Wi-Fi.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <EButton variant="outline" size="sm" onClick={addEntry}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add entry
          </EButton>
          <EButton variant="gold" size="sm" onClick={save} disabled={saving || !dirty}>
            <Save className="mr-1 h-3.5 w-3.5" /> {saving ? "Saving…" : dirty ? "Save guide" : "Saved"}
          </EButton>
        </div>
      </ECardHeader>
      <ECardBody className="space-y-4 pt-0">
        {entries.length === 0 ? (
          <EEmptyState
            eyebrow="No access points"
            title="Build the property access guide"
            description="Add each access point (supplies cupboard, bin room, lockbox, parking…) with clear instructions and photos so cleaners always know where to go."
            action={
              <EButton variant="gold" size="sm" onClick={addEntry}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add first entry
              </EButton>
            }
          />
        ) : (
          entries.map((entry, i) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              index={i}
              total={entries.length}
              propertyId={propertyId}
              onChange={(patch) => updateEntry(entry.id, patch)}
              onRemove={() => removeEntry(entry.id)}
              onMove={(dir) => move(entry.id, dir)}
            />
          ))
        )}
      </ECardBody>
    </ECard>
  );
}

function EntryCard({
  entry,
  index,
  total,
  propertyId,
  onChange,
  onRemove,
  onMove,
}: {
  entry: GuideEntry;
  index: number;
  total: number;
  propertyId: string;
  onChange: (patch: Partial<GuideEntry>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const meta = ACCESS_KIND_META[entry.kind] ?? ACCESS_KIND_META.OTHER;

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    const added: GuideImage[] = [];
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", "property-access");
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

  function updateImage(idx: number, patch: Partial<GuideImage>) {
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
          <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_1fr]">
            <EField label="Type">
              <ESelect
                value={entry.kind}
                onChange={(e) => onChange({ kind: e.target.value as AccessKind })}
              >
                {KIND_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {ACCESS_KIND_META[k].label}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Label">
              <EInput
                value={entry.label}
                placeholder="e.g. Supplies cupboard — level 2 hallway"
                onChange={(e) => onChange({ label: e.target.value })}
              />
            </EField>
          </div>

          <EField label="Instructions">
            <ETextarea
              value={entry.instructions ?? ""}
              placeholder="Step-by-step: where it is, codes, what to do…"
              onChange={(e) => onChange({ instructions: e.target.value })}
            />
          </EField>

          {/* Images */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">
                Photos
              </p>
              <EButton
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
                      <img src={img.url} alt={img.caption ?? "Access photo"} className="h-28 w-full object-cover" />
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
                No photos yet — add a lockbox close-up, a door shot, or a cupboard view.
              </p>
            )}
          </div>
        </div>

        {/* Entry controls */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <EButton variant="ghost" size="icon" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp className="h-4 w-4" />
          </EButton>
          <EButton variant="ghost" size="icon" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown className="h-4 w-4" />
          </EButton>
          <EButton variant="ghost" size="icon" onClick={onRemove} aria-label="Delete entry">
            <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
          </EButton>
        </div>
      </div>
    </div>
  );
}
