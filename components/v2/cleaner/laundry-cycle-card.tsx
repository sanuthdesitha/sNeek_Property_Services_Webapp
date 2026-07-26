"use client";

/**
 * Laundry cycle card for the cleaner Set-up stage: shows the cycle BELONGING TO
 * THE PREVIOUS CLEAN of this property (its pickup/drop is what stocks THIS
 * clean's fresh linen). Replaces the old `laundryGuidance` fresh-linen block,
 * which surfaced "the last drop from any job" and kept reading like the wrong
 * property/job.
 *
 * States:
 *  - delivered — green proof card with the drop time + tappable delivery photo
 *  - en_route  — live driver update, polled from /api/cleaner/jobs/[id]/laundry-eta
 *                every 25s while the card is mounted AND the tab is visible;
 *                polling stops once delivered
 *  - no_signal — driver on route but no fresh location ping
 *  - scheduled — cycle exists, no active route yet
 */
import * as React from "react";
import { Shirt, Truck } from "lucide-react";

export type PreviousLaundryCyclePayload = {
  taskId: string;
  status: string;
  pickupDate: string;
  dropoffDate: string;
  droppedAt: string | null;
  dropPhotoKey?: string | null;
  dropPhotoUrl?: string | null;
  dropNotes?: string | null;
  prevCleanDate: string;
};

type EtaResponse =
  | { state: "none" }
  | { state: "delivered"; droppedAt: string | null; dropPhotoUrl?: string | null; dropPhotoKey?: string | null }
  | { state: "scheduled"; pickupDate: string; dropoffDate: string }
  | { state: "no_signal"; dropoffDate: string }
  | {
      state: "en_route";
      isNextStop: boolean;
      stopsBefore: number;
      etaMinutes: number | null;
      driverLat: number;
      driverLng: number;
      dropoffDate: string;
    };

const SYDNEY_TZ = "Australia/Sydney";
const POLL_MS = 25_000;

function sydneyDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-AU", {
    timeZone: SYDNEY_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
}

function sydneyDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-AU", {
    timeZone: SYDNEY_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Resolves the drop photo to a viewable URL (direct URL or upload-access key). */
function useDropPhotoUrl(photoUrl?: string | null, photoKey?: string | null) {
  const [url, setUrl] = React.useState<string | null>(photoUrl ?? null);
  React.useEffect(() => {
    if (photoUrl) {
      setUrl(photoUrl);
      return;
    }
    if (!photoKey) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/uploads/access?key=${encodeURIComponent(photoKey)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.url) setUrl(data.url as string);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [photoUrl, photoKey]);
  return url;
}

export function LaundryCycleCard({
  jobId,
  cycle,
  eligible,
}: {
  jobId: string | null | undefined;
  cycle: PreviousLaundryCyclePayload | null | undefined;
  eligible: boolean;
}) {
  const alreadyDelivered = cycle?.status === "DROPPED";
  const [eta, setEta] = React.useState<EtaResponse | null>(null);
  const deliveredByPoll = eta?.state === "delivered";
  const shouldPoll = Boolean(eligible && cycle && jobId) && !alreadyDelivered && !deliveredByPoll;

  React.useEffect(() => {
    if (!shouldPoll || !jobId) return;
    let cancelled = false;
    const poll = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/cleaner/jobs/${jobId}/laundry-eta`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as EtaResponse;
        if (!cancelled && data?.state) setEta(data);
      } catch {
        // best-effort — keep the last known state
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [shouldPoll, jobId]);

  const deliveredPhotoUrl = useDropPhotoUrl(
    alreadyDelivered
      ? cycle?.dropPhotoUrl
      : eta?.state === "delivered"
        ? eta.dropPhotoUrl
        : null,
    alreadyDelivered
      ? cycle?.dropPhotoKey
      : eta?.state === "delivered"
        ? eta.dropPhotoKey
        : null,
  );

  if (!eligible || !cycle) return null;

  const prevCleanLabel = sydneyDate(cycle.prevCleanDate);

  // ── Delivered ──────────────────────────────────────────────────────────────
  if (alreadyDelivered || deliveredByPoll) {
    const droppedAt = alreadyDelivered
      ? cycle.droppedAt
      : eta?.state === "delivered"
        ? eta.droppedAt
        : null;
    return (
      <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-success))] bg-[hsl(var(--e-success-soft))] p-3">
        <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
          <Shirt className="h-4 w-4 shrink-0" /> Fresh linen delivered
          {sydneyDateTime(droppedAt) ? ` ${sydneyDateTime(droppedAt)}` : ""}
        </p>
        {prevCleanLabel ? (
          <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            from the {prevCleanLabel} clean
          </p>
        ) : null}
        {cycle.dropNotes ? (
          <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{cycle.dropNotes}</p>
        ) : null}
        {deliveredPhotoUrl ? (
          <a
            href={deliveredPhotoUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block w-24 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]"
            title="Delivery photo — tap to enlarge"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={deliveredPhotoUrl} alt="Linen delivery proof" className="h-24 w-24 object-cover" />
          </a>
        ) : null}
      </div>
    );
  }

  // ── En route (live driver update) ─────────────────────────────────────────
  if (eta?.state === "en_route") {
    const etaLabel = eta.etaMinutes != null ? ` · ~${eta.etaMinutes} min` : "";
    return (
      <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-info))] bg-[hsl(var(--e-info-soft))] p-3">
        <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
          <Truck className="h-4 w-4 shrink-0" />
          {eta.isNextStop
            ? `🚚 Laundry is on the way — you're the next drop${etaLabel}`
            : `🚚 ${eta.stopsBefore} more drop${eta.stopsBefore === 1 ? "" : "s"} before you${etaLabel}${
                etaLabel ? " (drive + stop time)" : ""
              }`}
        </p>
        {prevCleanLabel ? (
          <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Linen from the {prevCleanLabel} clean
          </p>
        ) : null}
      </div>
    );
  }

  // ── Driver on route, no live location ─────────────────────────────────────
  if (eta?.state === "no_signal") {
    return (
      <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
        <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
          <Truck className="h-4 w-4 shrink-0" /> Driver on route — live location unavailable
          {sydneyDate(eta.dropoffDate) ? ` · drop-off due ${sydneyDate(eta.dropoffDate)}` : ""}
        </p>
      </div>
    );
  }

  // ── Scheduled (default, also covers eta null / "scheduled") ───────────────
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
      <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
        <Shirt className="h-4 w-4 shrink-0" /> Linen from the {prevCleanLabel ?? "previous"} clean
      </p>
      <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
        Pickup {sydneyDate(cycle.pickupDate) ?? "—"} · drop-off due {sydneyDate(cycle.dropoffDate) ?? "—"}
      </p>
    </div>
  );
}
