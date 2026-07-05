"use client";

/**
 * Native Estate chat primitives for the v2 admin messages workspace.
 * Styled purely through the Estate token scope (`--e-*`) — no dependency on
 * components/messaging/* or components/ui/*. Same ClientMessage shape as v1:
 * { id, body, isFromAdmin, isRead, createdAt, sentBy }.
 */

import * as React from "react";
import { Check, CheckCheck, Loader2, SendHorizonal } from "lucide-react";
import { cn } from "@/lib/utils";

export type EChatMessage = {
  id: string;
  body: string;
  isFromAdmin: boolean;
  isRead?: boolean;
  createdAt: string;
  sentBy?: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
  } | null;
};

/* ── time helpers ──────────────────────────────────────────────────────── */
export function formatClock(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dayLabel(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const today = startOfDay(new Date());
  const that = startOfDay(d);
  const dayMs = 86_400_000;
  if (that === today) return "Today";
  if (that === today - dayMs) return "Yesterday";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function relativeListTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const today = startOfDay(new Date());
  const that = startOfDay(d);
  const dayMs = 86_400_000;
  if (that === today) return formatClock(d);
  if (that === today - dayMs) return "Yesterday";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "2-digit" }),
  });
}

/* ── message grouping ──────────────────────────────────────────────────── */
type RenderItem =
  | { type: "day"; key: string; label: string }
  | { type: "msg"; key: string; message: EChatMessage; mine: boolean; isGroupStart: boolean; isGroupEnd: boolean };

function buildRenderItems(messages: EChatMessage[]): RenderItem[] {
  const items: RenderItem[] = [];
  let lastDay = "";
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const day = dayLabel(message.createdAt);
    if (day !== lastDay) {
      items.push({ type: "day", key: `day-${day}-${message.id}`, label: day });
      lastDay = day;
    }
    const mine = message.isFromAdmin; // admin viewer → own messages on the right
    const samePrev =
      prev &&
      prev.isFromAdmin === message.isFromAdmin &&
      dayLabel(prev.createdAt) === day &&
      new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
    const sameNext =
      next &&
      next.isFromAdmin === message.isFromAdmin &&
      dayLabel(next.createdAt) === day &&
      new Date(next.createdAt).getTime() - new Date(message.createdAt).getTime() < 5 * 60_000;
    items.push({
      type: "msg",
      key: message.id,
      message,
      mine,
      isGroupStart: !samePrev,
      isGroupEnd: !sameNext,
    });
  }
  return items;
}

/* ── message list ──────────────────────────────────────────────────────── */
export function EMessageList({
  messages,
  loading = false,
  emptyTitle = "No messages in this thread yet",
  emptyHint,
}: {
  messages: EChatMessage[];
  loading?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const lastIdRef = React.useRef<string | null>(null);
  const stickRef = React.useRef(true);

  const items = React.useMemo(() => buildRenderItems(messages), [messages]);

  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  React.useEffect(() => {
    const last = messages[messages.length - 1];
    const lastId = last?.id ?? null;
    const isNew = lastId !== lastIdRef.current;
    lastIdRef.current = lastId;
    if (!isNew) return;
    if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  React.useEffect(() => {
    if (!loading && messages.length > 0) bottomRef.current?.scrollIntoView({ block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading messages…
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-[0.875rem] font-medium text-[hsl(var(--e-foreground))]">{emptyTitle}</p>
        {emptyHint ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{emptyHint}</p> : null}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-0.5">
        {items.map((item) => {
          if (item.type === "day") {
            return (
              <div key={item.key} className="my-3 flex justify-center">
                <span className="rounded-[var(--e-radius-pill)] bg-[hsl(var(--e-muted))] px-3 py-1 text-[0.6875rem] font-medium text-[hsl(var(--e-muted-foreground))]">
                  {item.label}
                </span>
              </div>
            );
          }
          const { message, mine, isGroupStart, isGroupEnd } = item;
          return (
            <div
              key={item.key}
              className={cn("flex w-full", mine ? "justify-end" : "justify-start", isGroupEnd ? "mb-2" : "mb-0.5")}
            >
              <div
                className={cn(
                  "relative max-w-[80%] px-3 py-2 text-[0.875rem] shadow-[var(--e-elevation-1)] sm:max-w-[70%]",
                  mine
                    ? "rounded-[var(--e-radius-lg)] rounded-br-[var(--e-radius-sm)] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                    : "rounded-[var(--e-radius-lg)] rounded-bl-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))]",
                  !isGroupStart && (mine ? "rounded-tr-[var(--e-radius-sm)]" : "rounded-tl-[var(--e-radius-sm)]")
                )}
              >
                <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
                <span
                  className={cn(
                    "mt-1 flex items-center justify-end gap-1 text-[0.625rem] leading-none",
                    mine ? "text-[hsl(var(--e-primary-foreground)/0.7)]" : "text-[hsl(var(--e-muted-foreground))]"
                  )}
                >
                  {formatClock(message.createdAt)}
                  {mine && typeof message.isRead === "boolean" ? (
                    message.isRead ? (
                      <CheckCheck className="h-3.5 w-3.5" aria-label="Read" />
                    ) : (
                      <Check className="h-3.5 w-3.5" aria-label="Sent" />
                    )
                  ) : null}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ── composer ──────────────────────────────────────────────────────────── */
export function EComposer({
  value,
  onChange,
  onSend,
  sending = false,
  disabled = false,
  placeholder = "Type a message",
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!disabled && !sending && value.trim()) onSend();
    }
  }

  const canSend = !disabled && !sending && value.trim().length > 0;

  return (
    <div className="shrink-0 border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface)/0.85)] px-3 py-2.5 backdrop-blur-xl sm:px-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            "max-h-40 min-h-[44px] flex-1 resize-none rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))]",
            "px-4 py-2.5 text-[0.875rem] text-[hsl(var(--e-foreground))] placeholder:text-[hsl(var(--e-text-faint))]",
            "focus:outline-none focus:border-[hsl(var(--e-gold))] focus:ring-1 focus:ring-[hsl(var(--e-ring))] disabled:opacity-50"
          )}
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label="Send message"
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all",
            canSend
              ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))] shadow-[var(--e-elevation-1)] hover:brightness-[1.05]"
              : "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]"
          )}
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizonal className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
