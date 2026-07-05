"use client";

/**
 * Estate messages thread — same endpoints as the legacy client thread:
 *   GET  /api/client/messages           → ClientMessage[] (asc)
 *   POST /api/client/messages           { body } → created message
 * Client messages sit on the right; the team's on the left. 10s refresh.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { format, isSameDay } from "date-fns";
import { Loader2, SendHorizonal } from "lucide-react";
import { ECard, EEyebrow } from "@/components/v2/ui/primitives";
import { EInlineNotice } from "@/components/v2/client/fields";
import { cn } from "@/lib/utils";

const REFRESH_MS = 10_000;

type ThreadMessage = {
  id: string;
  body: string;
  isFromAdmin: boolean;
  createdAt: string;
  sentBy: { id: string; name: string | null; role: string } | null;
};

export function EstateMessagesThread() {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const loadMessages = useCallback(async () => {
    const response = await fetch("/api/client/messages", { cache: "no-store" });
    const payload = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error((payload as any)?.error ?? "Could not load messages.");
    }
    setMessages(Array.isArray(payload) ? payload : []);
  }, []);

  useEffect(() => {
    let active = true;
    loadMessages()
      .catch((err: any) => {
        if (active) setError(err?.message ?? "Could not load messages.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const timer = window.setInterval(() => {
      loadMessages().catch(() => undefined);
    }, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loadMessages]);

  // Keep the view pinned to the newest message unless the reader scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, loading]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function sendMessage() {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/client/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "Could not send the message.");
      setBody("");
      stickToBottom.current = true;
      setMessages((current) => [...current, payload as ThreadMessage]);
    } catch (err: any) {
      setError(err?.message ?? "Could not send the message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <ECard className="flex h-[calc(100dvh-16rem)] min-h-[26rem] flex-col overflow-hidden">
      {/* Thread header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-5 py-3.5">
        <span className="e-serif flex h-10 w-10 items-center justify-center rounded-full border border-[hsl(var(--e-gold))] text-[0.9375rem] text-[hsl(var(--e-gold-ink))]">
          sN
        </span>
        <div className="min-w-0">
          <p className="truncate text-[0.875rem] font-semibold">sNeek Property Services</p>
          <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Support &amp; service updates — replies refresh automatically
          </p>
        </div>
      </div>

      {/* Message list */}
      <div ref={listRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
        {loading ? (
          <div className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening the thread…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <EEyebrow>Begin the conversation</EEyebrow>
            <p className="e-display-sm">We are at your service.</p>
            <p className="max-w-xs text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Send a question or a service update to the team — replies appear right here.
            </p>
          </div>
        ) : (
          messages.map((message, i) => {
            const prev = messages[i - 1];
            const showDay =
              !prev || !isSameDay(new Date(prev.createdAt), new Date(message.createdAt));
            const mine = !message.isFromAdmin;
            return (
              <div key={message.id}>
                {showDay ? (
                  <div className="my-4 flex items-center gap-3">
                    <span className="h-px flex-1 bg-[hsl(var(--e-border))]" />
                    <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-text-faint))]">
                      {format(new Date(message.createdAt), "EEE d MMM yyyy")}
                    </span>
                    <span className="h-px flex-1 bg-[hsl(var(--e-border))]" />
                  </div>
                ) : null}
                <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[78%]", mine ? "text-right" : "text-left")}>
                    <div
                      className={cn(
                        "inline-block whitespace-pre-wrap rounded-[var(--e-radius-lg)] px-4 py-2.5 text-left text-[0.875rem] leading-relaxed",
                        mine
                          ? "rounded-br-[4px] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                          : "rounded-bl-[4px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] text-[hsl(var(--e-foreground))]"
                      )}
                    >
                      {message.body}
                    </div>
                    <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                      {!mine ? `${message.sentBy?.name ?? "sNeek team"} · ` : ""}
                      {format(new Date(message.createdAt), "HH:mm")}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3">
        {error ? <EInlineNotice tone="danger" className="mb-2">{error}</EInlineNotice> : null}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            rows={1}
            placeholder="Message the sNeek team…"
            aria-label="Message the sNeek team"
            className="max-h-32 min-h-[2.75rem] flex-1 resize-none rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 py-2.5 text-[0.875rem] placeholder:text-[hsl(var(--e-text-faint))] focus:border-[hsl(var(--e-ring))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring)/0.25)]"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={sending || !body.trim()}
            aria-label="Send message"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))] shadow-[var(--e-elevation-gold)] transition-[filter,transform] duration-[160ms] hover:brightness-[0.97] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </ECard>
  );
}
