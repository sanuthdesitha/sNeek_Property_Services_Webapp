"use client";

/**
 * Brand frames and caption templates (2026-11-17): the free caption source.
 * Hooks rotate so two posts in a row do not open the same way. Saving is
 * revisioned (409 keeps the edit and offers the newer copy) and audited.
 */
import * as React from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { networkDefinition } from "@/lib/marketing/social/networks";
import type { CaptionTemplate, SocialTemplates } from "@/lib/marketing/social/captions";
import { socialRequest, SOCIAL_API } from "./social-api";

type Load = { state: "loading" } | { state: "failed"; message: string } | { state: "ready"; templates: SocialTemplates; readable: boolean };

export function TemplatesEditor() {
  const [load, setLoad] = React.useState<Load>({ state: "loading" });
  const [editing, setEditing] = React.useState<CaptionTemplate | null>(null);
  const [draft, setDraft] = React.useState<{ hooks: string; body: string; businessBody: string; cta: string } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const read = React.useCallback(async (signal?: AbortSignal) => {
    const result = await socialRequest<{ templates: SocialTemplates; readable: boolean }>(`${SOCIAL_API}/templates`, { signal });
    if (signal?.aborted) return;
    setLoad(result.ok ? { state: "ready", templates: result.data.templates, readable: result.data.readable } : { state: "failed", message: result.error });
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [read]);

  function open(template: CaptionTemplate) {
    setEditing(template);
    setDraft({ hooks: template.hooks.join("\n"), body: template.body, businessBody: template.businessBody, cta: template.cta });
    setError(null);
  }

  async function save() {
    if (load.state !== "ready" || !editing || !draft) return;
    setSaving(true);
    setError(null);
    const { revision, ...rest } = load.templates;
    const templates = rest.templates.map((template) => (template.key === editing.key ? { ...template, hooks: draft.hooks.split("\n").map((hook) => hook.trim()).filter(Boolean), body: draft.body, businessBody: draft.businessBody, cta: draft.cta } : template));
    const result = await socialRequest<{ templates: SocialTemplates }>(`${SOCIAL_API}/templates`, { method: "PUT", body: { expectedRevision: revision, templates: { ...rest, templates } } });
    setSaving(false);
    if (!result.ok) {
      setError(result.status === 409 ? "Someone saved the templates since you opened them. Your edit is kept here; reload to see theirs." : `${result.error}${result.problems.length ? ` (${result.problems.join(", ")})` : ""}`);
      return;
    }
    setLoad({ state: "ready", templates: result.data.templates, readable: true });
    setEditing(null);
  }

  return (
    <>
      <section id="frames" aria-labelledby="social-frames-heading" className="space-y-3">
        <h2 id="social-frames-heading" className="font-serif text-[1.25rem]">3 Brand frames</h2>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Drawn on the server in the Estate look. Text inside a frame is also written into the caption.</p>
        {load.state === "ready" ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {load.templates.frames.map((frame) => (
              <li key={frame.key}>
                <ECard className="overflow-hidden">
                  <div className="flex aspect-[4/5] flex-col justify-end bg-[hsl(var(--e-surface-sunken))]">
                    <div className="flex items-center justify-between gap-2 bg-[hsl(var(--e-primary))] px-3 py-2 text-[hsl(var(--e-primary-foreground))]">
                      <span className="font-serif text-[0.9375rem]">sNeek</span>
                      <span className="text-[0.75rem] opacity-90">{frame.line}</span>
                    </div>
                  </div>
                  <div className="p-3 text-[0.8125rem]"><p className="font-[600]">{frame.name}{frame.enabled ? " · default" : ""}</p><p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Company name and one line, up to 32 characters. Safe for 1:1 and 4:5.</p></div>
                </ECard>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section id="templates" aria-labelledby="social-templates-heading" className="space-y-3">
        <h2 id="social-templates-heading" className="font-serif text-[1.25rem]">4 Caption templates and hashtag sets</h2>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">The free caption source. Hooks rotate so two posts in a row do not open the same way.</p>
        {load.state === "loading" ? <p role="status" className="text-[0.8125rem]">Loading templates…</p> : null}
        {load.state === "failed" ? <EToneNotice tone="problem" role="alert">Templates could not be loaded: {load.message}</EToneNotice> : null}
        {load.state === "ready" && !load.readable ? <EToneNotice tone="attention">The saved templates could not be read, so the standard ones are shown. Saving replaces them.</EToneNotice> : null}
        {load.state === "ready" ? (
          <ECard className="space-y-3 p-4">
            <ul className="space-y-3">
              {load.templates.templates.map((template) => (
                <li key={template.key} className="space-y-1 border-b border-[hsl(var(--e-border))] pb-3 text-[0.8125rem] last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-[600]">{template.name} <span className="font-normal text-[hsl(var(--e-muted-foreground))]">· {template.formats.map((format) => format.toLowerCase().replace("_", " ")).join(", ")}</span></p>
                    <EButton size="sm" variant="ghost" onClick={() => open(template)}>Edit</EButton>
                  </div>
                  <p className="text-[0.75rem] [overflow-wrap:anywhere]">Hooks: {template.hooks.slice(0, 2).map((hook) => `"${hook}"`).join(" · ")}{template.hooks.length > 2 ? ` · +${template.hooks.length - 2}` : ""}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{template.body}</p>
                  {editing?.key === template.key && draft ? (
                    <fieldset disabled={saving} className="space-y-2 pt-2">
                      <legend className="sr-only">Edit {template.name}</legend>
                      <label className="block text-[0.75rem]">Hooks, one per line
                        <textarea rows={4} value={draft.hooks} onChange={(event) => setDraft({ ...draft, hooks: event.target.value })} className="mt-1 block w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2 max-sm:text-[1rem]" />
                      </label>
                      <label className="block text-[0.75rem]">Body ({"{home}"}, {"{rooms_list}"}, {"{room}"}, {"{suburb_in}"}, {"{link}"})
                        <textarea rows={3} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} className="mt-1 block w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2 max-sm:text-[1rem]" />
                      </label>
                      <label className="block text-[0.75rem]">LinkedIn body (business tone)
                        <textarea rows={2} value={draft.businessBody} onChange={(event) => setDraft({ ...draft, businessBody: event.target.value })} className="mt-1 block w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2 max-sm:text-[1rem]" />
                      </label>
                      <label className="block text-[0.75rem]">Call to action
                        <input value={draft.cta} onChange={(event) => setDraft({ ...draft, cta: event.target.value })} className="mt-1 block min-h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2 max-sm:text-[1rem]" />
                      </label>
                      {error ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
                      <div className="flex gap-2">
                        <EButton size="sm" onClick={() => void save()}>{saving ? "Saving…" : "Save template"}</EButton>
                        <EButton size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</EButton>
                      </div>
                    </fieldset>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Hashtag sets: {load.templates.hashtagSets.map((set) => `${set.name} (${set.tags.length})`).join(" · ")} · {networkDefinition("FACEBOOK").label} (none) · {networkDefinition("GOOGLE_BUSINESS").label} (none, not supported). {"{suburb_in}"} is left out when the owner did not allow naming the suburb; it is never replaced with a street, building or unit.
            </p>
          </ECard>
        ) : null}
      </section>
    </>
  );
}
