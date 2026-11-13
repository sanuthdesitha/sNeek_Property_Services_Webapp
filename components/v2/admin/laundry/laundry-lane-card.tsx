"use client";

/**
 * One run card in a Pipeline lane: property, one state pill, one line of facts
 * and its contextual actions: the run's own request (the laundry partner's
 * team for pickup / drop-off / return date / photo, "Ask cleaner" only for the
 * bags at the property, "Chase supplier" for the partner's stored contact;
 * each only where the run calls for it) and "Move to <next day>" (the
 * reschedule endpoint with its stale-write guard). The route stop names the
 * laundry team member carrying it, not a "driver". Opening the card shows the side panel, where
 * Edit, Delete and every other run action live.
 */
import * as React from "react";
import Link from "next/link";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EButton } from "@/components/v2/ui/primitives";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import { statusLabel } from "./laundry-shared";
import { READY_TO_RETURN_LABEL, isReadyToReturnStatus } from "@/lib/laundry/status-groups";
import { LaundryNudgeActions, requestOptionsForTask } from "./laundry-nudge";
import { LaundrySupplierChase, chaseAppliesToTask } from "./laundry-supplier-chase";
import type { PipelineCardDTO } from "./use-laundry-pipeline";

/** "Wed 11 Nov 15:00" when a time was planned, else the day alone. */
export function dayWithTime(value: string | null | undefined, time: string | null | undefined): string {
  const day = shortDay(value);
  return time && day !== "—" ? `${day} ${time}` : day;
}

export function shortDay(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : formatInTimeZone(date, SYDNEY_TZ, "EEE d MMM");
}

function clock(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : formatInTimeZone(date, SYDNEY_TZ, "HH:mm");
}

export function cardPill(card: PipelineCardDTO): { label: string; tone: EPillTone } {
  const first = card.exceptions[0];
  if (first) return { label: first.label, tone: first.code === "NO_DROP_PHOTO" || first.code === "OVER_TURNAROUND" ? "warn" : "bad" };
  switch (card.lane) {
    case "pickup":
      if (card.readiness === true) return { label: card.bagCount ? `Ready · ${card.bagCount} bag${card.bagCount === 1 ? "" : "s"}` : "Ready", tone: "ok" };
      if (card.job?.status === "IN_PROGRESS") return { label: "Clean in progress", tone: "neutral" };
      return { label: statusLabel(card.status), tone: "neutral" };
    case "laundry":
      if (isReadyToReturnStatus(card.status)) {
        return { label: card.dayOf ? `${READY_TO_RETURN_LABEL} · day ${card.dayOf.day} of ${card.dayOf.planned}` : READY_TO_RETURN_LABEL, tone: "ok" };
      }
      return card.dayOf ? { label: `Day ${card.dayOf.day} of ${card.dayOf.planned}`, tone: card.dayOf.day > card.dayOf.planned ? "warn" : "neutral" } : { label: "At the laundry", tone: "neutral" };
    case "drop":
      if (card.carriedIn) return { label: `Due ${shortDay(card.dropoffDate)}`, tone: "bad" };
      // As drawn: a drop with no planned clock time says so (the team is asked for one).
      return card.dropoffTime ? { label: `Drop ${card.dropoffTime}`, tone: "info" } : { label: "No drop time", tone: "warn" };
    case "delivered":
    default:
      return { label: clock(card.droppedAt) ?? "Delivered", tone: "ok" };
  }
}

/**
 * The laundry route stop as what the data is: the laundry team member (a
 * LAUNDRY portal account) carrying it, with the run's partner when known.
 */
export function laundryRouteLabel(stop: { driverName: string; stop: number }, supplierName: string | null): string {
  return `${supplierName ? `${supplierName} · ` : "Laundry team · "}${stop.driverName}, stop ${stop.stop}`;
}

export function cardFacts(card: PipelineCardDTO): string {
  const bags = card.bagCount ? `${card.bagCount} bag${card.bagCount === 1 ? "" : "s"}` : null;
  const weight = card.bagWeightKg ? `${card.bagWeightKg} kg` : null;
  const partner = card.supplier?.name ?? null;
  const driver = card.driver ? laundryRouteLabel(card.driver, partner) : null;
  // Planned clock times (Wave F): shown only when the office planned one.
  const pickupAt = card.pickupTime ? (card.driver ? `${driver} · ${card.pickupTime}` : `Pickup ${card.pickupTime}${partner ? ` · ${partner}` : ""}`) : driver ?? (partner ? `Pickup by ${partner}` : null);
  const dropAt = card.dropoffTime ? `Drop ${card.dropoffTime}` : null;
  const latestHandoff = [...(card.confirmations ?? [])].reverse().find((row) => row.bagLocation || row.photoUrl);
  const nextGuest = card.nextGuest?.checkinAt ? `next guest ${shortDay(card.nextGuest.checkinAt)}` : null;
  const parts: Array<string | null> = (() => {
    switch (card.lane) {
      case "pickup":
        return [
          card.carriedIn ? `Pickup was ${shortDay(card.pickupDate)}` : null,
          card.readiness === null ? "Cleaner has not confirmed bags" : null,
          latestHandoff?.bagLocation ?? null,
          latestHandoff?.photoUrl ? "photo attached" : null,
          pickupAt,
          card.job?.scheduledDate && card.readiness === null ? `Clean ${shortDay(card.job.scheduledDate)}` : null,
        ];
      case "laundry":
        return [bags, weight, card.supplier?.name ?? "Supplier not recorded", nextGuest];
      case "drop":
        return [bags, isReadyToReturnStatus(card.status) ? "ready to return" : null, dropAt, driver, nextGuest ? `needed before ${nextGuest.replace("next guest ", "")}` : null];
      case "delivered":
      default:
        return [bags, card.confirmations?.some((row) => row.photoUrl) ? "photo" : null, card.dropoffCostAud != null ? `receipt $${Number(card.dropoffCostAud).toFixed(2)}` : null];
    }
  })();
  return parts.filter(Boolean).join(" · ") || "No details recorded yet";
}

type Props = {
  card: PipelineCardDTO;
  active: boolean;
  selectable: boolean;
  selected: boolean;
  saving: boolean;
  moveLabel: string | null;
  onOpen: () => void;
  onToggle: () => void;
  onMove: () => void;
  /** The Pipeline's "today" (Sydney), for the exception actions. */
  todayKey?: string;
  /** The card's ⋯ menu (2026-11-14): the side panel's actions plus Change state and Void. */
  menuItems?: ERowMenuItem[];
};

export function LaundryLaneCard({ card, active, selectable, selected, saving, moveLabel, onOpen, onToggle, onMove, todayKey, menuItems }: Props) {
  const pill = cardPill(card);
  const chaseOffered = chaseAppliesToTask(card, todayKey);
  const hasExceptionAction = requestOptionsForTask(card, todayKey).length > 0 || chaseOffered;
  const name = card.property?.name ?? "Property";
  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-[10px] border bg-[hsl(var(--e-surface))] p-2.5",
        card.exceptions.length ? "border-[hsl(var(--e-danger)/0.4)]" : "border-[hsl(var(--e-border))]",
        active && "ring-2 ring-[hsl(var(--e-ring))]",
        saving && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {selectable ? <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={selected} onChange={onToggle} aria-label={`Select ${name}`} /> : null}
          <button type="button" onClick={onOpen} className="min-w-0 break-words text-left text-[0.875rem] font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
            {name}
          </button>
        </div>
        <EPill tone={pill.tone}>{pill.label}</EPill>
      </div>
      <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{cardFacts(card)}</span>
      {card.exceptions.length > 1 ? (
        <span className="text-[0.6875rem] text-[hsl(var(--e-danger))]">Also: {card.exceptions.slice(1).map((item) => item.label).join(" · ")}</span>
      ) : null}
      {moveLabel || hasExceptionAction ? (
        <div className="flex flex-wrap gap-1.5">
          <LaundryNudgeActions task={card} todayKey={todayKey} compact chaseOffered={chaseOffered} />
          <LaundrySupplierChase task={card} todayKey={todayKey} />
          {moveLabel ? <EButton size="sm" variant="outline" disabled={saving} onClick={onMove}>{moveLabel}</EButton> : null}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Link href={`/v2/admin/laundry/runs/${encodeURIComponent(card.id)}`} className="text-[0.75rem] font-semibold text-[hsl(var(--e-primary))] underline-offset-2 hover:underline max-sm:inline-flex max-sm:min-h-11 max-sm:items-center">Open run</Link>
        {menuItems?.length ? <ERowMenu label={`More for ${name}`} items={menuItems} disabled={saving} /> : null}
      </div>
    </li>
  );
}
