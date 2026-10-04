"use client";
import { isDeviceException } from "@/lib/forms/device-status";

/**
 * ESTATE read-only form-submission review — renders the cleaner's submitted
 * job form (sections → answers → photos) exactly as the v1 job console does,
 * minus editing. Media thumbnails resolve fresh presigned URLs through
 * GET /api/uploads/access?key&jobId → { url } (stored URLs may have expired).
 * QA rework flags (field ids from the latest QA review) are surfaced inline.
 */

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { formatFieldValue, isUploadFieldType } from "@/lib/forms/field-types";
import { EBadge } from "@/components/v2/ui/primitives";
import { MediaGallery, type MediaGalleryItem } from "@/components/shared/media-gallery";

/* ── Serialized shapes (built server-side in the job detail page) ───────── */

export type SubmissionMediaRow = {
  id: string;
  fieldId: string;
  mediaType: string;
  url: string;
  s3Key: string;
  label: string | null;
};

export type SubmissionRow = {
  id: string;
  createdAt: string;
  data: Record<string, unknown>;
  laundryReady: boolean | null;
  laundryOutcome: string | null;
  bagLocation: string | null;
  autoQaScore: number | null;
  templateName: string;
  schema: { sections?: unknown } | null;
  submittedBy: string;
  media: SubmissionMediaRow[];
  stockTxs: { quantity: number; itemName: string }[];
};

/* ── Helpers (ported from the v1 job detail console) ────────────────────── */

function valuesEqual(left: unknown, right: unknown) {
  if (typeof left === "boolean") return left === (right === true || right === "true");
  if (typeof left === "number") return left === Number(right);
  if (typeof right === "boolean") return (left === true || left === "true") === right;
  if (typeof right === "number") return Number(left) === right;
  return String(left ?? "") === String(right ?? "");
}

function isConditionMet(
  conditional: { fieldId?: string; propertyField?: string; value?: unknown } | undefined,
  answers: Record<string, unknown>,
  property: Record<string, unknown>
) {
  if (!conditional || typeof conditional !== "object") return true;
  if (conditional.propertyField) return valuesEqual(property[conditional.propertyField], conditional.value);
  if (conditional.fieldId) return valuesEqual(answers[conditional.fieldId], conditional.value);
  return true;
}

function uploadCount(uploads: Record<string, unknown>, media: SubmissionMediaRow[], fieldId: string) {
  const raw = uploads[fieldId];
  if (typeof raw === "string") return raw.trim() ? 1 : 0;
  if (Array.isArray(raw)) return raw.filter((item) => typeof item === "string" && item.trim()).length;
  return media.filter((item) => item.fieldId === fieldId).length;
}

function checkboxMark(checked: boolean) {
  return checked ? "☑" : "☐";
}

function renderFieldValue(field: any, sub: SubmissionRow): string {
  const answers = sub.data && typeof sub.data === "object" ? sub.data : {};
  const uploads =
    (answers as any)?.uploads && typeof (answers as any).uploads === "object"
      ? ((answers as any).uploads as Record<string, unknown>)
      : {};

  if (isUploadFieldType(field.type)) {
    const count = uploadCount(uploads, sub.media, String(field.id));
    return count > 0 ? `${count} file(s) uploaded` : "Not uploaded";
  }
  if (field.type === "inventory") {
    const used = sub.stockTxs.filter((tx) => tx.quantity < 0);
    if (used.length === 0) return "No inventory used";
    return used.map((tx) => `${tx.itemName}: ${Math.abs(tx.quantity)}`).join(", ");
  }
  return formatFieldValue(field, (answers as Record<string, unknown>)[field.id]);
}

/* ── Presigned media set → shared lightbox overlay ──────────────────────────
 * Resolves fresh presigned URLs for every key in a media set (stored URLs may
 * have expired, same as AccessImage) then hands them to the shared MediaGallery
 * so photos + videos open in an in-page overlay with prev/next — never a new
 * tab. ─────────────────────────────────────────────────────────────────────── */

export function AccessMediaGallery({
  media,
  jobId,
  title,
  className = "grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8",
}: {
  media: Array<{ id: string; s3Key: string | null; url: string | null; label: string | null; mediaType?: string | null }>;
  jobId: string;
  title?: string;
  className?: string;
}) {
  const [urlByKey, setUrlByKey] = useState<Record<string, string>>({});
  const [accessError, setAccessError] = useState(false);
  const [reload, setReload] = useState(0);
  const keySig = JSON.stringify(Array.from(new Set(media.map((m) => m.s3Key).filter(Boolean))));

  useEffect(() => {
    let alive = true;
    let refreshVersion = 0;
    const keys: string[] = JSON.parse(keySig);
    setUrlByKey({});
    const refresh = async () => {
      const version = ++refreshVersion;
      const results = await Promise.all(keys.map(async (key) => {
        try {
          const response = await fetch(`/api/uploads/access?key=${encodeURIComponent(key)}&jobId=${encodeURIComponent(jobId)}`);
          if (!response.ok) throw new Error("Media access failed");
          const body = await response.json();
          if (typeof body.url !== "string" || !body.url) throw new Error("Missing media URL");
          return [key, body.url] as const;
        } catch { return null; }
      }));
      if (!alive || version !== refreshVersion) return;
      setAccessError(results.some((result) => result === null));
      setUrlByKey(Object.fromEntries(results.filter((result): result is readonly [string, string] => result !== null)));
    };
    void refresh();
    // Access URLs last ten minutes; renew before expiry and after tab sleep.
    const timer = window.setInterval(() => { void refresh(); }, 8 * 60_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [keySig, jobId, reload]);

  const items: MediaGalleryItem[] = media
    .map((m) => ({
      id: m.id,
      url: (m.s3Key ? urlByKey[m.s3Key] : undefined) ?? m.url ?? "",
      label: m.label ?? undefined,
      mediaType: m.mediaType ?? undefined,
    }))
    .filter((it) => it.url.length > 0);

  const reloadMedia = () => setReload((value) => value + 1);
  return <>
    {accessError ? <div role="alert" className="mb-2 text-sm">Some media could not be loaded. <button type="button" className="underline" onClick={reloadMedia}>Reload media</button></div> : null}
    <MediaGallery items={items} title={title ?? "Submission media"} className={className} onReload={reloadMedia} />
  </>;

}

/* ── Submission review card body ────────────────────────────────────────── */

export function SubmissionReview({
  jobId,
  submissions,
  property,
  reworkFlags,
}: {
  jobId: string;
  submissions: SubmissionRow[];
  /** Plain property record — used by conditional sections/fields. */
  property: Record<string, unknown>;
  /** Field ids flagged for rework in the latest QA review (may be empty). */
  reworkFlags: string[];
}) {
  if (submissions.length === 0) {
    return (
      <p className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-6 text-center text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        The cleaner has not submitted a job form yet.
      </p>
    );
  }

  const flagged = new Set(reworkFlags);

  return (
    <div className="space-y-4">
      {submissions.map((sub) => {
        const answers = sub.data && typeof sub.data === "object" ? sub.data : {};
        const sections = Array.isArray((sub.schema as any)?.sections) ? ((sub.schema as any).sections as any[]) : [];
        const reworkLabels: string[] = [];
        const fieldLabels = new Map<string, string>();
        for (const section of sections) {
          for (const field of Array.isArray(section?.fields) ? section.fields : []) {
            if (field?.id && field?.label) fieldLabels.set(String(field.id), String(field.label));
            if (flagged.has(String(field?.id))) reworkLabels.push(String(field?.label ?? field?.id));
          }
        }

        return (
          <div key={sub.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.4)] px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[0.8125rem] font-[550]">{sub.templateName}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  By {sub.submittedBy} · {format(new Date(sub.createdAt), "dd MMM yyyy HH:mm")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {sub.autoQaScore != null ? (
                  <EBadge tone="neutral" soft>Auto QA {Math.round(sub.autoQaScore)}</EBadge>
                ) : null}
                {sub.laundryReady !== null ? (
                  <EBadge tone={sub.laundryReady ? "success" : "warning"} soft>
                    Laundry {sub.laundryReady ? "ready" : "not ready"}
                  </EBadge>
                ) : null}
                {sub.laundryOutcome ? <EBadge tone="info" soft>{sub.laundryOutcome}</EBadge> : null}
              </div>
            </div>

            <div className="space-y-4 px-3 py-3">
              {sub.bagLocation ? (
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Bag location: {sub.bagLocation}</p>
              ) : null}

              {/* Rework flags from the latest QA review */}
              {reworkLabels.length > 0 ? (
                <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger)/0.06)] px-3 py-2.5">
                  <p className="text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-danger))]">
                    QA rework items
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                    {reworkLabels.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* All submission media, batch preview */}
              {sub.media.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-text-faint))]">
                    Submission media
                  </p>
                  <AccessMediaGallery media={sub.media.map((item) => ({ ...item, label: fieldLabels.get(item.fieldId) ?? item.label }))} jobId={jobId} title="Submission media" />

                </div>
              ) : null}

              {/* Sections → answers */}
              {sections
                .filter((section: any) => isConditionMet(section?.conditional, answers as any, property))
                .map((section: any) => {
                  const fields = (Array.isArray(section?.fields) ? section.fields : []).filter((field: any) =>
                    isConditionMet(field?.conditional, answers as any, property)
                  );
                  if (fields.length === 0) return null;
                  return (
                    <div key={section.id} className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
                      <div className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.4)] px-3 py-2 text-[0.8125rem] font-[550]">
                        {section.label}
                      </div>
                      <div className="divide-y divide-[hsl(var(--e-border))]">
                        {fields.map((field: any) => {
                          const isCheckbox = field.type === "checkbox" && !isDeviceException((answers as Record<string, unknown>)[field.id]);
                          const checked = isCheckbox && (answers as Record<string, unknown>)[field.id] === true;
                          const label = isCheckbox
                            ? `${checkboxMark(checked)} ${String(field.label ?? field.id ?? "Checklist item")}`
                            : String(field.label ?? field.id ?? "Checklist item");
                          const value = renderFieldValue(field, sub);
                          const mediaForField = sub.media.filter((m) => m.fieldId === field.id);
                          const isFlagged = flagged.has(String(field.id));
                          return (
                            <div key={field.id} className="px-3 py-2">
                              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                                  {label}
                                  {isFlagged ? (
                                    <span className="ml-2 align-middle"><EBadge tone="danger" soft>Rework</EBadge></span>
                                  ) : null}
                                </p>
                                {!isCheckbox ? (
                                  <p className="text-[0.8125rem] font-[550]">{value}</p>
                                ) : null}
                              </div>
                              {mediaForField.length > 0 ? (
                                <div className="mt-2">
                                  <AccessMediaGallery
                                    media={mediaForField.map((item) => ({ ...item, label: fieldLabels.get(item.fieldId) ?? item.label }))}
                                    jobId={jobId}
                                    title={String(field.label ?? field.id ?? "Field media")}
                                    className="grid grid-cols-4 gap-2 sm:grid-cols-6"
                                  />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
