"use client";

/**
 * One run card in a Pipeline lane: property, one state pill, one line of facts
 * and at most one contextual action ("Move to <next day>", which uses the
 * reschedule endpoint with its stale-write guard). Opening the card shows the
 * side panel, where Edit, Delete and every other run action live.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { cn } from "@/lib/utils";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EButton } from "@/components/v2/ui/primitives";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import { statusLabel } from "./laundry-shared";
import type { PipelineCardDTO } from "./use-laundry-pipeline";

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
      return card.dayOf ? { label: `Day ${card.dayOf.day} of ${card.dayOf.planned}`, tone: card.dayOf.day > card.dayOf.planned ? "warn" : "neutral" } : { label: "At the laundry", tone: "neutral" };
    case "drop":
      return { label: card.carriedIn ? `Due ${shortDay(card.dropoffDate)}` : "Picked up", tone: card.carriedIn ? "bad" : "info" };
    case "delivered":
    default:
      return { label: clock(card.droppedAt) ?? "Delivered", tone: "ok" };
  }
}

export function cardFacts(card: PipelineCardDTO): string {
  const bags = card.bagCount ? `${card.bagCount} bag${card.bagCount === 1 ? "" : "s"}` : null;
  const weight = card.bagWeightKg ? `${card.bagWeightKg} kg` : null;
  const driver = card.driver ? `Driver ${card.driver.driverName}, stop ${card.driver.stop}` : null;
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
          driver,
          card.job?.scheduledDate && card.readiness === null ? `Clean ${shortDay(card.job.scheduledDate)}` : null,
        ];
      case "laundry":
        return [bags, weight, card.supplier?.name ?? "Supplier not recorded", nextGuest];
      case "drop":
        return [bags, driver, nextGuest ? `needed before ${nextGuest.replace("next guest ", "")}` : null];
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
};

export function LaundryLaneCard({ card, active, selectable, selected, saving, moveLabel, onOpen, onToggle, onMove }: Props) {
  const pill = cardPill(card);
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
      {moveLabel ? (
        <div className="flex flex-wrap gap-1.5">
          <EButton size="sm" variant="outline" disabled={saving} onClick={onMove}>{moveLabel}</EButton>
        </div>
      ) : null}
    </li>
  );
}
