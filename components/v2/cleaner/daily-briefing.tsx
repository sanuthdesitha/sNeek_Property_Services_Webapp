"use client";

/**
 * Cleaner "Today's briefing" panel — a concise, high-signal plan-your-day card
 * mounted at the top of the v2 cleaner Today page. Today | Tomorrow toggle
 * (refetches), collapsible (state remembered in localStorage, auto-expanded),
 * and a natural-sounding voiceover of the spoken script.
 *
 * Every section renders only when it carries content; the whole card degrades
 * to a compact skeleton/empty state and never blocks the rest of the page.
 * Estate UI only.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  CloudSun,
  Clock,
  Coins,
  History,
  Home,
  KeyRound,
  ListChecks,
  MapPin,
  MessageSquareWarning,
  Navigation,
  Package,
  ShoppingBag,
  Shirt,
  Sparkles,
  Star,
  BellRing,
} from "lucide-react";
import { ECard, ECardBody, EBadge } from "@/components/v2/ui/primitives";
import { EChip } from "@/components/v2/cleaner/fields";
import { BriefingVoiceover } from "@/components/v2/cleaner/briefing-voiceover";
import type { BriefingDay, CleanerBriefing } from "@/lib/briefing/types";

const COLLAPSE_KEY = "sneek.cleaner.briefing.collapsed";

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="e-eyebrow flex items-center gap-1.5">
      <span className="text-[hsl(var(--e-accent-portal))]">{icon}</span>
      {children}
    </span>
  );
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function DailyBriefing() {
  const [day, setDay] = useState<BriefingDay>("today");
  const [collapsed, setCollapsed] = useState(false);
  const [data, setData] = useState<CleanerBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Restore collapse preference (auto-expanded by default).
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const load = useCallback(async (which: BriefingDay) => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/cleaner/briefing?day=${which}`, { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const json = (await res.json()) as CleanerBriefing;
      setData(json);
    } catch {
      setError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(day);
  }, [day, load]);

  const jobCount = data?.jobsOverview?.count ?? 0;

  return (
    <ECard variant="ceremony">
      <ECardBody className="space-y-4 pt-6">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex min-w-0 items-center gap-2 text-left"
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" />
            )}
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
              <span className="e-display-sm text-[1.125rem]">Today's briefing</span>
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-1.5">
            <EChip active={day === "today"} onClick={() => setDay("today")}>
              Today
            </EChip>
            <EChip active={day === "tomorrow"} onClick={() => setDay("tomorrow")}>
              Tomorrow
            </EChip>
          </div>
        </div>

        {!collapsed ? (
          <div className="space-y-4">
            {/* Date + voiceover */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[0.75rem] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">
                {data?.dateLabel ?? (loading ? "Loading…" : "")}
              </p>
              {data?.spokenScript ? <BriefingVoiceover script={data.spokenScript} /> : null}
            </div>

            {loading ? (
              <div className="space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-[hsl(var(--e-surface-raised))]" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-[hsl(var(--e-surface-raised))]" />
                <div className="h-4 w-3/5 animate-pulse rounded bg-[hsl(var(--e-surface-raised))]" />
              </div>
            ) : error ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Couldn't load your briefing right now. Pull to refresh or try again shortly.
              </p>
            ) : !data ? null : (
              <>
                {/* Accept gate — unaccepted (PENDING) assignments come first */}
                {data.acceptGate && data.acceptGate.items.length > 0 ? (
                  <section className="space-y-2 rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
                    <SectionLabel icon={<ClipboardCheck className="h-3.5 w-3.5" />}>
                      Accept your jobs first
                    </SectionLabel>
                    <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                      {data.acceptGate.items.length === 1
                        ? "You have 1 job waiting to be accepted. Open Jobs and accept it to lock it in."
                        : `You have ${data.acceptGate.items.length} jobs waiting to be accepted. Open Jobs and accept them to lock them in.`}
                    </p>
                    <ul className="space-y-1.5">
                      {data.acceptGate.items.map((j) => (
                        <li
                          key={j.id}
                          className="flex items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2"
                        >
                          <div className="flex h-8 w-14 shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))]">
                            <span className="text-[0.75rem] font-semibold tabular-nums">{j.startTime || "—"}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[0.8125rem] font-[550]">{j.propertyName}</p>
                            <p className="truncate text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                              {[j.suburb, j.jobType].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <a
                      href="/v2/cleaner/jobs"
                      className="inline-flex items-center gap-1.5 text-[0.8125rem] font-[550] text-[hsl(var(--e-accent-portal))] underline underline-offset-2"
                    >
                      Go to Jobs to accept
                    </a>
                  </section>
                ) : null}

                {/* Schedule strip */}
                {data.jobsOverview && data.jobsOverview.count > 0 ? (
                  <section className="space-y-2">
                    <SectionLabel icon={<CalendarClock className="h-3.5 w-3.5" />}>
                      Schedule · {jobCount} {jobCount === 1 ? "job" : "jobs"}
                    </SectionLabel>
                    <div className="space-y-1.5">
                      {data.jobsOverview.jobs.map((j) => (
                        <div
                          key={j.id}
                          className="flex items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2"
                        >
                          <div className="flex h-9 w-14 shrink-0 items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))]">
                            <span className="text-[0.75rem] font-semibold tabular-nums">
                              {j.startTime || "—"}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[0.8125rem] font-[550]">{j.propertyName}</p>
                            <p className="truncate text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                              {[j.suburb, j.jobType].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                            {j.earlyCheckin ? (
                              <EBadge tone="warning" soft>
                                Early check-in
                              </EBadge>
                            ) : null}
                            {j.lateCheckout ? (
                              <EBadge tone="info" soft>
                                Late checkout
                              </EBadge>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : data.acceptGate && data.acceptGate.items.length > 0 ? null : (
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    No jobs scheduled {day === "today" ? "today" : "tomorrow"} — enjoy the {day === "today" ? "day" : "downtime"}.
                  </p>
                )}

                {/* ① Travel plan — leg-by-leg leave-by times + tight risks */}
                {data.travelPlan && data.travelPlan.legs.length > 0 ? (
                  <section className="space-y-1.5">
                    <SectionLabel icon={<Navigation className="h-3.5 w-3.5" />}>Travel plan</SectionLabel>
                    <ul className="space-y-1.5">
                      {data.travelPlan.legs.map((leg, i) => (
                        <li
                          key={i}
                          className={`rounded-[var(--e-radius)] border px-3 py-2 text-[0.8125rem] ${
                            leg.tight
                              ? "border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))]"
                              : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate font-[550]">
                              {leg.fromProperty} → {leg.toProperty}
                            </span>
                            {leg.tight ? (
                              <EBadge tone="warning" soft>
                                Tight
                              </EBadge>
                            ) : null}
                          </div>
                          <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                            {leg.etaMinutes != null ? `~${leg.etaMinutes} min drive${leg.estimated ? " (est.)" : ""}` : "Drive time unknown"}
                            {leg.leaveBy ? ` · leave by ${leg.leaveBy}` : ""}
                            {leg.nextStart ? ` · next starts ${leg.nextStart}` : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* ⑧ Priority / turnaround watch list */}
                {data.priorityWatch && data.priorityWatch.items.length > 0 ? (
                  <section className="space-y-1.5 rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
                    <SectionLabel icon={<ListChecks className="h-3.5 w-3.5" />}>Watch the clock</SectionLabel>
                    <ul className="space-y-1">
                      {data.priorityWatch.items.map((p, i) => (
                        <li key={i} className="flex items-start gap-2 text-[0.8125rem]">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--e-warning))]" />
                          <span>
                            <span className="font-[550]">{p.propertyName}</span>{" "}
                            <span className="text-[hsl(var(--e-text-secondary))]">— {p.reason}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* ④ New-to-you properties */}
                {data.newProperties && data.newProperties.items.length > 0 ? (
                  <section className="space-y-1.5">
                    <SectionLabel icon={<Home className="h-3.5 w-3.5" />}>New to you</SectionLabel>
                    <ul className="space-y-1.5">
                      {data.newProperties.items.map((p) => (
                        <li
                          key={p.jobId}
                          className="flex items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-3 py-2 text-[0.8125rem]"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-[550]">{p.propertyName}</p>
                            <p className="truncate text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                              {[
                                p.suburb,
                                p.bedrooms != null ? `${p.bedrooms} bed` : null,
                                p.bathrooms != null ? `${p.bathrooms} bath` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          {p.hasReferencePhotos ? (
                            <a
                              href={`/v2/cleaner/jobs/${p.jobId}`}
                              className="shrink-0 text-[0.75rem] font-[550] text-[hsl(var(--e-accent-portal))] underline underline-offset-2"
                            >
                              Reference photos
                            </a>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* ② Access & quirks per stop */}
                {data.accessNotes && data.accessNotes.stops.length > 0 ? (
                  <section className="space-y-1.5">
                    <SectionLabel icon={<KeyRound className="h-3.5 w-3.5" />}>Access & quirks</SectionLabel>
                    <ul className="space-y-1.5">
                      {data.accessNotes.stops.map((s, i) => (
                        <li key={i} className="text-[0.8125rem]">
                          <span className="font-[550]">{s.propertyName}</span>
                          <ul className="mt-0.5 space-y-0.5">
                            {s.items.map((it, k) => (
                              <li key={k} className="flex items-start gap-2 text-[hsl(var(--e-text-secondary))]">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--e-accent-portal))]" />
                                {it}
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* Warnings row: weather / traffic / low stock */}
                {(data.weather &&
                  (data.weather.summary ||
                    data.weather.trafficBuffer ||
                    (data.weather.advisories && data.weather.advisories.length > 0))) ||
                data.lowStock ? (
                  <section className="space-y-1.5">
                    {data.weather && data.weather.summary ? (
                      <p className="flex items-center gap-2 text-[0.8125rem]">
                        <CloudSun className="h-4 w-4 shrink-0 text-[hsl(var(--e-accent-portal))]" />
                        <span>
                          {data.weather.summary}
                          {data.weather.wetWeatherGear ? (
                            <span className="ml-1.5 font-[550] text-[hsl(var(--e-warning))]">
                              — bring wet-weather gear
                            </span>
                          ) : null}
                        </span>
                      </p>
                    ) : null}
                    {data.weather?.trafficBuffer ? (
                      <p className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                        <MapPin className="h-4 w-4 shrink-0 text-[hsl(var(--e-accent-portal))]" />
                        {data.weather.trafficBuffer}
                      </p>
                    ) : null}
                    {data.weather?.advisories?.map((a, i) => (
                      <p key={i} className="flex items-start gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-warning))]" />
                        {a}
                      </p>
                    ))}
                    {data.lowStock ? (
                      <div className="flex items-start gap-2 text-[0.8125rem]">
                        <Package className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-warning))]" />
                        <p>
                          <span className="font-[550]">Low stock: </span>
                          {data.lowStock.items
                            .map((s) => `${s.property}: ${s.item} (${s.left} left)`)
                            .join(" · ")}
                          {data.lowStock.moreCount > 0 ? ` · +${data.lowStock.moreCount} more` : ""}
                        </p>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                {/* Special requests */}
                {data.specialRequests ? (
                  <section className="space-y-1.5">
                    <SectionLabel icon={<BellRing className="h-3.5 w-3.5" />}>Special requests</SectionLabel>
                    <ul className="space-y-1">
                      {data.specialRequests.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-[0.8125rem]">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--e-gold))]" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* Laundry */}
                {data.laundry ? (
                  <p className="flex items-start gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                    <Shirt className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-accent-portal))]" />
                    {data.laundry.line}
                  </p>
                ) : null}

                {/* ⑤ Supplies to bring */}
                {data.supplies && data.supplies.items.length > 0 ? (
                  <section className="space-y-1.5">
                    <SectionLabel icon={<ShoppingBag className="h-3.5 w-3.5" />}>Supplies to bring</SectionLabel>
                    <ul className="space-y-1">
                      {data.supplies.items.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-[0.8125rem]">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[hsl(var(--e-accent-portal))]" />
                          <span>
                            <span className="font-[550]">{s.item}</span>{" "}
                            <span className="text-[hsl(var(--e-muted-foreground))]">— {s.reason}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* Earnings + finish-time chips */}
                {data.earnings || data.finishTime ? (
                  <div className="flex flex-wrap gap-2">
                    {data.earnings ? (
                      <span className="inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-3 py-1 text-[0.8125rem]">
                        <Coins className="h-3.5 w-3.5 text-[hsl(var(--e-gold-ink))]" />
                        <span className="font-[550]">{fmtMoney(data.earnings.amount)}</span>
                        <span className="text-[hsl(var(--e-muted-foreground))]">
                          {data.earnings.label}
                          {data.earnings.transportAllowance ? ` · incl. ${fmtMoney(data.earnings.transportAllowance)} transport` : ""}
                          {data.earnings.rateMissing ? " · rate not set" : ""}
                        </span>
                      </span>
                    ) : null}
                    {data.earnings && typeof data.earnings.weekToDate === "number" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-3 py-1 text-[0.8125rem]">
                        <Coins className="h-3.5 w-3.5 text-[hsl(var(--e-accent-portal))]" />
                        <span className="font-[550]">{fmtMoney(data.earnings.weekToDate)}</span>
                        <span className="text-[hsl(var(--e-muted-foreground))]">
                          this week
                          {typeof data.earnings.lastWeek === "number"
                            ? ` · vs ${fmtMoney(data.earnings.lastWeek)} last week`
                            : ""}
                        </span>
                      </span>
                    ) : null}
                    {data.finishTime ? (
                      <span className="inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border-strong))] px-3 py-1 text-[0.8125rem]">
                        <Clock className="h-3.5 w-3.5 text-[hsl(var(--e-accent-portal))]" />
                        <span className="font-[550]">{data.finishTime.finishTime}</span>
                        <span className="text-[hsl(var(--e-muted-foreground))]">
                          {data.finishTime.assumedStart ? "if you start at " : "from "}
                          {data.finishTime.startTime} · {data.finishTime.label}
                        </span>
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/* Watch-outs */}
                {data.watchOuts ? (
                  <section className="space-y-1.5 rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
                    <SectionLabel icon={<AlertTriangle className="h-3.5 w-3.5" />}>Watch-outs</SectionLabel>
                    <ul className="space-y-1.5">
                      {data.watchOuts.items.map((m, i) => (
                        <li key={i} className="text-[0.8125rem]">
                          <span className="font-[550]">{m.label}</span>
                          {m.count > 1 ? (
                            <span className="text-[hsl(var(--e-muted-foreground))]"> · {m.count}×</span>
                          ) : null}
                          <span className="text-[hsl(var(--e-text-secondary))]"> — {m.advice}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* Recurring issues (Phase 7a) — repeating QA categories */}
                {data.recurringIssues && data.recurringIssues.items.length > 0 ? (
                  <section className="space-y-1.5 rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
                    <SectionLabel icon={<AlertTriangle className="h-3.5 w-3.5" />}>Keeps coming up</SectionLabel>
                    <ul className="space-y-1.5">
                      {data.recurringIssues.items.map((r, i) => (
                        <li key={i} className="text-[0.8125rem]">
                          <span className="font-[550]">{r.label}</span>
                          <span className="text-[hsl(var(--e-text-secondary))]"> — {r.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* Prior feedback */}
                {data.complaints ? (
                  <section className="space-y-1.5">
                    <SectionLabel icon={<MessageSquareWarning className="h-3.5 w-3.5" />}>
                      Recent feedback
                    </SectionLabel>
                    <ul className="space-y-1">
                      {data.complaints.items.map((c, i) => (
                        <li key={i} className="flex items-start gap-2 text-[0.8125rem]">
                          <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-muted-foreground))]" />
                          <span>
                            <span className="font-[550]">{c.property}</span>{" "}
                            <span className="text-[hsl(var(--e-text-secondary))]">{c.text}</span>{" "}
                            <span className="text-[hsl(var(--e-text-faint))]">({c.date})</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* ③ Last-visit context — previous QA outcome per property */}
                {data.lastVisit && data.lastVisit.items.length > 0 ? (
                  <section className="space-y-1.5">
                    <SectionLabel icon={<History className="h-3.5 w-3.5" />}>Last visit</SectionLabel>
                    <ul className="space-y-1">
                      {data.lastVisit.items.map((v, i) => (
                        <li key={i} className="flex items-start gap-2 text-[0.8125rem]">
                          <span
                            className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                              v.passed === false ? "bg-[hsl(var(--e-warning))]" : "bg-[hsl(var(--e-success))]"
                            }`}
                          />
                          <span>
                            <span className="font-[550]">{v.propertyName}</span>
                            {v.score != null ? (
                              <span className="text-[hsl(var(--e-muted-foreground))]"> · QA {v.score}</span>
                            ) : null}
                            {v.date ? <span className="text-[hsl(var(--e-text-faint))]"> ({v.date})</span> : null}
                            {v.flags.length > 0 ? (
                              <span className="text-[hsl(var(--e-text-secondary))]"> — flagged: {v.flags.join(", ")}</span>
                            ) : null}
                            {v.reworkReason ? (
                              <span className="text-[hsl(var(--e-text-secondary))]"> — rework: {v.reworkReason}</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* Reminders */}
                {data.reminders && (data.reminders.deviceLine || data.reminders.expiringDocuments.length > 0) ? (
                  <section className="space-y-1 border-t border-[hsl(var(--e-border))] pt-3">
                    {data.reminders.deviceLine ? (
                      <p className="flex items-start gap-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {data.reminders.deviceLine}
                      </p>
                    ) : null}
                    {data.reminders.expiringDocuments.length > 0 ? (
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        Expiring soon: {data.reminders.expiringDocuments.join(", ")}
                      </p>
                    ) : null}
                  </section>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </ECardBody>
    </ECard>
  );
}
