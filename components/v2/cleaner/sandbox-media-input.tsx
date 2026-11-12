"use client";

/**
 * Stand-in for the camera / file capture when the cleaner form is rendered as
 * an admin preview or "Test as cleaner". It never opens the camera, never
 * uploads and never creates evidence: it only counts pretend files so the
 * same validation (minimum photos, maximum files, required uploads) can run.
 */
import * as React from "react";
import { Camera, Minus, Plus } from "lucide-react";
import type { CapturedMedia } from "@/components/v2/cleaner/media-capture";

export function SandboxMediaInput({
  fieldId,
  label,
  value,
  onChange,
  minPhotos,
  maxFiles,
  kind,
  interactive,
}: {
  fieldId: string;
  label: string;
  value: CapturedMedia[];
  onChange: (media: CapturedMedia[]) => void;
  minPhotos?: number;
  maxFiles?: number;
  kind: CapturedMedia["kind"];
  /** False in the builder's read-only phone preview. */
  interactive: boolean;
}) {
  const count = value.length;
  const add = () => onChange([...value, { key: `sandbox/${fieldId}/${count + 1}`, url: "", kind, name: `Sample ${count + 1}` }]);
  const remove = () => onChange(value.slice(0, -1));
  const noun = kind === "file" ? "file" : kind === "video" ? "video" : "photo";
  return (
    <div className="space-y-1.5">
      {minPhotos ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          At least {minPhotos} {noun}
          {minPhotos === 1 ? "" : "s"}
          {maxFiles ? ` · at most ${maxFiles}` : ""}
        </p>
      ) : null}
      <div className="flex min-h-[3rem] items-center justify-between gap-2 rounded-[var(--e-radius)] border-[1.5px] border-dashed border-[hsl(var(--e-border-strong))] px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <Camera className="h-4 w-4" aria-hidden="true" />
          {interactive ? `${count} sample ${noun}${count === 1 ? "" : "s"} (nothing is uploaded)` : `Camera opens here`}
        </span>
        {interactive ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={remove}
              disabled={count === 0}
              aria-label={`Remove a sample ${noun} from ${label}`}
              className="flex h-8 w-8 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={add}
              aria-label={`Add a sample ${noun} to ${label}`}
              className="flex h-8 w-8 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
