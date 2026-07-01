"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, FileText, KeyRound } from "lucide-react";
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

  // Structured per-location sections (cupboard / lockbox / entrance / bin / laundry…).
  const sections = Array.isArray(info.sections)
    ? info.sections
        .map((s: any, idx: number): AccessSection | null => {
          if (!s || typeof s !== "object") return null;
          const photos: AccessAttachment[] = Array.isArray(s.photos)
            ? s.photos
                .filter((p: any) => p?.url)
                .map((p: any, i: number) => ({
                  id: p.id ?? `sec-${idx}-${i}`,
                  url: p.url,
                  label: p.label || s.title || "Access photo",
                  mediaType: "PHOTO",
                }))
            : [];
          const title = typeof s.title === "string" && s.title.trim() ? s.title.trim() : ACCESS_CATEGORY_LABELS[s.category] ?? "Access point";
          const instructions = typeof s.instructions === "string" ? s.instructions.trim() : "";
          const code = typeof s.code === "string" ? s.code.trim() : "";
          if (!instructions && !code && photos.length === 0 && !title) return null;
          return { id: s.id ?? `section-${idx}`, category: String(s.category ?? "OTHER"), title, instructions, code, photos };
        })
        .filter(Boolean) as AccessSection[]
    : [];

  const pdfUrl = typeof info.pdfUrl === "string" && info.pdfUrl.trim() ? info.pdfUrl.trim() : null;

  if (textRows.length === 0 && attachments.length === 0 && sections.length === 0 && !pdfUrl) return null;
  return { textRows, attachments, sections, pdfUrl };
}

export const ACCESS_CATEGORY_LABELS: Record<string, string> = {
  CLEANERS_CUPBOARD: "Cleaner's cupboard",
  LOCKBOX: "Lockbox",
  MAIN_ENTRANCE: "Main entrance",
  BIN_ROOM: "Bin room",
  LAUNDRY_DROPOFF: "Laundry drop-off",
  LAUNDRY_PICKUP: "Laundry pickup",
  PARKING: "Parking",
  WIFI: "Wi-Fi",
  OTHER: "Other",
};

type AccessSection = {
  id: string;
  category: string;
  title: string;
  instructions: string;
  code: string;
  photos: AccessAttachment[];
};

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
              {content.sections.length > 0 ? `${content.sections.length} location${content.sections.length === 1 ? "" : "s"} · ` : ""}
              {content.textRows.length} note{content.textRows.length === 1 ? "" : "s"}
              {content.attachments.length > 0
                ? ` · ${content.attachments.length} file${content.attachments.length === 1 ? "" : "s"}`
                : ""}
              {imageCount > 0 ? ` · ${imageCount} image${imageCount === 1 ? "" : "s"}` : ""}
              {content.pdfUrl ? " · PDF guide" : ""}
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

      {content.pdfUrl ? (
        <a
          href={content.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-white"
        >
          <FileText className="h-3.5 w-3.5" /> View / download full access guide (PDF)
        </a>
      ) : null}

      {expanded ? (
        <div className="mt-3 space-y-3">
          {content.sections.length > 0 ? (
            <div className="space-y-2.5">
              {content.sections.map((section) => (
                <div key={section.id} className="rounded-lg border border-amber-200/80 bg-white/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
                      {ACCESS_CATEGORY_LABELS[section.category] ?? section.category}
                    </p>
                    {section.code ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-xs font-bold text-amber-900">{section.code}</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-sm font-semibold text-amber-950">{section.title}</p>
                  {section.instructions ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-amber-950">{section.instructions}</p>
                  ) : null}
                  {section.photos.length > 0 ? (
                    <MediaGallery items={section.photos} title={section.title} className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4" />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
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
