"use client";

/** The item's timeline (organisation time) with the comment box under it. */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/admin/estate-kit";
import type { HydratedLostFoundItem } from "@/lib/lost-found/service";
import { LOST_FOUND_EVENT_LABELS, lostFoundStatusLabel } from "@/lib/lost-found/status";
import { formatDateTime } from "./lost-found-format";

type Post = (payload: Record<string, unknown>, success: string) => Promise<boolean>;
type TimelineEvent = HydratedLostFoundItem["events"][number];

function eventTitle(event: TimelineEvent): string {
  const meta = event.meta as { toStatus?: string; fromStatus?: string } | null;
  if (event.action === "STATUS_CHANGE" && meta?.toStatus && meta.toStatus !== meta.fromStatus) return `Status changed to ${lostFoundStatusLabel(meta.toStatus)}`;
  if (event.action === "REOPENED" && meta?.toStatus) return `Reopened to ${lostFoundStatusLabel(meta.toStatus)}`;
  return LOST_FOUND_EVENT_LABELS[event.action] ?? event.action;
}

function previousDecision(event: TimelineEvent): string | null {
  const previous = (event.meta as { previousResolution?: { status?: string; resolution?: string | null } | null } | null)?.previousResolution;
  if (!previous?.status) return null;
  return `Previous decision: ${lostFoundStatusLabel(previous.status)}${previous.resolution ? ` (${previous.resolution})` : ""}`;
}

export function ItemTimeline({ item, timeZone, post }: { item: HydratedLostFoundItem; timeZone: string; post: Post }) {
  const [comment, setComment] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  async function addComment(event: React.FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    setSaving(true);
    const ok = await post({ action: "COMMENT", note: comment.trim() }, "Comment added");
    setSaving(false);
    if (ok) setComment("");
  }
  return (
    <section aria-label="Timeline" className="space-y-2">
      <h3 className="text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">Timeline</h3>
      <ol className="space-y-2">
        {item.events.map((event) => {
          const previous = previousDecision(event);
          return (
            <li key={event.id} className="text-[0.8125rem]">
              <p>
                <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">{formatDateTime(event.createdAt, timeZone)}</span>{" "}
                <span className="font-[550]">{event.actorName ?? "System"}</span> · {eventTitle(event)}
              </p>
              {event.note ? <p className="whitespace-pre-wrap text-[hsl(var(--e-text-secondary))]">{event.note}</p> : null}
              {previous ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{previous}</p> : null}
            </li>
          );
        })}
      </ol>
      <form onSubmit={addComment}>
        <fieldset disabled={saving} className="space-y-2">
          <ETextarea aria-label="Add a comment" placeholder="Add a comment" value={comment} maxLength={4000} onChange={(event) => setComment(event.target.value)} />
          <div className="flex justify-end"><EButton type="submit" size="sm" variant="outline" disabled={!comment.trim()}>{saving ? "Adding…" : "Add comment"}</EButton></div>
        </fieldset>
      </form>
    </section>
  );
}
