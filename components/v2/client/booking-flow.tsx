"use client";

/**
 * Estate booking flow — reimplements the legacy BookingWizard steps with the
 * SAME endpoints and payloads:
 *   GET  /api/client/available-slots?propertyId=&serviceType=   → { available: string[] }
 *   POST /api/client/booking  { propertyId, jobType, scheduledDate, notes }
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { BOOKABLE_SERVICES, type RebookSeed } from "@/lib/booking/rebook";
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
import { loadBookingDraft, saveBookingDraft, removeBookingDraft, type BookingDraft } from "@/lib/booking/draft-session";
import { BookingReviewDetails } from "@/components/v2/client/booking-review-details";

type PropertyOption = {
  id: string;
  name: string;
  suburb: string;
  bedrooms: number;
  bathrooms: number;
};

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

type BookingFlowProps = {
  properties: PropertyOption[];
  actorName: string;
  actingFor: string;
  draftScope?: string;
  rebook?: RebookSeed;
};

export function EstateBookingFlow(props: BookingFlowProps) {
  const [recovery, setRecovery] = useState<{ scope: string; result: ReturnType<typeof loadBookingDraft> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (props.draftScope) setRecovery({ scope: props.draftScope, result: loadBookingDraft(props.draftScope) });
  }, [props.draftScope, attempt]);
  if (!props.draftScope) return <BookingFlowBody {...props} />;
  if (!recovery || recovery.scope !== props.draftScope) return <p role="status">Checking saved booking...</p>;
  const draft = recovery.result.draft;
  const invalidOptions = draft && (!props.properties.some(property => property.id === draft.propertyId) ||
    !BOOKABLE_SERVICES.some(service => service.jobType === draft.jobType));
  if (invalidOptions || ["invalid", "unavailable"].includes(recovery.result.status)) return (
    <EAlert tone="danger" title="Saved booking unavailable">
      <p>The saved booking could not be verified. No request has been sent from this page. Check any earlier request with the team before starting again.</p>
      <EButton variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry recovery</EButton>
    </EAlert>
  );
  return <BookingFlowBody key={props.draftScope} {...props} initialDraft={draft} />;
}

function BookingFlowBody({ properties, actorName, actingFor, draftScope, initialDraft, rebook }: BookingFlowProps & { initialDraft?: BookingDraft }) {
  const [step, setStep] = useState<1 | 2 | 3>(initialDraft?.request ? 3 : initialDraft?.step ?? 1);
  const [propertyId, setPropertyId] = useState(initialDraft?.propertyId ?? rebook?.propertyId ?? properties[0]?.id ?? "");
  const [jobType, setJobType] = useState<MarketedJobTypeValue>(
    (initialDraft?.jobType as MarketedJobTypeValue | undefined) ?? (rebook?.jobType as MarketedJobTypeValue | undefined) ?? (BOOKABLE_SERVICES[0]?.jobType as MarketedJobTypeValue | undefined) ?? "GENERAL_CLEAN"
  );
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState(initialDraft?.scheduledDate ?? "");
  const restoredDate = useRef(initialDraft?.scheduledDate);
  // The bookable window, so the calendar can tell "fully booked" apart from
  // "outside the 30 days we take bookings for" — both are simply absent from
  // `availableDates`.
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [notes, setNotes] = useState(initialDraft?.notes ?? "");
  const [saveFailed, setSaveFailed] = useState(false);
  const [loadingDates, setLoadingDates] = useState(false);
  const [datesError, setDatesError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(initialDraft?.request && !initialDraft.confirmedRequestId
    ? "An earlier request has not been confirmed. Retry request to check or send that same booking." : null);
  const [confirmation, setConfirmation] = useState<string | null>(initialDraft?.confirmedRequestId ? "The team will confirm your date once they have checked availability." : null);
  const confirmedRequest = useRef(initialDraft?.confirmedRequestId);
  const [submitBlocked, setSubmitBlocked] = useState(false);
  const submitLock = useRef(false);
  const submittedRequest = useRef<{ key: string; payload: string } | null>(initialDraft?.request ?? null);
  const [retryAvailable, setRetryAvailable] = useState(!!initialDraft?.request && !initialDraft.confirmedRequestId);
  const draftFrozen = submitting || submitBlocked || submittedRequest.current !== null;
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const availabilityKey = JSON.stringify([propertyId, jobType, availabilityVersion]);
  const datesReady = loadedFor === availabilityKey && !loadingDates && !datesError;
  const canReview = datesReady && availableDates.includes(selectedDate) &&
    properties.some((property) => property.id === propertyId);

  function persistDraft() {
    if (!draftScope) return true;
    const saved = saveBookingDraft(draftScope, {
      propertyId, jobType, scheduledDate: selectedDate, notes, step,
      ...(submittedRequest.current ? { request: submittedRequest.current } : {}),
      ...(confirmedRequest.current ? { confirmedRequestId: confirmedRequest.current } : {}),
    });
    setSaveFailed(!saved);
    return saved;
  }
  useEffect(() => { persistDraft(); }, [draftScope, propertyId, jobType, selectedDate, notes, step, submitting, confirmation]);

  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === propertyId) ?? null,
    [properties, propertyId]
  );
  const selectedService = useMemo(
    () => BOOKABLE_SERVICES.find((service) => service.jobType === jobType) ?? null,
    [jobType]
  );

  useEffect(() => {
    if (!propertyId || !jobType || submittedRequest.current) return;
    let active = true;
    const controller = new AbortController();
    setLoadedFor(null);
    setAvailableDates([]);
    if (restoredDate.current === undefined) setSelectedDate("");
    setWindowStart("");
    setWindowEnd("");
    setLoadingDates(true);
    setDatesError(null);
    setAccessDenied(false);
    fetch(
      `/api/client/available-slots?propertyId=${encodeURIComponent(propertyId)}&serviceType=${encodeURIComponent(jobType)}`,
      { cache: "no-store", signal: controller.signal }
    )
      .then(async (response) => ({
        ok: response.ok, status: response.status, body: await response.json().catch(() => null),
      }))
      .then(({ ok, status, body }) => {
        if (!active) return;
        if (status === 401 || status === 403) {
          setAccessDenied(true);
          throw new Error("Your booking access could not be verified. Reload the page to check your account.");
        }
        if (!ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not load booking dates.");
        const isDate = (value: unknown): value is string => {
          if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
          const parsed = new Date(`${value}T00:00:00Z`);
          return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
        };
        if (!Array.isArray(body?.available) || !body.available.every(isDate) ||
          !isDate(body.windowStart) || !isDate(body.windowEnd) || body.windowStart > body.windowEnd ||
          body.available.some((date: string) => date < body.windowStart || date > body.windowEnd)) {
          throw new Error("Could not load booking dates. Please try again.");
        }
        const nextDates = Array.from(new Set<string>(body.available)).sort();
        setAvailableDates(nextDates);
        setWindowStart(typeof body?.windowStart === "string" ? body.windowStart : "");
        setWindowEnd(typeof body?.windowEnd === "string" ? body.windowEnd : "");
        const preferredDate = restoredDate.current;
        restoredDate.current = undefined;
        setSelectedDate((current) => preferredDate !== undefined
          ? nextDates.includes(preferredDate) ? preferredDate : ""
          : nextDates.includes(current) ? current : nextDates[0] ?? "");
        setLoadedFor(availabilityKey);
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
      controller.abort();
    };
  }, [jobType, propertyId, availabilityKey]);

  function refreshDates() {
    setSelectedDate("");
    setLoadedFor(null);
    setSubmitError(null);
    setAvailabilityVersion((version) => version + 1);
  }

  async function submitBooking(retry = false) {
    if (submitLock.current || submitBlocked || confirmation) return;
    if (retry ? !retryAvailable || !submittedRequest.current : submittedRequest.current || !canReview || !selectedService) return;
    submitLock.current = true;
    if (!submittedRequest.current) {
      try {
        submittedRequest.current = {
          key: globalThis.crypto.randomUUID(),
          payload: JSON.stringify({ propertyId, jobType, scheduledDate: selectedDate, notes }),
        };
      } catch {
        setSubmitBlocked(true);
        setSubmitError("No request was sent. Secure request identification is unavailable in this browser. Open this page over HTTPS in a supported browser, then reload booking.");
        return;
      }
    }
    if (!persistDraft()) {
      submitLock.current = false;
      setSubmitBlocked(true);
      setSubmitError("No request was sent. This tab could not save its recovery key. Restore browser storage and reload booking.");
      return;
    }
    setSubmitting(true);
    setRetryAvailable(false);
    setSubmitError(null);
    try {
      const response = await fetch("/api/client/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": submittedRequest.current.key },
        body: submittedRequest.current.payload,
      });
      if ([401, 403, 404, 409].includes(response.status)) {
        setAccessDenied(true);
        setSubmitBlocked(true);
        setSubmitError(response.status === 409
          ? "This request conflicts with an existing booking request or account context. Reload the page before making a booking."
          : "Your account or property access could not be verified. Reload the page before making a booking.");
        return;
      }
      const body = await response.json().catch(() => null);
      if (!body || (response.ok && (body.ok !== true || typeof body.requestId !== "string" || !body.requestId))) {
        throw new Error("We could not verify whether your request was received. Check with the team before trying again.");
      }
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not create booking.");
      confirmedRequest.current = body.requestId;
      persistDraft();
      // No job number to quote any more, and saying one existed would be a
      // lie: the booking is a request until the office approves it against
      // the team roster.
      setConfirmation(
        "The team will confirm your date once they have checked availability."
      );
    } catch {
      // Retain the exact wire payload and key: the request may already be committed.
      setRetryAvailable(true);
      setSubmitError("We could not verify whether your request was received. Retry request to check or send the same booking. Your draft is locked until this is resolved.");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  function reset() {
    if (draftScope && !removeBookingDraft(draftScope)) { setSaveFailed(true); return; }
    submitLock.current = false;
    submittedRequest.current = null;
    confirmedRequest.current = undefined;
    restoredDate.current = undefined;
    setRetryAvailable(false);
    setSubmitBlocked(false);
    setConfirmation(null);
    setNotes("");
    setSelectedDate("");
    setStep(1);
    refreshDates();
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
          {saveFailed ? <EInlineNotice tone="danger">The recovery record could not be updated. Restore browser storage before starting another booking.</EInlineNotice> : null}
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
      {draftScope ? <p role="status" className="text-sm">{saveFailed ? "Booking recovery is not saved in this tab." : "Booking recovery saved in this tab."}</p> : null}
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
                      onClick={() => {
                        if (property.id !== propertyId) { setPropertyId(property.id); refreshDates(); }
                      }}
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
                      onClick={() => {
                        if (service.jobType !== jobType) {
                          setJobType(service.jobType as MarketedJobTypeValue);
                          refreshDates();
                        }
                      }}
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

            {datesError ? (
              <EInlineNotice tone="danger">{datesError}</EInlineNotice>
            ) : !datesReady ? (
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
            {accessDenied ? <a href="/v2/client/booking" className="underline">Reload booking</a> : null}
            {(!accessDenied && (datesError || (datesReady && availableDates.length === 0))) ? (
              <EButton variant="outline" onClick={refreshDates}>Retry availability</EButton>
            ) : null}

            <div className="flex justify-between">
              <EButton variant="outline" onClick={() => setStep(1)}>
                Back
              </EButton>
              <EButton variant="gold" onClick={() => { if (canReview) setStep(3); }} disabled={!canReview}>
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
                { label: "Requested by", value: actorName },
                { label: "Acting for", value: actingFor },
                { label: "Property", value: selectedProperty?.name ?? "—" },
                { label: "Service", value: selectedService?.label ?? jobType },
                { label: "Date", value: selectedDate ? format(new Date(`${selectedDate}T00:00:00`), "EEE d MMM yyyy") : "—", serif: true },
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
                maxLength={4000}
                disabled={draftFrozen}
                onChange={(event) => { if (!draftFrozen) setNotes(event.target.value); }}
                placeholder="Access, guest timing, or anything the team should know"
              />
            </div>

            {!submittedRequest.current ? <BookingReviewDetails propertyId={propertyId} serviceType={jobType} /> : (
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                The team reviews capacity and confirms the exact run sheet after your request is in.
              </p>
            )}
            {submitError ? <EInlineNotice tone="danger">{submitError}</EInlineNotice> : null}
            {submitBlocked ? (
              <a href="/v2/client/booking" className="underline">Reload booking</a>
            ) : null}

            <div className="flex justify-between">
              <EButton variant="outline" onClick={() => setStep(2)} disabled={draftFrozen}>
                Back
              </EButton>
              <EButton variant="gold" onClick={() => submitBooking(retryAvailable)} disabled={submitting || submitBlocked || (!retryAvailable && !canReview)}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {submitting ? "Sending…" : retryAvailable ? "Retry request" : "Confirm booking"}
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}
