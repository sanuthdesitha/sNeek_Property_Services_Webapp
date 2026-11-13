"use client";
import { useEffect, useRef, useState } from "react";
import { EAlert } from "@/components/v2/ui/primitives";

type Flag = { kind: string; mediaId: string; fieldLabel: string; detail: string; relatedJobId: string | null };
type Photo = { mediaId: string; fieldLabel: string; state: "checked" | "not_checked" | "could_not_check"; error: string | null; capturedAt: string | null; capturedAtSource: string | null };
type Report = {
  hasSubmission: boolean;
  photos: Photo[];
  flags: Flag[];
  clockWindow: { start: string; end: string; open: boolean } | null;
  counts: { photos: number; checked: number; notChecked: number; couldNotCheck: number; captureTimeRecorded: number };
  timezone: string;
};

const KIND_LABEL: Record<string, string> = {
  duplicate_in_job: "Same file used twice",
  near_duplicate_in_job: "Looks the same as another photo",
  reused_from_earlier_job: "Matches an earlier clean",
  outside_clock_window: "Camera time outside clock times",
};

function when(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(iso));
}

/**
 * Photo integrity flags (deterministic: file hashes, a stamp-insensitive
 * picture hash, camera time). A secondary tool: loads only when opened, and
 * resets when the job changes. Flags are for a person to look at, not a verdict.
 */
export function PhotoIntegrityFlags({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<{ jobId: string; data: Report } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const current = useRef(jobId);
  current.current = jobId;

  useEffect(() => { setOpen(false); setReport(null); setError(""); }, [jobId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/qa/jobs/${encodeURIComponent(jobId)}/photo-integrity`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled || current.current !== jobId) return;
        if (!response.ok) throw new Error(typeof body.error === "string" && body.error !== "FORBIDDEN" ? body.error : "Photo checks could not be loaded.");
        setReport({ jobId, data: body as Report });
      })
      .catch((failure) => { if (!cancelled && failure?.name !== "AbortError") setError(failure instanceof Error ? failure.message : "Photo checks could not be loaded."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [open, jobId, reload]);

  const data = report?.jobId === jobId ? report.data : null;
  return (
    <details className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Photo checks (duplicates, reuse, camera time)</summary>
      <div className="mt-2 space-y-3 text-sm">
        <p className="text-[hsl(var(--e-muted-foreground))]">Facts worked out from the stored photos, without AI. A flag is something to look at, not a verdict. Clients never see these.</p>
        {loading ? <p role="status">Loading photo checks…</p> : null}
        {error ? <p role="alert">{error} <button type="button" className="underline" onClick={() => setReload((value) => value + 1)}>Retry</button></p> : null}
        {data && !data.hasSubmission ? <p>No submitted form yet.</p> : null}
        {data && data.hasSubmission ? (
          <>
            <p>
              {data.counts.checked} of {data.counts.photos} photos checked
              {data.counts.notChecked ? ` · ${data.counts.notChecked} not checked yet (the background check runs every 5 minutes)` : ""}
              {data.counts.couldNotCheck ? ` · ${data.counts.couldNotCheck} could not be checked` : ""}
              {` · camera time recorded for ${data.counts.captureTimeRecorded}`}.
            </p>
            {data.flags.length ? (
              <EAlert tone="warning" title={`${data.flags.length} photo${data.flags.length === 1 ? "" : "s"} to look at`}>
                <ul className="mt-1 space-y-2">
                  {data.flags.map((flag, index) => (
                    <li key={`${flag.kind}-${flag.mediaId}-${index}`} className="break-words [overflow-wrap:anywhere]">
                      <strong>{KIND_LABEL[flag.kind] ?? flag.kind}</strong> · {flag.fieldLabel}: {flag.detail}
                      {flag.relatedJobId ? <> <a className="underline" href={`/v2/admin/jobs/${encodeURIComponent(flag.relatedJobId)}`}>Open that job</a></> : null}
                    </li>
                  ))}
                </ul>
              </EAlert>
            ) : data.counts.checked === data.counts.photos && data.counts.photos > 0 ? (
              <p>No duplicates or matches with earlier cleans found among the checked photos.</p>
            ) : (
              <p>No flags among the photos checked so far.</p>
            )}
            {data.clockWindow ? (
              <p>Clock times: {when(data.clockWindow.start, data.timezone)} to {data.clockWindow.open ? "now (still clocked in)" : when(data.clockWindow.end, data.timezone)}.</p>
            ) : <p>No clock times to compare camera times with.</p>}
            {data.photos.some((photo) => photo.state !== "checked") ? (
              <ul className="space-y-1">
                {data.photos.filter((photo) => photo.state !== "checked").map((photo) => (
                  <li key={photo.mediaId}>{photo.fieldLabel}: {photo.state === "not_checked" ? "Not checked yet" : `Could not check (${photo.error ?? "unknown reason"})`}</li>
                ))}
              </ul>
            ) : null}
            {data.counts.captureTimeRecorded < data.counts.photos ? <p className="text-[hsl(var(--e-muted-foreground))]">Camera time is &quot;Not recorded&quot; when the uploaded file carries no camera data (the in-app stamp re-saves photos without it), so the clock comparison covers only photos that kept it.</p> : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
