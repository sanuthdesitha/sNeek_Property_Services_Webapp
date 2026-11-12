"use client";

/**
 * Conversations column: search, All / Unread / Waiting on us with real counts
 * (over the clients the list route read), unread dots, and the note that
 * staff chat lives in Workforce. Loading, failure, empty and stale are apart.
 */
import * as React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { EAvatar } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";
import { THREAD_FILTER_LABEL, filterThreads, isUnread, listTime, threadCounts, type ThreadFilter, type ThreadSummary } from "@/lib/messages/thread-model";
import type { LoadState } from "./use-threads";

const FILTERS: ThreadFilter[] = ["all", "unread", "waiting"];

type Props = {
  threads: ThreadSummary[];
  state: LoadState;
  error: string | null;
  selectedId: string | null;
  timezone: string;
  onSelect: (id: string) => void;
  onRetry: () => void;
};

export function ThreadList({ threads, state, error, selectedId, timezone, onSelect, onRetry }: Props) {
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<ThreadFilter>("all");
  const counts = threadCounts(threads);
  const rows = filterThreads(threads, filter, search);
  const countText = (n: number) => (counts.capped ? `${n}+` : String(n));

  return (
    <section aria-label="Conversations" className="flex min-h-0 min-w-0 flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
      <input
        type="search"
        aria-label="Search conversations"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search clients or messages"
        className="h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[16px] sm:text-[0.875rem]"
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter conversations">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "inline-flex min-h-[36px] items-center rounded-[var(--e-radius-pill)] border px-3 text-[0.8125rem] font-[550]",
              filter === key ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]" : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-secondary))]",
            )}
          >
            {THREAD_FILTER_LABEL[key]} {state === "ready" ? countText(counts[key]) : ""}
          </button>
        ))}
      </div>
      {error && state === "ready" ? (
        <p role="status" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-2.5 py-1.5 text-[0.75rem]">
          Showing the last list read; refreshing failed ({error}). <button type="button" className="font-[600] underline" onClick={onRetry}>Retry</button>
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {state === "loading" ? (
          <p role="status" className="flex items-center gap-2 px-2 py-4 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]"><Loader2 className="h-4 w-4 animate-spin" /> Loading conversations…</p>
        ) : state === "failed" ? (
          <div role="alert" className="space-y-2 px-2 py-4 text-[0.875rem]">
            <p>{error ?? "Could not load conversations."}</p>
            <button type="button" className="font-[600] text-[hsl(var(--e-primary))] underline" onClick={onRetry}>Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            {search ? "No client or message matches." : filter === "all" ? "No client conversations yet. Search for a client to start one." : `No conversations are ${THREAD_FILTER_LABEL[filter].toLowerCase()}.`}
          </p>
        ) : (
          <ul className="space-y-1">
            {rows.map((thread) => {
              const last = thread.messages[0];
              const unread = isUnread(thread);
              const active = thread.id === selectedId;
              return (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(thread.id)}
                    aria-current={active ? "true" : undefined}
                    className={cn("flex min-h-[56px] w-full items-center gap-3 rounded-[var(--e-radius)] px-2 py-2 text-left", active ? "bg-[hsl(var(--e-primary-soft))]" : "hover:bg-[hsl(var(--e-muted))]")}
                  >
                    <EAvatar name={thread.name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <b className="truncate text-[0.875rem]">{thread.name}</b>
                        {last ? <span className="shrink-0 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{listTime(last.createdAt, timezone)}</span> : null}
                      </span>
                      <span className={cn("block truncate text-[0.75rem]", unread ? "font-[600] text-[hsl(var(--e-foreground))]" : "text-[hsl(var(--e-muted-foreground))]")}>
                        {last ? `${last.isFromAdmin ? "You: " : ""}${last.body}` : "No messages yet"}
                      </span>
                    </span>
                    {unread ? (
                      <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-primary))] px-1.5 text-[0.6875rem] font-[600] text-[hsl(var(--e-primary-foreground))]">
                        {thread._count.messages}<span className="sr-only"> unread</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Staff chat lives in <Link className="font-[600] text-[hsl(var(--e-primary))] underline" href="/admin/workforce">Workforce</Link>; cleaner job threads open from the job.
      </p>
    </section>
  );
}
