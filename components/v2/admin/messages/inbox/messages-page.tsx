"use client";

/**
 * Messages (board "Messages", 2026-11): conversations, the open thread and
 * the composer on one page. From `lg` they are three columns (the composer
 * appears with "New message"); below it they are stacked views with back
 * navigation (list → thread, any view → compose → back).
 */
import * as React from "react";
import Link from "next/link";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { cn } from "@/lib/utils";
import { initialView, nextView, threadCounts, type ViewEvent } from "@/lib/messages/thread-model";
import type { ComposeRecipient } from "@/lib/messages/compose-checks";
import { useThreads } from "./use-threads";
import { useCompose } from "./use-compose";
import { ThreadList } from "./thread-list";
import { ThreadView } from "./thread-view";
import { ComposePanel } from "./compose-panel";

type Props = {
  canSend: boolean;
  timezone: string;
  initialCompose: boolean;
  initialRecipient: ComposeRecipient | null;
  recipientMissing: boolean;
  initialClientId: string | null;
};

export function MessagesPage({ canSend, timezone, initialCompose, initialRecipient, recipientMissing, initialClientId }: Props) {
  const threads = useThreads(initialClientId);
  const compose = useCompose(initialRecipient);
  const [composeOpen, setComposeOpen] = React.useState(initialCompose);
  const [view, dispatchView] = React.useReducer((state: ReturnType<typeof initialView>, event: ViewEvent) => nextView(state, event), initialView({ compose: initialCompose, threadOpen: Boolean(initialClientId) }));
  const counts = threadCounts(threads.threads);
  const selected = threads.threads.find((t) => t.id === threads.selectedId) ?? null;

  function openCompose() {
    setComposeOpen(true);
    dispatchView({ type: "open-compose" });
  }
  function closeCompose() {
    dispatchView({ type: "close-compose" });
    // Desktop closes the column; the draft stays in state for next time.
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) setComposeOpen(false);
  }

  const unreadLine = threads.listState === "ready" ? `${counts.unread}${counts.capped ? "+" : ""} unread` : threads.listState === "loading" ? "loading…" : "counts unavailable";

  return (
    <div className="space-y-4">
      <EPageHeader
        title="Messages"
        description={`Conversations with clients · ${unreadLine} · replies reach clients in the portal and by the notifications each one chose`}
        actions={
          <>
            <EButton size="sm" variant="outline" asChild><Link href="/v2/admin/forms?tab=messages">Templates</Link></EButton>
            <EButton size="sm" className="max-sm:hidden" onClick={openCompose}>New message</EButton>
          </>
        }
      />
      {recipientMissing ? <p role="alert" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">The client this message was started for could not be found or is inactive, so no recipient was chosen.</p> : null}
      <nav aria-label="Messages sections" className="flex flex-wrap gap-1 border-b border-[hsl(var(--e-border))]">
        <span aria-current="page" className="inline-flex min-h-[44px] items-center border-b-2 border-[hsl(var(--e-primary))] px-3 text-[0.8125rem] font-[600]">
          Client conversations {threads.listState === "ready" ? `${counts.all}${counts.capped ? "+" : ""}` : ""}
        </span>
        <Link href="/v2/admin/notifications?tab=log" className="inline-flex min-h-[44px] items-center px-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))] hover:text-[hsl(var(--e-foreground))]">
          Composed messages (delivery log)
        </Link>
      </nav>
      <div className={cn("grid min-w-0 grid-cols-1 gap-3 lg:h-[calc(100dvh-16rem)] lg:min-h-[32rem]", composeOpen ? "lg:grid-cols-[18rem_minmax(0,1fr)_22rem]" : "lg:grid-cols-[18rem_minmax(0,1fr)]")}>
        <div className={cn("min-h-0 min-w-0 lg:flex lg:flex-col", view.view === "list" ? "flex flex-col" : "hidden")}>
          <ThreadList
            threads={threads.threads}
            state={threads.listState}
            error={threads.listError}
            selectedId={threads.selectedId}
            timezone={timezone}
            onSelect={(id) => {
              threads.select(id);
              dispatchView({ type: "open-thread" });
            }}
            onRetry={threads.reloadList}
          />
        </div>
        <div className={cn("min-h-0 min-w-0 lg:flex lg:flex-col", view.view === "thread" ? "flex flex-col" : "hidden")}>
          <ThreadView
            thread={selected}
            messages={threads.messages}
            state={threads.threadState}
            error={threads.threadError}
            outbox={threads.outbox}
            timezone={timezone}
            showBack
            onBack={() => dispatchView({ type: "back" })}
            onRetryLoad={() => threads.reloadThread()}
            onSend={threads.send}
            onRetry={(entry) => void threads.retry(entry)}
            onDiscard={threads.discard}
          />
        </div>
        {composeOpen || view.view === "compose" ? (
          <div className={cn("min-h-0 min-w-0 overflow-y-auto lg:block", view.view === "compose" ? "block" : "hidden")}>
            <ComposePanel compose={compose} canSend={canSend} showBack onClose={closeCompose} />
          </div>
        ) : null}
      </div>
      {/* Phones (board M-QuotesMessages): "New message" in thumb reach on the conversation list. */}
      <EPhoneActionBar label="Messages actions" hidden={view.view !== "list"} primary={<EButton onClick={openCompose}>New message</EButton>} />
    </div>
  );
}
