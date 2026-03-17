"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface MediaGalleryItem {
  id: string;
  url: string;
  label?: string;
  mediaType?: string;
}

interface MediaGalleryProps {
  items: MediaGalleryItem[];
  emptyText?: string;
  title?: string;
  className?: string;
}

function isImage(item: MediaGalleryItem): boolean {
  if ((item.mediaType ?? "").toUpperCase() === "PHOTO") return true;
  return /\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(item.url);
}

export function MediaGallery({
  items,
  emptyText = "No media",
  title = "Image Preview",
  className = "grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5",
}: MediaGalleryProps) {
  const [open, setOpen] = useState(false);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");

  const imageItems = useMemo(() => items.filter(isImage), [items]);
  const otherItems = useMemo(() => items.filter((item) => !isImage(item)), [items]);

  function openImage(item: MediaGalleryItem) {
    setSelectedUrl(item.url);
    setSelectedLabel(item.label ?? "Image");
    setOpen(true);
  }

  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  }

  return (
    <>
      {imageItems.length > 0 && (
        <div className={className}>
          {imageItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="overflow-hidden rounded-md border bg-muted/20"
              onClick={() => openImage(item)}
              title={item.label ?? "View image"}
            >
              <img src={item.url} alt={item.label ?? "Submission image"} className="h-20 w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {otherItems.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {otherItems.map((item) => (
            <Button key={item.id} variant="outline" size="sm" asChild>
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.label ?? "Open file"}
              </a>
            </Button>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[75vh] overflow-auto rounded-md border bg-black/5 p-2">
            {selectedUrl && (
              <img src={selectedUrl} alt={selectedLabel || "Preview"} className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md object-contain" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
