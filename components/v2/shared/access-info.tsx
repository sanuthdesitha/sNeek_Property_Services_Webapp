"use client";

/**
 * ESTATE — native property access-instructions renderer (v2 port of the v1
 * `components/shared/access-instructions-panel.tsx`). Understands the same
 * stored `property.accessInfo` JSON shape:
 *   { instructions?, lockbox?, codes?, parking?, other?,
 *     attachments?: [{ id?, url, label?/name?, type?/mediaType? }],
 *     sections?: [{ id?, category?, title?, instructions?, code?, photos?: [{ url, label? }] }],
 *     pdfUrl? }
 * Zero v1 imports — Estate tokens only.
 */
import * as React from "react";
import { ChevronDown, ChevronUp, FileText, KeyRound } from "lucide-react";

type AccessAttachment = { id: string; url: string; label: string; isVideo: boolean };
type AccessSection = {
  id: string;
  title: string;
  instructions: string;
  code: string;
  photos: AccessAttachment[];
};

const ACCESS_CATEGORY_LABELS: Record<string, string> = {
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

function normalize(accessInfo: unknown) {
  if (!accessInfo || typeof accessInfo !== "object" || Array.isArray(accessInfo)) return null;
  const info = accessInfo as Record<string, any>;

  const attachments: AccessAttachment[] = Array.isArray(info.attachments)
    ? info.attachments
        .filter((item: any) => item?.url)
        .map((item: any, index: number) => ({
          id: String(item.id ?? `access-${index}`),
          url: String(item.url),
          label: String(item.label || item.name || "Access attachment"),
          isVideo: String(item.type || item.mediaType || "PHOTO").toUpperCase().includes("VIDEO"),
        }))
    : [];

  const textRows = [
    info.instructions ? { label: "Instructions", value: String(info.instructions) } : null,
    info.lockbox ? { label: "Lockbox", value: String(info.lockbox) } : null,
    info.codes ? { label: "Codes", value: String(info.codes) } : null,
    info.parking ? { label: "Parking", value: String(info.parking) } : null,
    info.other ? { label: "Other", value: String(info.other) } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const sections: AccessSection[] = Array.isArray(info.sections)
    ? (info.sections
        .map((s: any, idx: number): AccessSection | null => {
          if (!s || typeof s !== "object") return null;
          const photos: AccessAttachment[] = Array.isArray(s.photos)
            ? s.photos
                .filter((p: any) => p?.url)
                .map((p: any, i: number) => ({
                  id: String(p.id ?? `sec-${idx}-${i}`),
                  url: String(p.url),
                  label: String(p.label || s.title || "Access photo"),
                  isVideo: false,
                }))
            : [];
          const title =
            typeof s.title === "string" && s.title.trim()
              ? s.title.trim()
              : ACCESS_CATEGORY_LABELS[String(s.category ?? "OTHER")] ?? "Access point";
          const instructions = typeof s.instructions === "string" ? s.instructions.trim() : "";
          const code = typeof s.code === "string" ? s.code.trim() : "";
          if (!instructions && !code && photos.length === 0 && !title) return null;
          return { id: String(s.id ?? `section-${idx}`), title, instructions, code, photos };
        })
        .filter(Boolean) as AccessSection[])
    : [];

  const pdfUrl = typeof info.pdfUrl === "string" && info.pdfUrl.trim() ? info.pdfUrl.trim() : null;

  if (textRows.length === 0 && attachments.length === 0 && sections.length === 0 && !pdfUrl) return null;
  return { textRows, attachments, sections, pdfUrl };
}

function MediaStrip({ items }: { items: AccessAttachment[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {items.map((m) => (
        <a
          key={m.id}
          href={m.url}
          target="_blank"
          rel="noreferrer"
          title={m.label}
          className="block aspect-square overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]"
        >
          {m.isVideo ? (
            <video src={m.url} className="h-full w-full object-cover" muted playsInline />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.url} alt={m.label} className="h-full w-full object-cover" />
          )}
        </a>
      ))}
    </div>
  );
}

/**
 * Collapsible access instructions block. Renders nothing when the accessInfo
 * payload is empty/unusable (same behaviour as the v1 panel).
 */
export function EAccessInfo({
  accessInfo,
  title = "Property access instructions",
  defaultOpen = false,
  className,
  excludeTexts,
}: {
  accessInfo: unknown;
  title?: string;
  defaultOpen?: boolean;
  className?: string;
  /**
   * Text already shown elsewhere (e.g. the canonical access guide) — any flat
   * row/section whose text overlaps one of these is dropped so access never
   * renders twice. When everything is deduped away the block renders nothing.
   */
  excludeTexts?: string[];
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const base = React.useMemo(() => normalize(accessInfo), [accessInfo]);
  const data = React.useMemo(() => {
    if (!base) return null;
    const excluded = (excludeTexts ?? [])
      .map((t) => t.toLowerCase().replace(/\s+/g, " ").trim())
      .filter((t) => t.length > 2);
    if (excluded.length === 0) return base;
    const overlaps = (value: string) => {
      const v = value.toLowerCase().replace(/\s+/g, " ").trim();
      if (v.length <= 2) return false;
      return excluded.some((e) => e.includes(v) || v.includes(e));
    };
    const textRows = base.textRows.filter((row) => !overlaps(row.value));
    const sections = base.sections.filter(
      (s) => !overlaps([s.title, s.code, s.instructions].filter(Boolean).join(" "))
    );
    if (textRows.length === 0 && sections.length === 0 && base.attachments.length === 0 && !base.pdfUrl) {
      return null;
    }
    return { ...base, textRows, sections };
  }, [base, excludeTexts]);
  if (!data) return null;

  return (
    <div
      className={`rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-[600] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">
          <KeyRound className="h-3.5 w-3.5" />
          {title}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
        ) : (
          <ChevronDown className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
        )}
      </button>

      {open ? (
        <div className="space-y-3 border-t border-[hsl(var(--e-border))] px-3 py-3">
          {data.textRows.length > 0 ? (
            <dl className="space-y-1.5">
              {data.textRows.map((row) => (
                <div key={row.label}>
                  <dt className="text-[0.6875rem] font-[550] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                    {row.label}
                  </dt>
                  <dd className="whitespace-pre-wrap break-words text-[0.8125rem] text-[hsl(var(--e-foreground))]">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {data.sections.map((s) => (
            <div
              key={s.id}
              className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2.5"
            >
              <p className="text-[0.8125rem] font-[600]">{s.title}</p>
              {s.code ? (
                <p className="text-[0.8125rem]">
                  <span className="text-[hsl(var(--e-muted-foreground))]">Code: </span>
                  <span className="font-[600] tabular-nums">{s.code}</span>
                </p>
              ) : null}
              {s.instructions ? (
                <p className="whitespace-pre-wrap text-[0.8125rem] text-[hsl(var(--e-foreground))]">{s.instructions}</p>
              ) : null}
              <MediaStrip items={s.photos} />
            </div>
          ))}

          <MediaStrip items={data.attachments} />

          {data.pdfUrl ? (
            <a
              href={data.pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] hover:underline"
            >
              <FileText className="h-4 w-4" /> Access instructions PDF
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
