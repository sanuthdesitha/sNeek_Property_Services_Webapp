"use client";

/**
 * The persistent "your location is being shared" indicator, shown by the
 * cleaner and laundry portal layouts for as long as the tracker runs
 * (lib/gps/live-fix-store). It says who can see it, states the platform limit
 * plainly (a web app stops sharing when it is closed or in the background),
 * and turns into a warning with a retry when location permission is off —
 * without blocking the work in progress.
 */
import * as React from "react";
import { MapPin, RefreshCw } from "lucide-react";
import { toneMutedClass, toneNoticeClass } from "@/components/v2/ui/tone-band";
import { getTrackerStatus, requestTrackerRestart, subscribeTrackerStatus, type TrackerStatus } from "@/lib/gps/live-fix-store";

export function useTrackerStatus(): TrackerStatus {
  return React.useSyncExternalStore(subscribeTrackerStatus, getTrackerStatus, getTrackerStatus);
}

/** Pure wording, unit-tested. */
export function indicatorCopy(status: Pick<TrackerStatus, "portal" | "permission" | "clientSees">): { tone: "info" | "attention"; title: string; detail: string } {
  if (status.permission === "denied") {
    return {
      tone: "attention",
      title: "Location is off",
      detail: status.portal === "laundry"
        ? "The office sees \"location off\". You can finish your stops; turn location back on to keep sharing. It is needed to start your next route."
        : "The office sees \"location off\". You can finish this job; turn location back on to keep sharing. It is needed for your next start.",
    };
  }
  const audience = status.portal === "cleaner" && status.clientSees
    ? "with the office and, while you're on the way, with the client"
    : "with the office";
  return {
    tone: "info",
    title: `Your location is being shared ${audience}`,
    detail: status.portal === "laundry"
      ? "Until you end the route. Keep the app open while driving — sharing stops when the app is closed or in the background."
      : "Until you clock out. Keep the app open while travelling — sharing stops when the app is closed or in the background.",
  };
}

export function LocationSharingIndicator() {
  const status = useTrackerStatus();
  if (!status.active) return null;
  const copy = indicatorCopy(status);
  return (
    <section
      aria-label="Live location"
      role="status"
      className={`mb-3 flex flex-wrap items-start gap-x-3 gap-y-1 rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass(copy.tone)}`}
    >
      <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 basis-48 [overflow-wrap:anywhere]">
        <p className="font-semibold">{copy.title}</p>
        <p className={toneMutedClass(copy.tone)}>{copy.detail}</p>
      </div>
      {status.permission === "denied" ? (
        <button
          type="button"
          onClick={requestTrackerRestart}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded px-3 text-sm font-semibold hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <RefreshCw aria-hidden className="h-4 w-4" />Retry location
        </button>
      ) : null}
    </section>
  );
}
