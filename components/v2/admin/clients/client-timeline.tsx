"use client";

/**
 * Estate Client-360 activity timeline — a single reverse-chronological feed
 * that merges (a) client-level activity (messages sent, audit changes) with
 * (b) per-job CLEANER UPDATES rolled up across the client's recent jobs
 * (assigned → en-route → arrived → clock in/out → completed → QA → report →
 * form). Self-fetching from GET /api/admin/clients/[id]/timeline.
 *
 * Estate token scope only (--e-*), primitives + lucide. No v1 imports.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDistanceToNow, format } from "date-fns";
import {
  Activity,
  ArrowRight,
  Camera,
  CheckCircle2,
  FileText,
  History,
  LogIn,
  LogOut,
  Mail,
  MapPin,
  Navigation,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import {
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";

type TimelineType =
  | "AUDIT"
  | "MESSAGE"
  | "ASSIGNMENT"
  | "EN_ROUTE"
  | "ARRIVED"
  | "CLOCK_IN"
  | "CLOCK_OUT"
  | "COMPLETED"
  | "QA"
  | "REPORT"
  | "FORM";

type TimelineItem = {
  id: string;
  type: TimelineType;
  title: string;
  detail: string;
  at: string;
  jobId?: string;
  jobNumber?: string;
};

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "info" | "aubergine";

const TONE_HSL: Record<Tone, string> = {
  neutral: "hsl(var(--e-muted-foreground))",
  primary: "hsl(var(--e-accent-portal))",
  gold: "hsl(var(--e-gold))",
  success: "hsl(var(--e-success))",
  warning: "hsl(var(--e-warning))",
  info: "hsl(var(--e-info))",
  aubergine: "hsl(284 22% 44%)",
};

const TYPE_META: Record<TimelineType, { icon: typeof Activity; tone: Tone; label: string }> = {
  AUDIT: { icon: History, tone: "neutral", label: "Record" },
  MESSAGE: { icon: Mail, tone: "info", label: "Message" },
  ASSIGNMENT: { icon: UserPlus, tone: "primary", label: "Assigned" },
  EN_ROUTE: { icon: Navigation, tone: "primary", label: "En route" },
  ARRIVED: { icon: MapPin, tone: "info", label: "Arrived" },
  CLOCK_IN: { icon: LogIn, tone: "info", label: "Clock in" },
  CLOCK_OUT: { icon: LogOut, tone: "info", label: "Clock out" },
  COMPLETED: { icon: CheckCircle2, tone: "success", label: "Completed" },
  QA: { icon: ShieldCheck, tone: "aubergine", label: "QA" },
  REPORT: { icon: FileText, tone: "gold", label: "Report" },
  FORM: { icon: Camera, tone: "info", label: "Form" },
};

function relative(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return formatDistanceToNow(d, { addSuffix: true });
}

export function ClientTimeline({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/timeline`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not load the timeline.");
        return;
      }
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch {
      setError("Could not load the timeline.");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <ECard>
      <ECardHeader className="flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-accent-portal))]">
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <ECardTitle className="text-[0.95rem]">Activity timeline</ECardTitle>
            <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
              {loading ? "Loading…" : `Messages, record changes & cleaner updates · latest ${items.length}`}
            </p>
          </div>
        </div>
      </ECardHeader>
      <ECardBody className="pt-0">
        {loading ? (
          <p className="py-8 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading activity…</p>
        ) : error ? (
          <p className="py-8 text-center text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p>
        ) : items.length === 0 ? (
          <EEmptyState
            eyebrow="No activity"
            title="Nothing to show yet"
            description="Messages, record changes and cleaner updates for this client will appear here."
          />
        ) : (
          <ol className="relative space-y-0">
            {items.map((item, idx) => {
              const meta = TYPE_META[item.type] ?? TYPE_META.AUDIT;
              const Icon = meta.icon;
              const color = TONE_HSL[meta.tone];
              const isLast = idx === items.length - 1;
              return (
                <li key={item.id} className="relative flex gap-3 pb-4">
                  {/* connector rail */}
                  {!isLast ? (
                    <span
                      className="absolute left-[15px] top-8 bottom-0 w-px"
                      style={{ backgroundColor: "hsl(var(--e-border))" }}
                      aria-hidden
                    />
                  ) : null}
                  {/* icon ring */}
                  <span
                    className="relative z-[1] mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border"
                    style={{
                      borderColor: color,
                      color,
                      backgroundColor: `color-mix(in srgb, ${color} 12%, hsl(var(--e-surface)))`,
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  {/* body */}
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">{item.title}</p>
                      <time
                        className="shrink-0 text-[0.6875rem] tabular-nums text-[hsl(var(--e-text-faint))]"
                        dateTime={item.at}
                        title={format(new Date(item.at), "d MMM yyyy, h:mm a")}
                      >
                        {relative(item.at)}
                      </time>
                    </div>
                    {item.detail ? (
                      <p className="mt-0.5 text-[0.75rem] leading-snug text-[hsl(var(--e-muted-foreground))]">{item.detail}</p>
                    ) : null}
                    {item.jobId ? (
                      <Link
                        href={`/v2/admin/jobs/${item.jobId}`}
                        className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] font-[550] text-[hsl(var(--e-accent-portal))] hover:underline"
                      >
                        Open job{item.jobNumber ? ` #${item.jobNumber}` : ""}
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    ) : null}
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

export default ClientTimeline;
