"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useSession } from "next-auth/react";
import { z } from "zod";
import { Loader2, SendHorizonal, X } from "lucide-react";
import { EInlineNotice } from "@/components/v2/client/fields";
import { cn } from "@/lib/utils";

const contextSchema = z.string().regex(/^[a-f0-9]{64}$/);
const messageSchema = z.object({
  id: z.string().min(1), jobId: z.string(), body: z.string(), isFromAdmin: z.boolean(),
  createdAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
  sentBy: z.object({ id: z.string(), name: z.string().nullable(), role: z.string() }).nullable(),
});
const pendingSchema = z.object({ requestId: z.string().uuid(), body: z.string().trim().min(1).max(4000), context: contextSchema }).strict();
const draftSchema = z.object({ version: z.literal(1), body: z.string().max(4000), pending: pendingSchema.nullable() }).strict();
type Message = z.infer<typeof messageSchema>;
type Pending = z.infer<typeof pendingSchema>;
type Props = { jobId: string; jobLabel: string; open: boolean; onClose: () => void };
const storageKey = (context: string) => `client-job-message-v1:${context}`;

export function JobChatSheet(props: Props) {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || !session?.user?.id) return null;
  return <JobChatSession key={JSON.stringify([session.user.id, session.user.role, session.impersonation, props.jobId])} {...props} userId={session.user.id} />;
}

function JobChatSession({ jobId, jobLabel, open, onClose, userId }: Props & { userId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [limited, setLimited] = useState(false);
  const [online, setOnline] = useState(true);
  const contextRef = useRef<string | null>(null);
  const blockedRef = useRef(false);
  const mounted = useRef(false);
  const sendingRef = useRef(false);
  const savedVersion = useRef(0);
  const postAbort = useRef<AbortController | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  const opener = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { mounted.current = false; postAbort.current?.abort(); window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    if (!open) return;
    let active = true;
    let inFlight = false;
    let queued = false;
    let controller: AbortController | null = null;
    const block = () => { blockedRef.current = true; setBlocked(true); setMessages([]); setBody(""); setPending(null); };
    async function refresh() {
      if (!active || blockedRef.current) return;
      if (inFlight) { queued = true; return; }
      inFlight = true; controller = new AbortController();
      const startedVersion = savedVersion.current;
      try {
        const response = await fetch(`/api/client/messages?jobId=${encodeURIComponent(jobId)}&withContext=1`, { cache: "no-store", signal: controller.signal });
        if (!active) return;
        if ([401, 403, 404].includes(response.status)) { block(); throw new Error("Conversation access changed. Reload the page to check your access."); }
        const payload = await response.json();
        if (!active) return;
        if (!response.ok) throw new Error("Could not refresh messages. The previous list may be out of date.");
        const rows = z.array(messageSchema).max(500).parse(payload);
        if (rows.some(row => row.jobId !== jobId)) throw new Error("Conversation response did not match this clean.");
        const context = contextSchema.parse(response.headers.get("X-Client-Message-Context"));
        if (contextRef.current && contextRef.current !== context) { block(); throw new Error("Conversation context changed. Your earlier draft is retained separately. Reload the page before continuing."); }
        if (!contextRef.current) {
          contextRef.current = context;
          try {
            const raw = sessionStorage.getItem(storageKey(context));
            if (raw) {
              const saved = draftSchema.parse(JSON.parse(raw));
              if (saved.pending && (saved.pending.context !== context || saved.pending.body !== saved.body.trim())) throw new Error("Draft context mismatch");
              setBody(saved.body); setPending(saved.pending);
            }
          } catch {
            blockedRef.current = true; setBlocked(true);
            setStorageError("The saved conversation draft could not be read safely. It has been preserved. Reload the page after checking browser storage.");
          }
        }
        if (savedVersion.current !== startedVersion) { queued = true; return; }
        setMessages(rows); setCheckedAt(Date.now()); setLimited(response.headers.get("X-Client-Message-History-Limited") === "true"); setReadError(null);
      } catch (error) {
        if (active && !controller?.signal.aborted) setReadError(error instanceof z.ZodError ? "Messages could not be verified. Refresh to try again." : error instanceof Error ? error.message : "Could not refresh messages.");
      } finally {
        inFlight = false;
        if (active) { setLoading(false); if (queued) { queued = false; void refresh(); } }
      }
    }
    setLoading(true); refreshRef.current = () => { void refresh(); }; void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); refreshRef.current = () => {}; };
  }, [open, jobId]);

  useEffect(() => { const list = listRef.current; if (list && stickToBottom.current) list.scrollTop = list.scrollHeight; }, [messages, open]);

  function persist(text: string, receipt: Pending | null) {
    const context = contextRef.current;
    if (!context) return false;
    try { sessionStorage.setItem(storageKey(context), JSON.stringify({ version: 1, body: text, pending: receipt })); setStorageError(null); return true; }
    catch { setStorageError("Browser storage is unavailable. Keep this page open and copy your draft before leaving. Sending requires a saved recovery receipt."); return false; }
  }

  async function sendMessage() {
    const context = contextRef.current;
    if (sendingRef.current || blockedRef.current || !context || !navigator.onLine || (!pending && !body.trim())) return;
    const receipt = pending ?? { requestId: crypto.randomUUID(), body: body.trim(), context };
    if (!persist(receipt.body, receipt)) return;
    sendingRef.current = true; setSending(true); setPending(receipt); setBody(receipt.body); setSendNotice(null);
    const controller = new AbortController(); postAbort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/client/messages", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Client-Message-Context": context },
        body: JSON.stringify({ body: receipt.body, jobId, requestId: receipt.requestId }) });
      const payload = await response.json();
      if (!mounted.current) return;
      if (!response.ok) throw new Error("The message outcome is unconfirmed. Retry the same message to check its saved receipt.");
      const row = messageSchema.parse(payload);
      if (response.headers.get("X-Client-Message-Context") !== receipt.context || payload.requestId !== receipt.requestId || row.jobId !== jobId || row.body !== receipt.body || row.isFromAdmin || row.sentBy?.id !== userId) throw new Error("The send receipt could not be verified. Your message is retained for a safe retry.");
      if (blockedRef.current || contextRef.current !== receipt.context) return;
      savedVersion.current += 1;
      stickToBottom.current = true;
      setMessages(current => [...current.filter(item => item.id !== row.id), row].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
      setBody(""); setPending(null);
      try { sessionStorage.removeItem(storageKey(receipt.context)); } catch { setStorageError("Message saved, but its browser recovery receipt could not be cleared. A later retry will check the same saved message."); }
      setSendNotice(typeof payload.deliveryWarning === "string" ? payload.deliveryWarning : "Message saved.");
    } catch (error) {
      if (mounted.current) setSendNotice(error instanceof z.ZodError ? "The send receipt could not be verified. Retry the same message to check whether it was saved." : error instanceof Error ? error.message : "Message outcome unconfirmed. Retry the same message.");
    } finally { window.clearTimeout(timeout); sendingRef.current = false; if (mounted.current) setSending(false); }
  }

  return <Dialog.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
    <Dialog.Content onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }}
      className="fixed inset-x-0 bottom-0 z-50 mx-auto flex h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl border bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-xl sm:bottom-auto sm:top-1/2 sm:h-[70dvh] sm:max-w-lg sm:-translate-y-1/2 sm:rounded-2xl">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3"><div className="min-w-0 flex-1">
        <Dialog.Title className="text-sm font-semibold">Message us about this clean</Dialog.Title>
        <p className="truncate text-sm">{jobLabel}</p>
        <Dialog.Description className="text-xs text-[hsl(var(--e-muted-foreground))]">Client correspondence with the office</Dialog.Description>
      </div><Dialog.Close aria-label="Close chat" className="flex h-11 w-11 items-center justify-center"><X className="h-4 w-4" /></Dialog.Close></div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2 text-xs">
        <span>{checkedAt ? `Last checked ${new Date(checkedAt).toLocaleTimeString("en-AU")}` : "Messages not yet checked"}{limited ? ". Showing the latest 500 messages." : ""}</span>
        <button type="button" className="min-h-11 underline" disabled={blocked} onClick={() => refreshRef.current()}>Refresh messages</button>
      </div>
      {readError ? <EInlineNotice tone="danger" className="mx-3 mt-2">{readError}</EInlineNotice> : null}
      <div ref={listRef} onScroll={() => { const list = listRef.current; if (list) stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 80; }} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-label="Conversation messages">
        {loading && !checkedAt ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Opening the thread...</p> : null}
        {!loading && checkedAt && !readError && messages.length === 0 ? <p className="text-sm">Ask anything about this clean. The team replies here.</p> : null}
        {messages.map(message => <article key={message.id} className={cn("max-w-[85%] rounded-xl border p-3", !message.isFromAdmin && "ml-auto bg-[hsl(var(--e-muted))]")}>
          <p className="mb-1 text-xs font-semibold">{message.isFromAdmin ? `Office: ${message.sentBy?.name ?? "sNeek team"}` : message.sentBy?.id === userId ? "You" : message.sentBy?.name ?? "Client team"}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p><p className="mt-1 text-xs text-[hsl(var(--e-muted-foreground))]">{new Date(message.createdAt).toLocaleString("en-AU")}</p>
        </article>)}
      </div>
      <div className="shrink-0 space-y-2 border-t px-3 py-3">
        {sendNotice ? <p role="status" className="text-sm">{sendNotice}</p> : null}
        {storageError ? <EInlineNotice tone="danger">{storageError}</EInlineNotice> : null}
        {!online ? <p role="status" className="text-sm">Offline. Your saved draft stays in this tab; messages are not sent automatically.</p> : null}
        {pending ? <p className="text-xs">A send receipt is pending. Retry checks the same message and cannot create a second copy.</p> : null}
        {blocked ? <button type="button" className="min-h-11 underline" onClick={() => window.location.reload()}>Reload conversation page</button> : null}
        <div className="flex items-end gap-2"><textarea value={body} maxLength={4000} rows={2} disabled={!!pending || sending || blocked || !contextRef.current}
          onChange={event => { setBody(event.target.value); persist(event.target.value, null); }} aria-label="Message the sNeek team about this clean" placeholder="Message the team about this clean..."
          className="max-h-32 min-h-11 flex-1 resize-none rounded-lg border bg-transparent px-3 py-2 text-sm disabled:opacity-60" />
          <button type="button" onClick={() => { void sendMessage(); }} disabled={sending || blocked || !contextRef.current || !online || (!pending && !body.trim())}
            aria-label={pending ? "Retry same message" : "Send message"} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-[hsl(var(--e-gold))] px-3 text-[hsl(var(--e-gold-foreground))] disabled:opacity-50">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : pending ? <span className="text-xs">Retry same message</span> : <SendHorizonal className="h-4 w-4" />}
          </button></div>
      </div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
