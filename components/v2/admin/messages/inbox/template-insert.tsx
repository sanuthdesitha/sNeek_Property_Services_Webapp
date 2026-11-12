"use client";

/**
 * Message templates (managed in Forms → Message templates), read lazily, and
 * the reply box's "Insert template": the template body is resolved for this
 * client through the preview route before it is inserted, so no raw
 * `{{variables}}` reach a portal message.
 */
import * as React from "react";

export type MessageTemplate = { id: string; name: string; category: string; channel: "EMAIL" | "SMS" | "BOTH"; subject?: string | null; body: string };
type TemplatesState = { status: "idle" | "loading" | "ready" | "failed"; rows: MessageTemplate[] };

export function useTemplates(enabled: boolean): TemplatesState & { retry: () => void } {
  const [state, setState] = React.useState<TemplatesState>({ status: "idle", rows: [] });
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ status: "loading", rows: [] });
    fetch("/api/admin/messages/templates", { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { templates?: MessageTemplate[] };
        if (controller.signal.aborted) return;
        setState(res.ok ? { status: "ready", rows: body.templates ?? [] } : { status: "failed", rows: [] });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed", rows: [] });
      });
    return () => controller.abort();
  }, [enabled, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

export function TemplateInsert({ clientId, onInsert }: { clientId: string; onInsert: (text: string) => void }) {
  const [enabled, setEnabled] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const templates = useTemplates(enabled);

  async function insert(id: string) {
    const template = templates.rows.find((t) => t.id === id);
    if (!template) return;
    setResolving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/messages/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: template.body, context: { clientId } }) });
      const data = (await res.json().catch(() => ({}))) as { body?: string; error?: string };
      if (!res.ok || typeof data.body !== "string") throw new Error(data.error ?? "Could not fill the template.");
      onInsert(data.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fill the template.");
    } finally {
      setResolving(false);
    }
  }

  const placeholder = templates.status === "loading" ? "Loading templates…" : templates.status === "failed" ? "Templates could not load" : resolving ? "Filling…" : "Insert template ▾";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select
        aria-label="Insert template"
        value=""
        disabled={resolving}
        onFocus={() => setEnabled(true)}
        onPointerDown={() => setEnabled(true)}
        onChange={(e) => void insert(e.target.value)}
        className="h-9 max-w-[14rem] rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem]"
      >
        <option value="">{placeholder}</option>
        {templates.rows.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {templates.status === "failed" ? <button type="button" className="text-[0.75rem] font-[600] underline" onClick={templates.retry}>Retry</button> : null}
      {error ? <span role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</span> : null}
    </span>
  );
}
