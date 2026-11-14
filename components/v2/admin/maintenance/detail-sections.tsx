"use client";

/**
 * The cards of the admin item page (board "Maintenance item"): What was
 * reported, Work completed photos, Visit progress, History (left) and Who is
 * on this, Visit and access, Client price, Linked records (right rail).
 *
 * On a phone, Who is on this, Visit and access, Instructions and History fold
 * behind their title row (FoldSection), keeping their content mounted so a
 * draft inside survives folding. From 640px up they are always open.
 */
import * as React from "react";
import Link from "next/link";
import { MaintenanceAssigneeRole } from "@prisma/client";
import { ChevronDown, ExternalLink, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EToneBand, ETonePill, type ETone } from "@/components/v2/ui/tone-band";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { MediaGallery } from "@/components/shared/media-gallery";
import { googleMapsDirectionsUrl } from "@/lib/maps/google-maps-url";
import { MAINTENANCE_ASSIGNEE_ROLES, MAINTENANCE_ASSIGNEE_ROLE_LABELS } from "@/lib/maintenance/assignment-roles";
import { outcomeWithOriginal } from "@/lib/maintenance/visit-outcomes";
import { STATUS_LABELS } from "@/lib/maintenance/labels";
import { toast } from "@/hooks/use-toast";
import { AssignmentPayControls, type AssignmentLifecycle } from "./assignment-pay-controls";
import { patchMaintenanceItem, promoteWorker } from "./maintenance-api";
import { dayTime, initials, money, priceState, PRICE_STATE_LABELS, statusTone } from "./maintenance-format";
import type { MaintenanceDetailItem } from "./maintenance-types";

const CARD = "min-w-0 rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]";

function CardTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="text-[0.9375rem] font-[650]">{children}</h2>;
}

function NotYet({ children = "Not yet" }: { children?: React.ReactNode }) {
  return <span className="font-[500] text-[hsl(var(--e-muted-foreground))]">{children}</span>;
}

// ─── Fold (phones only) ─────────────────────────────────────────────────────

/**
 * A card whose title row folds its body on a phone. `open` can be raised from
 * outside (e.g. "Decide" on the price request notice).
 */
export function FoldSection({
  id,
  title,
  summary,
  band,
  action,
  openSignal = 0,
  className,
  children,
}: {
  id: string;
  title: string;
  /** One line shown under the title while folded on a phone. */
  summary?: React.ReactNode;
  /** Tone band for the title row when the card is flagged. */
  band?: { tone: ETone; pill: string; sub?: string } | null;
  /** Card action beside the title (desktop and open phone fold). */
  action?: React.ReactNode;
  openSignal?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const phone = useIsPhone();
  const [open, setOpen] = React.useState(false);
  const regionId = React.useId();
  React.useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);
  const folded = phone && !open;
  const headingId = `${id}-title`;
  const heading = (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
      <div className="min-w-0">
        <CardTitle id={headingId}>{title}</CardTitle>
        {band?.sub ? <p className="text-[0.75rem] opacity-80">{band.sub}</p> : null}
        {folded && summary ? <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{summary}</p> : null}
      </div>
      {band ? <ETonePill tone={band.tone}>{band.pill}</ETonePill> : null}
    </div>
  );
  const toggle = phone ? (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={regionId}
      onClick={() => setOpen((value) => !value)}
      className="flex min-h-11 w-full items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
    >
      {heading}
      <ChevronDown aria-hidden className={cn("mt-1 h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
    </button>
  ) : (
    <div className="flex items-start justify-between gap-2">{heading}{action ? <div className="shrink-0">{action}</div> : null}</div>
  );
  return (
    <section id={id} aria-labelledby={headingId} className={cn(CARD, "overflow-hidden", className)}>
      {band ? <EToneBand tone={band.tone} className="px-3.5 py-2.5">{toggle}</EToneBand> : <div className="px-3.5 pt-3">{toggle}</div>}
      <div id={regionId} hidden={folded} className={cn("min-w-0 flex-col gap-2.5 px-3.5 pb-3.5", folded ? "hidden" : "flex", band ? "pt-3" : "pt-2.5")}>
        {phone && action ? <div>{action}</div> : null}
        {children}
      </div>
    </section>
  );
}

// ─── What was reported / photos ─────────────────────────────────────────────

export function ReportedCard({ item }: { item: MaintenanceDetailItem }) {
  return (
    <section aria-labelledby="m-reported" className={cn(CARD, "flex flex-col gap-2.5 p-3.5")}>
      <div className="flex items-center justify-between gap-2">
        <CardTitle id="m-reported">What was reported</CardTitle>
        <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] max-sm:hidden">Edit details in More</span>
      </div>
      {item.description ? <p className="text-[0.875rem] [overflow-wrap:anywhere]">&ldquo;{item.description}&rdquo;</p> : <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No description was given.</p>}
      {item.photos.length > 0 ? (
        <MediaGallery items={item.photos.map((photo) => ({ id: photo.key, url: photo.url, mediaType: photo.mediaType }))} title={item.title} className="grid grid-cols-3 gap-2 sm:grid-cols-5" />
      ) : (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No photos were attached when this was reported.</p>
      )}
    </section>
  );
}

export function FinishPhotosCard({ item }: { item: MaintenanceDetailItem }) {
  const who = item.assignedWorker?.name ?? "the worker";
  return (
    <section aria-labelledby="m-finish" className={cn(CARD, "flex flex-col gap-2.5 p-3.5")}>
      <div className="flex items-center justify-between gap-2">
        <CardTitle id="m-finish">Work completed photos</CardTitle>
        <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.finishPhotos.length} photo{item.finishPhotos.length === 1 ? "" : "s"}</span>
      </div>
      {item.finishPhotos.length > 0 ? (
        <MediaGallery items={item.finishPhotos.map((photo) => ({ id: photo.key, url: photo.url, mediaType: photo.mediaType }))} title={`${item.title}, work completed`} className="grid grid-cols-3 gap-2 sm:grid-cols-5" />
      ) : (
        <div className="flex h-[88px] w-[118px] items-center justify-center rounded-[10px] border-[1.5px] border-dashed border-[hsl(var(--e-border-strong))] p-1.5 text-center text-[0.71875rem] text-[hsl(var(--e-muted-foreground))]">
          Added by {who} from their phone when they finish
        </div>
      )}
    </section>
  );
}

// ─── Visit progress ─────────────────────────────────────────────────────────

function PinRow({ label, lat, lng, at, timeZone }: { label: string; lat: number; lng: number; at: string; timeZone: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
      <span className="text-[hsl(var(--e-muted-foreground))]">{label} · {dayTime(at, timeZone) ?? "time not recorded"}</span>
      <a href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
        <MapPin aria-hidden className="h-3.5 w-3.5" /> View pin <ExternalLink aria-hidden className="h-3 w-3 opacity-60" />
      </a>
    </div>
  );
}

export function VisitProgressCard({ item, timeZone }: { item: MaintenanceDetailItem; timeZone: string }) {
  const directions = googleMapsDirectionsUrl(item.property);
  const firstPing = item.pings.length > 0 ? item.pings[0] : null;
  const lastPing = item.pings.length > 1 ? item.pings[item.pings.length - 1] : null;
  const facts: Array<[string, string | null]> = [
    ["Scheduled", dayTime(item.scheduledFor, timeZone)],
    ["En route", dayTime(item.enRouteAt, timeZone)],
    ["Arrived", dayTime(item.arrivedAt, timeZone)],
    ["Clock in", dayTime(item.clockInAt, timeZone)],
    ["Clock out", dayTime(item.clockOutAt, timeZone)],
    ["Outcome", item.outcome ? outcomeWithOriginal(item.outcome, item.originalOutcome) : null],
  ];
  return (
    <section aria-labelledby="m-visit-progress" className={cn(CARD, "flex flex-col gap-3 p-3.5")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle id="m-visit-progress">Visit progress</CardTitle>
        {directions ? (
          <a href={directions} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
            Directions to property <ExternalLink aria-hidden className="h-3 w-3 opacity-60" />
          </a>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-3.5 gap-y-2 sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{label}</dt>
            <dd className="e-tnum text-[0.8125rem] font-[600]">{value ?? <NotYet>{label === "Outcome" ? "Not recorded" : label === "Scheduled" ? "Not booked" : "Not yet"}</NotYet>}</dd>
          </div>
        ))}
        {item.status === "RESOLVED" || item.resolvedAt ? (
          <div className="min-w-0">
            <dt className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Closed</dt>
            <dd className="e-tnum text-[0.8125rem] font-[600]">{dayTime(item.resolvedAt, timeZone) ?? <NotYet>Not recorded</NotYet>}{item.resolvedBy?.name ? ` · ${item.resolvedBy.name}` : ""}</dd>
          </div>
        ) : null}
      </dl>
      {item.workerNote ? <p className="text-[0.8125rem]"><span className="text-[hsl(var(--e-muted-foreground))]">Worker note: </span>{item.workerNote}</p> : null}
      {item.issuesNote ? <p className="text-[0.8125rem]"><span className="text-[hsl(var(--e-muted-foreground))]">Issues raised: </span>{item.issuesNote}</p> : null}
      {item.resolutionNote ? <p className="text-[0.8125rem]"><span className="text-[hsl(var(--e-muted-foreground))]">Resolution note: </span>{item.resolutionNote}</p> : null}
      {firstPing ? <PinRow label="Check-in" lat={firstPing.lat} lng={firstPing.lng} at={firstPing.createdAt} timeZone={timeZone} /> : null}
      {lastPing ? <PinRow label="Check-out" lat={lastPing.lat} lng={lastPing.lng} at={lastPing.createdAt} timeZone={timeZone} /> : null}
      {!item.outcome ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          After the visit: outcome (Replaced or repaired, Needs parts, Needs follow-up, No access, No issue found), worker note, issues raised, and check-in and check-out pins. An outcome sent by an old screen is shown with its original wording.
        </p>
      ) : null}
    </section>
  );
}

// ─── History ────────────────────────────────────────────────────────────────

export function HistoryList({ item, timeZone }: { item: MaintenanceDetailItem; timeZone: string }) {
  const events = [...item.events].reverse();
  if (events.length === 0) return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No events recorded yet.</p>;
  return (
    <ol>
      {events.map((event) => {
        const who = event.user?.name ?? event.user?.email ?? null;
        const changed = event.fromStatus !== event.toStatus;
        return (
          <li key={event.id} className="grid grid-cols-[5.75rem_minmax(0,1fr)] gap-2.5 border-t border-[hsl(var(--e-border))] py-2 text-[0.8125rem] first:border-t-0">
            <span className="e-tnum text-[hsl(var(--e-muted-foreground))]">{dayTime(event.createdAt, timeZone) ?? "Time not recorded"}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 [overflow-wrap:anywhere]">
              {changed ? (
                <>
                  {event.fromStatus ? <><EPill tone={statusTone(event.fromStatus)}>{STATUS_LABELS[event.fromStatus]}</EPill><span aria-hidden>→</span><span className="sr-only">to</span></> : null}
                  <EPill tone={statusTone(event.toStatus)}>{STATUS_LABELS[event.toStatus]}</EPill>
                </>
              ) : null}
              {event.note ? <span>{event.note}</span> : null}
              {who ? <span className="text-[hsl(var(--e-muted-foreground))]">· {who}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Who is on this ─────────────────────────────────────────────────────────

type RosterRow = AssignmentLifecycle & {
  role: MaintenanceAssigneeRole;
  userId: string;
  removedAt: string | null;
  notifiedAt: string | null;
  user: { id: string; name: string | null; email: string | null } | null;
};

export type RosterState = { rows: RosterRow[] | null; error: string | null };

/** The item's role roster; a reply for another item is ignored. */
export function useItemRoster(itemId: string, revision: number): RosterState & { reload: () => void } {
  const [rows, setRows] = React.useState<RosterRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [own, setOwn] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetch(`/api/admin/maintenance/${encodeURIComponent(itemId)}/assignees`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { assignments?: RosterRow[]; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !Array.isArray(body.assignments)) throw new Error(body?.error ?? "The people on this item could not be loaded.");
        setRows(body.assignments);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The people on this item could not be loaded.");
      });
    return () => controller.abort();
  }, [itemId, revision, own]);
  return { rows, error, reload: React.useCallback(() => setOwn((value) => value + 1), []) };
}

export function rosterSummary(rows: RosterRow[] | null): string {
  if (!rows) return "Loading…";
  const active = rows.filter((row) => !row.removedAt);
  if (active.length === 0) return "Nobody in the roster";
  return active
    .map((row) => `${row.user?.name ?? row.user?.email ?? "Unnamed"} ${row.declinedAt ? "declined" : row.acceptedAt ? "accepted" : "not answered"}`)
    .join(" · ");
}

export function WhoIsOnThis({
  roster,
  onReload,
  canApprovePrice,
  onChangePeople,
  openSignal,
  timeZone,
}: {
  timeZone: string;
  roster: RosterState;
  onReload: () => void;
  canApprovePrice: boolean;
  onChangePeople: () => void;
  openSignal: number;
}) {
  const active = (roster.rows ?? []).filter((row) => !row.removedAt);
  const pending = active.some((row) => row.payChangeStatus === "PENDING");
  return (
    <FoldSection
      id="m-who"
      title="Who is on this"
      summary={rosterSummary(roster.rows)}
      band={pending ? { tone: "attention", pill: "Price request", sub: "Each role is saved on its own and emailed" } : null}
      openSignal={openSignal}
    >
      {!pending ? <p className="-mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Each role is saved on its own and emailed.</p> : null}
      {roster.error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{roster.error}</p> : null}
      {!roster.rows && !roster.error ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading people…</p> : null}
      {roster.rows
        ? MAINTENANCE_ASSIGNEE_ROLES.map((role) => {
            const people = active.filter((row) => row.role === role);
            return (
              <div key={role} className="space-y-1">
                <p className="e-eyebrow">{role === "MAINTENANCE" ? "Maintenance worker" : MAINTENANCE_ASSIGNEE_ROLE_LABELS[role]}</p>
                {people.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Nobody</p> : null}
                {people.map((row) => (
                  <div key={row.id} className="flex items-start gap-2 border-t border-[hsl(var(--e-border))] py-1.5 first:border-t-0">
                    <span aria-hidden className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-primary-soft))] text-[0.6875rem] font-semibold text-[hsl(var(--e-primary))]">{initials(row.user?.name ?? row.user?.email)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.875rem] font-semibold">{row.user?.name ?? row.user?.email ?? "Unnamed"}</p>
                      <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{row.notifiedAt ? `Assignment email sent ${dayTime(row.notifiedAt, timeZone)}` : "No assignment email has gone out yet"}</p>
                      <AssignmentPayControls row={row} onChanged={onReload} canApprovePrice={canApprovePrice} />
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        : null}
      <EButton size="sm" variant="outline" className="self-start" onClick={onChangePeople}>Change people…</EButton>
    </FoldSection>
  );
}

// ─── Visit and access ───────────────────────────────────────────────────────

export function VisitAccessCard({
  item,
  timeZone,
  isAdmin,
  onReassign,
  onChangeVisit,
  onChanged,
}: {
  item: MaintenanceDetailItem;
  timeZone: string;
  isAdmin: boolean;
  onReassign: () => void;
  onChangeVisit: () => void;
  onChanged: () => void;
}) {
  const worker = item.assignedWorker;
  const [promoting, setPromoting] = React.useState(false);
  const summary = [dayTime(item.scheduledFor, timeZone) ?? "Not booked", worker ? (item.shareAccess ? "access shared" : "access not shared") : "no visit worker"].join(" · ");

  async function promote() {
    if (!worker) return;
    setPromoting(true);
    try {
      const result = await promoteWorker(worker.id);
      toast({ title: "Portal login created", description: result.invitationEmailSent ? "The invitation email was sent." : "The invitation email did not go out. Share the invitation yourself." });
      onChanged();
    } catch (cause) {
      toast({ title: "No login created", description: cause instanceof Error ? cause.message : "Nothing was changed.", variant: "destructive" });
    } finally {
      setPromoting(false);
    }
  }

  return (
    <FoldSection
      id="m-visit"
      title="Visit and access"
      summary={summary}
      action={
        <div className="flex flex-wrap gap-1.5">
          <EButton size="sm" variant="outline" onClick={onReassign}>{worker ? "Reassign" : "Assign…"}</EButton>
          <EButton size="sm" variant="outline" onClick={onChangeVisit}>Reschedule</EButton>
        </div>
      }
    >
      <dl className="grid grid-cols-[6.25rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-[0.8125rem]">
        <dt className="text-[hsl(var(--e-muted-foreground))]">Worker</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere]">
          {worker ? (
            <>
              {worker.name}{worker.trade ? ` · ${worker.trade}` : ""}{worker.company ? ` · ${worker.company}` : ""}
              <br />
              {worker.phone ? <a className="text-[hsl(var(--e-primary))] underline" href={`tel:${worker.phone}`}>{worker.phone}</a> : null}
              {worker.phone && worker.email ? " · " : null}
              {worker.email ? <a className="text-[hsl(var(--e-primary))] underline" href={`mailto:${worker.email}`}>{worker.email}</a> : null}
              <br />
              <span className="text-[hsl(var(--e-muted-foreground))]">{worker.userId ? "Has a portal login" : "Ad hoc, no portal login"}</span>
              {!worker.userId ? (
                isAdmin ? (
                  <button type="button" disabled={promoting} onClick={() => void promote()} className="ml-1.5 min-h-8 text-[hsl(var(--e-primary))] underline disabled:opacity-50">
                    {promoting ? "Creating…" : "Create portal login"}
                  </button>
                ) : (
                  <span className="ml-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">(an administrator can create one)</span>
                )
              ) : null}
            </>
          ) : (
            <NotYet>Nobody booked to visit</NotYet>
          )}
        </dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Visit</dt>
        <dd>{dayTime(item.scheduledFor, timeZone) ?? <NotYet>Not booked</NotYet>}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Access</dt>
        <dd>{item.shareAccess ? "Shared: codes and entry notes show in their portal" : "Not shared"}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Contact</dt>
        <dd>{item.contactPerson ? `${item.contactPerson.name ?? item.contactPerson.email ?? "Unnamed"} (office)` : <NotYet>None</NotYet>}</dd>
      </dl>
    </FoldSection>
  );
}

// ─── Client price ───────────────────────────────────────────────────────────

const PRICE_BAND: Record<"PENDING" | "APPROVED" | "DECLINED", ETone> = { PENDING: "attention", APPROVED: "good", DECLINED: "attention" };

export function ClientPriceCard({ item, timeZone, onSaved }: { item: MaintenanceDetailItem; timeZone: string; onSaved: () => void }) {
  const state = priceState(item.costApprovalStatus);
  const [amount, setAmount] = React.useState(item.quotedCost != null ? item.quotedCost.toFixed(2) : "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const clientName = item.property.client?.name ?? "the client";

  React.useEffect(() => {
    setAmount(item.quotedCost != null ? item.quotedCost.toFixed(2) : "");
  }, [item.id, item.quotedCost]);

  async function send() {
    const value = Number(amount);
    if (amount.trim() === "" || !Number.isFinite(value) || value < 0) {
      setError("Enter the price in dollars, for example 240.00.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await patchMaintenanceItem(item.id, { quotedCost: value }, "The price could not be sent. Nothing was changed.");
      toast({ title: `Price ${money(value)} sent to ${clientName} for approval` });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The price could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  const sub = state === "NOT_SENT" ? `${clientName} · nothing sent yet` : `${clientName} · ${state === "PENDING" ? "sent" : "decided"} ${dayTime(state === "PENDING" ? null : item.costDecidedAt, timeZone) ?? ""}`.trim();
  const heading = (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 id="m-price-title" className="text-[0.9375rem] font-[650]">Client price</h2>
        <p className="text-[0.75rem] opacity-80">{state === "PENDING" ? `${clientName} · waiting for an answer` : sub}</p>
      </div>
      {state !== "NOT_SENT" ? <ETonePill tone={PRICE_BAND[state]}>{state === "DECLINED" ? "Client declined" : PRICE_STATE_LABELS[state]}</ETonePill> : null}
    </div>
  );
  return (
    <section id="m-price" aria-labelledby="m-price-title" className={cn(CARD, "overflow-hidden")}>
      {state !== "NOT_SENT" ? <EToneBand tone={PRICE_BAND[state]} className="px-3.5 py-2.5">{heading}</EToneBand> : <div className="px-3.5 pt-3">{heading}</div>}
      <div className="flex flex-col gap-2 px-3.5 pb-3.5 pt-3">
        {state === "DECLINED" ? <p className="text-[0.8125rem]">The item stays open for the office to decide: send a new price, carry on at our cost, or dismiss it.</p> : null}
        <fieldset disabled={busy} className="flex items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">Amount (AUD)</span>
            <input type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="mt-1 h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.875rem] focus:border-[hsl(var(--e-gold))] focus:outline-none max-sm:h-11 max-sm:text-base" />
          </label>
          <EButton variant="outline" onClick={() => void send()}>{busy ? "Sending…" : state === "NOT_SENT" ? "Send for approval" : "Update price"}</EButton>
        </fieldset>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Sending a price makes the item visible to the client. They approve or decline in their portal; an approved price does not create an invoice by itself.</p>
      </div>
    </section>
  );
}

// ─── Linked records ─────────────────────────────────────────────────────────

export function LinkedRecords({ item }: { item: MaintenanceDetailItem }) {
  const client = item.property.client;
  const rows: Array<{ key: string; label: string; href: string }> = [
    { key: "property", label: `Property · ${item.property.name}`, href: `/v2/admin/properties/${item.property.id}` },
    ...(item.job ? [{ key: "job", label: `Clean ${item.job.jobNumber ?? ""}${item.job.scheduledDate ? ` · ${new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(item.job.scheduledDate))}` : ""}`.trim(), href: `/v2/admin/jobs/${item.job.id}` }] : []),
    ...(item.caseId ? [{ key: "case", label: "Case · resolves with this item", href: `/v2/admin/cases?open=${encodeURIComponent(item.caseId)}` }] : []),
    ...(client && item.property.clientId ? [{ key: "client", label: `Client · ${client.name ?? "Unnamed"}${client.phone ? ` · ${client.phone}` : ""}`, href: `/v2/admin/clients/${item.property.clientId}` }] : []),
  ];
  return (
    <section aria-labelledby="m-linked" className={cn(CARD, "flex flex-col gap-1 p-3.5")}>
      <CardTitle id="m-linked">Linked records</CardTitle>
      <ul>
        {rows.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] py-1.5 text-[0.8125rem] first:border-t-0">
            <span className="min-w-0 [overflow-wrap:anywhere]">{row.label}</span>
            <Link href={row.href} className="min-h-8 shrink-0 content-center text-[hsl(var(--e-primary))] underline">Open<span className="sr-only"> {row.label}</span></Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
