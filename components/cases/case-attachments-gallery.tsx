"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type GalleryAttachment = {
  id: string;
  url: string;
  label: string | null;
  mimeType: string | null;
  meta: string;
};

function isImageAttachment(attachment: GalleryAttachment) {
  const mime = attachment.mimeType?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return true;
  const url = attachment.url.toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"].some((ext) =>
    url.includes(ext)
  );
}

export function CaseAttachmentsGallery({
  attachments,
  emptyText,
}: {
  attachments: GalleryAttachment[];
  emptyText: string;
}) {
  const [activeId, setActiveId] = useState("");

  const active = useMemo(
    () => attachments.find((attachment) => attachment.id === activeId) ?? null,
    [activeId, attachments]
  );

  if (attachments.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {attachments.map((attachment) => {
          const isImage = isImageAttachment(attachment);
          if (!isImage) {
            return (
              <a
                key={attachment.id}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border p-3 text-sm hover:bg-muted/50"
              >
                <p className="font-medium">{attachment.label || attachment.mimeType || "Attachment"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{attachment.meta}</p>
              </a>
            );
          }

          return (
            <button
              key={attachment.id}
              type="button"
              className="overflow-hidden rounded-xl border text-left transition hover:bg-muted/40"
              onClick={() => setActiveId(attachment.id)}
            >
              <div className="aspect-[4/3] w-full bg-muted">
                <img
                  src={attachment.url}
                  alt={attachment.label || "Case attachment"}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="space-y-1 p-3 text-sm">
                <p className="font-medium">{attachment.label || "Image attachment"}</p>
                <p className="text-xs text-muted-foreground">{attachment.meta}</p>
              </div>
            </button>
          );
        })}
      </div>

      <Dialog open={Boolean(active)} onOpenChange={(open) => !open && setActiveId("")}>
        <DialogContent className="max-w-5xl">
          {active ? (
            <div className="space-y-4">
              <DialogHeader>
                <DialogTitle>{active.label || active.mimeType || "Attachment preview"}</DialogTitle>
              </DialogHeader>
              <div className="overflow-hidden rounded-xl border bg-muted">
                <img
                  src={active.url}
                  alt={active.label || "Case attachment preview"}
                  className="max-h-[75vh] w-full object-contain"
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">{active.meta}</p>
                <Button asChild variant="outline">
                  <a href={active.url} target="_blank" rel="noreferrer">
                    Open original
                  </a>
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
