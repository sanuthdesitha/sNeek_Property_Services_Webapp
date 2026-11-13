"use client";
import { useEffect, useRef, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";

/**
 * Small AI helpers (2026-11-14): "Explain" for photo findings and checks, and
 * "Draft with AI" for an editor. Each shows its own unavailable state (AI off
 * or not configured) separately from an error, and never sends or saves.
 */

type ExplainState = { kind: "idle" } | { kind: "loading" } | { kind: "explained"; explanation: string; whatToCheck: string[] } | { kind: "unavailable"; reason: string } | { kind: "error"; message: string };

export function ExplainFlagButton({ jobId, kind, id, label = "Explain" }: { jobId: string; kind: "finding" | "photo" | "integrity"; id: string; label?: string }) {
  const [state, setState] = useState<ExplainState>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { controller.current?.abort(); setState({ kind: "idle" }); }, [jobId, kind, id]);
  async function explain() {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setState({ kind: "loading" });
    try {
      const response = await fetch(`/api/qa/jobs/${encodeURIComponent(jobId)}/photo-review/explain`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id }), signal: abort.signal });
      const body = await response.json().catch(() => ({}));
      if (abort.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || "No explanation could be made.");
      setState(body.state === "unavailable" ? { kind: "unavailable", reason: body.reason } : { kind: "explained", explanation: body.explanation, whatToCheck: body.whatToCheck ?? [] });
    } catch (error) {
      if (!abort.signal.aborted) setState({ kind: "error", message: error instanceof Error ? error.message : "No explanation could be made." });
    }
  }
  return (
    <div className="min-w-0 space-y-1">
      <EButton type="button" size="sm" variant="ghost" disabled={state.kind === "loading"} onClick={() => void explain()}>{state.kind === "loading" ? "Explaining…" : label}</EButton>
      {state.kind === "explained" ? (
        <div className="rounded border p-2 text-sm" aria-live="polite">
          <p className="break-words">{state.explanation}</p>
          {state.whatToCheck.length ? <ul className="mt-1 list-disc pl-5">{state.whatToCheck.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
          <p className="mt-1 text-xs text-[hsl(var(--e-muted-foreground))]">AI explanation of the stored result; a person decides.</p>
        </div>
      ) : null}
      {state.kind === "unavailable" ? <p className="text-sm">AI unavailable: {state.reason}</p> : null}
      {state.kind === "error" ? <p role="alert" className="text-sm">{state.message}</p> : null}
    </div>
  );
}

type DraftState = { kind: "idle" } | { kind: "loading" } | { kind: "drafted"; draft: string } | { kind: "unavailable"; reason: string } | { kind: "error"; message: string };

/** Asks for a draft, shows it, and only puts it into the editor when the person chooses "Use this draft". */
export function AiDraftButton({ request, onUse, scopeKey, withIntent = false }: { request: Record<string, unknown>; onUse: (draft: string) => void; scopeKey: string; withIntent?: boolean }) {
  const [state, setState] = useState<DraftState>({ kind: "idle" });
  const [intent, setIntent] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  // A different client or quote: forget the previous draft.
  useEffect(() => { controller.current?.abort(); setState({ kind: "idle" }); setIntent(""); }, [scopeKey]);
  async function draft() {
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/admin/assistant/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, ...(withIntent && intent.trim() ? { intent: intent.trim() } : {}) }), signal: abort.signal });
      const body = await response.json().catch(() => ({}));
      if (abort.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || "No draft could be made.");
      setState(body.state === "unavailable" ? { kind: "unavailable", reason: body.reason } : { kind: "drafted", draft: body.draft });
    } catch (error) {
      if (!abort.signal.aborted) setState({ kind: "error", message: error instanceof Error ? error.message : "No draft could be made." });
    }
  }
  return (
    <div className="min-w-0 space-y-2 rounded border border-dashed p-2">
      {withIntent ? (
        <label className="block text-xs font-medium">What should the reply say? (optional)
          <input className="mt-1 block h-11 w-full rounded-md border bg-transparent px-3 text-[16px] sm:text-sm" maxLength={500} value={intent} onChange={(event) => setIntent(event.target.value)} />
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <EButton type="button" size="sm" variant="outline" disabled={state.kind === "loading"} onClick={() => void draft()}>{state.kind === "loading" ? "Drafting…" : "Draft with AI"}</EButton>
        <span className="text-xs text-[hsl(var(--e-muted-foreground))]">A draft only: you edit it, then send or save as usual.</span>
      </div>
      {state.kind === "drafted" ? (
        <div className="space-y-2">
          <p className="whitespace-pre-wrap rounded border p-2 text-sm [overflow-wrap:anywhere]">{state.draft}</p>
          <div className="flex flex-wrap gap-2">
            <EButton type="button" size="sm" onClick={() => { onUse(state.draft); setState({ kind: "idle" }); }}>Use this draft</EButton>
            <EButton type="button" size="sm" variant="ghost" onClick={() => setState({ kind: "idle" })}>Discard</EButton>
          </div>
        </div>
      ) : null}
      {state.kind === "unavailable" ? <p className="text-sm">AI unavailable: {state.reason}</p> : null}
      {state.kind === "error" ? <p role="alert" className="text-sm">{state.message}</p> : null}
    </div>
  );
}
