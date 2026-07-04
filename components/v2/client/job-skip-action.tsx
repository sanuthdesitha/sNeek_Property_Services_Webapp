"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EButton } from "@/components/v2/ui/primitives";

/**
 * Estate skip-clean control. Mirrors the exact payload the legacy client job
 * page sends to /api/client/jobs/[id]/skip-request (POST { reason } to request,
 * DELETE to withdraw). Never invents an endpoint.
 */
export function JobSkipAction({
  jobId,
  skipStatus,
}: {
  jobId: string;
  skipStatus: string; // NONE | REQUESTED | SKIPPED | DECLINED
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function request() {
    const reason = window.prompt("Optional reason for skipping this clean:") ?? undefined;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/jobs/${jobId}/skip-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason?.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send skip request.");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not send skip request.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/jobs/${jobId}/skip-request`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not cancel skip request.");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not cancel skip request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {skipStatus === "REQUESTED" ? (
        <EButton variant="outline" size="sm" onClick={cancel} disabled={busy}>
          {busy ? "Cancelling…" : "Cancel skip request"}
        </EButton>
      ) : (
        <EButton variant="outline" size="sm" onClick={request} disabled={busy}>
          {busy ? "Sending…" : "Request to skip this clean"}
        </EButton>
      )}
      {error ? (
        <span className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</span>
      ) : null}
    </div>
  );
}
