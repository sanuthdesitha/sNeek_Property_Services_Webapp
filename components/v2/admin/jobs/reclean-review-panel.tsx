"use client";

/**
 * ESTATE reclean review — v2 port of app/admin/jobs/[id]/reclean-review: a
 * per-flagged-area BEFORE (QA guidance photos) / AFTER (cleaner's resubmission)
 * media grid so admins can verify a reclean without leaving the job detail.
 *
 * Data comes from GET /api/admin/jobs/[id] (already returns the full job record
 * including reworkAreas/reworkReason and submissions+media) — fetched here, not
 * threaded through page props, so the panel stays self-contained inside the
 * shared SubmissionReview card and the server page needs no changes. Media is
 * presigned client-side through the same /api/uploads/access flow every other
 * v2 admin gallery uses (admin/ops roles are unrestricted on that route).
 */

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Camera } from "lucide-react";
import { EBadge } from "@/components/v2/ui/primitives";
import { AccessMediaGallery } from "./submission-review";

/* lib/qa/rework-jobs owns these, but it imports sharp/db (server-only), so a
 * client component cannot import it. The prefix is a stable wire contract
 * (cleaner "after" uploads are keyed `rework_area_<areaId>`) and the normalizer
 * is a pure JSON coercion — both duplicated here verbatim on purpose. */
const REWORK_AREA_FIELD_PREFIX = "rework_area_";

type ReworkArea = {
  id: string;
  label: string;
  note?: string;
  photoKeys: string[];
};

function normalizeReworkAreas(input: unknown): ReworkArea[] {
  if (!Array.isArray(input)) return [];
  const out: ReworkArea[] = [];
  input.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const item = raw as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    if (!label) return;
    const id =
      typeof item.id === "string" && item.id.trim() ? item.id.trim() : `area-${index + 1}`;
    const note = typeof item.note === "string" ? item.note.trim() || undefined : undefined;
    const photoKeys = Array.isArray(item.photoKeys)
      ? item.photoKeys
          .filter((key): key is string => typeof key === "string" && key.trim().length > 0)
          .map((key) => key.trim())
      : [];
    out.push({ id, label, note, photoKeys });
  });
  return out;
}

/* QA guidance keys carry no MediaType row — infer video the same way the v1
 * reclean-review page did, from the file extension. */
const VIDEO_KEY_RE = /\.(mp4|mov|webm|m4v|avi|mkv)$/i;

type GalleryItem = {
  id: string;
  s3Key: string | null;
  url: string | null;
  label: string | null;
  mediaType?: string | null;
};

type RecleanState = {
  reworkReason: string | null;
  areas: ReworkArea[];
  afterByArea: Record<string, GalleryItem[]>;
  resubmittedAt: string | null;
  resubmittedBy: string | null;
};

export function RecleanReviewPanel({ jobId }: { jobId: string }) {
  const [state, setState] = useState<RecleanState | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch(`/api/admin/jobs/${jobId}`);
        if (!res.ok) return;
        const job = await res.json();
        // Non-rework jobs (the overwhelming majority) simply keep the panel
        // hidden — no error surface, the card renders as before.
        if (!alive || job?.isRework !== true) return;

        const areas = normalizeReworkAreas(job.reworkAreas);
        if (areas.length === 0) return;

        // Latest resubmission wins, matching the v1 page (take: 1, newest).
        const submissions: any[] = Array.isArray(job.formSubmissions) ? job.formSubmissions : [];
        const latest = [...submissions].sort(
          (a, b) => new Date(b?.createdAt ?? 0).getTime() - new Date(a?.createdAt ?? 0).getTime()
        )[0];

        const afterByArea: Record<string, GalleryItem[]> = {};
        const mediaRows: any[] = Array.isArray(latest?.media) ? latest.media : [];
        for (const m of mediaRows) {
          const fieldId = String(m?.fieldId ?? "");
          if (!fieldId.startsWith(REWORK_AREA_FIELD_PREFIX)) continue;
          const areaId = fieldId.slice(REWORK_AREA_FIELD_PREFIX.length);
          (afterByArea[areaId] ??= []).push({
            id: String(m?.id ?? `${fieldId}-${afterByArea[areaId]?.length ?? 0}`),
            s3Key: typeof m?.s3Key === "string" ? m.s3Key : null,
            url: typeof m?.url === "string" ? m.url : null,
            label: "After — cleaner re-did",
            mediaType: typeof m?.mediaType === "string" ? m.mediaType : null,
          });
        }

        setState({
          reworkReason: typeof job.reworkReason === "string" ? job.reworkReason : null,
          areas,
          afterByArea,
          resubmittedAt: latest?.createdAt ? String(latest.createdAt) : null,
          resubmittedBy: latest?.submittedBy?.name ? String(latest.submittedBy.name) : null,
        });
      } catch {
        // Fetch blip → keep the panel hidden rather than breaking the card.
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [jobId]);

  if (!state) return null;

  const { areas, afterByArea } = state;
  const redoneCount = areas.filter((a) => (afterByArea[a.id]?.length ?? 0) > 0).length;

  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-muted)/0.4)] px-3 py-2.5">
        <p className="text-[0.8125rem] font-[550]">Reclean — before / after</p>
        <div className="flex flex-wrap items-center gap-2">
          <EBadge tone="neutral" soft>{areas.length} flagged area{areas.length === 1 ? "" : "s"}</EBadge>
          <EBadge tone={redoneCount === areas.length ? "success" : "warning"} soft>
            {redoneCount}/{areas.length} re-done
          </EBadge>
        </div>
      </div>

      <div className="space-y-4 px-3 py-3">
        {state.reworkReason ? (
          <div className="flex items-start gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-warning)/0.4)] bg-[hsl(var(--e-warning)/0.08)] px-3 py-2 text-[0.8125rem]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-warning))]" />
            <p>
              <span className="font-[550]">Why it was sent back:</span> {state.reworkReason}
            </p>
          </div>
        ) : null}

        {state.resubmittedAt ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Resubmitted {new Date(state.resubmittedAt).toLocaleString("en-AU")}
            {state.resubmittedBy ? ` by ${state.resubmittedBy}` : ""}
          </p>
        ) : (
          <p className="text-[0.75rem] text-[hsl(var(--e-warning))]">No reclean submission yet.</p>
        )}

        {areas.map((area, i) => {
          const before: GalleryItem[] = area.photoKeys.map((key, j) => ({
            id: `${area.id}-before-${j}`,
            s3Key: key,
            url: null,
            label: `Before — ${area.label}`,
            mediaType: VIDEO_KEY_RE.test(key) ? "VIDEO" : "PHOTO",
          }));
          const after = afterByArea[area.id] ?? [];
          return (
            <div key={area.id} className="rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] p-3">
              <p className="text-[0.8125rem] font-[550]">
                <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(var(--e-muted))] text-[0.6875rem] font-semibold">
                  {i + 1}
                </span>
                {area.label}
              </p>
              {area.note ? (
                <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{area.note}</p>
              ) : null}

              {/* Side-by-side on desktop, stacked on a phone. */}
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <div className="rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-warning)/0.35)] bg-[hsl(var(--e-warning)/0.06)] p-2.5">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-warning))]">
                    <AlertTriangle className="h-3.5 w-3.5" /> Before — QA flagged
                  </p>
                  {before.length > 0 ? (
                    <AccessMediaGallery
                      media={before}
                      jobId={jobId}
                      title={`Before — ${area.label}`}
                      className="grid grid-cols-3 gap-2 sm:grid-cols-4"
                    />
                  ) : (
                    <p className="flex items-center gap-1.5 py-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      <Camera className="h-4 w-4" /> No QA photo.
                    </p>
                  )}
                </div>

                <div className="rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-success)/0.35)] bg-[hsl(var(--e-success)/0.06)] p-2.5">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-success))]">
                    <CheckCircle2 className="h-3.5 w-3.5" /> After — cleaner re-did
                  </p>
                  {after.length > 0 ? (
                    <AccessMediaGallery
                      media={after}
                      jobId={jobId}
                      title={`After — ${area.label}`}
                      className="grid grid-cols-3 gap-2 sm:grid-cols-4"
                    />
                  ) : (
                    <p className="flex items-center gap-1.5 py-3 text-[0.75rem] text-[hsl(var(--e-warning))]">
                      <AlertTriangle className="h-4 w-4" /> Not re-done yet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
