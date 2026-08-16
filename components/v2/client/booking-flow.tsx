"use client";

/**
 * Estate booking flow — reimplements the legacy BookingWizard steps with the
 * SAME endpoints and payloads:
 *   GET  /api/client/available-slots?propertyId=&serviceType=   → { available: string[] }
 *   POST /api/client/booking  { propertyId, jobType, scheduledDate, notes }
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import type { MarketedJobTypeValue } from "@/lib/marketing/job-types";
import {
  EAlert,
  EButton,
  ECard,
  ECardBody,
  EEyebrow,
  EThread,
} from "@/components/v2/ui/primitives";
import { EInlineNotice, EInput, ELabel } from "@/components/v2/client/fields";
import { cn } from "@/lib/utils";

type PropertyOption = {
  id: string;
  name: string;
  suburb: string;
  bedrooms: number;
  bathrooms: number;
};

const BOOKABLE_SERVICES = MARKETED_SERVICES.filter((service) =>
  ["GENERAL_CLEAN", "DEEP_CLEAN", "END_OF_LEASE", "AIRBNB_TURNOVER", "SPRING_CLEANING"].includes(
    service.jobType
  )
);

const STEPS = [
  { n: 1, label: "Property & service" },
  { n: 2, label: "Choose a date" },
  { n: 3, label: "Confirm" },
] as const;

/**
 * Month calendar for picking a booking date.
 *
 * This replaced a flat grid of up to thirty buttons — one per bookable day —
 * which gave no sense of week, weekend or month, and grew unusable the moment
 * availability was wide. A calendar answers "which Saturday?" in one glance.
 *
 * Three states a day can be in, and they are NOT the same thing:
 *   - available      → in the window and not fully booked
 *   - fully booked   → in the window, absent from `availableDates`
 *   - out of window  → outside windowStart..windowEnd (we only take bookings
 *                      thirty days ahead)
 * The API returns only the available days, so without the window bounds every
 * surrounding day would render identically disabled with nothing to explain it.
 *
 * Dates are `yyyy-MM-dd` strings compared as strings — lexicographic order is
 * chronological for that format, which sidesteps timezone drift entirely. The
 * one place a Date is constructed uses a `T00:00:00` suffix so it is parsed as
 * local rather than UTC.
 */
function BookingCalendar({
  availableDates,
  windowStart,
  windowEnd,
  selectedDate,
  onSelect,
}: {
  availableDates: string[];
  windowStart: string;
  windowEnd: string;
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);

  // Start on the month of the first bookable day, so the client opens straight
  // onto dates they can actually pick.
  const [month, setMonth] = useState(() => {
    const anchor = availableDates[0] ?? windowStart;
    const parsed = anchor ? new Date(`${anchor}T00:00:00`) : new Date();
    return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  });

  const grid = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    // Monday-first, matching the rest of the portal's calendars.
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells: Array<{ key: string; day: number } | null> = [];
    for (let i = 0; i < lead; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cells.push({ key, day });
    }
    return cells;
  }, [month]);

  const monthLabel = format(month, "MMMM yyyy");
  // Only step within months that can contain bookable days.
  const canGoBack = windowStart ? `${format(month, "yyyy-MM")}-01` > windowStart.slice(0, 8) + "01" : true;
  const canGoForward = windowEnd
    ? `${format(month, "yyyy-MM")}-01` < windowEnd.slice(0, 8) + "01"
    : true;

  function step(delta: number) {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <EButton
          variant="ghost"
          size="sm"
          onClick={() => step(-1)}
          disabled={!canGoBack}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </EButton>
        <p className="text-[0.9375rem] font-[600]">{monthLabel}</p>
        <EButton
          variant="ghost"
          size="sm"
          onClick={() => step(1)}
          disabled={!canGoForward}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </EButton>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-text-faint))]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {grid.map((cell, index) => {
          if (!cell) return <span key={`pad-${index}`} />;
          const outOfWindow =
            (windowStart && cell.key < windowStart) || (windowEnd && cell.key > windowEnd);
          const available = availableSet.has(cell.key);
          const selected = selectedDate === cell.key;

          return (
            <button
              key={cell.key}
              type="button"
              disabled={!available}
              onClick={() => onSelect(cell.key)}
              title={
                available
                  ? "Available"
                  : outOfWindow
                    ? "Outside the booking window"
                    : "Fully booked"
              }
              className={cn(
                "aspect-square rounded-[var(--e-radius-sm)] border text-[0.875rem] transition-colors duration-[160ms]",
                selected
                  ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] font-[600] shadow-[var(--e-elevation-1)]"
                  : available
                    ? "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]"
                    : // Fully booked reads as struck through; outside the window
                      // simply fades, because there is nothing to reconsider.
                      cn(
                        "cursor-not-allowed border-transparent text-[hsl(var(--e-text-faint))]",
                        outOfWindow ? "opacity-40" : "line-through"
                      )
              )}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {selectedDate
          ? `Selected ${formatSlot(selectedDate)}`
          : "Pick a highlighted day. Struck-through days are fully booked."}
      </p>
    </div>
  );
}

function formatSlot(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : format(parsed, "EEE d MMM");
}

export function EstateBookingFlow({ properties }: { properties: PropertyOption[] }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [jobType, setJobType] = useState<MarketedJobTypeValue>(
    (BOOKABLE_SERVICES[0]?.jobType as MarketedJobTypeValue | undefined) ?? "GENERAL_CLEAN"
  );
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  // The bookable window, so the calendar can tell "fully booked" apart from
  // "outside the 30 days we take bookings for" — both are simply absent from
  // `availableDates`.
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [loadingDates, setLoadingDates] = useState(false);
  const [datesError, setDatesError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === propertyId) ?? null,
    [properties, propertyId]
  );
  const selectedService = useMemo(
    () => BOOKABLE_SERVICES.find((service) => service.jobType === jobType) ?? null,
    [jobType]
  );

  // Same availability fetch as the legacy wizard.
  useEffect(() => {
    if (!propertyId || !jobType) return;
    let active = true;
    setLoadingDates(true);
    setDatesError(null);
    fetch(
      `/api/client/available-slots?propertyId=${encodeURIComponent(propertyId)}&serviceType=${encodeURIComponent(jobType)}`,
      { cache: "no-store" }
    )
      .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
      .then(({ ok, body }) => {
        if (!active) return;
        if (!ok) throw new Error(body?.error ?? "Could not load booking dates.");
        const nextDates = Array.isArray(body?.available) ? body.available : [];
        setAvailableDates(nextDates);
        setWindowStart(typeof body?.windowStart === "string" ? body.windowStart : "");
        setWindowEnd(typeof body?.windowEnd === "string" ? body.windowEnd : "");
        setSelectedDate((current) => (nextDates.includes(current) ? current : nextDates[0] ?? ""));
      })
      .catch((error: any) => {
        if (!active) return;
        setAvailableDates([]);
        setSelectedDate("");
        setDatesError(error?.message ?? "Could not load booking dates.");
      })
      .finally(() => {
        if (active) setLoadingDates(false);
      });
    return () => {
      active = false;
    };
  }, [jobType, propertyId]);

  async function submitBooking() {
    if (!propertyId || !jobType || !selectedDate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/client/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, jobType, scheduledDate: selectedDate, notes }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not create booking.");
      setConfirmation(
        body.jobNumber
          ? `Job ${body.jobNumber} has been created for scheduling.`
          : "The team has been notified and will confirm timing."
      );
    } catch (error: any) {
      setSubmitError(error?.message ?? "Could not create booking.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setConfirmation(null);
    setNotes("");
    setSelectedDate("");
    setStep(1);
  }

  if (confirmation) {
    return (
      <ECard variant="ceremony">
        <ECardBody className="flex flex-col items-center gap-3 py-14 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-ink))]">
            <Check className="h-5 w-5" />
          </span>
          <EEyebrow>Request received</EEyebrow>
          <p className="e-display-sm">Your booking is with the team.</p>
          <p className="max-w-md text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{confirmation}</p>
          <div className="mt-2">
            <EButton variant="outline" size="sm" onClick={reset}>
              Book another service
            </EButton>
          </div>
        </ECardBody>
      </ECard>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stepper — numbered serif steps with a gold progress hairline */}
      <div>
        <ol className="flex items-center gap-0">
          {STEPS.map((item, index) => {
            const state = step === item.n ? "current" : step > item.n ? "done" : "todo";
            return (
              <li key={item.n} className={cn("flex items-center", index > 0 && "flex-1")}>
                {index > 0 ? (
                  <span
                    aria-hidden
                    className="mx-3 h-px flex-1 transition-colors duration-[240ms]"
                    style={{
                      background:
                        state === "todo"
                          ? "hsl(var(--e-border))"
                          : "linear-gradient(90deg, hsl(var(--e-gold)/0.7), hsl(var(--e-gold)))",
                    }}
                  />
                ) : null}
                <span className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "e-numeral flex h-9 w-9 items-center justify-center rounded-full border text-[1rem] transition-colors duration-[240ms]",
                      state === "current"
                        ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))] shadow-[var(--e-elevation-gold)]"
                        : state === "done"
                          ? "border-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-ink))]"
                          : "border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-text-faint))]"
                    )}
                  >
                    {state === "done" ? <Check className="h-4 w-4" /> : item.n}
                  </span>
                  <span
                    className={cn(
                      "hidden text-[0.6875rem] font-semibold uppercase tracking-[0.18em] sm:block",
                      state === "current"
                        ? "text-[hsl(var(--e-foreground))]"
                        : "text-[hsl(var(--e-text-faint))]"
                    )}
                  >
                    {item.label}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Step 1 — property + service */}
      {step === 1 ? (
        <ECard>
          <ECardBody className="space-y-6 pt-6">
            <div className="space-y-3">
              <EEyebrow>Property</EEyebrow>
              <div className="grid gap-3 sm:grid-cols-2">
                {properties.map((property) => {
                  const active = property.id === propertyId;
                  return (
                    <button
                      key={property.id}
                      type="button"
                      onClick={() => setPropertyId(property.id)}
                      className={cn(
                        "rounded-[var(--e-radius)] border p-4 text-left transition-colors duration-[160ms]",
                        active
                          ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] shadow-[var(--e-elevation-1)]"
                          : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]"
                      )}
                    >
                      <p className="text-[0.875rem] font-semibold">{property.name}</p>
                      <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {property.suburb} · {property.bedrooms} bed · {property.bathrooms} bath
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <EThread />

            <div className="space-y-3">
              <EEyebrow>Service</EEyebrow>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {BOOKABLE_SERVICES.map((service) => {
                  const active = service.jobType === jobType;
                  return (
                    <button
                      key={service.jobType}
                      type="button"
                      onClick={() => setJobType(service.jobType as MarketedJobTypeValue)}
                      className={cn(
                        "rounded-[var(--e-radius)] border p-4 text-left transition-colors duration-[160ms]",
                        active
                          ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] shadow-[var(--e-elevation-1)]"
                          : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]"
                      )}
                    >
                      <p className="e-serif text-[1rem] leading-tight">{service.shortLabel}</p>
                      <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {service.tagline}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end">
              <EButton variant="gold" onClick={() => setStep(2)} disabled={!propertyId || !jobType}>
                Continue
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      {/* Step 2 — date */}
      {step === 2 ? (
        <ECard>
          <ECardBody className="space-y-5 pt-6">
            <div>
              <EEyebrow>Available dates</EEyebrow>
              <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                {selectedProperty?.name} · {selectedService?.shortLabel ?? jobType}
              </p>
            </div>

            {loadingDates ? (
              <div className="flex items-center gap-2 py-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                <Loader2 className="h-4 w-4 animate-spin" /> Checking the calendar…
              </div>
            ) : availableDates.length === 0 ? (
              <EAlert tone="info" title="No open dates right now">
                Try another service type or check again shortly — availability refreshes as the run
                sheet changes.
              </EAlert>
            ) : (
              <BookingCalendar
                availableDates={availableDates}
                windowStart={windowStart}
                windowEnd={windowEnd}
                selectedDate={selectedDate}
                onSelect={setSelectedDate}
              />
            )}
            {datesError ? <EInlineNotice tone="danger">{datesError}</EInlineNotice> : null}

            <div className="flex justify-between">
              <EButton variant="outline" onClick={() => setStep(1)}>
                Back
              </EButton>
              <EButton variant="gold" onClick={() => setStep(3)} disabled={!selectedDate}>
                Continue
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      ) : null}

      {/* Step 3 — confirm */}
      {step === 3 ? (
        <ECard variant="ceremony">
          <ECardBody className="space-y-5 pt-6">
            <EEyebrow>Confirm your request</EEyebrow>

            <dl className="space-y-0">
              {[
                { label: "Property", value: selectedProperty?.name ?? "—" },
                { label: "Service", value: selectedService?.label ?? jobType },
                { label: "Date", value: selectedDate ? formatSlot(selectedDate) : "—", serif: true },
              ].map((row, i) => (
                <div key={row.label}>
                  {i > 0 ? <EThread className="my-2.5" /> : null}
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-muted-foreground))]">
                      {row.label}
                    </dt>
                    <dd className={cn("text-right text-[0.9375rem]", row.serif && "e-numeral text-[1.0625rem]")}>
                      {row.value}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>

            <div className="space-y-1.5">
              <ELabel htmlFor="booking-notes">Special instructions</ELabel>
              <EInput
                id="booking-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Access, guest timing, or anything the team should know"
              />
            </div>

            <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              The team reviews capacity and confirms the exact run sheet after your request is in.
            </p>

            {submitError ? <EInlineNotice tone="danger">{submitError}</EInlineNotice> : null}

            <div className="flex justify-between">
              <EButton variant="outline" onClick={() => setStep(2)} disabled={submitting}>
                Back
              </EButton>
              <EButton variant="gold" onClick={submitBooking} disabled={submitting || !selectedDate}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {submitting ? "Sending…" : "Confirm booking"}
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}
