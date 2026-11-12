"use client";

/**
 * Client Messages (board 6): the conversation with the sNeek team, with saved
 * and retry states.
 *   GET  /api/client/messages?withContext=1   → messages (asc) + account context header
 *   POST /api/client/messages                 { body, requestId } + context header
 *
 * A message is "Saved" only after the server returns its receipt for the same
 * request id. Anything else leaves it "Not confirmed" with "Retry the same
 * message", which resends the SAME request id, so a retry can never create a
 * second copy. The draft and any pending receipt are kept in this tab's
 * session storage under the account context; a different account never sees
 * them. Reads are serial, abortable and checked after parsing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { Briefcase, Loader2 } from "lucide-react";
import { ECard } from "@/components/v2/ui/primitives";
import { EInlineNotice } from "@/components/v2/client/fields";
import { cn } from "@/lib/utils";

const TZ = "Australia/Sydney";
const REFRESH_MS = 15_000;
const contextSchema = z.string().regex(/^[a-f0-9]{64}$/);
const messageSchema = z.object({
  id: z.string().min(1), body: z.string(), isFromAdmin: z.boolean(),
  createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  jobId: z.string().nullish(),
  sentBy: z.object({ id: z.string(), name: z.string().nullable(), role: z.string() }).nullable(),
  job: z.object({ id: z.string(), jobNumber: z.string().nullable(), propertyName: z.string().nullable() }).nullish(),
});
const pendingSchema = z.object({ requestId: z.string().uuid(), body: z.string().trim().min(1).max(4000), context: contextSchema }).strict();
const draftSchema = z.object({ version: z.literal(1), body: z.string().max(4000), pending: pendingSchema.nullable() }).strict();
type ThreadMessage = z.infer<typeof messageSchema>;
type Pending = z.infer<typeof pendingSchema>;
const storageKey = (context: string) => `client-global-message-v1:${context}`;

function time(value: string | number, pattern = "HH:mm") {
  return formatInTimeZone(new Date(value), TZ, pattern);
}

export function EstateMessagesThread() {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || !session?.user?.id) return <p role="status" className="text-sm">Opening the thread…</p>;
  return <Thread key={JSON.stringify([session.user.id, session.user.role, session.impersonation])} userId={session.user.id} />;
}

function Thread({ userId }: { userId: string }) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<{ id: string; at: number } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const contextRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const sendingRef = useRef(false);
  const savedVersion = useRef(0);
  const refreshRef = useRef<() => void>(() => {});
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const restoreDraft = useCallback((context: string) => {
    try {
      const raw = sessionStorage.getItem(storageKey(context));
      if (!raw) return;
      const saved = draftSchema.parse(JSON.parse(raw));
      if (saved.pending && saved.pending.context !== context) return;
      setBody(saved.body);
      setPending(saved.pending);
    } catch { /* An unreadable draft is left in storage untouched; the thread still works. */ }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let inFlight = false;
    let queued = false;
    let controller: AbortController | null = null;
    async function refresh() {
      if (!active) return;
      if (inFlight) { queued = true; return; }
      inFlight = true;
      controller = new AbortController();
      const startedVersion = savedVersion.current;
      try {
        const response = await fetch("/api/client/messages?withContext=1", { cache: "no-store", signal: controller.signal });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          setBlocked(true); setMessages([]);
          throw new Error("Message access changed. Reload the page to check your access.");
        }
        const payload = await response.json();
        if (!active || controller.signal.aborted) return;
        if (!response.ok) throw new Error("Could not refresh messages. The list may be out of date.");
        const rows = z.array(messageSchema).max(500).parse(payload);
        const context = contextSchema.parse(response.headers.get("X-Client-Message-Context"));
        if (contextRef.current && contextRef.current !== context) {
          setBlocked(true); setMessages([]);
          throw new Error("Account context changed. Reload the page before continuing.");
        }
        if (!contextRef.current) { contextRef.current = context; restoreDraft(context); }
        if (savedVersion.current !== startedVersion) { queued = true; return; }
        setMessages(rows); setCheckedAt(Date.now()); setReadError(null);
      } catch (error) {
        if (active && !controller?.signal.aborted) {
          setReadError(error instanceof z.ZodError ? "Messages could not be verified. Refresh to try again." : error instanceof Error ? error.message : "Could not refresh messages.");
        }
      } finally {
        inFlight = false;
        if (active) { setLoading(false); if (queued) { queued = false; void refresh(); } }
      }
    }
    refreshRef.current = () => { void refresh(); };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, REFRESH_MS);
    return () => { active = false; mounted.current = false; controller?.abort(); window.clearInterval(timer); refreshRef.current = () => {}; };
  }, [restoreDraft]);

  useEffect(() => {
    const list = listRef.current;
    if (list && stickToBottom.current) list.scrollTop = list.scrollHeight;
  }, [messages, pending]);

  function persist(text: string, receipt: Pending | null): boolean {
    const context = contextRef.current;
    if (!context) return false;
    try { sessionStorage.setItem(storageKey(context), JSON.stringify({ version: 1, body: text, pending: receipt })); return true; }
    catch { setSendNotice("Browser storage is unavailable. Copy your message before leaving; sending needs a saved recovery receipt."); return false; }
  }

  async function send() {
    const context = contextRef.current;
    if (sendingRef.current || blocked || !context || (!pending && !body.trim())) return;
    const receipt = pending ?? { requestId: crypto.randomUUID(), body: body.trim(), context };
    if (!persist(receipt.body, receipt)) return;
    sendingRef.current = true; setSending(true); setPending(receipt); setBody(receipt.body); setSendNotice(null);
    try {
      const response = await fetch("/api/client/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Client-Message-Context": context },
        body: JSON.stringify({ body: receipt.body, requestId: receipt.requestId }),
      });
      const payload = await response.json();
      if (!mounted.current) return;
      if (!response.ok) throw new Error("Not confirmed.");
      const row = messageSchema.parse(payload);
      const verified = payload.requestId === receipt.requestId && row.body === receipt.body && !row.isFromAdmin && row.sentBy?.id === userId
        && response.headers.get("X-Client-Message-Context") === receipt.context;
      if (!verified) throw new Error("Not confirmed.");
      savedVersion.current += 1;
      stickToBottom.current = true;
      setMessages((current) => [...current.filter((item) => item.id !== row.id), row].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
      setBody(""); setPending(null); setSavedAt({ id: row.id, at: Date.now() });
      try { sessionStorage.removeItem(storageKey(receipt.context)); } catch { /* A later retry re-checks the same receipt. */ }
      setSendNotice(typeof payload.deliveryWarning === "string" ? payload.deliveryWarning : null);
    } catch {
      if (mounted.current) setSendNotice("Not confirmed.");
    } finally {
      sendingRef.current = false;
      if (mounted.current) setSending(false);
    }
  }

  const unconfirmed = pending !== null && !sending;
  return (
    <ECard className="flex h-[calc(100dvh-15rem)] min-h-[24rem] flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[0.9375rem] font-semibold">sNeek team</p>
          <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {checkedAt ? `Checked ${time(checkedAt)} · refreshes automatically` : "Support and service updates"}
          </p>
        </div>
        <button type="button" disabled={blocked} onClick={() => refreshRef.current()} className="min-h-11 shrink-0 px-2 text-[0.8125rem] underline disabled:opacity-50">Refresh</button>
      </div>
      {readError ? <EInlineNotice tone="danger" className="mx-3 mt-2">{readError}</EInlineNotice> : null}
      <div ref={listRef} aria-label="Conversation messages" onScroll={() => { const list = listRef.current; if (list) stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80; }}
        className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-4 py-4">
        {loading && !checkedAt ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Opening the thread…</p> : null}
        {!loading && checkedAt && !readError && messages.length === 0 && !pending ? (
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Send a question or a service update to the team. Replies appear here.</p>
        ) : null}
        {messages.map((message) => {
          const mine = !message.isFromAdmin;
          return (
            <div key={message.id} className={cn("flex max-w-[82%] flex-col", mine ? "self-end items-end" : "self-start items-start")}>
              {message.jobId ? (
                <Link href={`/v2/client/jobs/${message.jobId}`} className="mb-0.5 inline-flex min-h-8 items-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))] hover:underline">
                  <Briefcase className="h-3 w-3" aria-hidden />{message.job?.jobNumber ? `Job #${message.job.jobNumber}` : message.job?.propertyName ?? "Job thread"}
                </Link>
              ) : null}
              <div className={cn("whitespace-pre-wrap break-words rounded-[0.75rem] px-3 py-2 text-[0.8125rem]",
                mine ? "rounded-br-[4px] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]" : "rounded-bl-[4px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]")}>
                {message.body}
              </div>
              <p className="mt-0.5 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                {mine ? (message.sentBy?.id === userId ? "" : `${message.sentBy?.name ?? "Your team"} · `) : `${message.sentBy?.name ?? "sNeek team"} · `}
                {savedAt?.id === message.id ? `Saved ${time(savedAt.at)}` : time(message.createdAt, "d MMM HH:mm")}
              </p>
            </div>
          );
        })}
        {pending ? (
          <div className="flex max-w-[82%] flex-col items-end self-end">
            <div className="whitespace-pre-wrap break-words rounded-[0.75rem] rounded-br-[4px] bg-[hsl(var(--e-primary))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-primary-foreground))] opacity-70">{pending.body}</div>
            {sending ? <p role="status" className="mt-0.5 text-[0.6875rem]">Sending…</p> : (
              <p role="alert" className="mt-1 flex flex-wrap items-center gap-1 rounded-[var(--e-radius)] bg-[hsl(var(--e-warning)/0.14)] px-2 py-1 text-[0.75rem]">
                <span aria-hidden>!</span> Not confirmed.
                <button type="button" onClick={() => void send()} disabled={blocked} className="min-h-11 px-1 font-semibold underline">Retry the same message</button>
              </p>
            )}
          </div>
        ) : null}
      </div>
      <div className="shrink-0 space-y-2 border-t border-[hsl(var(--e-border))] px-3 py-2.5">
        {sendNotice && sendNotice !== "Not confirmed." ? <p role="status" className="text-[0.75rem]">{sendNotice}</p> : null}
        {blocked ? <button type="button" className="min-h-11 underline" onClick={() => window.location.reload()}>Reload messages page</button> : null}
        <div className="flex items-end gap-2">
          <textarea value={body} maxLength={4000} rows={1} disabled={unconfirmed || sending || blocked || !contextRef.current}
            onChange={(event) => { setBody(event.target.value); persist(event.target.value, null); }}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
            aria-label="Message the team" placeholder="Message the team…"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 py-2.5 text-[0.875rem] disabled:opacity-60" />
          <button type="button" onClick={() => void send()} disabled={sending || blocked || !contextRef.current || pending !== null || !body.trim()}
            className="flex min-h-11 items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-accent-portal))] px-4 text-[0.875rem] font-[600] text-[hsl(var(--e-accent-portal-foreground))] disabled:opacity-50">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Sending" /> : "Send"}
          </button>
        </div>
      </div>
    </ECard>
  );
}
