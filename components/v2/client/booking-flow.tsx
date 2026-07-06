"use client";

/**
 * Estate booking flow — reimplements the legacy BookingWizard steps with the
 * SAME endpoints and payloads:
 *   GET  /api/client/available-slots?propertyId=&serviceType=   → { available: string[] }
 *   POST /api/client/booking  { propertyId, jobType, scheduledDate, notes }
 */
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, Loader2 } from "lucide-react";
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
              <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {availableDates.map((date) => {
                  const active = selectedDate === date;
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setSelectedDate(date)}
                      className={cn(
                        "rounded-[var(--e-radius)] border px-4 py-3 text-left transition-colors duration-[160ms]",
                        active
                          ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))] shadow-[var(--e-elevation-1)]"
                          : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] hover:border-[hsl(var(--e-border-strong))]"
                      )}
                    >
                      <p className="e-numeral text-[1rem]">{formatSlot(date)}</p>
                      <p className="mt-0.5 text-[0.6875rem] uppercase tracking-[0.14em] text-[hsl(var(--e-text-faint))]">
                        {active ? "Selected" : "Available"}
                      </p>
                    </button>
                  );
                })}
              </div>
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
