"use client";

/**
 * Evidence pieces of the QA issue detail, moved unchanged in behaviour from
 * the old QA issues workspace: the QA / before / after photo strips (presigned
 * through /api/uploads/access, scoped to the issue's job) and the
 * rectification photo picker (POST /api/uploads/direct, folder
 * "qa-rectification").
 */
import * as React from "react";
import { ImagePlus, X } from "lucide-react";

export type PickedPhoto = { key: string; name: string };

export async function uploadRectificationPhoto(file: File): Promise<PickedPhoto> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "qa-rectification");
  const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body: unknown = await res.json().catch(() => ({}));
  const record = (body ?? {}) as { key?: unknown; error?: unknown };
  if (!res.ok || typeof record.key !== "string" || !record.key) {
    throw new Error(typeof record.error === "string" ? record.error : "Could not upload that photo.");
  }
  return { key: record.key, name: file.name };
}

/** Presigned urls for evidence keys; a late answer for another issue is dropped. */
export function useEvidenceUrls(keys: string[], jobId: string): Record<string, string> {
  const [urls, setUrls] = React.useState<Record<string, string>>({});
  const signature = keys.join("|");
  React.useEffect(() => {
    const controller = new AbortController();
    setUrls({});
    for (const key of signature ? signature.split("|") : []) {
      fetch(`/api/uploads/access?key=${encodeURIComponent(key)}&jobId=${encodeURIComponent(jobId)}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: unknown) => {
          if (controller.signal.aborted) return;
          const url = (body as { url?: unknown } | null)?.url;
          if (typeof url === "string") setUrls((previous) => ({ ...previous, [key]: url }));
        })
        .catch(() => {});
    }
    return () => controller.abort();
  }, [signature, jobId]);
  return urls;
}

/** Thumbnails; the placeholder holds the slot so the strip does not reflow. */
export function EvidenceStrip({ keys, urls, alt }: { keys: string[]; urls: Record<string, string>; alt: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {keys.map((key) =>
        urls[key] ? (
          <a key={key} href={urls[key]} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={urls[key]}
              alt={alt}
              className="h-20 w-20 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] object-cover"
            />
          </a>
        ) : (
          <div key={key} className="h-20 w-20 animate-pulse rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-muted))]" />
        ),
      )}
    </div>
  );
}

/**
 * Names, not thumbnails: a freshly uploaded key is only viewable through the
 * presigned access rail, which resolves from the SAVED issue.
 */
export function PhotoPicker({
  label,
  items,
  uploading,
  disabled,
  onFiles,
  onRemove,
}: {
  label: string;
  items: PickedPhoto[];
  uploading: boolean;
  disabled?: boolean;
  onFiles: (files: FileList | null) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[0.625rem] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">{label}</p>
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] px-2.5 py-1.5 text-[0.75rem] font-[550] focus-within:ring-2 focus-within:ring-[hsl(var(--e-ring))] hover:bg-[hsl(var(--e-muted))]">
        <ImagePlus aria-hidden className="h-3.5 w-3.5" />
        {uploading ? "Uploading…" : "Add photos"}
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={disabled}
          className="sr-only"
          onChange={(event) => {
            onFiles(event.target.files);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item, index) => (
            <li
              key={item.key}
              className="inline-flex max-w-[170px] items-center gap-1 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2 py-1 text-[0.6875rem]"
            >
              <span className="truncate">{item.name}</span>
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                disabled={disabled}
                onClick={() => onRemove(index)}
                className="text-[hsl(var(--e-danger))]"
              >
                <X aria-hidden className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
