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
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

type Row = {
  label: string;
  value: string;
  /** The figure's basis: what it was worked out over, with the counts. */
  sub: string;
  bar?: number | null;
  /** Plain-words definition, shown under "How this is worked out". */
  how: string;
};

/** "Not enough data" when a figure is below the minimum sample, otherwise nothing. */
function short(value: number | null, sample: number, minimum: number): string {
  return value === null && sample < minimum ? "Not enough data · " : "";
}

function missingStarts(m: { noClockIn: number; noStartTime: number }): string {
  const parts = [m.noClockIn ? `${m.noClockIn} without their clock-in` : "", m.noStartTime ? `${m.noStartTime} without a start time` : ""].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function rowsFor(metrics: SerializedMetrics, days: PerformanceWindowDays): Row[] {
  const min = metrics.minimumSample;
  const jobs = metrics.finishedJobs;
  const q = metrics.quality;
  const on = metrics.reliability;
  const p = metrics.punctuality;
  const doc = metrics.documentation;
  const reply = metrics.responseRate;
  const att = metrics.attendance;
  const ns = metrics.noShowRate;
  const cs = metrics.customerSatisfaction;
  const rw = metrics.reworkRate;
  const rows: Row[] = [
    {
      label: "Quality score",
      value: pct(q.score),
      sub: `${short(q.score, q.sampleSize, min)}${q.sampleSize} of ${plural(jobs, "job")} reviewed`,
      bar: q.score,
      how: "Average score of the deciding QA review on each finished job (a QA inspection over an office score over an automatic one). Jobs without a review are left out. The same average as the Quality hub.",
    },
    {
      label: "On time",
      value: pct(on.onTimePercent),
      sub: `${short(on.onTimePercent, on.sampleSize, min)}${on.onTime} of ${on.sampleSize} on time · ${on.sampleSize} of ${plural(jobs, "job")} had their clock-in and a start time${missingStarts(on)}`,
      bar: on.onTimePercent,
      how: `Their first clock-in on the job no later than 15 minutes after the scheduled start (the job's day and start time, Sydney time). A job without their clock-in or without a start time is left out, never counted as on time.`,
    },
    {
      label: "Punctuality, average",
      value: minutes(p.avgMinutesLate),
      sub: `${short(p.avgMinutesLate, p.sampleSize, min)}over ${plural(p.sampleSize, "job")} with their clock-in and a start time`,
      how: "Average minutes between the scheduled start (Sydney time) and their first clock-in, over the same jobs as On time. Early starts count as negative.",
    },
    {
      label: "Photos and forms",
      value: pct(doc.fullyDocumentedPercent),
      sub: `${short(doc.fullyDocumentedPercent, doc.sampleSize, min)}${doc.documented} of ${plural(jobs, "job")} · ${doc.withoutForm} without a form${doc.formWithoutPhotos ? ` · ${doc.formWithoutPhotos} form${doc.formWithoutPhotos === 1 ? "" : "s"} without photos` : ""}`,
      bar: doc.fullyDocumentedPercent,
      how: "Finished jobs whose form was submitted with at least one photo, out of all finished jobs. A job with no form counts against it. A team job has one shared form, so it counts for each cleaner on it.",
    },
    {
      label: "Replies within 1 hour",
      value: pct(reply.acceptedPercent),
      sub: `${short(reply.acceptedPercent, reply.sampleSize, min)}${reply.repliedWithinHour} of ${plural(reply.sampleSize, "offer")}`,
      bar: reply.acceptedPercent,
      how: `Job offers made to them in the window (at least an hour ago) that they accepted, declined or passed on within 60 minutes. Starting a job without replying is not a reply. Jobs the office put straight onto them are left out${reply.officeAccepted ? ` (${reply.officeAccepted} here)` : ""}.`,
    },
    {
      label: "Attendance",
      value: pct(att.percent),
      sub: `${short(att.percent, att.assignedJobs, min)}${att.completedJobs} of ${plural(att.assignedJobs, "past job")}${att.notRecorded ? ` · ${att.notRecorded} not recorded` : ""}`,
      bar: att.percent,
      how: "Past jobs (before today) still assigned to them, not cancelled or skipped, where they clocked in or submitted the form. A job that was started or finished with no record of them is \u201cnot recorded\u201d and left out.",
    },
    {
      label: "No-shows",
      value: pct(ns.percent),
      sub: `${short(ns.percent, ns.scheduled, min)}${ns.noShows} of ${plural(ns.scheduled, "past job")}${ns.notRecorded ? ` · ${ns.notRecorded} not recorded` : ""}`,
      how: "The same past jobs as Attendance where they never clocked in and nobody started the job. Attendance and no-shows add up to 100% of these jobs.",
    },
    {
      label: "Disputes",
      value: pct(metrics.disputeRate.percent),
      sub: `${short(metrics.disputeRate.percent, jobs, min)}${metrics.disputeRate.disputes} of ${plural(jobs, "job")}`,
      how: "Finished jobs with a \u201cClient dispute\u201d case that was not cancelled. Damage, operations, SLA and lost property cases, QA issues and pay adjustments are not disputes.",
    },
    {
      label: "Client rating",
      value: rating(cs.avgRating),
      sub: `${short(cs.avgRating, cs.sampleSize, min)}${plural(cs.sampleSize, "rating")} on ${plural(jobs, "job")}`,
      how: "One rating per finished job: the client's feedback rating, otherwise their satisfaction score, averaged.",
    },
    {
      label: "Confirmed reworks",
      value: rw.percent === null ? "–" : `${rw.percent}%`,
      sub: `${short(rw.percent, jobs, min)}${rw.reworks} confirmed in the window · per ${plural(jobs, "job")}`,
      how: "Approved QA rework records against them, reviewed in the window, per finished job. Shown on its own; it does not lower the quality score.",
    },
  ];
  if (days === 30) {
    rows.push({
      label: "Training",
      value: `${metrics.trainingCompletion.completed} of ${metrics.trainingCompletion.assigned}`,
      sub: "modules",
      how: "Training modules assigned to them that they have completed (all time).",
    });
  }
  return rows;
}

function windowTitle(state: WindowState): string {
  const base = `Last ${state.windowDays} days`;
  if (state.status === "ready") return `${base} · ${plural(state.metrics.finishedJobs, "finished job")}`;
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
    {
      label: "Quality · 30 days",
      value: m30 ? pct(m30.quality.score) : "–",
      word: scoreWord(m30?.quality.score ?? null),
      note: m30 ? `${m30.quality.score === null ? "Not enough data · " : ""}${m30.quality.sampleSize} of ${plural(m30.finishedJobs, "job")} reviewed` : undefined,
    },
    {
      label: "On time · 30 days",
      value: m30 ? pct(m30.reliability.onTimePercent) : "–",
      word: scoreWord(m30?.reliability.onTimePercent ?? null),
      note: m30 ? `${m30.reliability.onTimePercent === null ? "Not enough data · " : ""}${m30.reliability.sampleSize} of ${plural(m30.finishedJobs, "job")} had a clock-in` : undefined,
    },
    {
      label: "Attendance · 30 days",
      value: m30 ? pct(m30.attendance.percent) : "–",
      word: scoreWord(m30?.attendance.percent ?? null),
      note: m30 ? `${m30.attendance.percent === null ? "Not enough data · " : ""}${m30.attendance.completedJobs} of ${plural(m30.attendance.assignedJobs, "past job")}` : undefined,
    },
    {
      label: "Client rating · 30 days",
      value: m30 ? rating(m30.customerSatisfaction.avgRating) : "–",
      word: ratingWord(m30?.customerSatisfaction.avgRating ?? null),
      note: m30 ? `${m30.customerSatisfaction.avgRating === null ? "Not enough data · " : ""}${plural(m30.customerSatisfaction.sampleSize, "rating")}` : undefined,
    },
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
              ) : null}
              {tile.note ? <p className="mt-1.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{tile.note}</p> : null}
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
                  <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                    <dt className="text-[0.8125rem]">{row.label}</dt>
                    <dd className="text-right text-[0.8125rem] font-[600] e-tnum">{row.value}</dd>
                    <dd className="col-span-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.sub}</dd>
                    {typeof row.bar === "number" ? (
                      <div aria-hidden className="col-span-2 mt-1 h-1.5 overflow-hidden rounded-full bg-[hsl(var(--e-muted))]">
                        <div className="h-full rounded-full bg-[hsl(var(--e-primary))]" style={{ width: `${Math.max(0, Math.min(100, row.bar))}%` }} />
                      </div>
                    ) : null}
                    <dd className="col-span-2">
                      <details className="group">
                        <summary className="inline-flex min-h-8 cursor-pointer items-center text-[0.75rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">How this is worked out</summary>
                        <p className="pb-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.how}</p>
                      </details>
                    </dd>
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
        Score words use the same limits as before (quality: 85 good, 70 watch; rating: 4.3 good, 3.5 watch) and are written next to each figure. A figure needs at least {m30?.minimumSample ?? 3} jobs, offers or ratings; below that it reads &ldquo;Not enough data&rdquo;. Missing records are left out and counted, never shown as 0 or 100%. Recent QA fails, coaching and kudos are in their tabs.
      </p>
    </div>
  );
}
