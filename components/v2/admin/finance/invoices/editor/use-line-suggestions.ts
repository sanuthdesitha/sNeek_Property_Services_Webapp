"use client";

/**
 * What the add-line box and "Add finished jobs" offer on a draft: the
 * client's finished, unbilled jobs (with the generator's charge, or "no
 * rate") and the saved invoice items. Read once per invoice and again after
 * each save (reloadToken); an obsolete read is cancelled and a late answer is
 * ignored. Loading, failure and empty are separate states.
 */
import { useEffect, useState } from "react";
import type { UnbilledJobCandidate, UnbilledJobsPayload } from "@/lib/billing/client-invoice-add-jobs";
import type { SavedInvoiceItem, SavedItemsPayload } from "@/lib/billing/invoice-saved-items";
import { getSavedItems, getUnbilledJobs } from "../invoice-requests";

export type Loaded<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };

export type LineSuggestions = {
  jobs: Loaded<{ jobs: UnbilledJobCandidate[]; total: number; truncated: boolean }>;
  savedItems: Loaded<SavedInvoiceItem[]>;
};

export function useLineSuggestions(invoiceId: string, enabled: boolean, reloadToken: string): LineSuggestions {
  const [jobs, setJobs] = useState<LineSuggestions["jobs"]>({ status: "loading" });
  const [savedItems, setSavedItems] = useState<LineSuggestions["savedItems"]>({ status: "loading" });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    (async () => {
      try {
        const result = await getUnbilledJobs<UnbilledJobsPayload>(invoiceId, controller.signal);
        if (controller.signal.aborted) return;
        if (!result.ok || !Array.isArray(result.body.jobs)) setJobs({ status: "error", message: result.body.error ?? "Unbilled jobs could not be loaded." });
        else setJobs({ status: "ready", value: { jobs: result.body.jobs, total: result.body.total, truncated: result.body.truncated } });
      } catch {
        if (!controller.signal.aborted) setJobs({ status: "error", message: "Unbilled jobs could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [invoiceId, enabled, reloadToken]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    (async () => {
      try {
        const result = await getSavedItems<SavedItemsPayload>(controller.signal);
        if (controller.signal.aborted) return;
        if (!result.ok || !Array.isArray(result.body.items)) setSavedItems({ status: "error", message: result.body.error ?? "Saved items could not be loaded." });
        else setSavedItems({ status: "ready", value: result.body.items });
      } catch {
        if (!controller.signal.aborted) setSavedItems({ status: "error", message: "Saved items could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [enabled]);

  return { jobs, savedItems };
}

export type Suggestion =
  | { kind: "job"; key: string; job: UnbilledJobCandidate }
  | { kind: "item"; key: string; item: SavedInvoiceItem };

/** Matches for what is typed: jobs by number, property or type; items by name. At most `limit`. */
export function matchSuggestions(query: string, suggestions: LineSuggestions, limit = 8): Suggestion[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const items: Suggestion[] = suggestions.savedItems.status === "ready"
    ? suggestions.savedItems.value.filter((item) => item.name.toLowerCase().includes(needle)).map((item) => ({ kind: "item" as const, key: `item:${item.id}`, item }))
    : [];
  const jobs: Suggestion[] = suggestions.jobs.status === "ready"
    ? suggestions.jobs.value.jobs
        .filter((job) => [job.jobNumber ?? "", job.propertyName, job.jobType.replace(/_/g, " ")].some((text) => text.toLowerCase().includes(needle)))
        .map((job) => ({ kind: "job" as const, key: `job:${job.id}`, job }))
    : [];
  return [...items, ...jobs].slice(0, limit);
}
