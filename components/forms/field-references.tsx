"use client";

import * as React from "react";
import { ExternalLink, Play } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { FormFieldReference } from "@/lib/forms/types";

export interface FieldReferencesProps {
  references: FormFieldReference[] | undefined;
  className?: string;
}

// Shows the admin-attached reference/example media to the person filling the
// form (cleaner / QA). Images open in a lightbox; videos and links open in a
// new tab. Assumes `url` is already resolved (the job-form API resolves any
// uploaded storageKey to a presigned URL before sending the template).
export function FieldReferences({ references, className }: FieldReferencesProps) {
  const [lightbox, setLightbox] = React.useState<string | null>(null);
  const items = (references ?? []).filter((ref) => ref.url);
  if (items.length === 0) return null;

  return (
    <div className={className}>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Reference
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((ref, idx) => {
          if (ref.kind === "image") {
            return (
              <button
                key={`${ref.url}-${idx}`}
                type="button"
                onClick={() => setLightbox(ref.url)}
                className="group relative size-16 overflow-hidden rounded-md border"
                title={ref.caption ?? "Reference image"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ref.url} alt={ref.caption ?? "Reference"} className="size-16 object-cover" />
              </button>
            );
          }
          if (ref.kind === "video") {
            return (
              <a
                key={`${ref.url}-${idx}`}
                href={ref.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1.5 text-xs hover:bg-muted"
              >
                <Play className="size-3.5" />
                {ref.caption?.trim() || "Watch example"}
              </a>
            );
          }
          return (
            <a
              key={`${ref.url}-${idx}`}
              href={ref.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1.5 text-xs hover:bg-muted"
            >
              <ExternalLink className="size-3.5" />
              {ref.caption?.trim() || "Open link"}
            </a>
          );
        })}
      </div>

      <Dialog open={Boolean(lightbox)} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-3xl">
          {lightbox ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lightbox} alt="Reference" className="max-h-[80vh] w-full rounded object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
