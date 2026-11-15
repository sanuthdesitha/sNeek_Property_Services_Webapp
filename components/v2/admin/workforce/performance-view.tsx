"use client";

/**
 * Cleaner performance page body (board "Workforce" › Cleaner performance page;
 * phone frame 6 on M-Workforce). Three windows side by side from 1024px, a
 * 30 / 90 / 365 switch on a phone. A window that took too long says "not
 * worked out" with a retry for that window only; its figures are "–", never 0.
 * Score words use the same limits as before (quality 85 good, 70 watch;
 * rating 4.3 good, 3.5 watch) and are written next to each figure.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { cn } from "@/lib/utils";
import type { PerformanceWindowDays, PerformanceWindowResult, SerializedMetrics } from "@/lib/workforce/performance-window";

type WindowState = PerformanceWindowResult | { status: "retrying"; windowDays: PerformanceWindowDays };

type Word = { text: string; detail?: string } | null;

function scoreWord(percent: number | null): Word {
  if (percent === null) return null;
  if (percent >= 85) return { text: "Good", detail: "85 and over" };
  if (percent >= 70) return { text: "Watch", detail: "70 to 84" };
  return { text: "Below", detail: "under 70" };
}

function ratingWord(rating: number | null): Word {
  if (rating === null) return null;
  if (rating >= 4.3) return { text: "Good", detail: "4.3 and over" };
  if (rating >= 3.5) return { text: "Watch", detail: "3.5 to 4.2" };
  return { text: "Below", detail: "under 3.5" };
}

const pct = (value: number | null) => (value === null ? "–" : `${Math.round(value)}%`);
const rating = (value: number | null) => (value === null ? "–" : `★ ${value.toFixed(2)}`);
function minutes(value: number | null): string {
  if (value === null) return "–";
  if (value === 0) return "on time";
  return value < 0 ? `${Math.abs(value)} min early` : `${value} min late`;
}

type Row = { label: string; value: string; sub?: string; bar?: number | null };

function rowsFor(metrics: SerializedMetrics, days: PerformanceWindowDays): Row[] {
  const rows: Row[] = [
    { label: "Quality score", value: pct(metrics.quality.score), sub: metrics.quality.sampleSize ? `${metrics.quality.sampleSize} reviews` : "no reviews", bar: metrics.quality.score },
    { label: "On time", value: pct(metrics.reliability.onTimePercent), bar: metrics.reliability.onTimePercent },
    { label: "Punctuality, average", value: minutes(metrics.punctuality.avgMinutesLate) },
    { label: "Photos and forms", value: pct(metrics.documentation.fullyDocumentedPercent), bar: metrics.documentation.fullyDocumentedPercent },
    { label: "Replies within 1 hour", value: pct(metrics.responseRate.acceptedPercent), bar: metrics.responseRate.acceptedPercent },
    { label: "Disputes", value: pct(metrics.disputeRate.percent), sub: `${metrics.disputeRate.disputes} of ${metrics.disputeRate.totalJobs}` },
    { label: "No-shows", value: pct(metrics.noShowRate.percent), sub: `${metrics.noShowRate.noShows} of ${metrics.noShowRate.scheduled}` },
    { label: "Client rating", value: rating(metrics.customerSatisfaction.avgRating), sub: `${metrics.customerSatisfaction.sampleSize} rating${metrics.customerSatisfaction.sampleSize === 1 ? "" : "s"}` },
  ];
  if (days === 30) rows.push({ label: "Training", value: `${metrics.trainingCompletion.completed} of ${metrics.trainingCompletion.assigned}`, sub: "modules" });
  return rows;
}

function windowTitle(state: WindowState): string {
  const base = `Last ${state.windowDays} days`;
  if (state.status === "ready") return `${base} · ${state.metrics.attendance.assignedJobs} jobs`;
  if (state.status === "retrying") return `${base} · working out…`;
  return `${base} · not worked out`;
}

export function PerformanceView({ userId, initial }: { userId: string; initial: PerformanceWindowResult[] }) {
  const phone = useIsPhone();
  const [windows, setWindows] = React.useState<WindowState[]>(initial);
  const [phoneWindow, setPhoneWindow] = React.useState<PerformanceWindowDays>(30);
  const controllers = React.useRef(new Map<number, AbortController>());

  React.useEffect(() => () => controllers.current.forEach((controller) => controller.abort()), []);

  async function retry(days: PerformanceWindowDays) {
    controllers.current.get(days)?.abort();
    const controller = new AbortController();
    controllers.current.set(days, controller);
    setWindows((current) => current.map((state) => (state.windowDays === days ? { status: "retrying", windowDays: days } : state)));
    let next: WindowState = { status: "failed", windowDays: days };
    try {
      const res = await fetch(`/api/admin/workforce/performance/${encodeURIComponent(userId)}?window=${days}`, { cache: "no-store", signal: controller.signal });
      const body = (await res.json().catch(() => null)) as PerformanceWindowResult | null;
      if (controller.signal.aborted) return;
      if (body && (body.status === "ready" || body.status === "timed_out" || body.status === "failed") && body.windowDays === days) next = body;
    } catch {
      if (controller.signal.aborted) return;
    }
    setWindows((current) => current.map((state) => (state.windowDays === days ? next : state)));
  }

  const w30 = windows.find((state) => state.windowDays === 30);
  const m30 = w30?.status === "ready" ? w30.metrics : null;
  const tiles: Array<{ label: string; value: string; word: Word; note?: string }> = [
    { label: "Quality · 30 days", value: m30 ? pct(m30.quality.score) : "–", word: scoreWord(m30?.quality.score ?? null) },
    { label: "On time · 30 days", value: m30 ? pct(m30.reliability.onTimePercent) : "–", word: scoreWord(m30?.reliability.onTimePercent ?? null) },
    { label: "Attendance · 30 days", value: m30 ? pct(m30.attendance.percent) : "–", word: scoreWord(m30?.attendance.percent ?? null) },
    { label: "Client rating · 30 days", value: m30 ? rating(m30.customerSatisfaction.avgRating) : "–", word: ratingWord(m30?.customerSatisfaction.avgRating ?? null) },
    {
      label: "Documents current",
      value: m30 ? pct(m30.documentCompliance.percent) : "–",
      word: null,
      note: m30 ? (m30.documentCompliance.expired > 0 ? `${m30.documentCompliance.expired} expired` : m30.documentCompliance.percent === null ? "none on file" : "all current") : undefined,
    },
  ];

  const shownWindows = phone ? windows.filter((state) => state.windowDays === phoneWindow) : windows;

  return (
    <div className="space-y-4">
      {phone ? (
        <div role="radiogroup" aria-label="Window" className="flex rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-0.5">
          {([30, 90, 365] as const).map((days) => (
            <button key={days} type="button" role="radio" aria-checked={phoneWindow === days} onClick={() => setPhoneWindow(days)}
              className={cn("min-h-11 flex-1 rounded-[calc(var(--e-radius)-2px)] text-[0.8125rem]", phoneWindow === days ? "bg-[hsl(var(--e-surface))] font-[600] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))]")}>
              {days} days
            </button>
          ))}
        </div>
      ) : null}

      {!phone || phoneWindow === 30 ? (
        <section aria-label="Last 30 days at a glance" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {tiles.map((tile) => (
            <div key={tile.label} className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{tile.label}</p>
              <p className="e-numeral mt-1 text-[1.5rem] leading-none">{tile.value}</p>
              {tile.word ? (
                <p className="mt-1.5 inline-block rounded-full border border-[hsl(var(--e-border))] px-2 text-[0.6875rem] font-[600]">
                  {tile.word.text}{tile.word.detail ? <span className="font-[400]"> · {tile.word.detail}</span> : null}
                </p>
              ) : tile.note ? (
                <p className="mt-1.5 text-[0.6875rem] font-[600]">{tile.note}</p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {shownWindows.map((state) => (
          <section key={state.windowDays} aria-label={`Last ${state.windowDays} days`} className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
            <h2 className="mb-3 text-[0.9375rem] font-semibold">{windowTitle(state)}</h2>
            {state.status === "ready" ? (
              <dl className="space-y-2.5">
                {rowsFor(state.metrics, state.windowDays).map((row) => (
                  <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                    <dt className="text-[0.8125rem]">{row.label}</dt>
                    <dd className="text-right text-[0.8125rem] font-[600] e-tnum">
                      {row.value}
                      {row.sub ? <span className="ml-1 font-[400] text-[hsl(var(--e-muted-foreground))]">{row.sub}</span> : null}
                    </dd>
                    {typeof row.bar === "number" ? (
                      <div aria-hidden className="col-span-2 mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--e-muted))]">
                        <div className="h-full rounded-full bg-[hsl(var(--e-primary))]" style={{ width: `${Math.max(0, Math.min(100, row.bar))}%` }} />
                      </div>
                    ) : null}
                  </div>
                ))}
              </dl>
            ) : (
              <div className="space-y-3">
                {state.status === "retrying" ? (
                  <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Working out this window again…</p>
                ) : (
                  <EToneNotice tone="attention" role="alert" title={state.status === "timed_out" ? "This window took too long to work out." : "This window could not be worked out."}>
                    Its figures are left empty rather than shown as 0.{" "}
                    <EButton variant="outline" size="sm" className="mt-2" onClick={() => void retry(state.windowDays)}>Try again</EButton>
                  </EToneNotice>
                )}
                <dl className="space-y-2 text-[0.8125rem]">
                  {["Quality score", "On time", "Client rating"].map((label) => (
                    <div key={label} className="flex justify-between gap-2">
                      <dt>{label}</dt>
                      <dd className="text-[hsl(var(--e-muted-foreground))]">– not worked out</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </section>
        ))}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Score words use the same limits as before (quality: 85 good, 70 watch; rating: 4.3 good, 3.5 watch) and are written next to each figure. Small samples can mislead; missing data shows as &ldquo;–&rdquo;, never 0. Recent QA fails, coaching and kudos are in their tabs.
      </p>
    </div>
  );
}
