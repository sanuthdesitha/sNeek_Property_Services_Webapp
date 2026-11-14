"use client";

/**
 * Admin maintenance item page (board "Maintenance item", 2026-11-14), built
 * like the laundry run page: back link, one heading with the priority badge,
 * Change status ▾, Mark resolved… and More ▾; a progress strip joining status
 * and the visit; six fact tiles; What was reported, Work completed photos,
 * Visit progress and History on the left; Who is on this (acceptance, pay and
 * the worker's price request), Visit and access, Instructions, Client price
 * and Linked records on the right.
 *
 * Every function of the old page is here: photos with preview, the client
 * price, the visit times, outcome, notes and pins, directions, the full
 * history, the role roster with pay and price requests, instructions, the
 * visit worker with reassign, visit time, access sharing and contact, adding
 * an ad hoc worker, and creating a portal login (administrators).
 *
 * Phones: the stage strip swipes, Who is on this, Visit and access,
 * Instructions and History fold, More is a sheet, and Status ▾ with
 * Mark resolved… dock at the bottom. Items are never deleted.
 */
import * as React from "react";
import Link from "next/link";
import type { MaintenanceStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EStageBar } from "@/components/v2/ui/stage-bar";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { PhoneActionSheet } from "@/components/v2/admin/phone-action-sheet";
import { PhoneCarousel } from "@/components/v2/admin/phone-carousel";
import { ACTION_LABELS, CATEGORY_LABELS, PRIORITY_LABELS, SOURCE_LABELS } from "@/lib/maintenance/labels";
import { parseInstructions } from "@/lib/maintenance/instructions";
import { maintenanceRecordStages } from "@/lib/maintenance/record-stages";
import { describePay, resolveAssignmentPay } from "@/lib/maintenance/instructions";
import { AssignmentInstructionsEditor } from "./assignment-instructions-editor";
import {
  ClientPriceCard,
  FinishPhotosCard,
  FoldSection,
  HistoryList,
  LinkedRecords,
  ReportedCard,
  useItemRoster,
  VisitAccessCard,
  VisitProgressCard,
  WhoIsOnThis,
} from "./detail-sections";
import { dayTime, money, priceState, priorityTone } from "./maintenance-format";
import { readMaintenanceItem, targetFromDetail, type MaintenanceDetailItem } from "./maintenance-types";
import { STATUS_ACTION_LABEL, useMaintenanceActions } from "./use-maintenance-actions";
import { safeBackHref } from "./maintenance-view";

type LoadState = { item: MaintenanceDetailItem | null; error: string | null; loading: boolean };

function useItem(itemId: string, revision: number): LoadState {
  const [state, setState] = React.useState<LoadState>({ item: null, error: null, loading: true });
  React.useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true }));
    readMaintenanceItem(itemId, controller.signal)
      .then((item) => {
        if (controller.signal.aborted || item.id !== itemId) return;
        setState({ item, error: null, loading: false });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : "This item could not be loaded." }));
      });
    return () => controller.abort();
  }, [itemId, revision]);
  return state;
}

function Fact({ label, value, sub, subTone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; subTone?: "warning" | "danger" | "success" }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2.5 py-2">
      <dt className="text-[0.6875rem] font-[500] text-[hsl(var(--e-muted-foreground))]">{label}</dt>
      <dd className="e-tnum text-[0.875rem] font-[600] [overflow-wrap:anywhere]">{value}</dd>
      {sub ? (
        <dd className={cn("text-[0.71875rem] text-[hsl(var(--e-text-secondary))]", subTone === "warning" && "font-[600] text-[hsl(var(--e-warning))]", subTone === "danger" && "font-[600] text-[hsl(var(--e-danger))]", subTone === "success" && "text-[hsl(var(--e-success))]")}>
          {sub}
        </dd>
      ) : null}
    </div>
  );
}

export function EstateMaintenanceDetail({ itemId, timeZone = "Australia/Sydney", isAdmin = false, back }: { itemId: string; timeZone?: string; isAdmin?: boolean; back?: string | null }) {
  const [revision, setRevision] = React.useState(0);
  const [rosterRevision, setRosterRevision] = React.useState(0);
  const [whoSignal, setWhoSignal] = React.useState(0);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const phone = useIsPhone();
  const { item, error, loading } = useItem(itemId, revision);
  const roster = useItemRoster(itemId, rosterRevision);
  const backHref = safeBackHref(back);
  const actions = useMaintenanceActions({
    timeZone,
    isAdmin,
    onChanged: () => {
      setRevision((value) => value + 1);
      setRosterRevision((value) => value + 1);
    },
  });

  if (!item) {
    return (
      <div className="space-y-4">
        <p className="text-[0.8125rem]"><Link href={backHref} className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">← Maintenance</Link></p>
        <h1 className="e-display-md">{loading ? "Loading the item…" : "Maintenance item"}</h1>
        {error ? (
          <div role="alert" className="space-y-2 text-[0.875rem]">
            <p>{error}</p>
            <EButton size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Try again</EButton>
          </div>
        ) : (
          <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        )}
      </div>
    );
  }

  const target = targetFromDetail(item);
  const terminal = item.status === "RESOLVED" || item.status === "DISMISSED";
  const worker = item.assignedWorker;
  const activeRoster = (roster.rows ?? []).filter((row) => !row.removedAt);
  const someoneAssigned = Boolean(worker) || activeRoster.length > 0;
  const acknowledgedAt = item.events.find((event) => event.fromStatus === "OPEN" && event.toStatus !== "OPEN")?.createdAt ?? null;
  const stages = maintenanceRecordStages(
    {
      status: item.status, createdAt: item.createdAt, acknowledgedAt, assignedAt: item.assignedAt, someoneAssigned,
      scheduledFor: item.scheduledFor, arrivedAt: item.arrivedAt, clockInAt: item.clockInAt, clockOutAt: item.clockOutAt,
      outcome: item.outcome, resolvedAt: item.resolvedAt,
    },
    (key, fact) => {
      if (typeof fact === "string") {
        const when = dayTime(fact, timeZone);
        if (key === "assigned" && worker) return `${worker.name}${when ? `, ${when}` : ""}`;
        return when;
      }
      if (fact === true) return "Not timed";
      return key === "visit" ? "Not booked" : "Not yet";
    },
  );
  const dismissed = item.status === "DISMISSED"
    ? { title: "Dismissed", description: `${dayTime(item.resolvedAt, timeZone) ?? "Time not recorded"}${item.resolvedBy?.name ? ` by ${item.resolvedBy.name}` : ""}.${item.resolutionNote ? ` "${item.resolutionNote}"` : ""} Kept with its history; change the status to reopen it.` }
    : null;

  const maintenanceRow = activeRoster.find((row) => row.role === "MAINTENANCE") ?? null;
  const pendingRow = activeRoster.find((row) => row.payChangeStatus === "PENDING") ?? null;
  const pay = maintenanceRow ? resolveAssignmentPay(maintenanceRow) : null;
  const price = priceState(item.costApprovalStatus);

  const statusItems: ERowMenuItem[] = (Object.keys(STATUS_ACTION_LABEL) as MaintenanceStatus[])
    .filter((status) => status !== item.status)
    .filter((status) => status !== "OPEN" || terminal)
    .map((status) => ({ key: `status-${status}`, label: STATUS_ACTION_LABEL[status], badge: status === "RESOLVED" || status === "DISMISSED" ? "note" : undefined, onSelect: () => actions.requestStatus([target], status) }));
  const moreItems: ERowMenuItem[] = [
    { key: "edit", heading: "Item", label: "Edit details…", onSelect: () => actions.openEdit(item) },
    { key: "link", label: item.jobId ? "Move to another job…" : "Link to a job…", onSelect: () => actions.openLinkJob({ id: item.id, title: item.title, propertyId: item.property.id, propertyName: item.property.name, jobId: item.jobId }) },
    { key: "visibility", label: item.clientVisible ? "Hide from the client" : "Show to the client", onSelect: () => void actions.setVisibility(target, !item.clientVisible) },
    { key: "copy", label: "Copy link", onSelect: () => actions.copyLink(item.id) },
    ...(item.status !== "ORDERED" && !terminal ? [{ key: "ordered", heading: "Status", separated: true, label: "Mark ordered", onSelect: () => actions.requestStatus([target], "ORDERED") }] : []),
    ...(item.status !== "DISMISSED"
      ? [{ key: "dismiss", heading: item.status === "ORDERED" || terminal ? "Status" : undefined, separated: item.status === "ORDERED" || terminal, label: "Dismiss…", badge: "note, can be undone", onSelect: () => actions.requestStatus([target], "DISMISSED") }]
      : []),
  ];
  const primary = terminal ? (
    <EButton onClick={() => actions.requestStatus([target], "OPEN")} disabled={actions.running}>Reopen</EButton>
  ) : (
    <EButton onClick={() => actions.requestStatus([target], "RESOLVED")} disabled={actions.running}>Mark resolved…</EButton>
  );
  const address = [item.property.address, item.property.suburb].filter(Boolean).join(", ");
  const subLine = [
    item.property.name, address || null, item.area, CATEGORY_LABELS[item.category], ACTION_LABELS[item.recommendedAction],
    item.property.client?.name ?? null, item.clientVisible ? "the client sees this item" : "internal, the client does not see it",
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem]">
              <Link href={backHref} className="text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">← Maintenance</Link>
              <span className="font-mono text-[hsl(var(--e-muted-foreground))] max-sm:hidden"> · /v2/admin/maintenance/{item.id.slice(0, 6)}…</span>
            </p>
            <h1 className="e-display-md mt-1 break-words">
              {item.title} <EPill tone={priorityTone(item.priority)} className="align-middle [font-family:var(--e-font-sans)] tracking-normal">{PRIORITY_LABELS[item.priority]}</EPill>
            </h1>
            <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{subLine}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="max-sm:hidden">
              <ERowMenu label={`Change status of ${item.title}`} trigger="Change status ▾" triggerVariant="outline" items={statusItems} />
            </div>
            <span className="max-sm:hidden">{primary}</span>
            {phone ? (
              <EButton size="icon" variant="outline" aria-label="More: edit, link job, hide from client, dismiss" onClick={() => setMoreOpen(true)}>⋯</EButton>
            ) : (
              <ERowMenu label={`More actions for ${item.title}`} trigger="More ▾" triggerVariant="outline" items={moreItems} footnote="No delete: an item is dismissed, never removed, so the client and the case keep their history." />
            )}
          </div>
        </div>

        <PhoneCarousel label="Progress, swipe for more">
          <EStageBar label="Progress" stages={stages} terminal={dismissed} className="max-sm:flex max-sm:w-max max-sm:[&>li]:min-w-[7.5rem]" />
        </PhoneCarousel>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Fact label="Reported by" value={item.reportedBy?.name ?? item.reportedBy?.email ?? "Not recorded"} sub={<>{SOURCE_LABELS[item.source]}{item.job ? <> · from clean <Link className="underline" href={`/v2/admin/jobs/${item.job.id}`}>{item.job.jobNumber ?? "job"}</Link></> : null}</>} />
          <Fact label="Assigned" value={worker?.name ?? (activeRoster[0]?.user?.name ?? "Nobody yet")} sub={worker ? [worker.company, worker.userId ? "has login" : "no login"].filter(Boolean).join(" · ") : activeRoster.length > 0 ? "roster only, no visit worker" : "no visit worker"} />
          <Fact label="Visit" value={dayTime(item.scheduledFor, timeZone) ?? "Not booked"} sub={worker ? (item.shareAccess ? "access shared" : "access not shared") : undefined} />
          <Fact label="Our estimate" value={money(item.estimatedCost) ?? "Not estimated"} sub="internal" />
          <Fact
            label="Client price"
            value={price === "NOT_SENT" ? "Not sent" : money(item.quotedCost) ?? "No amount"}
            sub={price === "PENDING" ? "Awaiting client" : price === "APPROVED" ? `Approved${item.costDecidedAt ? ` ${dayTime(item.costDecidedAt, timeZone)}` : ""}` : price === "DECLINED" ? "Client declined" : undefined}
            subTone={price === "PENDING" ? "warning" : price === "DECLINED" ? "danger" : price === "APPROVED" ? "success" : undefined}
          />
          <Fact
            label="Worker pay"
            value={pay ? describePay(pay) : maintenanceRow ? "No pay set" : "Not recorded"}
            sub={maintenanceRow?.payChangeStatus === "PENDING" ? `asks ${money(Number(maintenanceRow.payChangeAmount)) ?? "a different price"}${pay ? ` · ${pay.payer === "CLIENT" ? "billed to the client" : "we pay"}` : ""}` : pay ? (pay.payer === "CLIENT" ? "billed to the client" : "we pay") : undefined}
          />
        </dl>

        {pendingRow && phone ? (
          <EToneNotice tone="attention" className="p-3">
            <span>
              <b>{pendingRow.user?.name ?? "A worker"} asks {money(Number(pendingRow.payChangeAmount)) ?? "a different price"}</b>
              {pendingRow.payChangeReason ? ` "${pendingRow.payChangeReason}"` : ""}{" "}
              <button type="button" className="min-h-8 underline" onClick={() => { setWhoSignal((value) => value + 1); document.getElementById("m-who")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Decide</button>
            </span>
          </EToneNotice>
        ) : null}
      </header>

      <div className="flex min-w-0 flex-col gap-3.5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <ReportedCard item={item} />
          <FinishPhotosCard item={item} />
          <VisitProgressCard item={item} timeZone={timeZone} />
          <FoldSection id="m-history" title="History" summary={`${item.events.length} event${item.events.length === 1 ? "" : "s"}${item.events.length ? ` · last ${dayTime(item.events[item.events.length - 1].createdAt, timeZone)}` : ""}`} action={<span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{timeZone} time</span>}>
            <HistoryList item={item} timeZone={timeZone} />
          </FoldSection>
        </div>
        <aside aria-label="Assignment and money" className="flex min-w-0 flex-col gap-3 lg:w-[372px] lg:shrink-0">
          <WhoIsOnThis
            roster={roster}
            onReload={() => { roster.reload(); setRevision((value) => value + 1); }}
            canApprovePrice={isAdmin}
            onChangePeople={() => actions.openAssign([target])}
            openSignal={whoSignal}
            timeZone={timeZone}
          />
          <VisitAccessCard item={item} timeZone={timeZone} isAdmin={isAdmin} onReassign={() => actions.openAssign([target])} onChangeVisit={() => actions.openVisit(item)} onChanged={() => setRevision((value) => value + 1)} />
          {phone ? (
            <FoldSection id="m-instructions" title="Instructions" summary={`${parseInstructions(item.assignmentInstructions).length} saved · everyone assigned sees these`}>
              <AssignmentInstructionsEditor key={item.id} itemId={item.id} initial={parseInstructions(item.assignmentInstructions)} />
            </FoldSection>
          ) : (
            <AssignmentInstructionsEditor key={item.id} itemId={item.id} initial={parseInstructions(item.assignmentInstructions)} />
          )}
          <ClientPriceCard item={item} timeZone={timeZone} onSaved={() => setRevision((value) => value + 1)} />
          <LinkedRecords item={item} />
        </aside>
      </div>

      <EPhoneActionBar
        label="Item actions"
        secondary={<EButton variant="outline" onClick={() => setStatusOpen(true)}>Status ▾</EButton>}
        primary={primary}
      />
      {phone ? (
        <>
          <PhoneActionSheet open={moreOpen} onOpenChange={setMoreOpen} title={item.title} items={moreItems} footnote="No delete: an item is dismissed, never removed, so the client and the case keep their history." />
          <PhoneActionSheet open={statusOpen} onOpenChange={setStatusOpen} title="Change status" items={statusItems} />
        </>
      ) : null}
      {actions.dialogs}
    </div>
  );
}
