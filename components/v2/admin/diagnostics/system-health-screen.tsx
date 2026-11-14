"use client";

/**
 * System health (admin Diagnostics, board "Diagnostics", 2026-11-16).
 *
 * Opens with one sentence built from real state ("N things need you"), then
 * twelve area cards with five states, the outside services, scheduled work in
 * plain names (technical detail folded), the queue, the database, the bounce
 * list and the server. The Email, Uploads and Server tabs keep the earlier
 * Diagnostics functions; old `?tab=system` links open Server.
 *
 * "Check again" re-reads the server (a second press cancels the first). A
 * failed check turns every card into "Cannot tell from here", never
 * "Working". A check older than ten minutes says so.
 */
import * as React from "react";
import Link from "next/link";
import { Copy, Info, RefreshCw } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { EButton, ECard, EPageHeader, ETabs } from "@/components/v2/ui/primitives";
import { EToneCard, toneNoticeClass, toneMutedClass } from "@/components/v2/ui/tone-band";
import { EPhoneActionBar, ESectionSwitcher } from "@/components/v2/ui/phone-bars";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { formatHealthTime, unreadableAreas, HEALTH_STATE_WORD } from "@/lib/ops/system-health-model";
import type { HealthArea, SystemHealthView, TaskRow } from "@/lib/ops/system-health-types";
import { HEALTH_LEGEND, HealthShape, HealthStatus, healthTone } from "./health-shapes";
import { EmailTab, ServerTab, UploadsTab, type EmailRow, type UploadRow } from "./diagnostics-hub";
import type { HealthTab } from "./health-tabs";

const OLDER_AFTER_MS = 10 * 60_000;
const PREVIEW_TASKS = 9;
const MUTED = "text-[hsl(var(--e-muted-foreground))]";
const H2 = "font-[family-name:var(--e-font-serif)] text-[1.375rem] font-medium leading-tight";

type CheckState = { status: "idle" } | { status: "checking" } | { status: "failed"; at: string };

function zoneLabel(timeZone: string): string {
  return timeZone === "Australia/Sydney" ? "Sydney time" : `${timeZone} time`;
}

function clockOf(view: SystemHealthView) {
  return { now: new Date(view.checkedAt), timeZone: view.timeZone };
}

/* ── Small pieces ────────────────────────────────────────────────────────── */

function FixLink({ fix }: { fix?: { label: string; href: string } }) {
  if (!fix) return null;
  return (
    <Link href={fix.href} className="font-medium text-[hsl(var(--e-accent-portal))] underline underline-offset-2">
      {fix.label}
    </Link>
  );
}

function SectionHeading({ id, title, aside }: { id: string; title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 id={id} className={H2}>{title}</h2>
      {aside ? <p className={cn("min-w-0 text-[0.8125rem]", MUTED)}>{aside}</p> : null}
    </div>
  );
}

/** Folded on a phone (a native disclosure), always open from 640px up. */
function PhoneFold({ summary, children, defaultOpen = false }: { summary: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const phone = useIsPhone();
  if (!phone) return <>{children}</>;
  return (
    <details open={defaultOpen} className="group rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2 text-[0.875rem] font-semibold">
        <span className="min-w-0">{summary}</span>
        <span aria-hidden className="text-[hsl(var(--e-muted-foreground))] group-open:rotate-90">▸</span>
      </summary>
      <div className="border-t border-[hsl(var(--e-border))] p-2">{children}</div>
    </details>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.75rem]" aria-label="What the states mean">
      {HEALTH_LEGEND.map((item) => (
        <span key={item.state} className="inline-flex items-center gap-1.5">
          <HealthShape state={item.state} />
          {item.word}
        </span>
      ))}
      <span className={MUTED}>Each state has its own shape and word, so it reads without colour.</span>
    </div>
  );
}

function AreaCard({ area, checking }: { area: HealthArea; checking: boolean }) {
  const tone = healthTone(area.state);
  return (
    <EToneCard
      tone={tone}
      header={<span className="text-[0.75rem] font-medium">{area.title}</span>}
      headerClassName="px-3 py-2"
      bodyClassName="px-3 pb-3 pt-1.5"
      className="min-w-0"
      data-health-area={area.key}
    >
      <HealthStatus state={area.state} word={area.word} className="text-[0.875rem]" />
      <p className={cn("mt-1 break-words text-[0.75rem]", MUTED)}>
        {checking ? "Checking… " : ""}
        {area.short}
      </p>
    </EToneCard>
  );
}

function ServiceCard({ area }: { area: HealthArea }) {
  const tone = healthTone(area.state);
  return (
    <EToneCard
      tone={tone}
      header={<h3 className="text-[0.9375rem] font-semibold">{area.title}</h3>}
      pill={<HealthStatus state={area.state} word={area.word} className="text-[0.8125rem]" />}
      className="min-w-0"
    >
      <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[0.8125rem]">
        {area.rows.map((row) => (
          <React.Fragment key={row.label}>
            <dt className={MUTED}>{row.label}</dt>
            <dd className="min-w-0 break-words">{row.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {area.note ? <p className={cn("mt-2 text-[0.75rem]", MUTED)}>{area.note}</p> : null}
      {area.fix ? <p className="mt-2 text-[0.8125rem]"><FixLink fix={area.fix} /></p> : null}
    </EToneCard>
  );
}

/* ── Summary ─────────────────────────────────────────────────────────────── */

function Summary({ view, check }: { view: SystemHealthView; check: CheckState }) {
  const clock = clockOf(view);
  if (check.status === "failed") {
    return (
      <div role="alert" className={cn("rounded-[var(--e-radius-lg)] p-4", toneNoticeClass("problem"))}>
        <h2 className="flex items-center gap-2 font-[family-name:var(--e-font-serif)] text-[1.25rem] font-medium">
          <HealthShape state="unknown" /> System health could not be read at {formatHealthTime(check.at, clock)}.
        </h2>
        <p className={cn("mt-1 text-[0.8125rem]", toneMutedClass("problem"))}>
          Every card says &quot;Cannot tell from here&quot; until a check succeeds. The links below are from the check at {formatHealthTime(view.checkedAt, clock)} and still work.
        </p>
        <SummaryItems view={view} tone="problem" />
      </div>
    );
  }
  const needs = view.summary.needs > 0;
  const tone = needs ? "attention" : view.areas.some((area) => area.state === "unknown") ? "info" : "good";
  return (
    <div className={cn("rounded-[var(--e-radius-lg)] p-4", toneNoticeClass(tone))} data-health-summary="">
      <h2 className="flex items-start gap-2 font-[family-name:var(--e-font-serif)] text-[1.25rem] font-medium leading-snug">
        <HealthShape state={needs ? "attention" : view.areas.some((area) => area.state === "unknown") ? "unknown" : "working"} className="mt-1.5" />
        <span className="min-w-0">{view.summary.sentence}</span>
      </h2>
      <SummaryItems view={view} tone={tone} />
    </div>
  );
}

function SummaryItems({ view, tone }: { view: SystemHealthView; tone: "attention" | "info" | "good" | "problem" }) {
  if (view.summary.items.length === 0) return null;
  return (
    <ul className={cn("mt-2 list-disc space-y-1 pl-6 text-[0.8125rem]", toneMutedClass(tone))}>
      {view.summary.items.map((item) => (
        <li key={item.key} className="break-words">
          <strong className="text-[hsl(var(--e-foreground))]">{item.title}</strong>: {item.text} <FixLink fix={item.fix} />
        </li>
      ))}
    </ul>
  );
}

/* ── Scheduled work ──────────────────────────────────────────────────────── */

function TaskStatus({ row }: { row: TaskRow }) {
  const word = row.state === "failing" ? "Failed" : row.state === "attention" ? "Late" : row.state === "working" ? "Ok" : "Cannot tell";
  return <HealthStatus state={row.state} word={word} className="text-[0.8125rem]" />;
}

function TaskTable({ rows, view, selected, onSelect, label }: { rows: TaskRow[]; view: SystemHealthView; selected: string | null; onSelect: (name: string) => void; label: string }) {
  const clock = clockOf(view);
  return (
    <>
      <div className="overflow-x-auto max-sm:hidden" role="region" aria-label={label} tabIndex={0}>
        <table className="w-full min-w-[640px] text-left text-[0.8125rem]">
          <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Task</th>
              <th scope="col" className="px-3 py-2 font-medium">Runs</th>
              <th scope="col" className="px-3 py-2 font-medium">Last run</th>
              <th scope="col" className="px-3 py-2 font-medium">Last 24 h</th>
              <th scope="col" className="px-3 py-2 font-medium">Next</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className={cn("border-t border-[hsl(var(--e-border))] align-top", selected === row.name && "bg-[hsl(var(--e-primary)/0.08)]")}>
                <td className="px-3 py-2.5">
                  {row.failure ? (
                    <button type="button" className="text-left font-semibold underline-offset-2 hover:underline" onClick={() => onSelect(row.name)} aria-pressed={selected === row.name}>
                      {row.plainName}
                    </button>
                  ) : (
                    <span className="font-semibold">{row.plainName}</span>
                  )}
                  <span className={cn("block text-[0.75rem]", MUTED)}>{row.description}</span>
                </td>
                <td className="px-3 py-2.5">{row.runs}</td>
                <td className="px-3 py-2.5">
                  <TaskStatus row={row} />
                  <span className={cn("block text-[0.75rem]", MUTED)}>{row.lastRunText}</span>
                </td>
                <td className="px-3 py-2.5">{row.last24h}</td>
                <td className="px-3 py-2.5">{row.nextAt ? formatHealthTime(row.nextAt, clock) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-[hsl(var(--e-border))] sm:hidden" aria-label={label}>
        {rows.map((row) => (
          <li key={row.name} className="space-y-1 px-3.5 py-3 text-[0.8125rem]">
            <div className="flex items-start justify-between gap-2">
              {row.failure ? (
                <button type="button" className="min-h-11 text-left font-semibold" onClick={() => onSelect(row.name)} aria-pressed={selected === row.name}>
                  {row.plainName}
                </button>
              ) : (
                <span className="font-semibold">{row.plainName}</span>
              )}
              <TaskStatus row={row} />
            </div>
            <p className={MUTED}>{row.lastRunText}</p>
            <p className={MUTED}>
              {row.runs} · {row.last24h} · next {row.nextAt ? formatHealthTime(row.nextAt, clock) : "—"}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

function FailurePanel({ row, view, total }: { row: TaskRow; view: SystemHealthView; total: string }) {
  const failure = row.failure!;
  return (
    <EToneCard
      tone="problem"
      header={<h3 className="text-[0.9375rem] font-semibold">{row.plainName} failed at {formatHealthTime(failure.at, clockOf(view))}</h3>}
      pill={total}
      data-health-failure={row.name}
    >
      <div className="space-y-2 text-[0.8125rem]">
        <p><strong>What happened:</strong> {failure.whatHappened}</p>
        <p><strong>What it means:</strong> {failure.whatItMeans}</p>
        <p><strong>What to do:</strong> {failure.whatToDo} {failure.fix ? <FixLink fix={failure.fix} /> : null}</p>
        <details className="border-t border-[hsl(var(--e-border))] pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium text-[hsl(var(--e-accent-portal))] sm:min-h-0">Technical details · {row.name}</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] p-2.5 font-mono text-[0.75rem]">{failure.technical}</pre>
        </details>
      </div>
    </EToneCard>
  );
}

function useSelectedFailure(rows: TaskRow[] | null) {
  const failing = React.useMemo(() => (rows ?? []).filter((row) => row.failure), [rows]);
  const [selected, setSelected] = React.useState<string | null>(failing[0]?.name ?? null);
  React.useEffect(() => {
    if (!failing.some((row) => row.name === selected)) setSelected(failing[0]?.name ?? null);
  }, [failing, selected]);
  return { failing, selected, setSelected, selectedRow: failing.find((row) => row.name === selected) ?? null };
}

function WorkerNote({ view }: { view: SystemHealthView }) {
  return (
    <div className={cn("flex gap-2 rounded-[var(--e-radius-lg)] p-3 text-[0.8125rem]", toneNoticeClass(view.workerKnown ? "info" : "attention"))} data-health-worker={view.workerKnown ? "known" : "silent"}>
      <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0">
        <strong>Where the worker runs:</strong> in its own process beside the web server or its own container. {view.workerNote} If it stops reporting for 3 minutes, this page says &quot;Cannot tell from here&quot; instead of showing an old state as healthy.
      </p>
    </div>
  );
}

function QueueCard({ view }: { view: SystemHealthView }) {
  const queue = view.queue;
  return (
    <ECard className="p-4">
      <h3 className="text-[0.9375rem] font-semibold">Job queue</h3>
      {queue ? (
        <dl className="mt-2 space-y-1 text-[0.8125rem]">
          {[
            ["Waiting to run", queue.waiting],
            ["Running now", queue.running],
            ["Will retry", queue.willRetry],
            ["Failed for good, last 24 h", queue.failed24h],
            ["Stuck past their time limit", queue.stuck],
            ["Done, last hour", queue.doneLastHour],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between gap-3">
              <dt>{label}</dt>
              <dd className="font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-[0.8125rem]">The queue could not be read, so its state is unknown.</p>
      )}
      {!view.workerKnown && queue ? <p className={cn("mt-2 text-[0.75rem]", MUTED)}>Counts are stored rows; with the worker silent nothing is being taken from the queue that this page can see.</p> : null}
    </ECard>
  );
}

function ScheduledSection({ view, preview }: { view: SystemHealthView; preview: boolean }) {
  const { failing, selected, setSelected, selectedRow } = useSelectedFailure(view.tasks);
  const rows = view.tasks ?? [];
  const shown = preview ? rows.slice(0, PREVIEW_TASKS) : rows;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <ECard className="min-w-0 overflow-hidden">
        {view.tasks === null ? (
          <p role="alert" className="p-4 text-[0.875rem]">The scheduled task history could not be read, so this page cannot tell how scheduled work is running.</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-[0.875rem]">No scheduled task is stored in this database. The worker registers them when it starts; until then this page cannot tell anything about scheduled work.</p>
        ) : (
          <>
            <TaskTable rows={shown} view={view} selected={selected} onSelect={setSelected} label="Scheduled tasks" />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] px-3 py-2 text-[0.75rem]">
              <span className={MUTED}>Showing {shown.length} of {rows.length} · failures first, then by how often they run</span>
              {preview && rows.length > shown.length ? (
                <EButton asChild variant="outline" size="sm">
                  <Link href="/v2/admin/diagnostics?tab=scheduled">Show all {rows.length}</Link>
                </EButton>
              ) : null}
            </div>
          </>
        )}
      </ECard>
      <div className="min-w-0 space-y-4">
        {selectedRow ? <FailurePanel row={selectedRow} view={view} total={selectedRow.last24h} /> : null}
        {failing.length === 0 && view.tasks && view.workerKnown ? <p className={cn("text-[0.8125rem]", MUTED)}>No task&apos;s latest run failed.</p> : null}
        <QueueCard view={view} />
        <WorkerNote view={view} />
      </div>
    </div>
  );
}

/* ── Database, bounce list, server ──────────────────────────────────────── */

function DatabaseCard({ view }: { view: SystemHealthView }) {
  const database = view.database;
  return (
    <ECard className="min-w-0 p-4">
      <h3 className="text-[0.9375rem] font-semibold">Database</h3>
      {database.reachable ? (
        <>
          <dl className="mt-2 space-y-1 text-[0.8125rem]">
            <div className="flex justify-between gap-3"><dt>Queries running now</dt><dd className="font-semibold">{database.runningQueries ?? "Not readable"}</dd></div>
            <div className="flex justify-between gap-3"><dt>Longest running</dt><dd className="font-semibold">{database.longestSeconds === null ? "Not readable" : `${database.longestSeconds} s`}</dd></div>
          </dl>
          <details className="mt-2 border-t border-[hsl(var(--e-border))] pt-2 text-[0.8125rem]">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium text-[hsl(var(--e-accent-portal))] sm:min-h-0">Query text and process ids</summary>
            {database.activeQueries.length ? (
              <ul className="mt-2 space-y-1.5">
                {database.activeQueries.map((query) => (
                  <li key={query.pid} className="break-words font-mono text-[0.6875rem]">pid {query.pid} · {query.seconds} s · {query.state ?? "unknown"} · {query.query}</li>
                ))}
              </ul>
            ) : (
              <p className={cn("mt-2", MUTED)}>No other query is running.</p>
            )}
          </details>
        </>
      ) : (
        <p role="alert" className="mt-2 text-[0.8125rem]">The database could not be reached from the web server.</p>
      )}
    </ECard>
  );
}

function BounceCard({ view, email }: { view: SystemHealthView; email: EmailRow[] }) {
  return (
    <ECard className="min-w-0 p-4">
      <h3 className="text-[0.9375rem] font-semibold">Email tab · bounce list {view.emailBounceList ?? ""}</h3>
      {email.length ? (
        <ul className="mt-2 space-y-1 text-[0.8125rem]">
          {email.slice(0, 3).map((row) => (
            <li key={row.email} className="break-words">{row.email} · {(row.reason ?? "on the list").toLowerCase().replace(/_/g, " ")}</li>
          ))}
        </ul>
      ) : (
        <p className={cn("mt-2 text-[0.8125rem]", MUTED)}>No address is on the bounce list.</p>
      )}
      <p className="mt-2 text-[0.8125rem]">
        <Link href="/v2/admin/diagnostics?tab=email" className="font-medium text-[hsl(var(--e-accent-portal))] underline underline-offset-2">Open the Email tab</Link> to remove an address from the list.
      </p>
    </ECard>
  );
}

function ServerCard({ view }: { view: SystemHealthView }) {
  const hours = Math.floor(view.server.uptimeSeconds / 3600);
  return (
    <ECard className="min-w-0 p-4">
      <h3 className="text-[0.9375rem] font-semibold">Server</h3>
      <dl className="mt-2 space-y-1 text-[0.8125rem]">
        <div className="flex justify-between gap-3"><dt>Web server running for</dt><dd className="font-semibold">{Math.floor(hours / 24)} d {hours % 24} h</dd></div>
        <div className="flex justify-between gap-3"><dt>Memory</dt><dd className="font-semibold">{view.server.rssMB} MB of {view.server.totalMemMB} MB</dd></div>
      </dl>
      <p className={cn("mt-2 text-[0.75rem]", MUTED)}>
        CPU, &quot;CPU taken by host&quot; and per-job run times are live on the <Link href="/v2/admin/diagnostics?tab=server" className="underline underline-offset-2">Server tab</Link>. Above 10% taken by host means a busy server neighbour; no setting in the app fixes it.
      </p>
    </ECard>
  );
}

/* ── Overview ────────────────────────────────────────────────────────────── */

function Overview({ view, check, email }: { view: SystemHealthView; check: CheckState; email: EmailRow[] }) {
  const areas = check.status === "failed" ? unreadableAreas(view.areas) : view.areas;
  const checking = check.status === "checking";
  const services = areas.filter((area) => area.service);
  return (
    <div className="space-y-8">
      <ESectionSwitcher
        label="System health sections"
        sections={[
          { id: "health-summary", label: "Summary" },
          { id: "health-services", label: "Outside services" },
          { id: "health-scheduled", label: "Scheduled work" },
          { id: "health-more", label: "Database and server" },
        ]}
      />
      <section id="health-summary" className="space-y-4" aria-label="Summary">
        <Summary view={view} check={check} />
        <Legend />
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {areas.map((area) => <AreaCard key={area.key} area={area} checking={checking} />)}
        </div>
      </section>
      <section id="health-services" className="space-y-3" aria-labelledby="health-services-title">
        <SectionHeading id="health-services-title" title="Outside services" aside={'What we know, how we know it, and where to fix it. "Key present" is not the same as "working": only a real recent use counts as working.'} />
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {services.map((area) => (
            <PhoneFold key={area.key} summary={<span className="flex items-center justify-between gap-2">{area.title} <HealthStatus state={area.state} word={area.word} className="text-[0.8125rem]" /></span>} defaultOpen={area.state === "attention" || area.state === "failing"}>
              <ServiceCard area={area} />
            </PhoneFold>
          ))}
        </div>
      </section>
      <section id="health-scheduled" className="space-y-3" aria-labelledby="health-scheduled-title">
        <SectionHeading id="health-scheduled-title" title="Scheduled work" aside={`The background worker runs ${view.tasks?.length ?? "its"} tasks on a timetable (${zoneLabel(view.timeZone)}). Names in plain words; the internal name is in the detail.`} />
        <ScheduledSection view={view} preview />
      </section>
      <section id="health-more" className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3" aria-label="Database, bounce list and server">
        <DatabaseCard view={view} />
        <BounceCard view={view} email={email} />
        <ServerCard view={view} />
      </section>
    </div>
  );
}

/* ── Screen ──────────────────────────────────────────────────────────────── */

export function SystemHealthScreen({
  initialView,
  tab,
  email,
  uploads,
}: {
  initialView: SystemHealthView | null;
  tab: HealthTab;
  email: EmailRow[];
  uploads: UploadRow[];
}) {
  const [view, setView] = React.useState<SystemHealthView | null>(initialView);
  const [check, setCheck] = React.useState<CheckState>(initialView ? { status: "idle" } : { status: "failed", at: new Date().toISOString() });
  const [copied, setCopied] = React.useState<"idle" | "copied" | "failed">("idle");
  const [now, setNow] = React.useState(() => Date.now());
  const controller = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearInterval(timer);
      controller.current?.abort();
    };
  }, []);

  const checkAgain = React.useCallback(async () => {
    // A second "Check again" cancels the first.
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setCheck({ status: "checking" });
    try {
      const response = await fetch("/api/admin/system/health", { cache: "no-store", signal: current.signal });
      const body = (await response.json().catch(() => null)) as SystemHealthView | null;
      if (current.signal.aborted) return;
      if (!response.ok || !body || !Array.isArray(body.areas)) throw new Error("unreadable");
      setView(body);
      setNow(Date.now());
      setCheck({ status: "idle" });
    } catch {
      if (current.signal.aborted) return;
      setCheck({ status: "failed", at: new Date().toISOString() });
    }
  }, []);

  async function copySupport() {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.support);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  const timeZone = view?.timeZone ?? "Australia/Sydney";
  const checkedText = view ? formatInTimeZone(new Date(view.checkedAt), timeZone, "HH:mm") : null;
  const older = view !== null && check.status === "idle" && now - new Date(view.checkedAt).getTime() > OLDER_AFTER_MS;
  const checkButton = (
    <EButton onClick={() => void checkAgain()} aria-busy={check.status === "checking"}>
      <RefreshCw aria-hidden className={cn("h-4 w-4", check.status === "checking" && "animate-spin motion-reduce:animate-none")} />
      {check.status === "checking" ? "Checking…" : "Check again"}
    </EButton>
  );

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "scheduled", label: "Scheduled work", badge: view?.tasks ? <span className={cn("text-[0.75rem]", MUTED)}>{view.tasks.length}</span> : undefined },
    { key: "email", label: "Email", badge: <span className={cn("text-[0.75rem]", MUTED)}>{email.length}</span> },
    { key: "uploads", label: "Uploads", badge: <span className={cn("text-[0.75rem]", MUTED)}>{uploads.length}</span> },
    { key: "server", label: "Server" },
  ];

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Setup · System · administrators only"
        title="System health"
        description={
          <>
            Is everything behind the app working: scheduled work, the database and each outside service.
            {checkedText ? ` Checked ${checkedText}, ${zoneLabel(timeZone)}.` : " Not checked yet."} Plain words first; technical detail is folded underneath.
          </>
        }
        actions={
          <>
            <EButton variant="outline" onClick={() => void copySupport()} disabled={!view}>
              <Copy aria-hidden className="h-4 w-4" /> Copy details for support
            </EButton>
            <span className="max-sm:hidden">{checkButton}</span>
          </>
        }
      />
      <div aria-live="polite" className="text-[0.8125rem]">
        {copied === "copied" ? <p>Copied. It has times, task names, counts and error text; no passwords, keys, tokens or client details.</p> : null}
        {copied === "failed" ? <p role="alert">The browser did not allow copying. Select the text in Server › support details instead, or try again.</p> : null}
        {check.status === "checking" && view ? <p>Checking… cards show the check from {checkedText} until it finishes.</p> : null}
        {older && view ? (
          <p className={cn("flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] p-2", toneNoticeClass("info"))}>
            Showing the check from {checkedText}.
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => void checkAgain()}>Refresh</button>
          </p>
        ) : null}
      </div>
      <ETabs ariaLabel="System health sections" items={tabs} active={tab} hrefFor={(key) => (key === "overview" ? "/v2/admin/diagnostics" : `/v2/admin/diagnostics?tab=${key}`)} />
      {tab === "overview" || tab === "scheduled" ? (
        view ? (
          tab === "overview" ? (
            <Overview view={view} check={check} email={email} />
          ) : (
            <section className="space-y-3" aria-labelledby="health-scheduled-all">
              <SectionHeading id="health-scheduled-all" title="Scheduled work" aside={`Every task the worker has stored (${zoneLabel(timeZone)}). Failures first.`} />
              {check.status === "failed" ? <p role="alert" className="text-[0.875rem]">The latest check failed; this is the check from {checkedText}.</p> : null}
              <ScheduledSection view={view} preview={false} />
            </section>
          )
        ) : (
          <div role="alert" className={cn("rounded-[var(--e-radius-lg)] p-4 text-[0.875rem]", toneNoticeClass("problem"))}>
            <p className="font-semibold">System health could not be read.</p>
            <p className={toneMutedClass("problem")}>Every area is &quot;{HEALTH_STATE_WORD.unknown}&quot;. Try Check again.</p>
          </div>
        )
      ) : null}
      {tab === "email" ? <EmailTab rows={email} /> : null}
      {tab === "uploads" ? <UploadsTab rows={uploads} /> : null}
      {tab === "server" ? <ServerTab supportText={view?.support ?? null} /> : null}
      <EPhoneActionBar label="System health actions" primary={checkButton} />
    </div>
  );
}
