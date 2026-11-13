"use client";

/**
 * Live ops: header with the real stream state, layer chips and Plan routes;
 * left, the state chips (real counts) and exceptions first with their actions,
 * then on-site progress; right, the map with the selected person's card. One
 * feed (LiveFeedProvider) drives every part.
 *
 * Phone (below 640px, board "Admin phone: Calendar and Live ops"): a List /
 * Map switch shows one screen at a time (the map is its own screen; choosing a
 * person anywhere opens it with their card); the state chips are one
 * swipeable row; layer chips scroll sideways; exception rows keep their main
 * fix on the card and put the rest under "More". From 640px up nothing
 * changes: phone parts render only after useIsPhone, and the screen split is
 * max-sm: classes only.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS, EFilterChips } from "@/components/v2/ui/filter-chips";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { isPhoneNow } from "@/components/v2/admin/phone-action-sheet";
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

type PhoneScreen = "list" | "map";

/** Phone only: which of the two screens is showing. */
function ScreenSwitch({ screen, onChange }: { screen: PhoneScreen; onChange: (screen: PhoneScreen) => void }) {
  return (
    <div role="group" aria-label="Show list or map" className="flex rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] p-0.5">
      {(["list", "map"] as const).map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={screen === key}
          onClick={() => onChange(key)}
          className={cn(
            "min-h-11 flex-1 rounded-[var(--e-radius-pill)] px-4 text-[0.875rem] font-[550] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
            screen === key ? "bg-[hsl(var(--e-foreground))] text-[hsl(var(--e-background))]" : "text-[hsl(var(--e-muted-foreground))]",
          )}
        >
          {key === "list" ? "List" : "Map"}
        </button>
      ))}
    </div>
  );
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
  const phone = useIsPhone();
  const [screen, setScreen] = useState<PhoneScreen>("list");
  // Choosing a person opens their card; on a phone the card lives on the map screen.
  const select = useCallback((userId: string) => {
    setSelected(userId);
    if (isPhoneNow()) setScreen("map");
  }, []);

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
          {phone ? <div className="basis-full"><ScreenSwitch screen={screen} onChange={setScreen} /></div> : null}
          <span role="status" aria-live="polite"><EPill tone={indicator.tone}>{indicator.label}</EPill></span>
          <div role="group" aria-label="Map layers" className="flex flex-wrap gap-1.5 max-sm:-mx-1 max-sm:max-w-full max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-1 max-sm:pb-0.5 max-sm:[scrollbar-width:none]">
            <Toggle pressed={layers.cleaners} onClick={() => setLayers((l) => ({ ...l, cleaners: !l.cleaners }))}>Cleaners</Toggle>
            {showsDrivers ? <Toggle pressed={layers.drivers} onClick={() => setLayers((l) => ({ ...l, drivers: !l.drivers }))}>Laundry drivers</Toggle> : null}
            <Toggle pressed={layers.properties} onClick={() => setLayers((l) => ({ ...l, properties: !l.properties }))}>Properties</Toggle>
          </div>
          <EButton asChild size="sm" variant="outline"><Link href={`/v2/admin/jobs/route-map?date=${todayKey}`}>Plan routes</Link></EButton>
        </div>
      </header>

      <div className="grid min-w-0 grid-cols-1 items-start gap-[14px] xl:grid-cols-[400px_minmax(0,1fr)]">
        <section aria-label="On shift" className={cn("order-2 min-w-0 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] xl:order-1", screen === "map" && "max-sm:hidden")}>
          {phone ? (
            <div className="border-b border-[hsl(var(--e-border))] px-4 py-3.5">
              <EFilterChips label="Show" phoneLayout="carousel" chips={chips} active={view} onChange={setView} />
            </div>
          ) : (
            <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5 border-b border-[hsl(var(--e-border))] px-4 py-3.5 max-sm:hidden">
              {chips.map((chip) => (
                <Toggle key={chip.key} pressed={view === chip.key} onClick={() => setView(chip.key)}>
                  {chip.label}{chip.count !== null ? <span className="e-tnum">{chip.count}</span> : null}
                </Toggle>
              ))}
            </div>
          )}
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

        <section aria-label="Map" className={cn("order-1 min-w-0 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] xl:order-2", screen === "list" && "max-sm:hidden")}>
          {feed.pings.status === "error" ? <p role="status" className="border-b border-[hsl(var(--e-border))] px-4 py-2 text-[0.75rem] text-[hsl(var(--e-warning))]">Location refresh failed. Showing the last received positions; retrying automatically.</p> : null}
          <EstateOpsMap
            properties={properties}
            pings={feed.pings.data}
            drivers={board?.drivers ?? []}
            jobs={board?.jobs}
            layers={layers}
            selectedUserId={selected}
            onSelect={select}
            refitKey={phone ? (screen === "map" ? `map:${selected ?? ""}` : "hidden") : undefined}
            overlay={selected ? <PersonCard userId={selected} pings={feed.pings.data} board={board} onClose={() => setSelected(null)} phoneActions={phone} canNotifyClient={canNotifyClient && !readOnly} /> : null}
          />
        </section>
      </div>

      {board ? <FieldStatus jobs={board.jobs} /> : null}
      <AlsoNeedsAttention links={attention} />
      <JobPeekPanel jobId={peekJobId} row={null} readOnly={readOnly} onClose={() => setPeekJobId(null)} onChanged={feed.reloadBoard} />
    </div>
  );
}
