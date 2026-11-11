"use client";

/**
 * Run side panel (`?open=<taskId>`): status, linked clean, dates, next guest,
 * supplier, bags / weight / cost when recorded, evidence (existing signed media
 * gallery), history from the handoff confirmations and EVERY action the old run
 * card had: Edit, Reschedule, Replace evidence, Skip or delete (existing
 * soft/permanent dialog), Task report / PDF and Open linked job; plus the
 * on-demand nudges (Ask cleaner / Request photo) where the run's exception
 * calls for them.
 */
import * as React from "react";
import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EPill } from "@/components/v2/ui/pill";
import { EButton } from "@/components/v2/ui/primitives";
import { MediaGallery } from "@/components/shared/media-gallery";
import { describeLaundryConfirmation } from "@/lib/laundry/media";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import { LaundryEvidenceReplacement } from "./laundry-evidence-replacement";
import { LaundryNudgeActions } from "./laundry-nudge";
import { buildTaskMedia, statusLabel, type LaundryTaskDTO } from "./laundry-shared";
import { cardPill, shortDay } from "./laundry-lane-card";
import type { PipelineCardDTO } from "./use-laundry-pipeline";

export type RunPanelTask = LaundryTaskDTO & Partial<Pick<PipelineCardDTO, "exceptions" | "cleaners" | "nextGuest" | "bagCount" | "lane" | "readiness" | "dayOf" | "carriedIn" | "driver">>;

function stamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : formatInTimeZone(date, SYDNEY_TZ, "d MMM yyyy HH:mm");
}

type Props = {
  task: RunPanelTask | null;
  busy: boolean;
  onClose: () => void;
  onEdit: (task: LaundryTaskDTO) => void;
  onReschedule: (task: LaundryTaskDTO) => void;
  onDelete: (task: LaundryTaskDTO) => void;
  onReport: (task: LaundryTaskDTO) => void;
  onSaved: () => void;
  /** The Pipeline's "today" (Sydney), for the nudge rules. */
  todayKey?: string;
};

export function LaundryRunPanel({ task, busy, onClose, onEdit, onReschedule, onDelete, onReport, onSaved, todayKey }: Props) {
  if (!task) return null;
  const name = task.property?.name ?? "Property";
  const media = buildTaskMedia(task);
  const pill = task.lane && task.exceptions ? cardPill(task as PipelineCardDTO) : null;
  const done = task.status === "DROPPED" || task.status === "SKIPPED_PICKUP";
  const facts: Array<[string, React.ReactNode]> = [
    ["Status", statusLabel(task.status)],
    ["Clean", task.jobId ? <Link className="text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/jobs/${task.jobId}`}>{task.job?.jobNumber ?? "Job"} · {shortDay(task.job?.scheduledDate)}{task.cleaners?.length ? ` · ${task.cleaners.join(", ")}` : ""}</Link> : "Not linked"],
    ["Pickup", shortDay(task.pickupDate)],
    ["Drop", shortDay(task.dropoffDate)],
    ["Next guest", task.nextGuest ? `${task.nextGuest.checkinAt ? shortDay(task.nextGuest.checkinAt) : "Date not given"}${task.nextGuest.name ? ` · ${task.nextGuest.name}` : ""}` : "Not recorded"],
    ["Supplier", task.supplier?.name ?? "Not recorded"],
    ["Client", task.property?.client?.name ?? task.property?.client?.email ?? "Unassigned client"],
  ];
  if (task.driver) facts.push(["Driver", `${task.driver.driverName}, stop ${task.driver.stop}`]);
  if (task.bagCount) facts.push(["Bags", String(task.bagCount)]);
  if (task.bagWeightKg) facts.push(["Weight", `${task.bagWeightKg} kg`]);
  if (task.dropoffCostAud != null) facts.push(["Cost", `$${Number(task.dropoffCostAud).toFixed(2)}`]);

  return (
    <ESidePanel
      open
      title={name}
      label="Run detail"
      subtitle={task.property?.suburb ?? undefined}
      onClose={onClose}
      toolbar={pill ? <EPill tone={pill.tone}>{pill.label}</EPill> : <EPill>{statusLabel(task.status)}</EPill>}
      className="lg:w-[320px]"
    >
      {task.exceptions && task.exceptions.length > 1 ? (
        <ul className="list-disc pl-5 text-[0.8125rem] text-[hsl(var(--e-danger))]">{task.exceptions.map((item) => <li key={item.code}>{item.label}</li>)}</ul>
      ) : null}
      <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.8125rem]">
        {facts.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-[hsl(var(--e-muted-foreground))]">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {task.flagNotes ? <p className="rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-raised))] px-2.5 py-1.5 text-[0.75rem]">{task.flagNotes}</p> : null}
      <div className="space-y-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
        {task.property?.address ? <p>{task.property.address}</p> : null}
        {task.property?.linenBufferSets != null ? <p>Buffer linen: {task.property.linenBufferSets} sets</p> : null}
        {task.property?.keyLostMode ? <p>Key lost — same-day pickup and delivery required.</p> : null}
        {task.flagReason ? <p>Flag: {task.flagReason.replace(/_/g, " ")}</p> : null}
        {task.skipReasonCode ? <p>Skipped: {task.skipReasonCode.replace(/_/g, " ")} {task.skipReasonNote}</p> : null}
        {task.adminOverrideNote ? <p>Override: {task.adminOverrideNote}</p> : null}
      </div>
      <div className="h-px bg-[hsl(var(--e-border))]" />
      <p className="e-eyebrow">History</p>
      <ol className="space-y-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {task.createdAt ? <li>{stamp(task.createdAt)} — Run created</li> : null}
        {(task.confirmations ?? []).map((row) => (
          <li key={row.id}>
            {stamp(row.createdAt)} — {row.confirmedByName ?? "Team member"}: {row.laundryReady === false ? "Not ready" : row.laundryReady === true ? "Ready" : "Handoff recorded"}
            {row.bagLocation ? ` · ${row.bagLocation}` : ""}
            {describeLaundryConfirmation(row) ? ` · ${describeLaundryConfirmation(row)}` : ""}
            {row.photoUrl ? " · photo" : ""}
          </li>
        ))}
        {!task.confirmations?.length ? <li>No handoff confirmation recorded.</li> : null}
        {task.confirmedAt ? <li>Confirmed: {stamp(task.confirmedAt)}</li> : null}
        {task.pickedUpAt ? <li>Picked up: {stamp(task.pickedUpAt)}</li> : null}
        {task.droppedAt ? <li>Delivered: {stamp(task.droppedAt)}</li> : null}
      </ol>
      {media.length > 0 ? (
        <>
          <p className="e-eyebrow">Evidence ({media.length})</p>
          <MediaGallery items={media} title="Laundry evidence" className="grid grid-cols-3 gap-2" />
        </>
      ) : <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No recorded photo evidence.</p>}
      {(task.confirmations ?? []).some((row) => row.photoUrl) ? (
        <div className="space-y-1.5">
          <p className="e-eyebrow">Replace evidence</p>
          {(task.confirmations ?? []).filter((row) => row.photoUrl).map((row) => (
            <LaundryEvidenceReplacement key={row.id} confirmationId={row.id} onSaved={onSaved} />
          ))}
        </div>
      ) : null}
      <div className="h-px bg-[hsl(var(--e-border))]" />
      <div className="flex flex-wrap gap-1.5">
        <LaundryNudgeActions task={task} todayKey={todayKey} />
        <EButton size="sm" variant="outline" onClick={() => onEdit(task)}>Edit</EButton>
        <EButton size="sm" variant="outline" disabled={done || busy} title={done ? "Delivered or skipped runs have nothing to move" : undefined} onClick={() => onReschedule(task)}>Reschedule</EButton>
        <EButton size="sm" variant="outline" onClick={() => onReport(task)}>Task report / PDF</EButton>
        {task.jobId ? <EButton asChild size="sm" variant="ghost"><Link href={`/v2/admin/jobs/${task.jobId}`}>Open linked job</Link></EButton> : null}
        <EButton size="sm" variant="danger" disabled={busy} aria-label={`Skip or delete the laundry run for ${name}`} onClick={() => onDelete(task)}>Skip or delete…</EButton>
      </div>
    </ESidePanel>
  );
}
