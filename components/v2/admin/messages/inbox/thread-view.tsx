"use client";

/**
 * The open conversation: who wrote each message (client assistants named as
 * such), times in the organisation timezone, an office message's state
 * ("Saved · not read yet" until the client opens it, then "Read"), messages
 * about a job with Open job, and the reply box. Replies are saved to the
 * conversation by the existing route, which also notifies the client's
 * portal users; a failed reply stays with Retry.
 */
import * as React from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { cn } from "@/lib/utils";
import { authorLabel, formatThreadTime, officeMessageState, threadDayKey, threadDayLabel, type ThreadMessage, type ThreadSummary } from "@/lib/messages/thread-model";
import type { LoadState, OutboxEntry } from "./use-threads";
import { TemplateInsert } from "./template-insert";

type Props = {
  thread: ThreadSummary | null;
  messages: ThreadMessage[];
  state: LoadState;
  error: string | null;
  outbox: OutboxEntry[];
  timezone: string;
  showBack: boolean;
  onBack: () => void;
  onRetryLoad: () => void;
  onSend: (body: string) => Promise<boolean>;
  onRetry: (entry: OutboxEntry) => void;
  onDiscard: (entry: OutboxEntry) => void;
};

function Bubble({ mine, children }: { mine: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("max-w-[85%] rounded-[var(--e-radius-lg)] px-3 py-2 text-[0.875rem] [overflow-wrap:anywhere]", mine ? "ml-auto bg-[hsl(var(--e-primary-soft))]" : "mr-auto bg-[hsl(var(--e-surface-raised))]")}>
      {children}
    </div>
  );
}

function MessageItems({ thread, messages, timezone }: { thread: ThreadSummary; messages: ThreadMessage[]; timezone: string }) {
  let lastDay = "";
  return (
    <>
      {messages.map((message) => {
        const day = threadDayKey(message.createdAt, timezone);
        const showDay = day !== lastDay;
        lastDay = day;
        return (
          <React.Fragment key={message.id}>
            {showDay ? <p className="text-center text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{threadDayLabel(message.createdAt, timezone)}</p> : null}
            <Bubble mine={message.isFromAdmin}>
              <p className="whitespace-pre-wrap">{message.body}</p>
              <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                {authorLabel(message, thread.name)} · {formatThreadTime(message.createdAt, timezone)}
                {message.isFromAdmin ? ` · ${officeMessageState(message)}` : ""}
              </p>
              {message.jobId ? (
                <p className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-[hsl(var(--e-border))] pt-1.5 text-[0.75rem]">
                  <b>Linked job</b>
                  <EButton size="sm" variant="outline" asChild><Link href={`/v2/admin/jobs/${message.jobId}`}>Open job</Link></EButton>
                </p>
              ) : null}
            </Bubble>
          </React.Fragment>
        );
      })}
    </>
  );
}

export function ThreadView(props: Props) {
  const { thread } = props;
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const draft = thread ? drafts[thread.id] ?? "" : "";
  const setDraft = (value: string) => thread && setDrafts((prev) => ({ ...prev, [thread.id]: value }));

  React.useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [props.messages.length, props.outbox.length, thread?.id]);

  if (!thread) {
    return (
      <section aria-label="Conversation" className="flex min-h-[16rem] min-w-0 flex-col items-center justify-center rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6 text-center">
        <p className="text-[0.875rem] font-[600]">Select a conversation</p>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Pick a client to read and reply to their conversation.</p>
      </section>
    );
  }

  function submit() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void props.onSend(text);
  }

  return (
    <section aria-label={`${thread.name} conversation`} className="flex min-h-0 min-w-0 flex-col rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <header className="flex items-center gap-2 border-b border-[hsl(var(--e-border))] p-3">
        {props.showBack ? (
          <button type="button" onClick={props.onBack} aria-label="Back to conversations" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-[hsl(var(--e-muted))] lg:hidden"><ArrowLeft className="h-5 w-5" /></button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[0.9375rem] font-[600]">{thread.name}</h2>
          <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{thread.email ?? "No email on file"}</p>
        </div>
        <EButton size="sm" variant="outline" asChild><Link href={`/v2/admin/clients/${thread.id}`}>Open client</Link></EButton>
      </header>
      <div ref={listRef} className="min-h-[12rem] flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {props.state === "loading" ? (
          <p role="status" className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]"><Loader2 className="h-4 w-4 animate-spin" /> Loading the conversation…</p>
        ) : props.state === "failed" ? (
          <div role="alert" className="space-y-2 text-[0.875rem]">
            <p>{props.error ?? "Could not load this conversation."}</p>
            <button type="button" className="font-[600] text-[hsl(var(--e-primary))] underline" onClick={props.onRetryLoad}>Retry</button>
          </div>
        ) : props.messages.length === 0 && props.outbox.length === 0 ? (
          <p className="text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No messages in this conversation yet. Send the first one below.</p>
        ) : (
          <MessageItems thread={thread} messages={props.messages} timezone={props.timezone} />
        )}
        {props.outbox.map((entry) => (
          <Bubble key={entry.localId} mine>
            <p className="whitespace-pre-wrap">{entry.body}</p>
            {entry.state === "sending" ? (
              <p className="mt-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Sending…</p>
            ) : (
              <p role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-[0.6875rem] text-[hsl(var(--e-danger))]">
                Not saved: {entry.error}
                <button type="button" className="font-[600] underline" onClick={() => props.onRetry(entry)}>Retry</button>
                <button type="button" className="underline" onClick={() => props.onDiscard(entry)}>Discard</button>
              </p>
            )}
          </Bubble>
        ))}
        {props.error && props.state === "ready" ? <p role="status" className="text-[0.75rem] text-[hsl(var(--e-warning))]">Refreshing failed; showing the last messages read.</p> : null}
      </div>
      <div className="space-y-2 border-t border-[hsl(var(--e-border))] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <TemplateInsert clientId={thread.id} onInsert={(text) => setDraft(draft ? `${draft}\n${text}` : text)} />
          <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Replies are saved to the conversation; the client&apos;s portal users are notified.</span>
        </div>
        <div className="flex items-end gap-2">
          <textarea
            aria-label="Reply"
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={`Message ${thread.name}`}
            className="min-h-[44px] flex-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[16px] sm:text-[0.875rem]"
          />
          <EButton onClick={submit} disabled={!draft.trim()}>Send</EButton>
        </div>
      </div>
    </section>
  );
}
