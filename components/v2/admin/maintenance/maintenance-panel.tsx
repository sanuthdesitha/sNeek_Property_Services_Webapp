"use client";

/**
 * Item side panel (board "Maintenance", right column): replaces the old detail
 * modal. Opened from a row with `?open=<id>`; "Open full page" keeps the
 * /v2/admin/maintenance/[id] link. Reads the item itself, aborts the read when
 * another item opens and ignores an answer for an item that is no longer open.
 *
 * The status note typed here is kept while the panel is closed, until another
 * item is opened (the hub owns it).
 */
import * as React from "react";
import Link from "next/link";
import type { MaintenanceStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { MediaGallery } from "@/components/shared/media-gallery";
import { ACTION_LABELS, CATEGORY_LABELS, PRIORITY_LABELS, SOURCE_LABELS, STATUS_LABELS } from "@/lib/maintenance/labels";
import { dayTime, weekdayTime, money, priceState, PRICE_STATE_LABELS, priorityTone, statusTone } from "./maintenance-format";
import { readMaintenanceItem, targetFromDetail, type MaintenanceDetailItem } from "./maintenance-types";
import type { MaintenanceActions } from "./use-maintenance-actions";

const PANEL_STATUSES: MaintenanceStatus[] = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ORDERED", "RESOLVED", "DISMISSED"];

function eventLine(event: MaintenanceDetailItem["events"][number]): string {
  const who = event.user?.name ?? event.user?.email ?? null;
  const change = event.fromStatus && event.fromStatus !== event.toStatus ? `${STATUS_LABELS[event.fromStatus]} → ${STATUS_LABELS[event.toStatus]}` : event.fromStatus ? null : `${STATUS_LABELS[event.toStatus]}`;
  return [change, event.note, who].filter(Boolean).join(" · ");
}

export function MaintenancePanel({
  itemId,
  revision,
  timeZone,
  backHref,
  note,
  onNoteChange,
  actions,
  onClose,
}: {
  itemId: string;
  /** Bumped after a change elsewhere, so the panel re-reads the item. */
  revision: number;
  timeZone: string;
  /** The list address to come back to from the full page. */
  backHref: string;
  note: string;
  onNoteChange: (value: string) => void;
  actions: MaintenanceActions;
  onClose: () => void;
}) {
  const [item, setItem] = React.useState<MaintenanceDetailItem | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [applying, setApplying] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    setError(null);
    readMaintenanceItem(itemId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted || loaded.id !== itemId) return;
        setItem(loaded);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "This item could not be loaded.");
      });
    return () => controller.abort();
  }, [itemId, revision]);

  const shown = item && item.id === itemId ? item : null;
  const title = shown?.title ?? (error ? "Could not load" : "Loading…");

  async function changeStatus(status: MaintenanceStatus) {
    if (!shown || status === shown.status) return;
    if (status === "RESOLVED" || status === "DISMISSED") {
      actions.requestStatus([{ id: shown.id, title: shown.title }], status, note);
      return;
    }
    setApplying(true);
    const ok = await actions.applyStatus([shown.id], status, note.trim() || null);
    setApplying(false);
    if (ok) onNoteChange("");
  }

  const eyebrow = shown ? [shown.property.name, shown.area].filter(Boolean).join(" · ") : null;
  const worker = shown?.assignedWorker ?? null;
  const price = shown ? priceState(shown.costApprovalStatus) : "NOT_SENT";
  const recent = shown ? [...shown.events].reverse().slice(0, 3) : [];

  return (
    <ESidePanel
      open
      label="Item detail"
      title={title}
      onClose={onClose}
      toolbar={eyebrow ? <span className="e-eyebrow">{eyebrow}</span> : null}
      className="lg:w-[360px]"
    >
      {error && !shown ? (
        <div role="alert" className="space-y-2 text-[0.875rem]">
          <p>{error}</p>
          <EButton size="sm" variant="outline" asChild>
            <Link href={`/v2/admin/maintenance/${itemId}`}>Open full page</Link>
          </EButton>
        </div>
      ) : null}
      {!shown && !error ? <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading the item…</p> : null}
      {shown ? (
        <div className="flex min-w-0 flex-col gap-3 text-[0.8125rem]">
          <div className="flex flex-wrap gap-1.5">
            <EPill tone={priorityTone(shown.priority)}>{PRIORITY_LABELS[shown.priority]}</EPill>
            <EPill tone={statusTone(shown.status)}>{STATUS_LABELS[shown.status]}</EPill>
            <EPill>{CATEGORY_LABELS[shown.category]}</EPill>
            <EPill tone="gold">{ACTION_LABELS[shown.recommendedAction]}</EPill>
            <EPill>{shown.clientVisible ? "Client sees it" : "Internal"}</EPill>
          </div>
          {shown.description ? <p className="[overflow-wrap:anywhere]">&ldquo;{shown.description}&rdquo;</p> : <p className="text-[hsl(var(--e-muted-foreground))]">No description was given.</p>}
          {shown.photos.length > 0 ? (
            <MediaGallery items={shown.photos.map((photo) => ({ id: photo.key, url: photo.url, mediaType: photo.mediaType }))} title={shown.title} className="grid grid-cols-4 gap-1.5" />
          ) : null}
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-1.5">
            <dt className="text-[hsl(var(--e-muted-foreground))]">Reported</dt>
            <dd>
              {shown.reportedBy?.name ?? shown.reportedBy?.email ?? "Not recorded"} ({SOURCE_LABELS[shown.source].toLowerCase()}) · {dayTime(shown.createdAt, timeZone) ?? "date not recorded"}
              {shown.job ? <> · <Link className="underline" href={`/v2/admin/jobs/${shown.job.id}`}>{shown.job.jobNumber ?? "Job"}</Link></> : null}
            </dd>
            <dt className="text-[hsl(var(--e-muted-foreground))]">Assigned</dt>
            <dd>{worker ? [worker.name, worker.company].filter(Boolean).join(", ") : "No visit worker"}</dd>
            <dt className="text-[hsl(var(--e-muted-foreground))]">Visit</dt>
            <dd>{dayTime(shown.scheduledFor, timeZone) ?? "Not booked"}{worker ? ` · access ${shown.shareAccess ? "shared" : "not shared"}` : ""}</dd>
            <dt className="text-[hsl(var(--e-muted-foreground))]">Estimate</dt>
            <dd className="e-tnum">{money(shown.estimatedCost) ?? "Not estimated"}</dd>
            <dt className="text-[hsl(var(--e-muted-foreground))]">Client price</dt>
            <dd className="e-tnum">
              {price === "NOT_SENT" ? "Not sent" : (
                <>
                  {money(shown.quotedCost) ?? "No amount recorded"} ·{" "}
                  <span className={cn("font-[600]", price === "PENDING" && "text-[hsl(var(--e-warning))]", price === "DECLINED" && "text-[hsl(var(--e-danger))]", price === "APPROVED" && "text-[hsl(var(--e-success))]")}>
                    {PRICE_STATE_LABELS[price].toLowerCase()}
                  </span>
                  {shown.costDecidedAt ? ` ${dayTime(shown.costDecidedAt, timeZone)}` : ""}
                </>
              )}
            </dd>
            {shown.caseId ? (
              <>
                <dt className="text-[hsl(var(--e-muted-foreground))]">Case</dt>
                <dd><Link className="underline" href={`/v2/admin/cases?open=${encodeURIComponent(shown.caseId)}`}>Linked case</Link> · resolves together</dd>
              </>
            ) : null}
          </dl>
          <section aria-label="Change status" className="flex flex-col gap-2 rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-2.5">
            <p className="e-eyebrow">Change status</p>
            <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">
              {PANEL_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={shown.status === status}
                  disabled={applying || actions.running}
                  onClick={() => void changeStatus(status)}
                  className={cn(E_CHIP_CLASS, shown.status === status && E_CHIP_ON_CLASS)}
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="sr-only">Status note</span>
              <input
                value={note}
                disabled={applying}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="Note for the history, optional"
                className="h-9 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] focus:border-[hsl(var(--e-gold))] focus:outline-none max-sm:h-11 max-sm:text-base"
              />
            </label>
          </section>
          <section aria-label="History" className="flex flex-col gap-1 rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-2.5">
            <p className="e-eyebrow">History</p>
            {recent.length === 0 ? <p className="text-[hsl(var(--e-muted-foreground))]">No events recorded yet.</p> : null}
            <ol>
              {recent.map((event) => (
                <li key={event.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 border-t border-[hsl(var(--e-border))] py-1.5 first:border-t-0">
                  <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">{weekdayTime(event.createdAt, timeZone) ?? ""}</span>
                  <span className="[overflow-wrap:anywhere]">{eventLine(event)}</span>
                </li>
              ))}
            </ol>
          </section>
          <div className="flex gap-2">
            <EButton asChild className="flex-1">
              <Link href={`/v2/admin/maintenance/${shown.id}?back=${encodeURIComponent(backHref)}`}>Open full page</Link>
            </EButton>
            <EButton variant="outline" onClick={() => actions.openAssign([targetFromDetail(shown)])}>{worker ? "Reassign" : "Assign…"}</EButton>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">History times are in {timeZone} time. Closing the panel keeps an unsaved note until you open another item.</p>
        </div>
      ) : null}
    </ESidePanel>
  );
}
