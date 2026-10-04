"use client";

/**
 * "This booking" — the incoming-reservation details pulled from the property's
 * iCal sync (jobMeta.reservationContext). v1 showed this prominently; v2 had the
 * data in its payload but rendered it nowhere, so cleaners couldn't see how many
 * guests to set the property up for.
 *
 * Guest count is the hero number: it drives bed/linen setup and towel counts,
 * and getting it wrong is a guest-facing failure. When the booking doesn't
 * declare a count we fall back to the property maximum and say so.
 */
import * as React from "react";
import { stayNights } from "@/lib/inventory/stay-preparation-policy";
import { Users, CalendarClock, User, Hash, BedDouble, ChevronDown } from "lucide-react";
import { ECard, ECardBody, EBadge } from "@/components/v2/ui/primitives";
import { StayPreparationPanel } from "@/components/inventory/stay-preparation-panel";
import type { JobReservationContext } from "@/lib/jobs/meta";

export function BookingCard({
  reservation,
  sofaBedCount,
  checkoutTime,
  checkinTime,
  preparation,
}: {
  reservation: JobReservationContext | null | undefined;
  sofaBedCount?: number | null;
  /** Property default checkout (this clean's earliest start). */
  checkoutTime?: string | null;
  /** Property default check-in (guests arrive — the hard deadline). */
  checkinTime?: string | null;
  preparation?: { propertyId: string; jobId: string; refreshToken?: string };
}) {
  const [preparationOpen, setPreparationOpen] = React.useState(false);
  const preparationId = React.useId();
  const showPreparationError = React.useCallback(() => setPreparationOpen(true), []);
  if ((!reservation || Object.keys(reservation).length === 0) && !preparation) return null;
  reservation = reservation ?? {};

  const guests = reservation.preparationGuestCount;
  const fromPropertyMax = reservation.preparationSource === "PROPERTY_MAX";
  const breakdown = [
    reservation.adults ? `${reservation.adults} adult${reservation.adults === 1 ? "" : "s"}` : null,
    reservation.children ? `${reservation.children} child${reservation.children === 1 ? "" : "ren"}` : null,
    reservation.infants ? `${reservation.infants} infant${reservation.infants === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  // Advisory only — a nudge, not a rule (bed config varies by property).
  const sofaBedHint =
    guests != null && (sofaBedCount ?? 0) > 0 && guests > 2
      ? `${guests} guests — the sofa bed is likely needed`
      : null;

  const checkout = reservation.checkoutAtLocal || checkoutTime;
  const checkin = reservation.checkinAtLocal || checkinTime;

  return (
    <ECard variant="ceremony">
      <ECardBody className="space-y-3 pt-6">
        <div className="flex items-center justify-between gap-2">
          <p className="e-eyebrow">This booking</p>
          {reservation.reservationCode ? (
            <span className="inline-flex items-center gap-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
              <Hash className="h-3 w-3" />
              {reservation.reservationCode}
            </span>
          ) : null}
        </div>

        {guests != null ? (
          <div className="flex flex-wrap items-baseline gap-2">
            <Users className="h-5 w-5 self-center text-[hsl(var(--e-gold))]" />
            <span className="text-[0.9375rem] font-[550]">Prepare for</span>
            <span className="text-[1.75rem] font-[650] leading-none tabular-nums">{guests}</span>
            <span className="text-[0.9375rem] font-[550]">{guests === 1 ? "guest" : "guests"}</span>
            {fromPropertyMax ? (
              <EBadge tone="neutral" soft>
                property max
              </EBadge>
            ) : null}
          </div>
        ) : <p className="font-medium">Guest count unknown — confirm with the office.</p>}

        {!preparation ? <p>Incoming stay: {stayNights(reservation) === null ? "Unknown nights" : `${stayNights(reservation)} nights (iCal dates)`}</p> : null}

        {breakdown.length > 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{breakdown.join(" · ")}</p>
        ) : null}

        {sofaBedHint ? (
          <p className="flex items-center gap-1.5 rounded-[var(--e-radius)] bg-[hsl(var(--e-gold-soft))] px-2.5 py-1.5 text-[0.75rem] text-[hsl(var(--e-gold-ink))]">
            <BedDouble className="h-3.5 w-3.5 shrink-0" /> {sofaBedHint}
          </p>
        ) : null}

        {preparation ? <section className="border-t border-[hsl(var(--e-border))] pt-2">
          <button type="button" aria-expanded={preparationOpen} aria-controls={preparationId}
            onClick={() => setPreparationOpen(open => !open)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--e-radius)] px-1 py-3 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
            Incoming stay preparation
            <ChevronDown aria-hidden className={`h-5 w-5 shrink-0 transition-transform motion-reduce:transition-none ${preparationOpen ? "rotate-180" : ""}`} />
          </button>
          <div id={preparationId} hidden={!preparationOpen} className="pt-3">
            <StayPreparationPanel {...preparation} embedded onError={showPreparationError} />
          </div>
        </section> : null}

        <dl className="grid gap-1.5 border-t border-[hsl(var(--e-border))] pt-3 text-[0.8125rem]">
          {checkout || checkin ? (
            <div className="flex items-start gap-1.5">
              <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-muted-foreground))]" />
              <span>
                {checkout ? <>Guests out {checkout}</> : null}
                {checkout && checkin ? " · " : ""}
                {checkin ? (
                  <>
                    next in <span className="font-[600]">{checkin}</span>
                  </>
                ) : null}
              </span>
            </div>
          ) : null}
          {reservation.guestName ? (
            <div className="flex items-start gap-1.5">
              <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-muted-foreground))]" />
              <span>{reservation.guestName}</span>
            </div>
          ) : null}
        </dl>
      </ECardBody>
    </ECard>
  );
}
