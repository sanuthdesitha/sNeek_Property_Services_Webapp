"use client";

/**
 * Shared WhatsApp-style chat primitives used by the admin client-messages
 * workspace and the client portal thread. Built around the existing
 * ClientMessage model (no schema changes): every message has
 * { id, body, isFromAdmin, isRead, createdAt, sentBy }.
 *
 * "Mine" is whatever the current viewer sent (admin sees admin messages on the
 * right; client sees their own on the right). Read ticks are shown only for
 * the viewer's own messages because the model tracks isRead.
 */

import * as React from "react";
import { Check, CheckCheck, Loader2, SendHorizonal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

export type ChatMessage = {
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

export function initialsOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Deterministic warm avatar tint from a seed string. */
export function avatarTint(seed: string): { bg: string; fg: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return {
    bg: `hsl(${hue} 65% 90%)`,
    fg: `hsl(${hue} 45% 32%)`,
  };
}

export function Avatar({
  name,
  size = 44,
  className,
}: {
  name: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const tint = avatarTint(name ?? "?");
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold",
        className
      )}
      style={{
        width: size,
        height: size,
        background: tint.bg,
        color: tint.fg,
        fontSize: Math.round(size * 0.36),
      }}
      aria-hidden
    >
      {initialsOf(name)}
    </div>
  );
}

/* ─── time / date helpers ─── */

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

/* ─── message rendering ─── */

type RenderItem =
  | { type: "day"; key: string; label: string }
  | {
      type: "msg";
      key: string;
      message: ChatMessage;
      mine: boolean;
      showName: boolean;
      isGroupStart: boolean;
      isGroupEnd: boolean;
    };

/**
 * Group consecutive messages by sender, insert day separators.
 * `mineIsFromAdmin` decides which side counts as "mine".
 */
function buildRenderItems(
  messages: ChatMessage[],
  mineIsFromAdmin: boolean,
  showSenderNames: boolean
): RenderItem[] {
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
    const mine = message.isFromAdmin === mineIsFromAdmin;
    const samePrevSender =
      prev &&
      prev.isFromAdmin === message.isFromAdmin &&
      dayLabel(prev.createdAt) === day &&
      new Date(message.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
    const sameNextSender =
      next &&
      next.isFromAdmin === message.isFromAdmin &&
      dayLabel(next.createdAt) === day &&
      new Date(next.createdAt).getTime() - new Date(message.createdAt).getTime() < 5 * 60_000;
    const isGroupStart = !samePrevSender;
    items.push({
      type: "msg",
      key: message.id,
      message,
      mine,
      showName: showSenderNames && !mine && isGroupStart,
      isGroupStart,
      isGroupEnd: !sameNextSender,
    });
  }
  return items;
}

function senderLabel(message: ChatMessage): string {
  return message.sentBy?.name || (message.isFromAdmin ? "sNeek" : "Client");
}

export function MessageList({
  messages,
  mineIsFromAdmin,
  showSenderNames = false,
  loading = false,
  emptyTitle = "No messages yet",
  emptyHint,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: {
  messages: ChatMessage[];
  mineIsFromAdmin: boolean;
  showSenderNames?: boolean;
  loading?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const lastIdRef = React.useRef<string | null>(null);
  const stickToBottomRef = React.useRef(true);

  const items = React.useMemo(
    () => buildRenderItems(messages, mineIsFromAdmin, showSenderNames),
    [messages, mineIsFromAdmin, showSenderNames]
  );

  // Track whether the user is near the bottom; only auto-scroll if so.
  const handleScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 120;
  }, []);

  React.useEffect(() => {
    const last = messages[messages.length - 1];
    const lastId = last?.id ?? null;
    const isNew = lastId !== lastIdRef.current;
    lastIdRef.current = lastId;
    if (!isNew) return;
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  // Initial jump to bottom (no animation) when the thread first loads.
  React.useEffect(() => {
    if (!loading && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading messages…
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
        {emptyHint ? <p className="text-xs text-muted-foreground">{emptyHint}</p> : null}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6"
    >
      {hasMore ? (
        <div className="mb-3 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-50"
          >
            {loadingMore ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </span>
            ) : (
              "Load older messages"
            )}
          </button>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-3xl flex-col gap-0.5">
        {items.map((item) => {
          if (item.type === "day") {
            return (
              <div key={item.key} className="my-3 flex justify-center">
                <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
                  {item.label}
                </span>
              </div>
            );
          }
          const { message, mine, showName, isGroupStart, isGroupEnd } = item;
          return (
            <div
              key={item.key}
              className={cn(
                "flex w-full",
                mine ? "justify-end" : "justify-start",
                isGroupEnd ? "mb-2" : "mb-0.5"
              )}
            >
              <div
                className={cn(
                  "relative max-w-[80%] px-3 py-2 text-sm shadow-sm sm:max-w-[70%]",
                  mine
                    ? "rounded-2xl rounded-br-md bg-[hsl(var(--primary))] text-primary-foreground"
                    : "rounded-2xl rounded-bl-md border border-border bg-surface text-foreground",
                  // soften the grouped corner so a run reads as one block
                  !isGroupStart && (mine ? "rounded-tr-md" : "rounded-tl-md")
                )}
              >
                {showName ? (
                  <p className="mb-0.5 text-xs font-semibold text-primary">
                    {senderLabel(message)}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
                <span
                  className={cn(
                    "mt-1 flex items-center justify-end gap-1 text-[10px] leading-none",
                    mine ? "text-primary-foreground/70" : "text-muted-foreground"
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

/* ─── composer ─── */

export function Composer({
  value,
  onChange,
  onSend,
  sending = false,
  disabled = false,
  placeholder = "Type a message",
  leading,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** optional slot left of the textarea (e.g. quick-reply / template button) */
  leading?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea up to ~6 lines.
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
    <div className="shrink-0 border-t border-border bg-card/80 px-3 py-2.5 backdrop-blur-xl sm:px-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        {leading}
        <Textarea
          ref={ref}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-2xl px-4 py-2.5"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label="Send message"
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all",
            canSend
              ? "bg-[hsl(var(--primary))] text-primary-foreground shadow-sm hover:opacity-90"
              : "bg-muted text-muted-foreground"
          )}
        >
          {sending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <SendHorizonal className="h-5 w-5" />
          )}
        </button>
      </div>
    </div>
  );
}
