"use client";

/**
 * Settings → Accountability → Final check-up (R7). Admin editor for
 * AppSettings.finalCheckup: the enable toggle plus CRUD over the acknowledgement
 * items the cleaner must tap through before "Submit & clock out" (title, detail,
 * applies-to job types, reference images, up/down ordering). Reference images
 * upload through POST /api/uploads/direct (folder "final-checkup") and store S3
 * keys; previews resolve via /api/uploads/access. Saves the whole blob via
 * PATCH /api/admin/settings (server shape enforced by
 * sanitizeFinalCheckupSettings in lib/settings.ts).
 */
import * as React from "react";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  ETextarea,
  EToggle,
  ESaveStatus,
  ESectionHeading,
  useSaveStatus,
} from "./estate-form";
import type { FinalCheckupItem, FinalCheckupSettings } from "@/lib/settings";

/* Must match the Prisma JobType enum (same list the form builder uses). */
const JOB_TYPES: ReadonlyArray<readonly [string, string]> = [
  ["AIRBNB_TURNOVER", "Airbnb Turnover"],
  ["DEEP_CLEAN", "Deep Clean"],
  ["END_OF_LEASE", "End of Lease"],
  ["GENERAL_CLEAN", "General Clean"],
  ["POST_CONSTRUCTION", "Post-Construction"],
  ["PRESSURE_WASH", "Pressure Wash"],
  ["WINDOW_CLEAN", "Window Clean"],
  ["LAWN_MOWING", "Lawn Mowing"],
  ["SPECIAL_CLEAN", "Special Clean"],
  ["COMMERCIAL_RECURRING", "Commercial Recurring"],
  ["CARPET_STEAM_CLEAN", "Carpet Steam Clean"],
  ["MOLD_TREATMENT", "Mold Treatment"],
  ["UPHOLSTERY_CLEANING", "Upholstery Cleaning"],
  ["TILE_GROUT_CLEANING", "Tile & Grout Cleaning"],
  ["GUTTER_CLEANING", "Gutter Cleaning"],
  ["SPRING_CLEANING", "Spring Cleaning"],
];

function newItemId() {
  return `fc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ReferenceThumb({ storageKey }: { storageKey: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/uploads/access?key=${encodeURIComponent(storageKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body?.url) setUrl(body.url as string);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [storageKey]);
  return (
    <div className="flex size-14 items-center justify-center overflow-hidden rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted))]">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Reference" className="size-14 object-cover" />
      ) : (
        <Loader2 className="size-4 animate-spin text-[hsl(var(--e-text-faint))]" />
      )}
    </div>
  );
}

export function FinalCheckupSettingsSection({
  initial,
  readOnly,
}: {
  initial: FinalCheckupSettings;
  readOnly: boolean;
}) {
  const [draft, setDraft] = React.useState<FinalCheckupSettings>(() =>
    JSON.parse(JSON.stringify(initial))
  );
  const [saving, setSaving] = React.useState(false);
  const [uploadingItemId, setUploadingItemId] = React.useState<string | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const { status, flash } = useSaveStatus();

  function patchItem(id: string, changes: Partial<FinalCheckupItem>) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === id ? { ...it, ...changes } : it)),
    }));
  }
  function addItem() {
    setDraft((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { id: newItemId(), title: "", detail: "", referenceImageKeys: [], appliesTo: [] },
      ],
    }));
  }
  function removeItem(id: string) {
    setDraft((prev) => ({ ...prev, items: prev.items.filter((it) => it.id !== id) }));
  }
  function moveItem(id: string, dir: -1 | 1) {
    setDraft((prev) => {
      const idx = prev.items.findIndex((it) => it.id === id);
      const to = idx + dir;
      if (idx === -1 || to < 0 || to >= prev.items.length) return prev;
      const items = prev.items.slice();
      const [it] = items.splice(idx, 1);
      items.splice(to, 0, it);
      return { ...prev, items };
    });
  }
  function toggleJobType(id: string, jobType: string) {
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((it) => {
        if (it.id !== id) return it;
        const current = new Set(it.appliesTo ?? []);
        if (current.has(jobType)) current.delete(jobType);
        else current.add(jobType);
        return { ...it, appliesTo: Array.from(current) };
      }),
    }));
  }

  async function uploadReferences(itemId: string, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingItemId(itemId);
    setUploadError(null);
    try {
      const keys: string[] = [];
      const failed: string[] = [];
      for (const file of Array.from(files)) {
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("folder", "final-checkup");
          const res = await fetch("/api/uploads/direct", { method: "POST", body: fd });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || !body.key) {
            failed.push(`${file.name}: ${body.error ?? `upload failed (${res.status})`}`);
            continue;
          }
          keys.push(body.key as string);
        } catch {
          failed.push(`${file.name}: network error`);
        }
      }
      if (keys.length > 0) {
        setDraft((prev) => ({
          ...prev,
          items: prev.items.map((it) =>
            it.id === itemId
              ? { ...it, referenceImageKeys: [...it.referenceImageKeys, ...keys] }
              : it
          ),
        }));
      }
      if (failed.length > 0) setUploadError(failed.join(" · "));
    } finally {
      setUploadingItemId(null);
    }
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const cleaned: FinalCheckupSettings = {
        enabled: draft.enabled,
        items: draft.items
          .map((it) => ({
            ...it,
            title: it.title.trim(),
            detail: it.detail?.trim() || undefined,
          }))
          .filter((it) => it.title.length > 0),
      };
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalCheckup: cleaned }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", body.error ?? "Could not save settings.");
        return;
      }
      setDraft(cleaned);
      flash("saved", "Final check-up settings saved");
    } catch {
      flash("error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Quality"
        title="Final check-up"
        description="An acknowledgement dialog the cleaner must tap through before Submit & clock out — one item at a time, no skipping. Guest count and admin special-request tasks are added automatically per job."
      />

      <ECard className="space-y-5 p-5">
        <EToggle
          checked={draft.enabled}
          disabled={readOnly}
          onChange={(v) => setDraft((prev) => ({ ...prev, enabled: v }))}
          label="Enable the final check-up dialog"
          description="When off, cleaners submit without the acknowledgement walk-through (no gate)."
        />
      </ECard>

      <ECard className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[0.9375rem] font-semibold">Check-up items</h3>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Shown in this order. Leave the job-type selection empty to apply an item to every job
              type.
            </p>
          </div>
          {!readOnly ? (
            <EButton size="sm" variant="outline-gold" onClick={addItem}>
              <Plus className="h-4 w-4" /> Add item
            </EButton>
          ) : null}
        </div>

        {draft.items.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
            No items yet — only the automatic guest-count and admin-request items will appear (when
            enabled).
          </p>
        ) : null}

        <div className="space-y-4">
          {draft.items.map((item, idx) => (
            <div
              key={item.id}
              className="space-y-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-[0.75rem] font-[600] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                  Item {idx + 1}
                </p>
                {!readOnly ? (
                  <div className="flex items-center gap-1">
                    <EButton
                      size="icon"
                      variant="ghost"
                      disabled={idx === 0}
                      onClick={() => moveItem(item.id, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </EButton>
                    <EButton
                      size="icon"
                      variant="ghost"
                      disabled={idx === draft.items.length - 1}
                      onClick={() => moveItem(item.id, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </EButton>
                    <EButton
                      size="icon"
                      variant="ghost"
                      onClick={() => removeItem(item.id)}
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                    </EButton>
                  </div>
                ) : null}
              </div>

              <EField label="Title">
                <EInput
                  value={item.title}
                  disabled={readOnly}
                  placeholder="e.g. All bins emptied and relined"
                  onChange={(e) => patchItem(item.id, { title: e.target.value })}
                />
              </EField>
              <EField label="Detail (optional)">
                <ETextarea
                  value={item.detail ?? ""}
                  disabled={readOnly}
                  rows={2}
                  placeholder="What exactly should the cleaner double-check?"
                  onChange={(e) => patchItem(item.id, { detail: e.target.value })}
                />
              </EField>

              <div>
                <p className="mb-1.5 text-[0.8125rem] font-[550]">
                  Applies to{" "}
                  <span className="font-[400] text-[hsl(var(--e-text-faint))]">
                    (none selected = all job types)
                  </span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {JOB_TYPES.map(([value, label]) => {
                    const active = (item.appliesTo ?? []).includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={readOnly}
                        onClick={() => toggleJobType(item.id, value)}
                        className={`rounded-[var(--e-radius-pill)] border px-2.5 py-1 text-[0.75rem] font-[550] transition-colors disabled:opacity-60 ${
                          active
                            ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-foreground))]"
                            : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))] hover:border-[hsl(var(--e-gold)/0.5)]"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[0.8125rem] font-[550]">Reference images</p>
                <div className="flex flex-wrap items-center gap-2">
                  {item.referenceImageKeys.map((key) => (
                    <div key={key} className="relative">
                      <ReferenceThumb storageKey={key} />
                      {!readOnly ? (
                        <button
                          type="button"
                          onClick={() =>
                            patchItem(item.id, {
                              referenceImageKeys: item.referenceImageKeys.filter((k) => k !== key),
                            })
                          }
                          aria-label="Remove reference image"
                          className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-danger))] shadow"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {!readOnly ? (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 py-1.5 text-[0.75rem] hover:bg-[hsl(var(--e-muted))]">
                      {uploadingItemId === item.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <ImagePlus className="size-3.5" />
                      )}
                      {uploadingItemId === item.id ? "Uploading…" : "Upload image"}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        disabled={uploadingItemId !== null}
                        onChange={(e) => {
                          void uploadReferences(item.id, e.target.files);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>

        {uploadError ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{uploadError}</p>
        ) : null}
      </ECard>

      <div className="flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        {!readOnly ? (
          <EButton onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </EButton>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">
            Read-only — administrator access required to edit.
          </p>
        )}
      </div>
    </div>
  );
}
