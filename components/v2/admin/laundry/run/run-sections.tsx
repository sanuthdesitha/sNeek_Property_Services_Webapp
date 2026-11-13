"use client";

/**
 * The laundry run page's timeline stages and right rail (board
 * LaundryRunDetail). Display only: actions come in as children or callbacks
 * from the page, which owns the dialogs.
 */
import * as React from "react";
import Link from "next/link";
import { ECard, EButton } from "@/components/v2/ui/primitives";
import { EToneCard, EToneNotice, type ETone } from "@/components/v2/ui/tone-band";
import { MediaGallery } from "@/components/shared/media-gallery";
import type { RunHistoryEntry, RunPageExtras } from "@/lib/laundry/run-page-types";
import { buildTaskMedia, type LaundryTaskDTO } from "../laundry-shared";
import { dayWithTime, laundryRouteLabel } from "../laundry-lane-card";
import type { RunPanelTask } from "../laundry-run-panel";

const MUTED = "text-[hsl(var(--e-muted-foreground))]";

export type StageState = "done" | "now" | "todo";

/** One stage of the run timeline: a card with an eyebrow, title and actions. */
export function RunStage({ id, number, name, title, state, tone, actions, children }: {
  id: string;
  number: number;
  name: string;
  title: React.ReactNode;
  state: StageState;
  tone?: ETone | null;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section id={id} aria-label={name} className={state === "todo" ? "opacity-90" : undefined}>
      <EToneCard
        tone={tone ?? null}
        className={state === "todo" ? "border-dashed bg-transparent" : undefined}
        header={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.8125rem]"><span className="e-eyebrow">{number} · {name}</span> <b>{title}</b></p>
            {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
          </div>
        }
      >
        {children}
      </EToneCard>
    </section>
  );
}

export function Facts({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.8125rem]">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className={MUTED}>{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function NotRecorded({ children = "Not recorded" }: { children?: React.ReactNode }) {
  return <span className={MUTED}>{children}</span>;
}

export function RunPhotos({ task }: { task: LaundryTaskDTO }) {
  const media = buildTaskMedia(task);
  if (!media.length) return <p className={`text-[0.8125rem] ${MUTED}`}>No recorded photo evidence.</p>;
  return <MediaGallery items={media} title="Laundry evidence" className="grid grid-cols-3 gap-2 sm:grid-cols-5" />;
}

const HISTORY_FILTERS = [
  { key: "all", label: "All" },
  { key: "correction", label: "Office corrections" },
  { key: "void", label: "Voided" },
] as const;
type HistoryFilter = (typeof HISTORY_FILTERS)[number]["key"];

export function RunHistory({ entries, limit }: { entries: RunHistoryEntry[]; limit?: number }) {
  const [filter, setFilter] = React.useState<HistoryFilter>("all");
  const shown = entries.filter((entry) => filter === "all" || entry.kind === filter);
  const visible = limit ? shown.slice(0, limit) : shown;
  return (
    <div className="space-y-2">
      <div role="group" aria-label="History filter" className="flex flex-wrap gap-1.5">
        {HISTORY_FILTERS.map((item) => (
          <button key={item.key} type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)} className={`h-8 rounded-full border px-2.5 text-[0.75rem] max-sm:h-11 ${filter === item.key ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))] font-semibold text-[hsl(var(--e-primary))]" : "border-[hsl(var(--e-border))]"}`}>{item.label}</button>
        ))}
      </div>
      {visible.length === 0 ? <p className={`text-[0.8125rem] ${MUTED}`}>Nothing recorded here.</p> : (
        <ol className="divide-y divide-[hsl(var(--e-border))] text-[0.75rem]">
          {visible.map((entry) => (
            <li key={entry.id} className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 py-1.5">
              <span className={`${MUTED} tabular-nums`}>{entry.when}</span>
              <span><b>{entry.who ?? (entry.kind === "system" ? "System" : "Name not recorded")}</b> {entry.label}{entry.detail ? <span className={MUTED}> · {entry.detail}</span> : null}</span>
            </li>
          ))}
        </ol>
      )}
      {limit && shown.length > limit ? <p className={`text-[0.75rem] ${MUTED}`}>{shown.length - limit} earlier entries in the History tab.</p> : null}
      <p className={`text-[0.6875rem] ${MUTED}`}>Times in the organisation's time zone. Office corrections and voids show who, when, why, before and after.</p>
    </div>
  );
}

type Supplier = { id?: string; name?: string | null; pricePerKg?: number | null; avgTurnaround?: number | null } | null | undefined;

export function RunRail({ task, extras, onOpenJob }: { task: RunPanelTask; extras: RunPageExtras; onOpenJob?: () => void }) {
  const supplier = task.supplier as Supplier;
  const property = task.property;
  const team = task.supplierTeam;
  const money: Array<[string, React.ReactNode]> = [
    ["Weight", task.bagWeightKg != null ? `${task.bagWeightKg} kg` : <NotRecorded />],
    ["Price", task.dropoffCostAud != null ? `$${Number(task.dropoffCostAud).toFixed(2)}` : <NotRecorded />],
    ["Rate", supplier?.pricePerKg != null ? `$${Number(supplier.pricePerKg).toFixed(2)} per kg${supplier.name ? `, ${supplier.name}` : ""}` : <NotRecorded />],
    ["On a report", extras.invoiceLine.label],
  ];
  return (
    <aside aria-label="Run details" className="flex w-full flex-col gap-3 lg:w-[340px] lg:flex-none">
      <section id="r-partner" aria-label="Laundry partner and team">
        <ECard className="space-y-2 p-3.5">
          <div className="flex items-center justify-between"><p className="e-eyebrow">Laundry partner and team</p>{supplier?.id ? <Link className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline" href={`/v2/admin/laundry?tab=suppliers`}>Suppliers</Link> : null}</div>
          <Facts rows={[
            ["Partner", supplier?.name ?? <NotRecorded />],
            ["Turnaround", supplier?.avgTurnaround != null ? `${supplier.avgTurnaround} h` : <NotRecorded />],
            ["Team", team === null ? <NotRecorded>No partner recorded</NotRecorded> : team === undefined ? <NotRecorded>Could not be checked</NotRecorded> : team.count ? team.names.join(", ") : <NotRecorded>No portal users linked</NotRecorded>],
            ["On the route", task.driver ? laundryRouteLabel(task.driver, supplier?.name ?? null) : <NotRecorded>Not on today's route</NotRecorded>],
          ]} />
        </ECard>
      </section>
      <section id="r-property" aria-label="Property and access">
        <ECard className="space-y-2 p-3.5">
          <div className="flex items-center justify-between"><p className="e-eyebrow">Property and access</p>{property?.id ? <Link className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline" href={`/v2/admin/properties/${property.id}`}>Property</Link> : null}</div>
          <Facts rows={[
            ["Property", property?.name ?? <NotRecorded />],
            ["Address", property?.address ?? <NotRecorded />],
            ["Client", property?.client?.name ?? property?.client?.email ?? <NotRecorded>Unassigned client</NotRecorded>],
            ["Buffer linen", property?.linenBufferSets != null ? `${property.linenBufferSets} set${property.linenBufferSets === 1 ? "" : "s"}` : <NotRecorded />],
            ["Key lost mode", property?.keyLostMode ? "On: same-day pickup and delivery" : "Off"],
          ]} />
        </ECard>
      </section>
      <section id="r-job" aria-label="Linked job">
        <ECard className="space-y-2 p-3.5">
          <div className="flex items-center justify-between"><p className="e-eyebrow">Linked job</p>{task.jobId ? <Link className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline" href={`/v2/admin/jobs/${task.jobId}`} onClick={onOpenJob}>Open job</Link> : null}</div>
          <Facts rows={[
            ["Clean", task.job ? `${task.job.jobNumber ?? "Job"}${task.job.scheduledDate ? ` · ${dayWithTime(task.job.scheduledDate, null)}` : ""}${task.cleaners?.length ? ` · ${task.cleaners.join(", ")}` : ""}` : <NotRecorded>Not linked</NotRecorded>],
            ["Next clean", extras.nextClean ? <Link className="text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/jobs/${extras.nextClean.jobId}`}>{extras.nextClean.jobNumber ?? "Job"} · {extras.nextClean.when}</Link> : <NotRecorded>None booked</NotRecorded>],
            ["Next guest", task.nextGuest ? `${task.nextGuest.checkinAt ?? "Date not given"}${task.nextGuest.name ? ` · ${task.nextGuest.name}` : ""}` : <NotRecorded />],
          ]} />
        </ECard>
      </section>
      <section id="r-money" aria-label="Money">
        <ECard className="space-y-2 p-3.5">
          <p className="e-eyebrow">Money</p>
          <Facts rows={money} />
          <p className={`text-[0.75rem] ${MUTED}`}>{extras.invoiceLine.detail}</p>
        </ECard>
      </section>
      <section id="r-exceptions" aria-label="Exceptions">
        <ECard className="space-y-2 p-3.5">
          <p className="e-eyebrow">Exceptions</p>
          {extras.voided ? <p className="text-[0.8125rem]">Voided: no exceptions apply.</p> : task.exceptions?.length ? (
            <ul className="space-y-1 text-[0.8125rem]">{task.exceptions.map((item) => <li key={item.code}>{item.label}</li>)}</ul>
          ) : <p className={`text-[0.8125rem] ${MUTED}`}>None.</p>}
          {task.flagNotes ? <p className="text-[0.75rem]">{task.flagNotes}</p> : null}
          {task.skipReasonCode ? <p className="text-[0.75rem]">Skipped: {task.skipReasonCode.replace(/_/g, " ").toLowerCase()}{task.skipReasonNote ? ` · ${task.skipReasonNote}` : ""}</p> : null}
          {task.adminOverrideNote ? <p className="text-[0.75rem]">Override: {task.adminOverrideNote}</p> : null}
        </ECard>
      </section>
      <section id="r-history" aria-label="History">
        <ECard className="space-y-2 p-3.5">
          <p className="e-eyebrow">History</p>
          <RunHistory entries={extras.history} limit={8} />
        </ECard>
      </section>
    </aside>
  );
}

/** The cleaner's handoff stage body. */
export function HandoffBody({ task, extras }: { task: RunPanelTask; extras: RunPageExtras }) {
  const handoffs = (task.confirmations ?? []).filter((row) => {
    try { return !JSON.parse(row.notes ?? "{}").event; } catch { return true; }
  });
  const latest = handoffs[handoffs.length - 1];
  if (!latest) return <p className={`text-[0.8125rem] ${MUTED}`}>The cleaner has not reported the linen yet.</p>;
  return (
    <Facts rows={[
      ["Reported by", `${latest.confirmedByName ?? "Name not recorded"}${extras.handoffWhen ? ` · ${extras.handoffWhen}` : ""}`],
      ["Linen", latest.laundryReady === false ? "Not ready" : "Ready for pickup"],
      ["Location", latest.bagLocation ?? <NotRecorded />],
      ["Bags", task.bagCount ? String(task.bagCount) : <NotRecorded />],
      ["Photo", latest.photoUrl ? "Recorded (Photos tab)" : <NotRecorded>No photo</NotRecorded>],
    ]} />
  );
}

export function CorrectionsList({ extras }: { extras: RunPageExtras }) {
  if (!extras.corrections.length) return null;
  return (
    <EToneNotice tone="attention" title="Office corrections">
      <ul className="space-y-1">
        {extras.corrections.map((row) => (
          <li key={row.id}>
            {row.when}: {row.fromLabel} → {row.toLabel}{row.doneBy ? `, done by ${row.doneBy}` : ""}{row.who ? `, recorded by ${row.who}` : ""}{row.reason ? ` · ${row.reason}` : ""}
            {row.teamRecordWhen ? ` · the team's own record arrived ${row.teamRecordWhen} and is kept beside it` : ""}
          </li>
        ))}
      </ul>
    </EToneNotice>
  );
}

export function FailedPickupTable({ extras }: { extras: RunPageExtras }) {
  if (!extras.failedPickups.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-[0.8125rem]">
        <thead className={MUTED}><tr><th className="py-1 pr-2 font-semibold">When</th><th className="py-1 pr-2 font-semibold">Who</th><th className="py-1 pr-2 font-semibold">What happened</th><th className="py-1 font-semibold">Photo</th></tr></thead>
        <tbody>
          {extras.failedPickups.map((row) => (
            <tr key={row.id} className="border-t border-[hsl(var(--e-border))] align-top">
              <td className="py-1.5 pr-2 tabular-nums">{row.when}</td>
              <td className="py-1.5 pr-2">{row.who ?? "Name not recorded"}</td>
              <td className="py-1.5 pr-2">Failed pickup{row.reason ? `: ${row.reason}` : ""}. {row.outcome}.</td>
              <td className="py-1.5">{row.photoUrl ? <a className="text-[hsl(var(--e-primary))] underline" href={row.photoUrl} target="_blank" rel="noreferrer">Open</a> : <NotRecorded>None</NotRecorded>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StageButton(props: React.ComponentProps<typeof EButton>) {
  return <EButton size="sm" variant="outline" className="h-auto min-h-8 whitespace-normal text-left" {...props} />;
}
