"use client";

/**
 * Live ops supporting pieces: the selected person's card on the map, the
 * field status disclosure (safety and GPS check-ins, moved from the old live
 * map page) and the "Also needs attention" row pointing to Command's queue.
 */
import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { buildGoogleMapsDirectionsUrl } from "@/lib/jobs/schedule-order";
import type { LiveBoardPayload, LiveJobRow } from "@/lib/ops/live-board-types";
import type { LivePing } from "@/lib/ops/live-feed-types";
import { EPill } from "@/components/v2/ui/pill";
import { EButton } from "@/components/v2/ui/primitives";
import { jobTabHref } from "@/lib/dashboard/work-queue-links";

export type AttentionLink = { label: string; count: number; href: string };

/**
 * `phoneActions` (phones only, board "Admin phone"): the card also carries
 * Call, Message and Tell client as drawn, and states a start without a
 * location fix. Message and Tell client open the job's Messages tab (the
 * delay notice with its confirm stays on the late exception row).
 */
export function PersonCard({ userId, pings, board, onClose, phoneActions = false, canNotifyClient = false }: { userId: string; pings: LivePing[]; board: LiveBoardPayload | null; onClose: () => void; phoneActions?: boolean; canNotifyClient?: boolean }) {
  const ping = pings.find((p) => p.userId === userId) ?? null;
  const driver = board?.drivers.find((d) => d.userId === userId) ?? null;
  const job: LiveJobRow | null = board?.jobs.find((j) => j.cleaners.some((c) => c.id === userId) && ["late", "travelling", "on-site", "off-site"].includes(j.state)) ?? null;
  const next = board?.cleaners.find((c) => c.userId === userId) ?? null;
  const name = ping?.user?.name ?? driver?.name ?? job?.cleaners.find((c) => c.id === userId)?.name ?? "Selected person";
  const phone = driver?.phone ?? next?.phone ?? job?.cleaners.find((c) => c.id === userId)?.phone ?? null;
  const heading = driver
    ? `Laundry route · ${driver.stopsDone} of ${driver.stopsTotal} stops done`
    : job ? `${job.state === "on-site" ? "At" : job.state === "off-site" ? "Away from" : "Heading to"} ${job.propertyName}` : ping?.liveLabel ?? "No active job";
  return (
    <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3.5 shadow-[var(--e-elevation-1)]">
      <div className="flex items-start justify-between gap-2">
        <b className="min-w-0 [overflow-wrap:anywhere]">{name}</b>
        <button type="button" aria-label="Close person card" onClick={onClose} className="rounded p-0.5 hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"><X aria-hidden className="h-4 w-4" /></button>
      </div>
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{heading}</p>
      <dl className="mt-2 grid grid-cols-[70px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[0.8125rem]">
        <dt className="text-[hsl(var(--e-muted-foreground))]">ETA</dt>
        <dd className="e-tnum">{job?.etaClock ?? (job?.state === "on-site" ? "On site" : "Not recorded")}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Next</dt>
        <dd>{next?.nextJob ? <Link href={`/v2/admin/jobs/${next.nextJob.jobId}`}>{next.nextJob.propertyName}{next.nextJob.startTime ? ` ${next.nextJob.startTime}` : ""}</Link> : "Nothing else today"}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Phone</dt>
        <dd>{phone ? <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a> : "Not on the account"}</dd>
      </dl>
      {phoneActions ? (
        <>
          {ping?.startedWithoutFix ? <p className="mt-2"><EPill>Started without a location fix</EPill></p> : null}
          {ping?.trackingStateLabel ? <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Phone reports: {ping.trackingStateLabel}</p> : null}
          <div className="mt-2.5 flex flex-wrap gap-2" aria-label="Person actions">
            {phone ? (
              <EButton asChild size="sm" variant="outline"><a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>Call</a></EButton>
            ) : <EButton size="sm" variant="outline" disabled title="No phone number on the account">Call</EButton>}
            {job ? <EButton asChild size="sm" variant="outline"><Link href={jobTabHref(job.jobId, "messages")}>Message</Link></EButton> : null}
            {job ? (
              <EButton asChild size="sm" variant="outline">
                <Link href={jobTabHref(job.jobId, "messages")} title={canNotifyClient ? "The delay notice is on the late exception in the list" : "Opens the job's client messages"}>Tell client</Link>
              </EButton>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function FieldStatus({ jobs }: { jobs: LiveJobRow[] }) {
  const [open, setOpen] = useState(false);
  const active = jobs.filter((job) => job.state !== "done");
  const pending = active.filter((job) => job.field.safety === "pending").length;
  return (
    <details onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <summary className="cursor-pointer px-4 py-3 text-[0.8125rem] font-[600]">
        Field status: safety and GPS check-ins <span className="font-normal text-[hsl(var(--e-muted-foreground))]">· {active.length} active job{active.length === 1 ? "" : "s"} · {pending} safety check-in{pending === 1 ? "" : "s"} pending</span>
      </summary>
      {open ? (
        active.length === 0 ? <p className="px-4 pb-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No active jobs today.</p> : (
          <ul className="border-t border-[hsl(var(--e-border))]">
            {active.map((job) => {
              const maps = buildGoogleMapsDirectionsUrl({ address: job.field.address, suburb: job.suburb, name: job.propertyName });
              const distance = job.field.checkInDistanceMeters;
              return (
                <li key={job.jobId} className="flex flex-col gap-1.5 border-b border-[hsl(var(--e-border))] px-4 py-3 text-[0.8125rem] sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/v2/admin/jobs/${job.jobId}`} className="font-[550] text-inherit hover:underline">{job.propertyName}</Link>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{job.cleaners.map((c) => c.name).join(", ") || "No cleaner assigned"}{job.startTime ? ` · ${job.startTime}` : ""}{job.dueTime ? `–${job.dueTime}` : ""}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {job.field.safety === "pending" ? <EPill tone="bad">Safety pending</EPill> : null}
                    {job.field.safety === "confirmed" ? <EPill tone="ok">Safety confirmed</EPill> : null}
                    {distance == null ? <EPill>No GPS check-in yet</EPill> : <EPill tone={distance < 500 ? "ok" : "warn"}>{distance < 500 ? "Checked in on site" : `Checked in ${distance} m away`}</EPill>}
                    {maps ? <a href={maps} target="_blank" rel="noreferrer" className="text-[hsl(var(--e-primary))]">Maps</a> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </details>
  );
}

export function AlsoNeedsAttention({ links }: { links: AttentionLink[] | null }) {
  return (
    <nav aria-label="Also needs attention" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3 text-[0.8125rem]">
      <span className="font-[600]">Also needs attention</span>
      {links === null ? <span className="text-[hsl(var(--e-muted-foreground))]">Counts could not be read. <Link href="/v2/admin#work-queue">Open the work queue</Link></span> : links.length === 0 ? (
        <span className="text-[hsl(var(--e-muted-foreground))]">Nothing else waiting. <Link href="/v2/admin#work-queue">Work queue</Link></span>
      ) : links.map((link) => (
        <Link key={link.label} href={link.href}>{link.label} <span className="e-tnum">{link.count}</span></Link>
      ))}
    </nav>
  );
}
