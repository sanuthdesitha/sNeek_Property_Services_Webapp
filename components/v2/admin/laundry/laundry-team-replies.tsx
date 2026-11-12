"use client";

/**
 * Run panel: what the laundry partner's team answered to office requests
 * ("From the office" in the laundry portal). A typed answer is what the team
 * said, not a change to the run: "Back by Fri 13 Nov 14:00" does not move the
 * drop-off. Times are shown as given; days are calendar days (never shifted).
 */
import { formatInTimeZone } from "date-fns-tz";
import { EPill } from "@/components/v2/ui/pill";
import { TEAM_REQUEST_LABELS, type LaundryTeamRequestKind } from "@/lib/laundry/nudge-rules";
import { describeTeamReply, type TeamReplySummary } from "@/lib/laundry/team-request-reply-rules";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";

function formatDayKey(key: string): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? key : formatInTimeZone(date, "UTC", "EEE d MMM");
}

function requestName(kind: string): string {
  const label = TEAM_REQUEST_LABELS[kind as LaundryTeamRequestKind];
  return label ? label.button.replace(/^Ask laundry team:? ?/i, "") : "Request";
}

export function LaundryTeamReplies({ replies }: { replies: TeamReplySummary[] | undefined }) {
  if (!replies?.length) return null;
  return (
    <section aria-label="Answers from the laundry team" className="space-y-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
      <p className="e-eyebrow">Laundry team answered</p>
      <ul className="space-y-1.5 text-[0.8125rem]">
        {replies.map((reply) => (
          <li key={reply.id} className="flex flex-wrap items-start gap-1.5">
            <EPill tone={reply.answer === "CANNOT" ? "warn" : reply.answer === "MESSAGE" ? "neutral" : "ok"}>{requestName(reply.requestKind)}</EPill>
            <span className="min-w-0 flex-1 break-words">
              {describeTeamReply(reply, formatDayKey)}
              <span className="block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                {reply.byName} · {formatInTimeZone(new Date(reply.at), SYDNEY_TZ, "EEE d MMM HH:mm")}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
