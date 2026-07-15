"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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

/** File extension with any query string / hash stripped (presigned S3 URLs
 *  carry `?X-Amz-…`, so a naive end-of-string test would never match). */
function extOf(url: string): string {
  const clean = url.split("?")[0].split("#")[0];
  const m = /\.([a-z0-9]+)$/i.exec(clean);
  return m ? m[1].toLowerCase() : "";
}

const VIDEO_EXT = ["mp4", "mov", "webm", "m4v", "avi", "3gp", "mkv", "ogv"];
const DOC_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "csv", "zip"];

function isVideo(item: MediaGalleryItem): boolean {
  if ((item.mediaType ?? "").toUpperCase().includes("VIDEO")) return true;
  return VIDEO_EXT.includes(extOf(item.url));
}

/** Non-viewable attachments (PDFs/office docs) link out; everything else that
 *  isn't a video is treated as an image — presigned URLs often lack a clean
 *  extension, so unknowns default to the image lightbox rather than a link. */
function isDocument(item: MediaGalleryItem): boolean {
  const mt = (item.mediaType ?? "").toUpperCase();
  if (mt.includes("PDF") || mt.includes("DOC")) return true;
  return DOC_EXT.includes(extOf(item.url));
}

function isImage(item: MediaGalleryItem): boolean {
  return !isVideo(item) && !isDocument(item);
}

/** Photos + videos open in the lightbox; documents (e.g. PDFs) link out. */
function isViewable(item: MediaGalleryItem): boolean {
  return isImage(item) || isVideo(item);
}

export function MediaGallery({
  items,
  emptyText = "No media",
  title = "Image Preview",
  className = "grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5",
}: MediaGalleryProps) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  // The carousel spans every viewable item (photos + videos), in order.
  const mediaItems = useMemo(() => items.filter(isViewable), [items]);
  const otherItems = useMemo(() => items.filter((item) => !isViewable(item)), [items]);

  const count = mediaItems.length;
  const current = count > 0 ? mediaItems[Math.min(index, count - 1)] : null;

  const go = useCallback(
    (delta: number) => {
      setIndex((i) => {
        if (count === 0) return 0;
        return (i + delta + count) % count; // wrap around
      });
    },
    [count]
  );

  function openImage(i: number) {
    setIndex(i);
    setOpen(true);
  }

  // Keyboard arrows while the lightbox is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  // Touch swipe.
  const touchStartX = useRef<number | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    touchStartX.current = null;
  }

  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  }

  return (
    <>
      {mediaItems.length > 0 && (
        <div className={className}>
          {mediaItems.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className="relative overflow-hidden rounded-md border bg-muted/20 text-left"
              onClick={() => openImage(i)}
              title={item.label ?? (isVideo(item) ? "Play video" : "View image")}
            >
              {isVideo(item) ? (
                <>
                  <video
                    src={item.url}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-20 w-full object-cover"
                  />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="rounded-full bg-black/55 p-1.5 text-white shadow">
                      <Play className="h-4 w-4" />
                    </span>
                  </span>
                </>
              ) : (
                <img src={item.url} alt={item.label ?? "Submission image"} className="h-20 w-full object-cover" />
              )}
              {item.label ? (
                <div className="truncate border-t bg-white dark:bg-surface-raised px-2 py-1 text-[11px] text-muted-foreground">
                  {item.label}
                </div>
              ) : null}
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
          <DialogTitle className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{current?.label || title}</span>
            {count > 1 ? <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">{Math.min(index, count - 1) + 1} / {count}</span> : null}
          </DialogTitle>
          <div
            className="relative max-h-[75vh] overflow-hidden rounded-md border bg-black/5 p-2"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {current && (
              isVideo(current) ? (
                <video
                  key={current.id}
                  src={current.url}
                  controls
                  playsInline
                  className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md object-contain"
                />
              ) : (
                <img
                  src={current.url}
                  alt={current.label || "Preview"}
                  className="mx-auto max-h-[70vh] w-auto max-w-full select-none rounded-md object-contain"
                  draggable={false}
                />
              )
            )}
            {count > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous item"
                  onClick={() => go(-1)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white shadow hover:bg-black/75"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label="Next item"
                  onClick={() => go(1)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white shadow hover:bg-black/75"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
          </div>
          {count > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 pt-2">
              {mediaItems.map((item, i) => (
                <button
                  key={`thumb-${item.id}`}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`View item ${i + 1}`}
                  className={`relative shrink-0 overflow-hidden rounded-md border-2 ${i === Math.min(index, count - 1) ? "border-primary" : "border-transparent opacity-70"}`}
                >
                  {isVideo(item) ? (
                    <>
                      <video src={item.url} muted playsInline preload="metadata" className="h-12 w-12 object-cover" />
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <Play className="h-3.5 w-3.5 text-white drop-shadow" />
                      </span>
                    </>
                  ) : (
                    <img src={item.url} alt="" className="h-12 w-12 object-cover" />
                  )}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
