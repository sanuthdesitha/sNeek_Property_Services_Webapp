"use client";

/**
 * Settings › Property reminder rules (smart property reminders, slice B,
 * 2026-11-28). Each rule: what it does, where the cleaner sees it, what it
 * reads, on or off with who changed it, and the live preview. "Switch on"
 * sends the preview the administrator saw; when the facts changed meanwhile
 * the server refuses and the new preview is shown to check again.
 * Operations managers see the same page without the switches.
 */
import * as React from "react";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";

type Preview = { reminders: number; properties: number; cleaners: number; summary: string; examples: Array<{ text: string; why: string }> } | { failed: true };
type RuleView = { key: string; name: string; description: string; creates: string; reads: string; enabled: boolean; changedAt: string | null; changedBy: string | null; preview: Preview };
type Payload = { readable: boolean; canEdit: boolean; pilot: string; rules: RuleView[] };
type Load = { status: "loading" } | { status: "failed"; message: string } | { status: "ready"; data: Payload };

const MUTED = "text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]";

function formatWhen(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function RuleCard({ rule, canEdit, timeZone, onChanged }: { rule: RuleView; canEdit: boolean; timeZone: string; onChanged: () => void }) {
  const [preview, setPreview] = React.useState<Preview>(rule.preview);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  async function change(enabled: boolean) {
    if (enabled && "failed" in preview) return;
    setSaving(true);
    setMessage(null);
    try {
      const seen = enabled && !("failed" in preview) ? { reminders: preview.reminders, properties: preview.properties, cleaners: preview.cleaners } : null;
      const response = await fetch("/api/admin/settings/reminder-rules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rule: rule.key, enabled, seen }) });
      const body = (await response.json().catch(() => null)) as { error?: string; preview?: Preview } | null;
      if (!response.ok) {
        if (body?.preview) setPreview(body.preview);
        setMessage(body?.error ?? "Not saved.");
        return;
      }
      onChanged();
    } catch {
      setMessage("Not saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="space-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-[0.9375rem] font-[650] [overflow-wrap:anywhere]">{rule.name}</h3>
        <EPill tone={rule.enabled ? "ok" : "neutral"}>{rule.enabled ? "On" : "Off"}</EPill>
      </div>
      <p className="text-[0.8125rem]">{rule.description}</p>
      <p className={MUTED}><span className="font-[550]">Cleaner sees:</span> {rule.creates}</p>
      <p className={MUTED}><span className="font-[550]">Reads:</span> {rule.reads}</p>
      <div className="rounded-[var(--e-radius)] bg-[hsl(var(--e-muted))] p-3">
        {"failed" in preview ? (
          <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-warning))]">The preview could not be worked out. The rule cannot be switched on until it can.</p>
        ) : (
          <>
            <p className="text-[0.8125rem] font-[600]">{preview.summary}.</p>
            {preview.examples.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {preview.examples.map((example, index) => (
                  <li key={index} className={MUTED}>
                    <span className="font-[550] text-[hsl(var(--e-foreground))] [overflow-wrap:anywhere]">{example.text}</span> <span className="[overflow-wrap:anywhere]">— {example.why}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
      {rule.changedAt ? <p className={MUTED}>Last changed by {rule.changedBy ?? "unknown"}, {formatWhen(rule.changedAt, timeZone)}.</p> : <p className={MUTED}>Never switched on.</p>}
      {message ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{message}</p> : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {rule.enabled ? (
            <EButton type="button" size="sm" variant="outline" disabled={saving} onClick={() => void change(false)}>{saving ? "Saving…" : "Switch off"}</EButton>
          ) : (
            <EButton type="button" size="sm" disabled={saving || "failed" in preview} onClick={() => void change(true)}>{saving ? "Saving…" : "Switch on with this preview"}</EButton>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function ReminderRules({ timeZone = "Australia/Sydney", refreshKey = 0, onChanged }: { timeZone?: string; refreshKey?: number; onChanged?: () => void }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/admin/settings/reminder-rules", { cache: "no-store", signal: controller.signal });
        const body = (await response.json().catch(() => null)) as (Payload & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.rules) return setLoad({ status: "failed", message: body?.error ?? "Could not load the reminder rules." });
        setLoad({ status: "ready", data: body });
      } catch {
        if (!controller.signal.aborted) setLoad({ status: "failed", message: "Could not load the reminder rules." });
      }
    })();
    return () => controller.abort();
  }, [version, refreshKey]);

  if (load.status === "loading") return <p role="status" className={MUTED}>Loading rules…</p>;
  if (load.status === "failed") {
    return (
      <EAlert tone="danger" title="Rules could not be loaded">
        <p>{load.message}</p>
        <EButton type="button" size="sm" variant="outline" className="mt-2" onClick={() => setVersion((value) => value + 1)}>Try again</EButton>
      </EAlert>
    );
  }
  const { data } = load;
  return (
    <div className="space-y-4">
      {data.pilot !== "ON" && data.pilot !== "SCOPED" ? (
        <EAlert tone="warning">The &ldquo;Property reminders&rdquo; pilot is {data.pilot === "UNREADABLE" ? "unreadable (counts as off)" : "off"}: cleaners see no reminders from these rules until it is on.</EAlert>
      ) : null}
      {!data.readable ? <EAlert tone="warning">The stored rule switches could not be read, so every rule counts as off.</EAlert> : null}
      {!data.canEdit ? <p className={MUTED}>Only an administrator can switch rules.</p> : null}
      <p className={MUTED}>Live plants is built in: with the pilot on, a property marked as having live plants always gets its before-start reminder. Hand-over notes from the last clean are already shown in Read first as unfinished tasks.</p>
      <ul className="space-y-3">
        {data.rules.map((rule) => (
          <RuleCard key={`${rule.key}-${rule.enabled}-${rule.changedAt ?? ""}`} rule={rule} canEdit={data.canEdit} timeZone={timeZone} onChanged={() => { setVersion((value) => value + 1); onChanged?.(); }} />
        ))}
      </ul>
    </div>
  );
}
