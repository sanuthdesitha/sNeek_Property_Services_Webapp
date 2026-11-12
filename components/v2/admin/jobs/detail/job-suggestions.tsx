"use client";

/**
 * The unassigned lead's ranked cleaners, from the existing suggestions route
 * (availability, clashes, history, distance and QA where known), rendered by
 * the peek panel's own section so the two never disagree. Assigning goes
 * through the existing assign route and refreshes the page.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cleanerSuggestionsResponseSchema, type CleanerSuggestionsResponse } from "@/lib/jobs/peek-types";
import { PeekSuggestions } from "../peek-sections";
import type { Loadable } from "../use-job-peek";

export function JobSuggestions({ jobId, readOnly }: { jobId: string; readOnly: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState<Loadable<CleanerSuggestionsResponse>>({ status: "loading", data: null, error: "" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setValue({ status: "loading", data: null, error: "" });
    void (async () => {
      try {
        const response = await fetch(`/api/admin/jobs/${encodeURIComponent(jobId)}/cleaner-suggestions`, { signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) {
          const message = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "Could not load suggestions.";
          setValue({ status: "error", data: null, error: message });
          return;
        }
        const parsed = cleanerSuggestionsResponseSchema.safeParse(body);
        setValue(parsed.success ? { status: "success", data: parsed.data, error: "" } : { status: "error", data: null, error: "Suggestions came back in an unexpected shape." });
      } catch (error) {
        if (controller.signal.aborted) return;
        setValue({ status: "error", data: null, error: error instanceof Error ? error.message : "Could not load suggestions." });
      }
    })();
    return () => controller.abort();
  }, [jobId, revision]);

  const onAssigned = useCallback(() => {
    setRevision((current) => current + 1);
    router.refresh();
  }, [router]);

  return (
    <div className="space-y-2">
      <PeekSuggestions jobId={jobId} value={value} onAssigned={onAssigned} readOnly={readOnly} />
      <Link href="#s-dispatch" className="inline-flex min-h-11 items-center text-[0.8125rem] font-[550] text-[hsl(var(--e-accent-portal))] hover:underline">
        Offer to several cleaners
      </Link>
    </div>
  );
}
