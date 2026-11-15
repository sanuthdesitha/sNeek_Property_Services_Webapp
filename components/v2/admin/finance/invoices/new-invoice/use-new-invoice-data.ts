"use client";

/**
 * Reads for the New invoice panel. Each read is cancelled when its inputs
 * change, and the signal is checked again after the JSON is parsed, so a late
 * answer for an earlier client or period never fills the current one. A failed
 * refresh keeps the last good preview and says it is stale; loading never
 * reads as "no jobs".
 */
import * as React from "react";
import type { GeneratePreview, PeriodDefault } from "@/lib/billing/client-invoice-generate-preview-types";
import type { ReadyToBillSummary } from "@/lib/billing/ready-to-bill";

export type JobsSelection = {
  clientId: string;
  propertyId: string;
  periodStart: string;
  periodEnd: string;
  periodBasis: "SCHEDULED" | "SERVICE";
  gstEnabled: boolean;
};

export type PreviewState =
  | { status: "idle" }
  | { status: "loading"; previous: GeneratePreview | null }
  | { status: "ready"; preview: GeneratePreview }
  | { status: "error"; message: string; previous: GeneratePreview | null };

export function selectionQuery(selection: JobsSelection): string {
  const params = new URLSearchParams({ view: "preview", clientId: selection.clientId, basis: selection.periodBasis, gst: selection.gstEnabled ? "1" : "0" });
  if (selection.propertyId) params.set("propertyId", selection.propertyId);
  if (selection.periodStart) params.set("from", selection.periodStart);
  if (selection.periodEnd) params.set("to", selection.periodEnd);
  return params.toString();
}

function previousOf(state: PreviewState): GeneratePreview | null {
  if (state.status === "ready") return state.preview;
  if (state.status === "loading" || state.status === "error") return state.previous;
  return null;
}

/** The preview for one selection; `reloadToken` re-reads it (after a rate fix). */
export function useGeneratePreview(selection: JobsSelection | null, reloadToken: number): PreviewState {
  const [state, setState] = React.useState<PreviewState>({ status: "idle" });
  const query = selection ? selectionQuery(selection) : null;
  const clientId = selection?.clientId ?? null;
  React.useEffect(() => {
    if (!query || !clientId) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    // A different client must never show the previous client's jobs, even as "stale".
    setState((current) => {
      const previous = previousOf(current);
      return { status: "loading", previous: previous && previous.client.id === clientId ? previous : null };
    });
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/invoices/generate?${query}`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as (GeneratePreview & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !Array.isArray(body.jobs)) {
          const message = body?.error ?? "The jobs for this client and period could not be loaded.";
          setState((current) => ({ status: "error", message, previous: previousOf(current) }));
          return;
        }
        if (body.client.id !== clientId) return;
        setState({ status: "ready", preview: body });
      } catch {
        if (controller.signal.aborted) return;
        setState((current) => ({ status: "error", message: "No answer from the server. The jobs could not be loaded.", previous: previousOf(current) }));
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, clientId, reloadToken]);
  return state;
}

export type PeriodDefaultState =
  | { status: "idle" }
  | { status: "loading"; clientId: string }
  | { status: "ready"; clientId: string; period: PeriodDefault }
  | { status: "error"; clientId: string; message: string };

/** The client's period default (last invoice end, else the 1st of the month). */
export function usePeriodDefault(clientId: string): PeriodDefaultState {
  const [state, setState] = React.useState<PeriodDefaultState>({ status: "idle" });
  React.useEffect(() => {
    if (!clientId) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", clientId });
    (async () => {
      try {
        const response = await fetch(`/api/admin/invoices/generate?view=period&clientId=${encodeURIComponent(clientId)}`, { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as (PeriodDefault & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.start) {
          setState({ status: "error", clientId, message: body?.error ?? "The usual period could not be worked out. Choose the dates." });
          return;
        }
        setState({ status: "ready", clientId, period: body });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error", clientId, message: "The usual period could not be worked out. Choose the dates." });
      }
    })();
    return () => controller.abort();
  }, [clientId]);
  return state;
}

export type ReadyState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; summary: ReadyToBillSummary };

/** "Ready to bill, all clients": the figures the batch "Create N drafts" acts on. */
export function useReadyToBillSummary(reloadToken: number): ReadyState {
  const [state, setState] = React.useState<ReadyState>({ status: "loading" });
  React.useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    (async () => {
      try {
        const response = await fetch("/api/admin/invoices?view=ready-to-bill", { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as (ReadyToBillSummary & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !Array.isArray(body.byClient)) {
          setState({ status: "error", message: body?.error ?? "The clients to bill could not be loaded." });
          return;
        }
        setState({ status: "ready", summary: body });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error", message: "The clients to bill could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [reloadToken]);
  return state;
}
