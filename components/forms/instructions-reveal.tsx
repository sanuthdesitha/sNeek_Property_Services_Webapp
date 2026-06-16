"use client";

import * as React from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { FormFieldReference } from "@/lib/forms/types";

/**
 * Parse a video URL into something playable INSIDE the popup. YouTube / Vimeo
 * become privacy-friendly iframe embeds; direct media files use a native
 * <video>; anything else falls back to an "open in new window" link.
 */
function resolveVideo(url: string): { kind: "youtube" | "vimeo" | "file" | "link"; src: string } {
  const u = url.trim();
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return { kind: "youtube", src: `https://www.youtube-nocookie.com/embed/${yt[1]}` };
  const vimeo = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { kind: "vimeo", src: `https://player.vimeo.com/video/${vimeo[1]}` };
  if (/\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(u)) return { kind: "file", src: u };
  return { kind: "link", src: u };
}

function VideoPlayer({ url, caption }: { url: string; caption?: string }) {
  const v = resolveVideo(url);
  return (
    <div className="space-y-1">
      {v.kind === "youtube" || v.kind === "vimeo" ? (
        <div className="relative w-full overflow-hidden rounded-lg border" style={{ paddingTop: "56.25%" }}>
          <iframe
            src={v.src}
            title={caption || "How-to video"}
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : v.kind === "file" ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={v.src} controls playsInline className="w-full rounded-lg border" />
      ) : (
        <a
          href={v.src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center gap-1.5 rounded-md border bg-muted/40 px-3 text-sm hover:bg-muted"
        >
          <ExternalLink className="size-4" />
          {caption?.trim() || "Watch video"}
        </a>
      )}
      <div className="flex items-center justify-between">
        {caption ? <span className="text-xs text-muted-foreground">{caption}</span> : <span />}
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
          <ExternalLink className="size-3" />
          Open in new window
        </a>
      </div>
    </div>
  );
}

export interface InstructionsRevealProps {
  /** Title shown on the reveal button + dialog (e.g. the item label). */
  title?: string;
  /** How-to text. */
  instructions?: string | null;
  /** Reference media (images + video + link). */
  references?: FormFieldReference[];
  className?: string;
}

/**
 * A compact "How to clean this" reveal. Shows nothing if there's no content.
 * Opens a popup with the instruction text, reference images, and any how-to
 * video playing INLINE (no new tab) — with an explicit open-in-new-window link.
 */
export function InstructionsReveal({ title, instructions, references, className }: InstructionsRevealProps) {
  const [open, setOpen] = React.useState(false);
  const refs = React.useMemo(() => (references ?? []).filter((r) => r.url), [references]);
  const images = refs.filter((r) => r.kind === "image");
  const videos = refs.filter((r) => r.kind === "video");
  const links = refs.filter((r) => r.kind === "link");
  const text = (instructions ?? "").trim();

  if (!text && refs.length === 0) return null;

  return (
    <div className={className}>
      <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs text-primary hover:bg-primary/5" onClick={() => setOpen(true)}>
        <BookOpen className="mr-1.5 size-3.5" />
        How to clean this{videos.length > 0 ? " · video" : ""}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title?.trim() || "How to clean this"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {text ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{text}</p> : null}

            {videos.map((v, i) => (
              <VideoPlayer key={`v-${i}`} url={v.url} caption={v.caption ?? undefined} />
            ))}

            {images.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {images.map((img, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={`i-${i}`} src={img.url} alt={img.caption ?? "Reference"} className="h-28 w-full rounded-md border object-cover" />
                ))}
              </div>
            ) : null}

            {links.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {links.map((l, i) => (
                  <a key={`l-${i}`} href={l.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-muted/40 px-3 text-sm hover:bg-muted">
                    <ExternalLink className="size-4" />
                    {l.caption?.trim() || "Open link"}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
