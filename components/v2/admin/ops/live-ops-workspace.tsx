"use client";

/**
 * Live ops: header with the real stream state, layer chips and Plan routes;
 * left, the state chips (real counts) and exceptions first with their actions,
 * then on-site progress; right, the map with the selected person's card. One
 * feed (LiveFeedProvider) drives every part.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { JobPeekPanel } from "@/components/v2/admin/jobs/job-peek-panel";
import { cn } from "@/lib/utils";
import { freshestPositionAgeSeconds, streamIndicator } from "@/lib/ops/live-feed-types";
import { EstateOpsMap, type MapLayers, type OpsMapProperty } from "./estate-ops-map";
import { useLiveFeed } from "./live-feed-provider";
import { LiveExceptions } from "./live-exceptions";
import { OnSiteRows, SimpleJobList } from "./live-state-lists";
import { AlsoNeedsAttention, FieldStatus, PersonCard, type AttentionLink } from "./live-side-parts";

import type { LiveView } from "./live-views";

type WorkspaceProps = {
  properties: OpsMapProperty[];
  attention: AttentionLink[] | null;
  initialView: LiveView;
  todayKey: string;
  timeZone: string;
  readOnly: boolean;
  /** Notify client (delay notice): ADMIN, or OPS_MANAGER with the Jobs pack; not impersonating. */
  canNotifyClient?: boolean;
  /** Pause clock: the same rule. */
  canPauseClock?: boolean;
};

function Toggle({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-pressed={pressed} onClick={onClick} className={cn(E_CHIP_CLASS, pressed && E_CHIP_ON_CLASS)}>{children}</button>;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function LiveOpsWorkspace({ properties, attention, initialView, todayKey, timeZone, readOnly, canNotifyClient = false, canPauseClock = false }: WorkspaceProps) {
  const feed = useLiveFeed();
  const now = useNow(10_000);
  const [view, setView] = useState<LiveView>(initialView);
  const [layers, setLayers] = useState<MapLayers>({ cleaners: true, drivers: true, properties: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [peekJobId, setPeekJobId] = useState<string | null>(null);
  const board = feed.board.data;
  const indicator = streamIndicator({ mode: feed.stream.mode, lastMessageAt: feed.stream.lastMessageAt, lastSnapshotAt: feed.pings.updatedAt, now, timeZone });
  const age = freshestPositionAgeSeconds(feed.pings.data, now);
  const select = useCallback((userId: string) => setSelected(userId), []);

  const chips: Array<{ key: LiveView; label: string; count: number | null }> = [
    { key: "exceptions", label: "Exceptions", count: board?.counts.exceptions ?? null },
    { key: "onsite", label: "On site", count: board?.counts.onSite ?? null },
    { key: "travelling", label: "Travelling", count: board?.counts.travelling ?? null },
    { key: "notstarted", label: "Not started", count: board?.counts.notStarted ?? null },
  ];
  // Drivers are withheld without the Laundry pack: say nothing about them
  // rather than "0 drivers".
  const showsDrivers = board?.visibility?.drivers !== false;
  const cleanersText = board ? `${board.counts.cleanersOnShift} cleaner${board.counts.cleanersOnShift === 1 ? "" : "s"}` : "";
  const driversText = board && showsDrivers ? ` and ${board.counts.driversOnShift} driver${board.counts.driversOnShift === 1 ? "" : "s"}` : "";
  const summary = board
    ? `${cleanersText}${driversText} on shift · ${age === null ? "no GPS positions yet" : `positions ${age < 120 ? `${age} seconds` : `${Math.round(age / 60)} minutes`} old`}`
    : feed.board.status === "error" ? "Today's board could not be read." : "Loading today's board…";

  return (
    <div className="min-w-0 space-y-[14px]">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="e-display-md">Live ops</h1>
          <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{summary}</p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <span role="status" aria-live="polite"><EPill tone={indicator.tone}>{indicator.label}</EPill></span>
          <div role="group" aria-label="Map layers" className="flex flex-wrap gap-1.5">
            <Toggle pressed={layers.cleaners} onClick={() => setLayers((l) => ({ ...l, cleaners: !l.cleaners }))}>Cleaners</Toggle>
            {showsDrivers ? <Toggle pressed={layers.drivers} onClick={() => setLayers((l) => ({ ...l, drivers: !l.drivers }))}>Laundry drivers</Toggle> : null}
            <Toggle pressed={layers.properties} onClick={() => setLayers((l) => ({ ...l, properties: !l.properties }))}>Properties</Toggle>
          </div>
          <EButton asChild size="sm" variant="outline"><Link href={`/v2/admin/jobs/route-map?date=${todayKey}`}>Plan routes</Link></EButton>
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-1 items-start gap-[14px] xl:grid-cols-[400px_minmax(0,1fr)]">
        <section aria-label="On shift" className="order-2 min-w-0 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] xl:order-1">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5 border-b border-[hsl(var(--e-border))] px-4 py-3.5">
            {chips.map((chip) => (
              <Toggle key={chip.key} pressed={view === chip.key} onClick={() => setView(chip.key)}>
                {chip.label}{chip.count !== null ? <span className="e-tnum">{chip.count}</span> : null}
              </Toggle>
            ))}
          </div>
          {feed.board.status === "error" && board ? (
            <p role="status" className="flex flex-wrap gap-2 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-warning-soft))] px-4 py-2 text-[0.75rem] text-[hsl(var(--e-warning))]">
              Could not refresh. Showing the board from {new Date(feed.board.updatedAt ?? Date.parse(board.generatedAt)).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone })}.
              <button type="button" className="underline" onClick={feed.reloadBoard}>Retry</button>
            </p>
          ) : null}
          {!board ? (
            feed.board.status === "error" ? (
              <div role="alert" className="space-y-2 p-4 text-[0.8125rem]">
                <p>Today&apos;s board could not be loaded. Positions on the map still update.</p>
                <EButton size="sm" variant="outline" onClick={feed.reloadBoard}>Retry</EButton>
              </div>
            ) : <p role="status" className="p-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading today&apos;s board…</p>
          ) : view === "exceptions" ? (
            <>
              <LiveExceptions jobs={board.jobs} continuations={board.continuations} readOnly={readOnly} canNotifyClient={canNotifyClient} canPauseClock={canPauseClock} todayKey={board.todayKey} timeZone={timeZone} onReassign={setPeekJobId} onSelect={select} onDecided={feed.reloadBoard} />
              <div className="space-y-2 px-4 py-3.5">
                <p className="e-eyebrow">On site</p>
                <OnSiteRows jobs={board.jobs.filter((j) => j.state === "on-site")} drivers={layers.drivers ? board.drivers : []} onSelect={select} />
              </div>
            </>
          ) : view === "onsite" ? (
            <div className="px-4 py-3.5"><OnSiteRows jobs={board.jobs.filter((j) => j.state === "on-site")} drivers={board.drivers} onSelect={select} /></div>
          ) : view === "travelling" ? (
            <SimpleJobList jobs={board.jobs.filter((j) => j.state === "travelling")} empty="Nobody is on the way right now." onSelect={select} />
          ) : (
            <SimpleJobList jobs={board.jobs.filter((j) => j.state === "planned" || j.state === "not-started")} empty="Every job today has started." onSelect={select} />
          )}
        </section>

        <section aria-label="Map" className="order-1 min-w-0 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] xl:order-2">
          {feed.pings.status === "error" ? <p role="status" className="border-b border-[hsl(var(--e-border))] px-4 py-2 text-[0.75rem] text-[hsl(var(--e-warning))]">Location refresh failed. Showing the last received positions; retrying automatically.</p> : null}
          <EstateOpsMap
            properties={properties}
            pings={feed.pings.data}
            drivers={board?.drivers ?? []}
            layers={layers}
            selectedUserId={selected}
            onSelect={select}
            overlay={selected ? <PersonCard userId={selected} pings={feed.pings.data} board={board} onClose={() => setSelected(null)} /> : null}
          />
        </section>
      </div>

      {board ? <FieldStatus jobs={board.jobs} /> : null}
      <AlsoNeedsAttention links={attention} />
      <JobPeekPanel jobId={peekJobId} row={null} readOnly={readOnly} onClose={() => setPeekJobId(null)} onChanged={feed.reloadBoard} />
    </div>
  );
}
