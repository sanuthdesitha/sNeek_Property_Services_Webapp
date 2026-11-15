"use client";

/**
 * Editor beside the message template list (board "Message templates",
 * 2026-11-17): name, category, channel (Email / SMS / Both), when it is sent
 * automatically, job type, subject and message with variable chips that insert
 * at the cursor, the variable warning with a one-click replace of the old
 * names, a preview for a real client (the same preview route the inbox uses;
 * "[not filled]" instead of a gap; nothing is sent) and "Where it is used".
 *
 * Saves are guarded: the editor sends the updatedAt it loaded and a 409 keeps
 * the draft with an explicit "Load their version". Fields freeze while saving;
 * a failed save keeps the draft. Delete is tier B with "Switch off instead"
 * offered first. Without write access (communications pack at View) the list,
 * preview and "Where it is used" stay, with no editing.
 */
import * as React from "react";
import Link from "next/link";
import { JobType } from "@prisma/client";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { E_INPUT_CLASS, EField, EInput, ESelect, ESwitch } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import {
  DESTINATION_LABEL,
  LEGACY_NAMES,
  VARIABLE_CHIPS,
  isLegacyName,
  replaceLegacyNames,
  replaceableLegacyNames,
  smsLength,
  unfilledNames,
} from "@/lib/messages/template-variables";
import {
  AUTOMATION_TRIGGER_LABEL,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  TRIGGER_LABEL,
  destinationsOf,
  draftOf,
  sameDraft,
  type MessageChannel,
  type MessageTemplateDraft,
  type MessageTemplateRecord,
  type MessageTrigger,
  type TemplateUsage,
} from "./message-template-model";

type ClientOption = { id: string; name: string };
type PreviewState = { status: "idle" | "loading" | "ready" | "failed"; subject?: string; body?: string };

export type MessageTemplateEditorProps = {
  /** The saved record, or null for a new template. */
  record: MessageTemplateRecord | null;
  draft: MessageTemplateDraft;
  onDraftChange: (draft: MessageTemplateDraft) => void;
  usage: TemplateUsage | null;
  usageFailed: boolean;
  canWrite: boolean;
  onSaved: (record: MessageTemplateRecord) => void;
  onDeleted: (id: string) => void;
  onDiscard: () => void;
  onBack?: () => void;
};

const CHANNELS: ReadonlyArray<{ key: MessageChannel; label: string }> = [
  { key: "EMAIL", label: "Email" },
  { key: "SMS", label: "SMS" },
  { key: "BOTH", label: "Both" },
];

const TRIGGERS: readonly MessageTrigger[] = ["MANUAL", "POST_JOB", "REVIEW_REQUEST", "DISCOUNT", "NEXT_CLEAN"];

function jobTypeWords(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
}

function errorText(body: unknown, fallback: string): string {
  return body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : fallback;
}

function usePreview(draft: MessageTemplateDraft, clientId: string | null): PreviewState {
  const [state, setState] = React.useState<PreviewState>({ status: "idle" });
  React.useEffect(() => {
    if (!clientId || !draft.body.trim()) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState((current) => ({ ...current, status: "loading" }));
      fetch("/api/admin/messages/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ subject: draft.channel === "SMS" ? undefined : draft.subject || undefined, body: draft.body, context: { clientId }, markMissing: true }),
      })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as { subject?: string; body?: string } | null;
          if (controller.signal.aborted) return;
          if (!response.ok || !body || typeof body.body !== "string") throw new Error("preview");
          setState({ status: "ready", subject: body.subject, body: body.body });
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ status: "failed" });
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [draft.body, draft.subject, draft.channel, clientId]);
  return state;
}

function useClientSearch(query: string): ClientOption[] {
  const [results, setResults] = React.useState<ClientOption[]>([]);
  React.useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/admin/messages/recipients?type=client&q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as { recipients?: Array<{ id: string; name: string; kind: string }> } | null;
          if (controller.signal.aborted) return;
          setResults(response.ok ? (body?.recipients ?? []).filter((row) => row.kind === "client").map((row) => ({ id: row.id, name: row.name })) : []);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return results;
}

/** Inserts `{{token}}` at the caret of a text control and returns the new value. */
function insertAtCaret(element: HTMLInputElement | HTMLTextAreaElement | null, value: string, token: string): { value: string; caret: number } {
  const insert = `{{${token}}}`;
  const start = element?.selectionStart ?? value.length;
  const end = element?.selectionEnd ?? value.length;
  return { value: value.slice(0, start) + insert + value.slice(end), caret: start + insert.length };
}

function VariableWarning({ draft, usage, canWrite, onReplace }: { draft: MessageTemplateDraft; usage: TemplateUsage | null; canWrite: boolean; onReplace: () => void }) {
  const texts = [draft.channel === "SMS" ? "" : draft.subject, draft.body];
  const reports = unfilledNames(texts, destinationsOf(draft, usage));
  if (reports.length === 0) return null;
  const legacy = Array.from(new Set(reports.flatMap((report) => report.names.filter(isLegacyName))));
  const replaceable = Array.from(new Set(texts.flatMap((text) => replaceableLegacyNames(text))));
  const others = reports
    .map((report) => ({ destination: report.destination, names: report.names.filter((name) => !isLegacyName(name)) }))
    .filter((report) => report.names.length > 0);
  return (
    <div role="status" className={cn("flex flex-wrap items-start justify-between gap-3 rounded-[var(--e-radius)] px-3 py-2.5 text-[0.8125rem]", toneNoticeClass("attention"))}>
      <div className="min-w-0 flex-1 space-y-1">
        {legacy.length > 0 ? (
          <>
            <p className="font-[600]">{legacy.map((name) => `{{${name}}}`).join(", ")} {legacy.length === 1 ? "is" : "are"} not filled where this template is used</p>
            <p>
              The old names ({LEGACY_NAMES.join(", ")}) only work in client automations. In the inbox, Compose and campaigns they are not filled
              {replaceable.length > 0 ? "; Replace swaps each for the dotted name that fills the same way." : "."}
              {legacy.includes("feedback_url") ? " feedback_url has no equivalent outside client automations." : ""}
            </p>
          </>
        ) : null}
        {others.map((report) => (
          <p key={report.destination}>
            Not filled in {DESTINATION_LABEL[report.destination]}: {report.names.map((name) => `{{${name}}}`).join(", ")}.
            {report.destination === "inbox" ? " The inbox insert knows only the client; Compose fills the rest when you pick a job or property." : ""}
            {report.destination === "campaign" ? " A campaign stops rather than send a name it cannot fill." : ""}
          </p>
        ))}
      </div>
      {canWrite && replaceable.length > 0 ? (
        <EButton size="sm" variant="outline" onClick={onReplace}>
          {replaceable.length === 1 ? "Replace it" : "Replace them"}
        </EButton>
      ) : null}
    </div>
  );
}

function WhereUsed({ draft, usage, usageFailed }: { draft: MessageTemplateDraft; usage: TemplateUsage | null; usageFailed: boolean }) {
  const automations = usage?.automations ?? [];
  const campaigns = usage?.campaigns ?? [];
  return (
    <section aria-labelledby="where-used-heading" className="min-w-0 space-y-2">
      <h4 id="where-used-heading" className="text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">Where it is used</h4>
      <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
        <p className="font-[600]">Inbox · Insert template</p>
        <p className="text-[hsl(var(--e-text-secondary))]">
          {draft.isActive ? "Any office reply to a client, and Messages › Compose. Filled for that person before it goes into the box." : "Switched off: not offered in the inbox or Compose."}
        </p>
      </div>
      <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
        <p className="font-[600]">Client automations · {usageFailed ? "–" : automations.length}</p>
        {usageFailed ? (
          <p className="text-[hsl(var(--e-danger))]">Could not be read. Try again later.</p>
        ) : automations.length === 0 ? (
          <p className="text-[hsl(var(--e-text-secondary))]">None</p>
        ) : (
          <ul className="space-y-0.5 text-[hsl(var(--e-text-secondary))]">
            {automations.map((rule) => (
              <li key={rule.ruleId} className="break-words">
                {rule.clientName}: &ldquo;{AUTOMATION_TRIGGER_LABEL[rule.triggerType] ?? rule.triggerType}&rdquo; after each job, {rule.delayMinutes} min delay{rule.isEnabled ? "" : " (switched off)"}.{" "}
                <Link href={`/v2/admin/clients/${encodeURIComponent(rule.clientId)}`} className="font-[600] text-[hsl(var(--e-primary))] underline">Open</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3 text-[0.8125rem]">
        <p className="font-[600]">Campaigns</p>
        {usageFailed ? (
          <p className="text-[hsl(var(--e-danger))]">Could not be read.</p>
        ) : campaigns.length === 0 ? (
          <p className="text-[hsl(var(--e-text-secondary))]">None</p>
        ) : (
          <ul className="space-y-0.5 text-[hsl(var(--e-text-secondary))]">
            {campaigns.map((campaign) => (
              <li key={campaign.id} className="break-words">{campaign.name} · {campaign.status}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function MessageTemplateEditor({ record, draft, onDraftChange, usage, usageFailed, canWrite, onSaved, onDeleted, onDiscard, onBack }: MessageTemplateEditorProps) {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conflict, setConflict] = React.useState<MessageTemplateRecord | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [clientQuery, setClientQuery] = React.useState("");
  const [previewClient, setPreviewClient] = React.useState<ClientOption | null>(null);
  const subjectRef = React.useRef<HTMLInputElement>(null);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);
  const lastFocus = React.useRef<"subject" | "body">("body");
  const searchResults = useClientSearch(clientQuery);
  const preview = usePreview(draft, previewClient?.id ?? null);
  const dirty = record ? !sameDraft(draft, draftOf(record)) : true;
  const sms = draft.channel !== "EMAIL" ? smsLength(draft.body) : null;
  const locked = !canWrite || saving;

  const automationClients = React.useMemo(() => {
    const seen = new Map<string, ClientOption>();
    for (const rule of usage?.automations ?? []) seen.set(rule.clientId, { id: rule.clientId, name: rule.clientName });
    return Array.from(seen.values());
  }, [usage]);

  // A different template starts with no message, conflict or preview client of the last one.
  React.useEffect(() => {
    setError(null);
    setConflict(null);
    setStatus(null);
    setPreviewClient(null);
  }, [record?.id]);

  React.useEffect(() => {
    if (!previewClient && automationClients[0]) setPreviewClient(automationClients[0]);
  }, [automationClients, previewClient]);

  function set<K extends keyof MessageTemplateDraft>(key: K, value: MessageTemplateDraft[K]) {
    onDraftChange({ ...draft, [key]: value });
  }

  function insertToken(token: string) {
    if (!canWrite) return;
    const target = lastFocus.current === "subject" && draft.channel !== "SMS" ? "subject" : "body";
    const element = target === "subject" ? subjectRef.current : bodyRef.current;
    const next = insertAtCaret(element, target === "subject" ? draft.subject ?? "" : draft.body, token);
    set(target, next.value);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.caret, next.caret);
    });
  }

  function replaceOldNames() {
    onDraftChange({ ...draft, subject: replaceLegacyNames(draft.subject ?? ""), body: replaceLegacyNames(draft.body) });
  }

  async function save() {
    if (!draft.name.trim() || !draft.body.trim()) {
      setError("A name and a message are needed before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    setStatus(null);
    const payload = {
      name: draft.name.trim(),
      triggerType: draft.triggerType,
      jobType: draft.jobType || null,
      channel: draft.channel,
      category: draft.category,
      subject: draft.channel === "SMS" ? null : draft.subject || null,
      body: draft.body,
      isActive: draft.isActive,
      ...(record ? { expectedUpdatedAt: record.updatedAt } : {}),
    };
    try {
      const response = await fetch(record ? `/api/admin/message-templates/${record.id}` : "/api/admin/message-templates", {
        method: record ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 409) {
        const current = (body as { current?: MessageTemplateRecord } | null)?.current ?? null;
        setConflict(current);
        setError(errorText(body, "Someone else saved this template. Your changes are kept here."));
        return;
      }
      if (!response.ok) {
        setError(`The template was not saved: ${errorText(body, `the server answered ${response.status}`)}. Your changes are kept.`);
        return;
      }
      onSaved(body as MessageTemplateRecord);
      setStatus("Template saved.");
    } catch {
      setError("The template was not saved: the server could not be reached. Your changes are kept.");
    } finally {
      setSaving(false);
    }
  }

  async function switchOff() {
    if (!record) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/admin/message-templates/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false, expectedUpdatedAt: record.updatedAt }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setDeleteError(`It was not switched off: ${errorText(body, `the server answered ${response.status}`)}.`);
        return;
      }
      setDeleteOpen(false);
      onSaved(body as MessageTemplateRecord);
      setStatus("Template switched off.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function remove() {
    if (!record) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/admin/message-templates/${record.id}`, { method: "DELETE" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setDeleteError(`It was not deleted: ${errorText(body, `the server answered ${response.status}`)}.`);
        return;
      }
      setDeleteOpen(false);
      onDeleted(record.id);
    } finally {
      setDeleteBusy(false);
    }
  }

  const automationCount = usage?.automations.length ?? 0;
  const title = draft.name.trim() || (record ? record.name : "New message template");

  return (
    <ECard className="min-w-0 p-4 sm:p-5" data-unsaved={canWrite && dirty ? "true" : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <EButton variant="ghost" size="sm" className="lg:hidden" onClick={onBack}>
              ← Templates
            </EButton>
          ) : null}
          <h3 className="min-w-0 break-words text-[1rem] font-[600]">{title}</h3>
        </div>
        <div className="flex items-center gap-2">
          <ESwitch checked={draft.isActive} disabled={locked} onCheckedChange={(value) => set("isActive", value)} label={draft.isActive ? "On" : "Off"} />
          {canWrite && record ? (
            <ERowMenu label={`More actions for ${record.name}`} items={[{ key: "delete", label: "Delete…", danger: true, onSelect: () => { setDeleteError(null); setDeleteOpen(true); } }]} />
          ) : null}
        </div>
      </div>

      <fieldset disabled={locked} className="mt-4 min-w-0 space-y-4">
        <legend className="sr-only">{canWrite ? "Edit the template" : "Template (read only)"}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <EField label="Name">
            <EInput value={draft.name} onChange={(event) => set("name", event.target.value)} placeholder="e.g. Booking confirmed" className="max-sm:h-11 max-sm:text-base" />
          </EField>
          <EField label="Category">
            <ESelect value={draft.category} onChange={(event) => set("category", event.target.value as MessageTemplateDraft["category"])} className="max-sm:h-11 max-sm:text-base">
              {CATEGORY_ORDER.map((category) => <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>)}
            </ESelect>
          </EField>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-1.5">
            <span id="channel-label" className="block text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Channel</span>
            <div role="radiogroup" aria-labelledby="channel-label" className="flex overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))]">
              {CHANNELS.map((channel, index) => (
                <button
                  key={channel.key}
                  type="button"
                  role="radio"
                  aria-checked={draft.channel === channel.key}
                  onClick={() => set("channel", channel.key)}
                  className={cn(
                    "min-h-10 flex-1 px-3 text-[0.8125rem] font-[550] max-sm:min-h-11",
                    index > 0 && "border-l border-[hsl(var(--e-border))]",
                    draft.channel === channel.key ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "text-[hsl(var(--e-text-secondary))]",
                  )}
                >
                  {channel.label}
                </button>
              ))}
            </div>
          </div>
          <EField label="Sent automatically on">
            <ESelect value={draft.triggerType} onChange={(event) => set("triggerType", event.target.value as MessageTrigger)} className="max-sm:h-11 max-sm:text-base">
              {TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{TRIGGER_LABEL[trigger]}</option>)}
            </ESelect>
          </EField>
          <EField label="Job type">
            <ESelect value={draft.jobType ?? ""} onChange={(event) => set("jobType", event.target.value || null)} className="max-sm:h-11 max-sm:text-base">
              <option value="">All job types</option>
              {draft.jobType && !Object.values(JobType).includes(draft.jobType as JobType) ? <option value={draft.jobType}>{draft.jobType}</option> : null}
              {Object.values(JobType).map((type) => <option key={type} value={type}>{jobTypeWords(type)}</option>)}
            </ESelect>
          </EField>
        </div>
        {draft.channel !== "SMS" ? (
          <EField label="Subject" hint={draft.channel === "BOTH" ? "Used for the email only." : undefined}>
            <EInput
              ref={subjectRef}
              value={draft.subject ?? ""}
              onFocus={() => { lastFocus.current = "subject"; }}
              onChange={(event) => set("subject", event.target.value)}
              placeholder="You're booked: {{property.name}}"
              className="max-sm:h-11 max-sm:text-base"
            />
          </EField>
        ) : null}
        <div className="space-y-1.5">
          <label htmlFor="message-template-body" className="block text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Message</label>
          <textarea
            id="message-template-body"
            ref={bodyRef}
            rows={draft.channel === "SMS" ? 5 : 8}
            value={draft.body}
            onFocus={() => { lastFocus.current = "body"; }}
            onChange={(event) => set("body", event.target.value)}
            aria-describedby={sms ? "message-template-count" : undefined}
            placeholder="Hi {{client.firstName}}, …"
            className={cn(E_INPUT_CLASS, "h-auto min-h-[8rem] py-2 font-[inherit] max-sm:text-base")}
          />
          {sms ? (
            <p id="message-template-count" className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              {sms.characters} characters · {sms.texts} text{sms.texts === 1 ? "" : "s"}{draft.channel === "BOTH" ? " (for the SMS)" : ""}. Variables count once filled in.
            </p>
          ) : null}
        </div>
      </fieldset>

      {canWrite ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Insert a variable at the cursor</p>
          <div className="flex flex-wrap gap-1.5">
            {VARIABLE_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                disabled={saving}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertToken(chip)}
                className="min-h-8 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-info)/0.35)] bg-[hsl(var(--e-info-soft))] px-2 font-mono text-[0.75rem] text-[hsl(var(--e-info))] max-sm:min-h-11"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3">
        <VariableWarning draft={draft} usage={usage} canWrite={canWrite && !saving} onReplace={replaceOldNames} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-labelledby="template-preview-heading" className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h4 id="template-preview-heading" className="text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">Preview for a real client</h4>
            <ESelect
              aria-label="Client for the preview"
              value={previewClient?.id ?? ""}
              onChange={(event) => {
                const all = [...automationClients, ...searchResults];
                setPreviewClient(all.find((client) => client.id === event.target.value) ?? null);
              }}
              className="h-9 w-auto max-w-[14rem] max-sm:h-11"
            >
              <option value="">Choose a client</option>
              {[...automationClients, ...searchResults.filter((row) => !automationClients.some((client) => client.id === row.id))].map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
              {previewClient && ![...automationClients, ...searchResults].some((client) => client.id === previewClient.id) ? <option value={previewClient.id}>{previewClient.name}</option> : null}
            </ESelect>
          </div>
          <EInput aria-label="Find a client for the preview" value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Find a client by name" className="h-9 max-sm:h-11 max-sm:text-base" />
          <div className="min-h-[7rem] whitespace-pre-wrap break-words rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-3 text-[0.8125rem]" aria-live="polite">
            {!previewClient ? (
              <span className="text-[hsl(var(--e-text-faint))]">Choose a client to see the message filled for them.</span>
            ) : preview.status === "failed" ? (
              <span role="alert" className="text-[hsl(var(--e-danger))]">The preview could not be made. Try again.</span>
            ) : preview.status === "idle" ? (
              <span className="text-[hsl(var(--e-text-faint))]">Write a message to preview it.</span>
            ) : (
              <>
                {preview.status === "loading" ? <span className="sr-only">Updating preview…</span> : null}
                {preview.subject ? <span className="block font-[600]">{preview.subject}</span> : null}
                {preview.body ?? "Loading…"}
              </>
            )}
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Filled by the same preview the inbox uses. Nothing is sent.</p>
        </section>
        <WhereUsed draft={draft} usage={usage} usageFailed={usageFailed} />
      </div>

      {error ? (
        <div role="alert" className={cn("mt-4 rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem]", toneNoticeClass("problem"))}>
          <p>{error}</p>
          {conflict ? (
            <EButton size="sm" variant="outline" className="mt-2" onClick={() => { onSaved(conflict); setConflict(null); setError(null); }}>
              Load their version
            </EButton>
          ) : null}
        </div>
      ) : null}
      {status ? <p role="status" className="mt-3 text-[0.8125rem] text-[hsl(var(--e-success))]">{status}</p> : null}

      {canWrite ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--e-border))] pt-4">
          <p className="min-w-0 flex-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            {dirty ? "Unsaved changes stay if you click another template; it asks first." : "No unsaved changes."}
          </p>
          <div className="flex gap-2 max-sm:w-full">
            <EButton variant="outline" disabled={saving || (!dirty && Boolean(record))} onClick={onDiscard} className="max-sm:flex-1">Discard</EButton>
            <EButton disabled={saving || (!dirty && Boolean(record))} onClick={() => void save()} className="max-sm:flex-1">{saving ? "Saving…" : record ? "Save template" : "Create template"}</EButton>
          </div>
        </div>
      ) : (
        <p className="mt-4 border-t border-[hsl(var(--e-border))] pt-3 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
          Read only: your account can see templates, previews and where they are used, but not change them.
        </p>
      )}

      <EConfirmDialog
        open={deleteOpen}
        onClose={() => { if (!deleteBusy) setDeleteOpen(false); }}
        tier="destructive"
        title={`Delete "${record?.name ?? "template"}"?`}
        description={
          automationCount > 0
            ? `${automationCount} client automation${automationCount === 1 ? " uses" : "s use"} it and will stop sending until someone picks another template. Messages already sent keep their wording. This cannot be undone; switching it off can.`
            : "Messages already sent keep their wording. This cannot be undone; switching it off can."
        }
        confirmLabel="Delete template"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => remove()}
      >
        {record?.isActive ? (
          <EButton variant="ghost" size="sm" disabled={deleteBusy} onClick={() => void switchOff()}>
            Switch off instead
          </EButton>
        ) : null}
      </EConfirmDialog>
    </ECard>
  );
}

