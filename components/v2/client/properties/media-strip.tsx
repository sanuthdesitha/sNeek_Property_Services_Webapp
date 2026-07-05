/**
 * Estate media strip — hairline thumbnail grid that opens each asset in a new
 * tab. Server-safe (no client hooks); replaces the v1 MediaGallery for the
 * Estate client portal.
 */
import { FileText, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type EMediaItem = {
  id: string;
  url: string;
  label?: string | null;
  mediaType?: string | null;
};

export function EMediaStrip({
  items,
  className,
  emptyText,
}: {
  items: EMediaItem[];
  className?: string;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return emptyText ? (
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{emptyText}</p>
    ) : null;
  }
  return (
    <div className={cn("grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6", className)}>
      {items.map((item) => {
        const type = (item.mediaType ?? "PHOTO").toUpperCase();
        const isVideo = type.includes("VIDEO");
        const isPdf = type.includes("PDF") || item.url.toLowerCase().endsWith(".pdf");
        return (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            title={item.label ?? undefined}
            className="group relative block aspect-square overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted))]"
          >
            {isVideo || isPdf ? (
              <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-[hsl(var(--e-muted-foreground))]">
                {isVideo ? <PlayCircle className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
                <span className="text-[0.625rem] font-medium uppercase tracking-[0.14em]">
                  {isVideo ? "Video" : "PDF"}
                </span>
              </span>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.url}
                alt={item.label ?? "Media"}
                className="h-full w-full object-cover transition-transform duration-[240ms] group-hover:scale-[1.04]"
                loading="lazy"
              />
            )}
          </a>
        );
      })}
    </div>
  );
}
