"use client";

/**
 * ESTATE quote activity timeline. Mounted on the admin quote detail; self-fetches
 * the quote's events and auto-refreshes so client responses (viewed / accepted /
 * declined / add-on requests) land without a page reload. Built on v2 primitives
 * + estate-kit + lucide only.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { Clock, Loader2, RefreshCw } from "lucide-react";
import {
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
  EButton,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import {
  QUOTE_EVENT_META,
  type QuoteEventType,
} from "@/lib/quotes/event-meta";

const REFRESH_MS = 25_000;

type QuoteEvent = {
  id: string;
  type: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
};

const TONE_COLOR: Record<string, string> = {
  neutral: "hsl(var(--e-muted-foreground))",
  info: "hsl(var(--e-info))",
  success: "hsl(var(--e-success))",
  danger: "hsl(var(--e-danger))",
  gold: "hsl(var(--e-gold))",
};

/** Human one-liner for an event, from its type + detail bag. */
function describe(event: QuoteEvent): string {
  const d = event.detail ?? {};
  const asStrings = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  const note = typeof d.note === "string" && d.note.trim() ? d.note.trim() : null;

  switch (event.type as QuoteEventType) {
    case "EMAIL_SENT": {
      const recipients = asStrings(d.recipients);
      const attachments = asStrings(d.attachments);
      const who = recipients.length ? `Email sent to ${recipients.join(", ")}` : "Email sent";
      const resend = d.resend === true ? " (resend)" : "";
      const files = attachments.length ? ` · ${attachments.join(", ")}` : "";
      return `${who}${resend}${files}`;
    }
    case "VIEWED":
      return "Viewed by client";
    case "ACCEPTED":
      return note ? `Accepted — “${note}”` : "Accepted by client";
    case "DECLINED":
      return note ? `Declined — “${note}”` : "Declined by client";
    case "ADDON_REQUESTED": {
      const items = asStrings(d.items);
      const base = items.length ? `Requested add-ons: ${items.join(", ")}` : "Requested add-ons";
      return note ? `${base} — “${note}”` : base;
    }
    case "CONVERTED": {
      const ref =
        typeof d.jobRef === "string" && d.jobRef ? ` (${d.jobRef})` : "";
      return `Converted to job${ref}`;
    }
    case "NOTE":
      return note ?? (typeof d.text === "string" ? d.text : "Note added");
    default:
      return event.type.replace(/_/g, " ").toLowerCase();
  }
}

function relTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}
function absTime(iso: string): string {
  try {
    return format(new Date(iso), "d MMM yyyy, h:mm a");
  } catch {
    return "";
  }
}

export default function QuoteTimeline({ quoteId }: { quoteId: string }) {
  const [events, setEvents] = useState<QuoteEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the interval callback pointing at the latest quoteId without resetting.
  const quoteIdRef = useRef(quoteId);
  quoteIdRef.current = quoteId;

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/quotes/${encodeURIComponent(quoteIdRef.current)}/events`,
        { cache: "no-store" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error ?? "Could not load activity.");
        return;
      }
      setEvents(Array.isArray(body?.events) ? body.events : []);
    } catch {
      setError("Could not load activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load({ silent: true }), REFRESH_MS);
    return () => clearInterval(id);
  }, [load, quoteId]);

  return (
    <ECard>
      <ECardHeader className="flex-row items-center justify-between">
        <div>
          <EEyebrow>Activity</EEyebrow>
          <ECardTitle>Timeline</ECardTitle>
        </div>
        <EButton
          variant="ghost"
          size="sm"
          onClick={() => load()}
          disabled={loading}
          aria-label="Refresh activity timeline"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </EButton>
      </ECardHeader>
      <ECardBody>
        {error ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p>
        ) : events === null ? (
          <div className="flex items-center gap-2 py-6 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
          </div>
        ) : events.length === 0 ? (
          <EEmptyState
            eyebrow="No activity yet"
            title="Nothing has happened"
            description="Emails you send and client responses will appear here automatically."
          />
        ) : (
          <ol className="relative space-y-5">
            {events.map((event, i) => {
              const meta =
                QUOTE_EVENT_META[event.type as QuoteEventType] ?? QUOTE_EVENT_META.NOTE;
              const Icon = meta.icon;
              const color = TONE_COLOR[meta.tone] ?? TONE_COLOR.neutral;
              const isLast = i === events.length - 1;
              return (
                <li key={event.id} className="relative flex gap-3.5">
                  {/* connector rail */}
                  {!isLast && (
                    <span
                      aria-hidden
                      className="absolute left-[15px] top-8 bottom-[-1.25rem] w-px bg-[hsl(var(--e-border))]"
                    />
                  )}
                  <span
                    className="relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border bg-[hsl(var(--e-surface))]"
                    style={{ borderColor: color, color }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">
                      {meta.label}
                    </p>
                    <p className="mt-0.5 break-words text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                      {describe(event)}
                    </p>
                    <p
                      className="mt-1 flex items-center gap-1 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]"
                      title={absTime(event.createdAt)}
                    >
                      <Clock className="h-3 w-3" />
                      {relTime(event.createdAt)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </ECardBody>
    </ECard>
  );
}
