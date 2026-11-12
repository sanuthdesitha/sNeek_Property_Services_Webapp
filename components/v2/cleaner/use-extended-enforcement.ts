"use client";

/**
 * Whether the phone shows the extended answer checks inline for this job
 * (GET /api/cleaner/jobs/[id]/form-validation — the submit route's own
 * decision). Re-read when the cleaner's started state changes, because the
 * decision depends on when they first clocked in. A failed read keeps the
 * previous value (default false): the server stays authoritative either way.
 */
import * as React from "react";

export function useExtendedEnforcement(jobId: string, started: boolean): boolean {
  const [enforce, setEnforce] = React.useState(false);
  React.useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/cleaner/jobs/${jobId}/form-validation`, { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: unknown) => {
        if (controller.signal.aborted || !body || typeof body !== "object") return;
        setEnforce((body as { enforceExtended?: unknown }).enforceExtended === true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [jobId, started]);
  return enforce;
}
