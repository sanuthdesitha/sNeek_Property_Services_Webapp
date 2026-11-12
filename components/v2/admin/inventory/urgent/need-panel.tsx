"use client";

/**
 * The need side panel (`?open=<id>`), as drawn: title, property and needed-by,
 * stage bar, counted / par level / suggested buy / requested / reported by
 * (with the job) / shopping run / cleaner asked / note, Stay preparation (the existing panel for this property, opened on
 * demand), the actions for the stage, and the history. Keyed by need id by its
 * parent; reads are cancelled when the need changes.
 */
import * as React from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EStageBar, type EStage } from "@/components/v2/ui/stage-bar";
import { StayPreparationPanel } from "@/components/inventory/stay-preparation-panel";
import type { UrgentNeedListRow, UrgentNeedListResponse } from "@/lib/inventory/urgent-stock-list";
import type { UrgentNeedEventRecord } from "@/lib/inventory/urgent-stock-store";
import { URGENT_STAGE_RECORDED, urgentNextAction } from "@/lib/inventory/urgent-stock-actions";
import { isUrgentStockClosed, type UrgentStockStage } from "@/lib/inventory/urgent-stock-policy";
import { formatInTimeZone } from "date-fns-tz";
import { NeedActionDialog, type NeedActionMode } from "./need-action-dialog";
import { neededByLabel, quantity } from "./urgent-format";
import { AskFact, RunFact } from "./need-links";
import { AddToRunDialog } from "./add-to-run-dialog";
import { AskCleanerDialog } from "./ask-cleaner-dialog";
import { WithdrawAskButton } from "./withdraw-ask-button";

type Detail = { items: Array<{ itemId: string; item: { name: string; unit: string } }>; events: UrgentNeedEventRecord[] };
type Load<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: T };

const BAR: Array<{ stage: UrgentStockStage; label: string }> = [
  { stage: "REPORTED", label: "Reported" },
  { stage: "ACKNOWLEDGED", label: "Acknowledged" },
  { stage: "ORDERED", label: "Ordered" },
  { stage: "DELIVERED", label: "Delivered" },
  { stage: "PROPERTY_CONFIRMED", label: "Confirmed" },
];
const dt = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

/** Wave F history entries (shopping run and "buy" asks). */
const EXTRA_EVENT_LABEL: Record<string, (detail: Record<string, unknown>) => string> = {
  ADDED_TO_SHOPPING_RUN: (detail) => `Added to shopping run "${String(detail.runTitle ?? "")}"${typeof detail.quantity === "number" ? `, ${detail.quantity} planned` : ""}`,
  ASKED_CLEANER_TO_BUY: (detail) => `Asked ${String(detail.cleanerName ?? "a cleaner")} to buy${typeof detail.quantity === "number" ? ` ${detail.quantity}` : ""}`,
  PURCHASE_ASK_WITHDRAWN: () => "Withdrew the ask to buy",
  CLEANER_ACCEPTED_TO_BUY: (detail) => `Accepted the ask; on shopping run "${String(detail.runTitle ?? "")}"`,
  CLEANER_DECLINED_TO_BUY: () => "Declined the ask to buy",
};

/** As drawn: "needed before Thu 10:00"; "clean has passed" or "no upcoming clean scheduled" otherwise. */
function panelNeededBy(value: UrgentNeedListRow, text: string, timeZone: string): string {
  if (value.neededByState === "passed") return "the next clean's time has passed";
  if (!value.neededBy || text === "–") return value.neededByState === "closed" ? "closed" : "no upcoming clean scheduled";
  return `needed before ${formatInTimeZone(new Date(value.neededBy), timeZone, "EEE HH:mm")}`;
}

function dispositionNote(disposition: string, count: number | null): string {
  if (count === null || disposition === "APPLY") return "";
  if (disposition === "PENDING_APPROVAL") return " (applied to stock when the clean is approved)";
  return ` (stock not changed: ${disposition.toLowerCase()})`;
}

export function urgentStages(stage: UrgentStockStage): EStage[] {
  const index = BAR.findIndex((step) => step.stage === stage);
  return BAR.map((step, position) => ({ key: step.stage, label: step.label, state: position < index ? "done" : position === index ? "current" : "todo" }));
}

function historyLine(event: UrgentNeedEventRecord, timeZone: string, unit: string): string {
  const when = formatInTimeZone(new Date(event.at), timeZone, "d MMM, HH:mm");
  const detail = (event.detail ?? {}) as { reason?: string; note?: string; number?: number; observedCount?: number | null; purchaseQuantity?: number | null; observationDisposition?: string };
  const what = event.kind === "REPORTED" ? "Reported"
    : event.kind === "REPORT_UPDATED" ? "Report updated"
    : event.kind === "REMINDER" ? `Reminder ${detail.number ?? ""} queued for administrators`
    : EXTRA_EVENT_LABEL[event.kind] ? EXTRA_EVENT_LABEL[event.kind]((event.detail ?? {}) as Record<string, unknown>)
    : URGENT_STAGE_RECORDED[event.kind as UrgentStockStage] ?? event.kind;
  const facts = [
    "observedCount" in detail ? `count ${detail.observedCount ?? "unknown"}` : null,
    "purchaseQuantity" in detail ? `requested ${detail.purchaseQuantity ?? "unknown"}` : null,
    detail.observationDisposition && "observedCount" in detail && detail.observedCount !== null ? `count ${detail.observationDisposition === "APPLY" ? "applied to stock" : `not applied (${detail.observationDisposition.toLowerCase()})`}` : null,
  ].filter(Boolean).join(", ");
  const why = detail.reason ?? detail.note;
  return `${when} · ${what}${facts ? ` (${facts}; ${unit})` : ""} · ${event.actorName}${why ? ` — “${why}”` : ""}`;
}

export function NeedPanel({ needId, row, timeZone, canResolve, onClose, onChanged }: { needId: string; row: UrgentNeedListRow | null; timeZone: string; canResolve: boolean; onClose: () => void; onChanged: () => void }) {
  const [need, setNeed] = React.useState<Load<UrgentNeedListRow>>(row ? { status: "ready", value: row } : { status: "loading" });
  const [detail, setDetail] = React.useState<Load<Detail>>({ status: "loading" });
  const [action, setAction] = React.useState<NeedActionMode | null>(null);
  const [dialog, setDialog] = React.useState<"run" | "ask" | null>(null);
  const [showStay, setShowStay] = React.useState(false);
  const [revision, setRevision] = React.useState(0);

  // The list row when it is on screen; otherwise this one need from the list API.
  React.useEffect(() => {
    if (row) {
      setNeed({ status: "ready", value: row });
      return;
    }
    const controller = new AbortController();
    fetch(`/api/inventory/urgent-stock?paginated=1&stage=all&pageSize=1&id=${encodeURIComponent(needId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (UrgentNeedListResponse & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.rows) throw new Error(body?.error ?? "Could not load this need.");
        if (!body.rows[0]) throw new Error("This need no longer exists.");
        setNeed({ status: "ready", value: body.rows[0] });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setNeed({ status: "error", message: error instanceof Error ? error.message : "Could not load this need." });
      });
    return () => controller.abort();
  }, [needId, row, revision]);

  const value = need.status === "ready" ? need.value : null;
  const propertyId = value?.propertyId ?? null;
  React.useEffect(() => {
    if (!propertyId) return;
    const controller = new AbortController();
    setDetail({ status: "loading" });
    fetch(`/api/inventory/urgent-stock?propertyId=${encodeURIComponent(propertyId)}&reportId=${encodeURIComponent(needId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (Detail & { error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.events) throw new Error(body?.error ?? "History unavailable.");
        setDetail({ status: "ready", value: { items: body.items ?? [], events: body.events } });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDetail({ status: "error", message: error instanceof Error ? error.message : "History unavailable." });
      });
    return () => controller.abort();
  }, [needId, propertyId, value?.version]);

  const next = value ? urgentNextAction(value.stage) : null;
  const needed = value ? neededByLabel(value.neededBy, value.neededByState, timeZone) : null;
  const closed = value ? isUrgentStockClosed(value.stage) : false;
  const liveAsk = value?.purchaseAsk && (value.purchaseAsk.state === "ASKED" || value.purchaseAsk.state === "ACCEPTED") ? value.purchaseAsk : null;
  const canBuy = Boolean(value && !closed && !(value.shoppingRun?.open) && !liveAsk);
  const changed = () => {
    setRevision((count) => count + 1);
    onChanged();
  };

  return (
    <ESidePanel open title={value?.itemName ?? (need.status === "error" ? "Need unavailable" : "Loading…")} label="Need detail" onClose={onClose} subtitle={value ? `${value.propertyName} · ${panelNeededBy(value, needed?.text ?? "–", timeZone)}` : undefined}>
      {need.status === "loading" ? <p role="status" className="text-[0.875rem]">Loading the need…</p> : null}
      {need.status === "error" ? <p role="alert" className="text-[0.875rem] text-[hsl(var(--e-danger))]">{need.message}</p> : null}
      {value ? (
        <>
          <EStageBar label="Need stages" stages={urgentStages(value.stage)} terminal={value.stage === "ADMIN_RESOLVED" ? { title: "Resolved by an administrator", description: "Closed without a property confirmation; the reason is in the history." } : null} />
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[0.8125rem]">
            <dt className={dt}>Counted</dt>
            <dd>{value.observedCount === null ? "Unknown" : quantity(value.observedCount, value.unit)}{value.observedAt ? `, ${formatInTimeZone(new Date(value.observedAt), timeZone, "d MMM HH:mm")}` : ""}{dispositionNote(value.observationDisposition, value.observedCount)}</dd>
            <dt className={dt}>Par level</dt>
            <dd>{value.parLevel === null ? "Not set" : quantity(value.parLevel, value.unit)}</dd>
            <dt className={dt}>Suggested buy</dt>
            <dd>{value.suggestedBuy === null ? "Unknown (needs a count and a par level)" : quantity(value.suggestedBuy, value.unit)}</dd>
            <dt className={dt}>Requested</dt>
            <dd>{value.purchaseQuantity === null ? "Unknown" : quantity(value.purchaseQuantity, value.unit)}</dd>
            <dt className={dt}>Reported by</dt>
            <dd>
              {value.reportedByName ?? "Not recorded"}
              {value.sourceJob ? <> during <Link className="font-[550] text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/jobs/${value.sourceJob.id}`}>{value.sourceJob.jobNumber ?? "this job"}</Link></> : null}
            </dd>
            <dt className={dt}>Shopping run</dt>
            <dd><RunFact row={value} /></dd>
            <dt className={dt}>Cleaner asked</dt>
            <dd><AskFact row={value} timeZone={timeZone} /></dd>
            <dt className={dt}>Note</dt>
            <dd className="whitespace-pre-wrap break-words">&ldquo;{value.note}&rdquo;</dd>
          </dl>
          <hr className="border-[hsl(var(--e-border))]" />
          <section aria-label="Stay preparation" className="space-y-2">
            <h3 className="text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">Stay preparation</h3>
            {showStay ? (
              <StayPreparationPanel embedded propertyId={value.propertyId} isAdmin items={detail.status === "ready" ? detail.value.items : []} refreshToken={`${value.id}:${value.version}`} />
            ) : (
              <EButton size="sm" variant="outline" onClick={() => setShowStay(true)}>Show stay preparation for {value.propertyName}</EButton>
            )}
          </section>
          <hr className="border-[hsl(var(--e-border))]" />
          {!closed ? (
            <div className="flex flex-wrap gap-2">
              {next?.kind === "transition" ? <EButton size="sm" onClick={() => setAction("next")}>{next.label}</EButton> : <span className={dt}>{next?.label}</span>}
              {canBuy ? <EButton size="sm" variant="outline" onClick={() => setDialog("run")}>Add to shopping run</EButton> : null}
              {canBuy ? <EButton size="sm" variant="outline" onClick={() => setDialog("ask")}>Ask cleaner to buy</EButton> : null}
              {liveAsk?.state === "ASKED" ? <WithdrawAskButton askId={liveAsk.id} cleanerName={liveAsk.cleanerName} onDone={changed} /> : null}
              <EButton size="sm" variant="outline" onClick={() => setAction("confirm")}>Confirm at property</EButton>
              {canResolve ? <EButton size="sm" variant="outline" onClick={() => setAction("resolve")}>Resolve</EButton> : null}
            </div>
          ) : (
            <p className={dt}>Closed. Earlier actions stay in the history; a new need is a new report.</p>
          )}
          <section aria-label="History" className="space-y-1.5">
            <h3 className="text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">History</h3>
            {detail.status === "loading" ? <p role="status" className={dt}>Loading history…</p> : null}
            {detail.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{detail.message}</p> : null}
            {detail.status === "ready" ? (
              detail.value.events.length ? (
                <ol className="space-y-1 text-[0.8125rem]">{detail.value.events.map((event, index) => <li key={index}>{historyLine(event, timeZone, value.unit)}</li>)}</ol>
              ) : (
                <p className={dt}>No history recorded.</p>
              )
            ) : null}
          </section>
          {dialog === "run" ? <AddToRunDialog needs={[value]} onClose={() => setDialog(null)} onDone={changed} /> : null}
          {dialog === "ask" ? <AskCleanerDialog need={value} onClose={() => setDialog(null)} onDone={changed} /> : null}
          {action ? (
            <NeedActionDialog
              need={value}
              mode={action}
              onClose={() => setAction(null)}
              onDone={() => {
                setAction(null);
                setRevision((count) => count + 1);
                onChanged();
              }}
            />
          ) : null}
        </>
      ) : null}
    </ESidePanel>
  );
}
