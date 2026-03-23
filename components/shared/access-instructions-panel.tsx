"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaGallery } from "@/components/shared/media-gallery";

type AccessAttachment = {
  id: string;
  url: string;
  label?: string;
  mediaType?: string;
};

type AccessInfoRecord = Record<string, any>;

function normalizeAccessInfo(accessInfo: unknown) {
  if (!accessInfo || typeof accessInfo !== "object" || Array.isArray(accessInfo)) return null;
  const info = accessInfo as AccessInfoRecord;
  const attachments = Array.isArray(info.attachments)
    ? info.attachments
        .filter((item: any) => item?.url)
        .map(
          (item: any, index: number): AccessAttachment => ({
            id: item.id ?? `access-${index}`,
            url: item.url,
            label: item.label || item.name || "Access attachment",
            mediaType: String(item.type || item.mediaType || "PHOTO")
              .toUpperCase()
              .includes("VIDEO")
              ? "VIDEO"
              : "PHOTO",
          })
        )
    : [];

  const textRows = [
    info.instructions ? { label: "Instructions", value: String(info.instructions) } : null,
    info.lockbox ? { label: "Lockbox", value: String(info.lockbox) } : null,
    info.codes ? { label: "Codes", value: String(info.codes) } : null,
    info.parking ? { label: "Parking", value: String(info.parking) } : null,
    info.other ? { label: "Other", value: String(info.other) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (textRows.length === 0 && attachments.length === 0) return null;
  return { textRows, attachments };
}

export function AccessInstructionsPanel({
  accessInfo,
  title = "Access Instructions",
  className = "",
}: {
  accessInfo: unknown;
  title?: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const content = useMemo(() => normalizeAccessInfo(accessInfo), [accessInfo]);

  if (!content) return null;

  const imageCount = content.attachments.filter(
    (item) => (item.mediaType ?? "").toUpperCase() === "PHOTO"
  ).length;

  return (
    <div className={`rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-950 ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-amber-800" />
          <div>
            <p className="font-semibold uppercase tracking-[0.14em] text-amber-800">{title}</p>
            <p className="text-[11px] text-amber-900/80">
              {content.textRows.length} note{content.textRows.length === 1 ? "" : "s"}
              {content.attachments.length > 0
                ? ` · ${content.attachments.length} file${content.attachments.length === 1 ? "" : "s"}`
                : ""}
              {imageCount > 0 ? ` · ${imageCount} image${imageCount === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-amber-300 bg-white/70 text-amber-900 hover:bg-white"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? (
            <>
              <ChevronUp className="mr-1 h-4 w-4" />
              Hide
            </>
          ) : (
            <>
              <ChevronDown className="mr-1 h-4 w-4" />
              View
            </>
          )}
        </Button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3">
          <div className="space-y-2">
            {content.textRows.map((row) => (
              <div key={row.label} className="rounded-lg border border-amber-200/70 bg-white/55 p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                  {row.label}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-amber-950">
                  {row.value}
                </p>
              </div>
            ))}
          </div>

          {content.attachments.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                Access References
              </p>
              <MediaGallery
                items={content.attachments}
                title={title}
                className="grid grid-cols-3 gap-2 sm:grid-cols-4"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
