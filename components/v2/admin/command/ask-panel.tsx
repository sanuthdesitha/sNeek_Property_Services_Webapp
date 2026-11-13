"use client";
import { useEffect, useRef, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";

type Citation = { type: string; id: string; label: string; href: string };
type AskState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "answered" | "no_answer"; answer: string; citations: Citation[]; untrustedIncluded: boolean }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

/**
 * "Ask" on Command: a lazy disclosure below the heading. Answers come only from
 * records the signed-in person can read, with links to them. The question is
 * kept when the panel is closed; a new question cancels the previous one.
 */
export function AskPanel() {
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<AskState>({ kind: "idle" });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function ask() {
    const text = question.trim();
    if (text.length < 3) return;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/admin/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }), signal: abort.signal });
      const body = await response.json().catch(() => ({}));
      if (abort.signal.aborted) return;
      if (!response.ok) throw new Error(body.error || "Ask could not answer right now.");
      if (body.state === "unavailable") setState({ kind: "unavailable", reason: body.reason });
      else setState({ kind: body.state === "answered" ? "answered" : "no_answer", answer: body.answer, citations: body.citations ?? [], untrustedIncluded: Boolean(body.untrustedIncluded) });
    } catch (error) {
      if (!abort.signal.aborted) setState({ kind: "error", message: error instanceof Error ? error.message : "Ask could not answer right now." });
    }
  }

  return (
    <details className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-2">
      <summary className="flex min-h-11 cursor-pointer items-center text-[0.875rem] font-[600]">Ask about today&apos;s operations</summary>
      <div className="space-y-3 pb-3 pt-1">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Answers come only from records you can open, with links. Ask cannot change anything.</p>
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
          <label className="block min-w-0 flex-1 text-[0.8125rem] font-medium">Your question
            <input className="mt-1 block h-11 w-full rounded-md border bg-transparent px-3 text-[16px] sm:text-sm" maxLength={500} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Which jobs today have no cleaner yet?" />
          </label>
          <EButton type="submit" disabled={state.kind === "loading" || question.trim().length < 3}>{state.kind === "loading" ? "Looking it up…" : "Ask"}</EButton>
        </form>
        {state.kind === "answered" || state.kind === "no_answer" ? (
          <div className="space-y-2" aria-live="polite">
            {state.kind === "no_answer" ? <p className="text-[0.8125rem] font-medium">The records Ask can read do not answer this.</p> : null}
            <p className="whitespace-pre-wrap text-[0.875rem] [overflow-wrap:anywhere]">{state.answer}</p>
            {state.citations.length ? (
              <ul className="flex flex-wrap gap-2" aria-label="Sources">
                {state.citations.map((citation) => <li key={`${citation.type}-${citation.id}`}><a className="inline-flex min-h-11 items-center rounded-full border px-3 text-[0.8125rem] underline" href={citation.href}>{citation.label}</a></li>)}
              </ul>
            ) : null}
            {state.untrustedIncluded ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Some of the records include text written by clients or cleaners; it was read as information only.</p> : null}
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">AI answer: check the linked records before acting.</p>
          </div>
        ) : null}
        {state.kind === "unavailable" ? <p className="text-[0.8125rem]">Ask is unavailable: {state.reason}</p> : null}
        {state.kind === "error" ? <p role="alert" className="text-[0.8125rem]">{state.message} <button type="button" className="underline" onClick={() => void ask()}>Try again</button></p> : null}
      </div>
    </details>
  );
}
