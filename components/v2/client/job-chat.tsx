"use client";

/**
 * Per-job client↔admin chat, opened from the job action hub. Uses the SAME
 * ClientMessage endpoints as the global thread, scoped with ?jobId= / { jobId }:
 *   GET  /api/client/messages?jobId=… → this job's messages (marks admin msgs read)
 *   POST /api/client/messages { body, jobId } → send
 * Polls every 15s while open. Client↔admin only — no cleaner participation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { format, isSameDay } from "date-fns";
import { Loader2, MessageCircle, SendHorizonal, X } from "lucide-react";
import { EEyebrow } from "@/components/v2/ui/primitives";
import { EInlineNotice } from "@/components/v2/client/fields";
import { cn } from "@/lib/utils";

const REFRESH_MS = 15_000;

type ThreadMessage = {
  id: string;
  body: string;
  isFromAdmin: boolean;
  createdAt: string;
  sentBy: { id: string; name: string | null; role: string } | null;
};

export function JobChatSheet({
  jobId,
  jobLabel,
  open,
  onClose,
}: {
  jobId: string;
  jobLabel: string;
  open: boolean;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const loadMessages = useCallback(async () => {
    const response = await fetch(`/api/client/messages?jobId=${encodeURIComponent(jobId)}`, {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => []);
    if (!response.ok) throw new Error((payload as any)?.error ?? "Could not load messages.");
    setMessages(Array.isArray(payload) ? payload : []);
  }, [jobId]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
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
  }, [open, loadMessages]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading, open]);

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
        body: JSON.stringify({ body: text, jobId }),
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close chat"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
      />
      {/* Sheet (mobile) / panel (desktop) */}
      <div className="relative flex h-[85dvh] w-full flex-col overflow-hidden rounded-t-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-xl sm:h-[70dvh] sm:max-w-lg sm:rounded-[var(--e-radius-lg)]">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-ink))]">
            <MessageCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.875rem] font-semibold">Message us about this clean</p>
            <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{jobLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages */}
        <div ref={listRef} onScroll={onScroll} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              <Loader2 className="h-4 w-4 animate-spin" /> Opening the thread…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <EEyebrow>This clean</EEyebrow>
              <p className="max-w-xs text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Ask anything about this clean — the team replies right here.
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
                    <div className="my-3 flex items-center gap-3">
                      <span className="h-px flex-1 bg-[hsl(var(--e-border))]" />
                      <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-text-faint))]">
                        {format(new Date(message.createdAt), "EEE d MMM yyyy")}
                      </span>
                      <span className="h-px flex-1 bg-[hsl(var(--e-border))]" />
                    </div>
                  ) : null}
                  <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[80%]", mine ? "text-right" : "text-left")}>
                      <div
                        className={cn(
                          "inline-block whitespace-pre-wrap rounded-[var(--e-radius-lg)] px-3.5 py-2 text-left text-[0.875rem] leading-relaxed",
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
        <div className="shrink-0 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-3">
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
              placeholder="Message the sNeek team about this clean…"
              aria-label="Message the sNeek team about this clean"
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
      </div>
    </div>
  );
}
