"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { EButton } from "@/components/v2/ui/primitives";

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable();
const responseSchema = z.object({
  propertyId: z.string(), serviceType: z.string(),
  pricing: z.discriminatedUnion("state", [
    z.object({ state: z.literal("estimate"), total: z.number().finite().nonnegative(), gst: z.number().finite().nonnegative() }),
    z.object({ state: z.literal("hidden") }), z.object({ state: z.literal("unavailable") }),
  ]),
  timing: z.object({ checkin: time, checkout: time, source: z.enum(["PROPERTY", "ICAL"]).nullable() }),
  access: z.object({ recorded: z.boolean() }),
});
type Details = z.infer<typeof responseSchema>;
const money = (amount: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(amount);

export function BookingReviewDetails({ propertyId, serviceType }: { propertyId: string; serviceType: string }) {
  const identity = JSON.stringify([propertyId, serviceType]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ identity: string; data?: Details; error?: boolean }>({ identity: "" });
  useEffect(() => {
    const refresh = () => setAttempt(value => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    setState({ identity });
    void (async () => {
      try {
        const response = await fetch(`/api/client/booking-review?${new URLSearchParams({ propertyId, serviceType })}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Review unavailable");
        const data = responseSchema.parse(await response.json());
        if (data.propertyId !== propertyId || data.serviceType !== serviceType) throw new Error("Review context changed");
        if (!disposed) setState({ identity, data });
      } catch { if (!disposed) setState({ identity, error: true }); }
    })();
    return () => { disposed = true; controller.abort(); };
  }, [identity, propertyId, serviceType, attempt]);
  const data = state.identity === identity ? state.data : undefined;
  const error = state.identity === identity && state.error;
  const service = MARKETED_SERVICES.find(item => item.jobType === serviceType);
  return <section aria-label="Booking details" className="space-y-4 border-t border-[hsl(var(--e-border))] pt-4 text-sm [overflow-wrap:anywhere]">
    <div><h3 className="font-semibold">Service overview</h3><p className="mt-1 text-[hsl(var(--e-muted-foreground))]">{service?.summary ?? "Service scope will be confirmed by the team."}</p></div>
    {!data && !error ? <p role="status">Checking property and estimate...</p> : null}
    {error ? <div role="alert"><p>Property and estimate details are unavailable.</p><EButton variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry review details</EButton></div> : null}
    {data ? <>
      <div><h3 className="font-semibold">Access readiness</h3><p className="mt-1">{data.access.recorded ? "Access instructions recorded" : "Access instructions not recorded"}</p><p className="mt-1 text-[hsl(var(--e-muted-foreground))]">Access must be confirmed before the visit.</p></div>
      <div><h3 className="font-semibold">Timing</h3>
        {serviceType === "AIRBNB_TURNOVER" ? <>
          <p className="mt-1">Default guest checkout: {data.timing.checkout ?? "Not recorded"}</p>
          <p>Default guest check-in: {data.timing.checkin ?? "Not recorded"}</p>
          <p className="mt-1 text-[hsl(var(--e-muted-foreground))]">{data.timing.source === "ICAL" ? "Reservation times are checked when scheduling. " : ""}These are guest timings, not a confirmed cleaning appointment.</p>
        </> : <p className="mt-1">The team will confirm the cleaning arrival window.</p>}
      </div>
      <div><h3 className="font-semibold">Estimated service price</h3>
        {data.pricing.state === "estimate" ? <>
          <p className="mt-1 text-lg font-semibold">{money(data.pricing.total)}</p>
          <p className="text-[hsl(var(--e-muted-foreground))]">GST component: {money(data.pricing.gst)}</p>
          <p className="mt-1 text-[hsl(var(--e-muted-foreground))]">Based on the selected service and recorded bedrooms and bathrooms. Extra work and final scope require review; this is not a confirmed quote.</p>
        </> : <p className="mt-1">{data.pricing.state === "hidden" ? "Pricing is not available to this account." : "An estimate is unavailable. The team must confirm pricing."}</p>}
        {data.pricing.state === "unavailable" ? <EButton variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry estimate</EButton> : null}
      </div>
    </> : null}
    <p className="text-[hsl(var(--e-muted-foreground))]">This is a booking request. The team reviews capacity and confirms the schedule before a job is created.</p>
  </section>;
}
