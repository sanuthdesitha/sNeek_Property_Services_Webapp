"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import {
  EMPTY_ACTIVITY,
  activityBatchEnded,
  activityFinished,
  activityInterrupted,
  activityStarted,
  classifyActivityRequest,
  isActivityBusy,
  summarizeActivity,
  type ActivityRequest,
  type ActivityState,
} from "@/lib/client/activity-summary";
import {
  hasLiveActivityBatch,
  subscribeActivityBatches,
  type LiveBatch,
} from "@/lib/client/activity-batches";
import "./activity-bar.css";

/** Quick requests finish before the bar would be worth showing. */
const SHOW_DELAY_MS = 600;
const SUCCESS_CLOSE_MS = 4000;
const ERROR_CLOSE_MS = 10000;
/** Longer than the 120s part-transfer deadline: an open file this quiet has stalled. */
const STALLED_UPLOAD_MS = 150_000;
/** A plain download link gives the page no completion signal. */
const DOWNLOAD_LINK_MS = 2600;

function readRequest(input: RequestInfo | URL, init?: RequestInit) {
  let urlString = "";
  let headers = new Headers();
  if (typeof input === "string") urlString = input;
  else if (input instanceof URL) urlString = input.toString();
  else {
    urlString = input.url;
    headers = new Headers(input.headers);
  }
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return { url: new URL(urlString, window.location.origin), headers };
}

/** Which requests appear in the bar. `x-progress-toast: off|force` still opts out or in. */
function trackedRequest(url: URL, headers: Headers): ActivityRequest | null {
  const mode = headers.get("x-progress-toast")?.toLowerCase();
  if (mode === "off") return null;
  if (url.origin !== window.location.origin) return null;
  if (!url.pathname.startsWith("/api/")) return null;
  if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/public/")) return null;
  return classifyActivityRequest(url.pathname, url.searchParams, mode === "force");
}

/**
 * Watches this tab's slow requests and shows them as ONE bar: a sentence
 * ("Uploading 3 of 5 files"), a count, and a single track. Completion and
 * failure are stated once for the whole batch.
 */
export function GlobalRequestProgress() {
  const [state, setState] = useState<ActivityState>(EMPTY_ACTIVITY);
  const [visible, setVisible] = useState(false);
  const stateRef = useRef<ActivityState>(EMPTY_ACTIVITY);
  const [live, setLive] = useState<LiveBatch[]>([]);
  const liveRef = useRef<LiveBatch[]>([]);
  const pathname = usePathname() ?? "";

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let shown = false;
    const downloadTimers = new Set<ReturnType<typeof setTimeout>>();

    const clear = (timer: ReturnType<typeof setTimeout> | null) => {
      if (timer) clearTimeout(timer);
      return null;
    };

    const reset = () => {
      closeTimer = clear(closeTimer);
      stateRef.current = EMPTY_ACTIVITY;
      setState(EMPTY_ACTIVITY);
      shown = false;
      setVisible(false);
    };

    const apply = (next: ActivityState) => {
      stateRef.current = next;
      setState(next);
      stallTimer = clear(stallTimer);
      if (isActivityBusy(next, liveRef.current)) {
        // New work during the closing summary keeps the same bar and counts.
        closeTimer = clear(closeTimer);
        if (!shown && !showTimer) {
          showTimer = setTimeout(() => {
            showTimer = null;
            shown = true;
            setVisible(true);
          }, SHOW_DELAY_MS);
        }
        if (next.inFlight === 0 && next.uploadsOpen > 0) {
          stallTimer = setTimeout(() => apply(activityInterrupted(stateRef.current)), STALLED_UPLOAD_MS);
        }
        return;
      }
      const summary = summarizeActivity(next, liveRef.current);
      if (summary.tone === "danger") {
        // A failure is always stated, even when it happened before the delay.
        showTimer = clear(showTimer);
        shown = true;
        setVisible(true);
      } else if (!shown) {
        // Finished before the bar appeared: nothing worth announcing.
        showTimer = clear(showTimer);
        reset();
        return;
      }
      closeTimer = clear(closeTimer);
      closeTimer = setTimeout(reset, summary.tone === "danger" ? ERROR_CLOSE_MS : SUCCESS_CLOSE_MS);
    };

    // Work that starts after a clean finish is a new batch with its own counts.
    // After a failure the counts are kept, so the failure is not silently erased.
    const batchBase = (): ActivityState => {
      const current = stateRef.current;
      const settledCleanly =
        !isActivityBusy(current, liveRef.current) &&
        current.uploadsFailed + current.tasksFailed === 0;
      return settledCleanly ? EMPTY_ACTIVITY : current;
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const { url, headers } = readRequest(input, init);
      const request = trackedRequest(url, headers);
      // A component reporting its own batch already counts those files; its
      // allocation and part requests must not be counted a second time.
      const ownedByBatch = request?.kind !== "task" && hasLiveActivityBatch();
      if (!request || ownedByBatch) return originalFetch(input, init);
      apply(activityStarted(batchBase(), request));
      try {
        const response = await originalFetch(input, init);
        // An HTTP error resolved the fetch but the work still failed.
        apply(activityFinished(stateRef.current, request, response.ok));
        return response;
      } catch (error) {
        apply(activityFinished(stateRef.current, request, false));
        throw error;
      }
    };

    function onAnchorClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.getAttribute("data-progress-toast") === "off") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.origin);
      } catch {
        return;
      }
      const request = trackedRequest(url, new Headers());
      if (!request || request.kind !== "task") return;
      apply(activityStarted(batchBase(), request));
      const timer = setTimeout(() => {
        downloadTimers.delete(timer);
        apply(activityFinished(stateRef.current, request, true));
      }, DOWNLOAD_LINK_MS);
      downloadTimers.add(timer);
    }

    const unsubscribe = subscribeActivityBatches({
      onLive: (batches) => {
        const starting = liveRef.current.length === 0 && batches.length > 0;
        const base = starting ? batchBase() : stateRef.current;
        liveRef.current = batches;
        setLive(batches);
        apply(base);
      },
      onEnd: (result) => {
        stateRef.current = activityBatchEnded(stateRef.current, result);
      },
    });
    const onDismiss = () => reset();
    document.addEventListener("click", onAnchorClick, true);
    window.addEventListener("sneek:activity-dismiss", onDismiss);

    return () => {
      window.fetch = originalFetch;
      unsubscribe();
      document.removeEventListener("click", onAnchorClick, true);
      window.removeEventListener("sneek:activity-dismiss", onDismiss);
      clear(showTimer);
      clear(closeTimer);
      clear(stallTimer);
      downloadTimers.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  if (!visible) return null;
  const summary = summarizeActivity(state, live);
  const busy = summary.tone === "working";
  const percent = summary.percent;
  const estate = pathname === "/v2" || pathname.startsWith("/v2/");
  const Icon = busy ? Loader2 : summary.tone === "danger" ? AlertTriangle : CheckCircle2;

  return (
    <div className="activity-bar-layer">
      <div
        className="activity-bar"
        data-tone={summary.tone}
        data-skin={estate ? "estate" : undefined}
        role={summary.tone === "danger" ? "alert" : "status"}
        aria-live={summary.tone === "danger" ? "assertive" : "polite"}
      >
        <span className="activity-bar-icon" aria-hidden>
          <Icon size={18} className={busy ? "activity-bar-spin" : undefined} />
        </span>
        <span className="activity-bar-message">{summary.message}</span>
        {busy && summary.total > 1 ? (
          <span className="activity-bar-count">
            {summary.finished}/{summary.total}
          </span>
        ) : busy && !summary.indeterminate ? (
          <span className="activity-bar-count">{percent}%</span>
        ) : null}
        {!busy ? (
          <button
            type="button"
            className="activity-bar-dismiss"
            aria-label="Dismiss"
            onClick={() => window.dispatchEvent(new Event("sneek:activity-dismiss"))}
          >
            <X size={16} aria-hidden />
          </button>
        ) : null}
        <div
          className="activity-bar-track"
          role="progressbar"
          aria-label="Overall progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={busy && summary.indeterminate ? undefined : busy ? percent : 100}
        >
          <div
            className="activity-bar-fill"
            data-indeterminate={busy && summary.indeterminate ? "true" : undefined}
            style={busy && summary.indeterminate ? undefined : { width: `${busy ? percent : 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}
