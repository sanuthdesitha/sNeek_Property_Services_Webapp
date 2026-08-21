"use client";

/**
 * Estate thumbnail strip for already-resolved S3 evidence ({ key, url }).
 * Extracted so a receipt or a rectification photo looks the same wherever it
 * surfaces — admin finance, the approval queue and the payee's own view all
 * render one attachment set, and a divergent copy per screen is how evidence
 * ends up visible on one screen and invisible on the next.
 *
 * Resolving keys → urls stays with the caller: some rails use the public S3
 * base (finance) and others a presigned per-job url (QA), and that choice is
 * an access decision, not a presentation one.
 */
import { FileText } from "lucide-react";

export type EvidenceThumbItem = { key: string; url: string };

// Documents can't thumbnail, so they link out instead. Same extension list the
// finance workspace uses; an unknown extension is treated as an image because
// presigned urls often carry no clean extension at all.
const DOC_EXT = ["pdf", "doc", "docx", "xls", "xlsx", "csv", "zip"];

function isDocument(url: string): boolean {
  const clean = url.split("?")[0].split("#")[0];
  const match = /\.([a-z0-9]+)$/i.exec(clean);
  return match ? DOC_EXT.includes(match[1].toLowerCase()) : false;
}

export function EvidenceThumbs({
  items,
  alt = "Attached evidence",
  docLabel = "Open file",
}: {
  items: EvidenceThumbItem[];
  alt?: string;
  docLabel?: string;
}) {
  // Nothing attached means no strip at all — an empty frame reads as a
  // loading failure rather than as "there was never anything here".
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) =>
        isDocument(item.url) ? (
          <a
            key={item.key}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2 text-[0.8125rem] transition-colors hover:bg-[hsl(var(--e-muted))]"
          >
            <FileText className="h-3.5 w-3.5" />
            {docLabel}
          </a>
        ) : (
          <a
            key={item.key}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            title="Open full size in a new tab"
            className="block overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={alt} loading="lazy" className="h-20 w-20 object-cover" />
          </a>
        )
      )}
    </div>
  );
}
