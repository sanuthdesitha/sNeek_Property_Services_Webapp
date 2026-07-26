"use client";

/**
 * Admin side of the per-job client↔admin chat. Used in two places:
 *   · the "Messages" section of the job manage modal (job-manage.tsx)
 *   · the admin job detail page (anchored #chat for approval-queue deep links)
 * Endpoints:
 *   GET  /api/admin/messages/job/[jobId]        → { job, messages, relayedMessageIds }
 *   POST /api/admin/messages/job/[jobId]        { body } → send as admin
 *   POST /api/admin/messages/job/[jobId]/relay  { messageId } → notify cleaner(s)
 * Per policy the chat is client↔admin only; "Relay to cleaner" forwards one
 * client message as a notification (no cleaner replies).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { format, isSameDay } from "date-fns";
import { Forward, Loader2, SendHorizonal } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";

const REFRESH_MS = 15_000;

type ThreadMessage = {
  id: string;
  body: string;
  isFromAdmin: boolean;
  createdAt: string;
  sentBy: { id: string; name: string | null; role: string } | null;
};

export function JobChatAdmin({ jobId, prefill }: { jobId: string; prefill?: string }) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [relayedIds, setRelayedIds] = useState<Set<string>>(new Set());
  const [body, setBody] = useState(prefill ?? "");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [relaying, setRelaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/messages/job/${jobId}`, { cache: "no-store" });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error ?? "Could not load messages.");
    setMessages(Array.isArray(payload.messages) ? payload.messages : []);
    setRelayedIds(new Set(Array.isArray(payload.relayedMessageIds) ? payload.relayedMessageIds : []));
  }, [jobId]);

  useEffect(() => {
    let active = true;
    load()
      .catch((err: any) => {
        if (active) setError(err?.message ?? "Could not load messages.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function send() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/messages/job/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "Could not send the message.");
      setBody("");
      stickToBottom.current = true;
      setMessages((current) => [...current, payload as ThreadMessage]);
    } catch (err: any) {
      setError(err?.message ?? "Could not send the message.");
    } finally {
      setSending(false);
    }
  }

  async function relay(messageId: string) {
    setRelaying(messageId);
    try {
      const res = await fetch(`/api/admin/messages/job/${jobId}/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "Could not relay the message.");
      setRelayedIds((prev) => new Set(prev).add(messageId));
      toast({ title: `Relayed to ${payload.relayedTo ?? ""} cleaner${payload.relayedTo === 1 ? "" : "s"}` });
    } catch (err: any) {
      toast({ title: "Relay failed", description: err?.message, variant: "destructive" });
    } finally {
      setRelaying(null);
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
      <div
        ref={listRef}
        onScroll={onScroll}
        className="max-h-80 min-h-[12rem] flex-1 space-y-3 overflow-y-auto bg-[hsl(var(--e-surface))] px-4 py-4"
      >
        {loading ? (
          <div className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the job thread…
          </div>
        ) : messages.length === 0 ? (
          <p className="py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            No messages on this job yet. Client↔admin only — relaying forwards a message to the
            assigned cleaner as a notification.
          </p>
        ) : (
          messages.map((message, i) => {
            const prev = messages[i - 1];
            const showDay = !prev || !isSameDay(new Date(prev.createdAt), new Date(message.createdAt));
            const mine = message.isFromAdmin;
            const relayed = relayedIds.has(message.id);
            return (
              <div key={message.id}>
                {showDay ? (
                  <div className="my-3 flex items-center gap-3">
                    <span className="h-px flex-1 bg-[hsl(var(--e-border))]" />
                    <span className="text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-text-faint))]">
                      {format(new Date(message.createdAt), "EEE d MMM yyyy")}
                    </span>
                    <span className="h-px flex-1 bg-[hsl(var(--e-border))]" />
                  </div>
                ) : null}
                <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[82%]", mine ? "text-right" : "text-left")}>
                    <div
                      className={cn(
                        "inline-block whitespace-pre-wrap rounded-[var(--e-radius)] px-3 py-2 text-left text-[0.8125rem] leading-relaxed",
                        mine
                          ? "rounded-br-[4px] bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-foreground))]"
                          : "rounded-bl-[4px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]"
                      )}
                    >
                      {message.body}
                    </div>
                    <div
                      className={cn(
                        "mt-1 flex items-center gap-2 text-[0.625rem] text-[hsl(var(--e-text-faint))]",
                        mine ? "justify-end" : "justify-start"
                      )}
                    >
                      <span>
                        {mine
                          ? `${message.sentBy?.name ?? "Admin"} · `
                          : `${message.sentBy?.name ?? "Client"} · `}
                        {format(new Date(message.createdAt), "HH:mm")}
                      </span>
                      {!mine ? (
                        relayed ? (
                          <EBadge tone="info" soft>
                            Relayed to cleaner
                          </EBadge>
                        ) : (
                          <button
                            type="button"
                            disabled={relaying === message.id}
                            onClick={() => relay(message.id)}
                            className="inline-flex items-center gap-1 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-2 py-0.5 font-semibold uppercase tracking-[0.08em] hover:border-[hsl(var(--e-gold))] hover:text-[hsl(var(--e-foreground))] disabled:opacity-50"
                          >
                            {relaying === message.id ? (
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            ) : (
                              <Forward className="h-2.5 w-2.5" />
                            )}
                            Relay to cleaner
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="shrink-0 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5">
        {error ? <p className="mb-1.5 text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Reply to the client on this job…"
            aria-label="Reply to the client on this job"
            className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.8125rem] placeholder:text-[hsl(var(--e-text-faint))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring)/0.3)]"
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !body.trim()}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))] transition-[filter] hover:brightness-[0.97] disabled:pointer-events-none disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
