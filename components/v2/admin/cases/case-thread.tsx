"use client";

/**
 * The message thread: client messages, office replies, internal notes (visibly
 * different and labelled) and attachments, in time order. Times use the
 * organisation's timezone (Australia/Sydney).
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { EPill } from "@/components/v2/ui/pill";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import { personLabel, type CaseAttachment, type CaseComment, type CaseDetail } from "./case-types";

type ThreadItem =
  | { kind: "comment"; at: number; comment: CaseComment }
  | { kind: "attachment"; at: number; attachment: CaseAttachment };

export function formatCaseTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : formatInTimeZone(date, SYDNEY_TZ, "EEE d MMM, HH:mm");
}

function isClientSide(role: string | undefined): boolean {
  return role === "CLIENT" || role === "VA";
}

function buildThread(detail: CaseDetail): ThreadItem[] {
  const items: ThreadItem[] = [
    ...detail.comments.map((comment) => ({ kind: "comment" as const, at: new Date(comment.createdAt).getTime(), comment })),
    ...detail.attachments.map((attachment) => ({ kind: "attachment" as const, at: new Date(attachment.createdAt).getTime(), attachment })),
  ];
  return items.sort((a, b) => a.at - b.at);
}

function CommentMessage({ comment, viewerId }: { comment: CaseComment; viewerId: string | null }) {
  const author = comment.author?.id && comment.author.id === viewerId ? "You" : personLabel(comment.author);
  return (
    <article
      className={cn(
        "rounded-[10px] border px-3 py-2.5",
        comment.isInternal
          ? "border-[hsl(var(--e-gold)/0.45)] bg-[hsl(var(--e-gold-soft))]"
          : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]",
      )}
      aria-label={comment.isInternal ? `Internal note from ${author}` : `Message from ${author}`}
    >
      <p className="flex flex-wrap items-center gap-1.5 text-[0.8125rem]">
        <b>{author}</b>
        {comment.isInternal ? <EPill tone="gold">Internal note</EPill> : isClientSide(comment.author?.role) ? <EPill tone="info">Client</EPill> : null}
        <span className="text-[hsl(var(--e-muted-foreground))]">{formatCaseTime(comment.createdAt)}</span>
      </p>
      <p className="mt-1 whitespace-pre-wrap break-words text-[0.875rem]">{comment.body}</p>
    </article>
  );
}

function AttachmentMessage({ attachment }: { attachment: CaseAttachment }) {
  const image = (attachment.mimeType ?? "").startsWith("image/");
  return (
    <article className="flex items-center gap-3 rounded-[10px] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 py-2">
      <a href={attachment.url} target="_blank" rel="noreferrer" className="shrink-0">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={attachment.url} alt={attachment.label ?? "Attachment"} className="h-14 w-14 rounded-[8px] object-cover" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-[8px] bg-[hsl(var(--e-muted))]"><FileText aria-hidden className="h-6 w-6" /></span>
        )}
      </a>
      <div className="min-w-0 text-[0.8125rem]">
        <a href={attachment.url} target="_blank" rel="noreferrer" className="block truncate font-[550] text-[hsl(var(--e-primary))] hover:underline">
          {attachment.label || "Attachment"}
        </a>
        <span className="text-[hsl(var(--e-muted-foreground))]">
          Attached by {personLabel(attachment.uploadedBy)} · {formatCaseTime(attachment.createdAt)}
        </span>
      </div>
    </article>
  );
}

export function CaseThread({ detail, viewerId }: { detail: CaseDetail; viewerId: string | null }) {
  const items = buildThread(detail);
  if (items.length === 0) {
    return <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No messages yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-2.5" aria-label="Conversation">
      {items.map((item) => (
        <li key={item.kind === "comment" ? `c-${item.comment.id}` : `a-${item.attachment.id}`}>
          {item.kind === "comment" ? <CommentMessage comment={item.comment} viewerId={viewerId} /> : <AttachmentMessage attachment={item.attachment} />}
        </li>
      ))}
    </ol>
  );
}
