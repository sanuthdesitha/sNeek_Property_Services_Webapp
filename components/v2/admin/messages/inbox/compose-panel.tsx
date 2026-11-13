"use client";
import { AiDraftButton } from "@/components/v2/shared/ai-help";

/**
 * "New message, with a template" column: To (search clients and users),
 * Template, Email / SMS / Both as explicit transports (a transport the
 * recipient cannot receive is disabled with the reason), Subject, Message,
 * what the variables are filled from (client from the recipient, one of the
 * client's properties, a job or quote reference) with a check, the preview,
 * and Send with a per-transport outcome.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, X } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import { TRANSPORT_LABEL, checkVariables, sendBlock, sendButtonLabel, transportOptions } from "@/lib/messages/compose-checks";
import { useTemplates } from "./template-insert";
import type { ComposeState } from "./use-compose";

const SMALL = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

function RecipientPicker({ compose }: { compose: ComposeState }) {
  const c = compose;
  if (c.recipient) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
        <span className="min-w-0 text-[0.8125rem]">
          <b className="block truncate">{c.recipient.name}</b>
          <span className={SMALL}>{c.recipient.kind === "client" ? "Client" : `User${c.recipient.role ? ` · ${c.recipient.role}` : ""}`} · {c.recipient.email ?? "no email"} · {c.recipient.phone ?? "no phone"}</span>
        </span>
        <EButton size="sm" variant="ghost" onClick={() => c.setRecipient(null)}>Change</EButton>
      </div>
    );
  }
  return (
    <div className="relative">
      <EField label="To">
        <EInput value={c.query} onChange={(e) => c.setQuery(e.target.value)} placeholder="Search clients or users by name, email or phone" autoComplete="off" />
      </EField>
      {c.searching ? <p role="status" className={SMALL}>Searching…</p> : null}
      {c.results.length > 0 ? (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-3)]">
          {c.results.map((r) => (
            <li key={`${r.kind}:${r.id}`}>
              <button type="button" className="block min-h-[44px] w-full px-3 py-2 text-left text-[0.8125rem] hover:bg-[hsl(var(--e-muted))]" onClick={() => c.setRecipient(r)}>
                <b>{r.name}</b>
                <span className={cn(SMALL, "block")}>{r.kind === "client" ? "Client" : `User${r.role ? ` · ${r.role}` : ""}`}{r.email ? ` · ${r.email}` : ""}{r.phone ? ` · ${r.phone}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FilledFrom({ compose }: { compose: ComposeState }) {
  const c = compose;
  const check = checkVariables(c.subject, c.body, c.sources);
  const set = (key: "jobId" | "propertyId" | "quoteId", value: string) => c.setSources((prev) => ({ ...prev, [key]: value.trim() || undefined }));
  return (
    <div className="space-y-2 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-2.5">
      <p className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">Filled from</p>
      <p className={SMALL}>{c.recipient ? `${c.recipient.kind === "client" ? "Client" : "Cleaner or user"}: ${c.recipient.name}` : "Choose a recipient to fill client variables."}</p>
      <EField label="Property">
        <ESelect value={c.sources.propertyId ?? ""} onChange={(e) => set("propertyId", e.target.value)} disabled={c.properties.length === 0}>
          <option value="">{c.recipient?.kind === "client" ? (c.properties.length ? "No property" : "This client has no properties") : "Only for a client"}</option>
          {c.properties.map((p) => <option key={p.id} value={p.id}>{p.name}{p.suburb ? ` — ${p.suburb}` : ""}</option>)}
        </ESelect>
      </EField>
      <div className="grid grid-cols-2 gap-2">
        <EField label="Job ID"><EInput value={c.sources.jobId ?? ""} onChange={(e) => set("jobId", e.target.value)} placeholder="Optional" /></EField>
        <EField label="Quote ID"><EInput value={c.sources.quoteId ?? ""} onChange={(e) => set("quoteId", e.target.value)} placeholder="Optional" /></EField>
      </div>
      {check.state === "sourced" ? <EPill tone="ok">All variables have a source</EPill> : null}
      {check.state === "missing" ? (
        <p role="status" className="text-[0.75rem] text-[hsl(var(--e-warning))]">
          {check.missing.map((m) => `{{${m.root}…}} needs ${m.needs}`).join("; ")}. Without one it is left blank.
        </p>
      ) : null}
    </div>
  );
}

export function ComposePanel({ compose, canSend, showBack, onClose }: { compose: ComposeState; canSend: boolean; showBack: boolean; onClose: () => void }) {
  const c = compose;
  const templates = useTemplates(true);
  const options = transportOptions(c.recipient);
  const block = sendBlock({ canSend, recipient: c.recipient, transport: c.transport, body: c.body, sending: c.sending });
  const failed = c.outcomes.some((o) => o.state !== "sent");
  const smsOnly = c.transport === "SMS";

  return (
    <aside aria-label="Compose with a template" className="flex min-w-0 flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
      <div className="flex items-center gap-2">
        {showBack ? <button type="button" aria-label="Back" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-[hsl(var(--e-muted))] lg:hidden"><ArrowLeft className="h-5 w-5" /></button> : null}
        <h2 className="flex-1 text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">New message, with a template</h2>
        <button type="button" aria-label="Close composer" onClick={onClose} className="hidden h-9 w-9 items-center justify-center rounded-full hover:bg-[hsl(var(--e-muted))] lg:flex"><X className="h-4 w-4" /></button>
      </div>
      <p className={SMALL}>Variables fill from the client, property or job you pick. Templates are managed in <Link className="font-[600] underline" href="/v2/admin/forms?tab=messages">Forms</Link>.</p>
      <fieldset disabled={c.sending} className="min-w-0 space-y-3">
        <RecipientPicker compose={c} />
        <EField label="Template">
          <ESelect value={c.templateId ?? ""} onChange={(e) => c.applyTemplate(templates.rows.find((t) => t.id === e.target.value) ?? null)}>
            <option value="">{templates.status === "loading" ? "Loading templates…" : templates.status === "failed" ? "Templates could not load" : "No template (write your own)"}</option>
            {templates.rows.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.channel === "BOTH" ? "Email or SMS" : t.channel === "SMS" ? "SMS" : "Email"}</option>)}
          </ESelect>
        </EField>
        <div className="space-y-1">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Send by">
            {options.map((o) => (
              <button
                key={o.transport}
                type="button"
                role="radio"
                aria-checked={c.transport === o.transport}
                disabled={!o.enabled}
                title={o.reason ?? undefined}
                onClick={() => c.setTransport(o.transport)}
                className={cn("inline-flex min-h-[36px] items-center rounded-[var(--e-radius-pill)] border px-3 text-[0.8125rem] font-[550] disabled:cursor-not-allowed disabled:opacity-50", c.transport === o.transport ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]" : "border-[hsl(var(--e-border-strong))]")}
              >
                {TRANSPORT_LABEL[o.transport]}
              </button>
            ))}
          </div>
          {options.filter((o) => !o.enabled && o.transport !== "BOTH" && c.recipient).map((o) => <p key={o.transport} className={SMALL}>{o.reason}</p>)}
        </div>
        {!smsOnly ? <EField label="Subject"><EInput value={c.subject} onChange={(e) => c.setSubject(e.target.value)} placeholder="Subject line; supports {{variables}}" /></EField> : null}
        <EField label="Message" hint={c.transport !== "EMAIL" ? `${c.body.length} / 320 characters for SMS` : undefined}>
          <ETextarea value={c.body} onChange={(e) => c.setBody(e.target.value)} rows={smsOnly ? 5 : 8} placeholder="Supports {{client.firstName}}, {{property.name}}, {{job.scheduledFor | date short}} …" />
        </EField>
        {c.recipient?.kind === "client" ? <AiDraftButton scopeKey={c.recipient.id} withIntent request={{ kind: "client_reply", clientId: c.recipient.id }} onUse={(draft) => c.setBody(draft)} /> : null}
        <FilledFrom compose={c} />
      </fieldset>
      <div className="space-y-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
        <p className="text-[0.6875rem] font-[600] uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">Preview</p>
        {c.previewState === "idle" ? <p className={SMALL}>Write a message to see it with the variables filled.</p> : null}
        {c.previewState === "loading" ? <p role="status" className={SMALL}>Filling variables…</p> : null}
        {c.previewState === "failed" ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">The preview could not be made.</p> : null}
        {c.previewState === "ready" && c.preview ? (
          <div className="space-y-1 text-[0.8125rem]">
            {!smsOnly && c.preview.subject ? <p><b>Subject:</b> {c.preview.subject}</p> : null}
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{c.preview.body || "(empty)"}</p>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <EButton size="sm" variant="outline" onClick={c.clear} disabled={c.sending}>Clear</EButton>
        <span className="flex-1" />
        {failed ? <EButton size="sm" variant="outline" onClick={() => void c.retryFailed()} disabled={c.sending || !canSend}>Retry failed</EButton> : null}
        <EButton size="sm" onClick={() => void c.send()} disabled={block.blocked} title={block.reason ?? undefined}>{c.sending ? "Sending…" : sendButtonLabel(c.transport)}</EButton>
      </div>
      {block.blocked && block.reason && !c.sending ? <p className={SMALL}>{block.reason}</p> : null}
      {c.outcomes.length > 0 ? (
        <ul role="status" className="space-y-1">
          {c.outcomes.map((o) => (
            <li key={o.channel} className="flex flex-wrap items-center gap-2 text-[0.75rem]">
              <EPill tone={o.state === "sent" ? "ok" : o.state === "skipped" ? "warn" : "bad"}>{o.state === "sent" ? "Handed over" : o.state === "skipped" ? "Not sent" : "Failed"}</EPill>
              <span className="min-w-0 [overflow-wrap:anywhere]">{o.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
