"use client";

/**
 * Composer state. Same routes and bodies as the old compose page:
 * recipients search, templates, live preview (`/preview`) and send
 * (`/send`, one channel per request; "Both" is two requests, each with its
 * own outcome). The send route checks `messages.compose_send`. A failed
 * channel keeps the draft and can be retried alone; nothing reads as sent
 * unless the route said so.
 */
import * as React from "react";
import { channelOutcome, channelsFor, reconcileTransport, type Channel, type ChannelOutcome, type ComposeRecipient, type Transport, type VariableSources } from "@/lib/messages/compose-checks";
import type { MessageTemplate } from "./template-insert";

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export type PropertyChoice = { id: string; name: string; suburb: string | null };

export function useCompose(initialRecipient: ComposeRecipient | null) {
  const [query, setQuery] = React.useState(initialRecipient?.name ?? "");
  const [results, setResults] = React.useState<ComposeRecipient[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [recipient, setRecipientRaw] = React.useState<ComposeRecipient | null>(initialRecipient);
  const [templateId, setTemplateId] = React.useState<string | null>(null);
  const [transport, setTransport] = React.useState<Transport | null>(reconcileTransport("EMAIL", initialRecipient));
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [sources, setSources] = React.useState<VariableSources>(initialRecipient ? { clientId: initialRecipient.id } : {});
  const [properties, setProperties] = React.useState<PropertyChoice[]>([]);
  const [preview, setPreview] = React.useState<{ subject?: string; body: string } | null>(null);
  const [previewState, setPreviewState] = React.useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [sending, setSending] = React.useState(false);
  const [outcomes, setOutcomes] = React.useState<ChannelOutcome[]>([]);
  const debouncedQuery = useDebounced(query, 250);
  const debouncedBody = useDebounced(body, 400);
  const debouncedSubject = useDebounced(subject, 400);

  React.useEffect(() => {
    if (recipient || debouncedQuery.trim().length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    fetch(`/api/admin/messages/recipients?q=${encodeURIComponent(debouncedQuery)}`, { signal: controller.signal })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { recipients?: ComposeRecipient[] };
        if (!controller.signal.aborted) setResults(res.ok ? data.recipients ?? [] : []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setSearching(false);
      });
    return () => controller.abort();
  }, [debouncedQuery, recipient]);

  // A client's properties fill property variables; reset whenever the client changes.
  const clientId = recipient?.kind === "client" ? recipient.id : null;
  React.useEffect(() => {
    setProperties([]);
    if (!clientId) return;
    const controller = new AbortController();
    fetch(`/api/admin/properties?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const rows: unknown = await res.json().catch(() => []);
        if (controller.signal.aborted || !res.ok || !Array.isArray(rows)) return;
        setProperties((rows as Array<Record<string, unknown>>).map((p) => ({ id: String(p.id), name: String(p.name ?? "Property"), suburb: typeof p.suburb === "string" ? p.suburb : null })));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [clientId]);

  const sourcesKey = JSON.stringify(sources);
  React.useEffect(() => {
    if (!debouncedBody.trim()) {
      setPreview(null);
      setPreviewState("idle");
      return;
    }
    const controller = new AbortController();
    setPreviewState("loading");
    fetch("/api/admin/messages/preview", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: debouncedSubject || undefined, body: debouncedBody, context: JSON.parse(sourcesKey) }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { subject?: string; body?: string };
        if (controller.signal.aborted) return;
        if (!res.ok) return setPreviewState("failed");
        setPreview({ subject: data.subject, body: data.body ?? "" });
        setPreviewState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreviewState("failed");
      });
    return () => controller.abort();
  }, [debouncedBody, debouncedSubject, sourcesKey]);

  function setRecipient(next: ComposeRecipient | null) {
    setRecipientRaw(next);
    setResults([]);
    setQuery(next?.name ?? "");
    setOutcomes([]);
    setTransport((current) => reconcileTransport(current, next));
    // Variable sources follow the recipient; job, property and quote are cleared with a new client.
    setSources(next ? (next.kind === "client" ? { clientId: next.id } : { cleanerId: next.id }) : {});
  }

  function applyTemplate(template: MessageTemplate | null) {
    setTemplateId(template?.id ?? null);
    if (!template) return;
    setSubject(template.subject ?? "");
    setBody(template.body);
    if (template.channel !== "BOTH") setTransport((current) => reconcileTransport(template.channel, recipient) ?? current);
  }

  async function sendChannels(channels: Channel[]) {
    if (!recipient) return;
    setSending(true);
    const next: ChannelOutcome[] = [];
    for (const channel of channels) {
      try {
        const res = await fetch("/api/admin/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateId: templateId ?? undefined,
            channel,
            recipientUserId: recipient.kind === "user" ? recipient.id : undefined,
            recipientEmail: channel === "EMAIL" ? recipient.email ?? undefined : undefined,
            recipientPhone: channel === "SMS" ? recipient.phone ?? undefined : undefined,
            subject: subject || undefined,
            body,
            context: sources,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; skipped?: boolean; status?: string; error?: string; provider?: string };
        next.push(channelOutcome(channel, res.ok, data));
      } catch {
        next.push({ channel, state: "failed", detail: `${channel === "EMAIL" ? "Email" : "SMS"} failed: the request did not reach the server.` });
      }
    }
    setOutcomes(next);
    setSending(false);
    if (next.every((o) => o.state === "sent")) {
      setBody("");
      setSubject("");
      setTemplateId(null);
    }
  }

  return {
    query, setQuery, results, searching, recipient, setRecipient,
    templateId, applyTemplate, transport, setTransport, subject, setSubject, body, setBody,
    sources, setSources, properties, preview, previewState,
    sending, outcomes,
    send: () => (transport ? sendChannels(channelsFor(transport)) : Promise.resolve()),
    retryFailed: () => sendChannels(outcomes.filter((o) => o.state !== "sent").map((o) => o.channel)),
    clear: () => {
      setBody("");
      setSubject("");
      setTemplateId(null);
      setOutcomes([]);
    },
  };
}

export type ComposeState = ReturnType<typeof useCompose>;
