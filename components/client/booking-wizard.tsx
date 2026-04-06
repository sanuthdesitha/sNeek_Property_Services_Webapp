"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import type { MarketedJobTypeValue } from "@/lib/marketing/job-types";
import { toast } from "@/hooks/use-toast";

type PropertyOption = {
  id: string;
  name: string;
  suburb: string;
  bedrooms: number;
  bathrooms: number;
};

const BOOKABLE_SERVICES = MARKETED_SERVICES.filter((service) =>
  ["GENERAL_CLEAN", "DEEP_CLEAN", "END_OF_LEASE", "AIRBNB_TURNOVER", "SPRING_CLEANING"].includes(service.jobType)
);

export function BookingWizard({ properties }: { properties: PropertyOption[] }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const [jobType, setJobType] = useState<MarketedJobTypeValue>(
    (BOOKABLE_SERVICES[0]?.jobType as MarketedJobTypeValue | undefined) ?? "GENERAL_CLEAN"
  );
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loadingDates, setLoadingDates] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedProperty = useMemo(
    () => properties.find((property) => property.id === propertyId) ?? null,
    [properties, propertyId]
  );

  useEffect(() => {
    if (!propertyId || !jobType) return;
    let active = true;
    setLoadingDates(true);
    fetch(`/api/client/available-slots?propertyId=${encodeURIComponent(propertyId)}&serviceType=${encodeURIComponent(jobType)}`, {
      cache: "no-store",
    })
      .then((response) => response.json().then((body) => ({ ok: response.ok, body })))
      .then(({ ok, body }) => {
        if (!active) return;
        if (!ok) {
          throw new Error(body?.error ?? "Could not load booking dates.");
        }
        const nextDates = Array.isArray(body?.available) ? body.available : [];
        setAvailableDates(nextDates);
        if (!nextDates.includes(selectedDate)) {
          setSelectedDate(nextDates[0] ?? "");
        }
      })
      .catch((error: any) => {
        if (!active) return;
        setAvailableDates([]);
        setSelectedDate("");
        toast({
          title: "Availability load failed",
          description: error?.message ?? "Could not load booking dates.",
          variant: "destructive",
        });
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
    try {
      const response = await fetch("/api/client/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          jobType,
          scheduledDate: selectedDate,
          notes,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "Could not create booking.");
      }
      toast({
        title: "Booking request created",
        description: body.jobNumber ? `Job ${body.jobNumber} has been created for admin scheduling.` : "Admin has been notified.",
      });
      setStep(1);
      setNotes("");
    } catch (error: any) {
      toast({
        title: "Booking failed",
        description: error?.message ?? "Could not create booking.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Book a service</h1>
        <p className="text-sm text-muted-foreground">
          Choose the property, service, and preferred date. Admin will confirm timing once the booking is created.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { value: 1, label: "Property & service" },
          { value: 2, label: "Choose a date" },
          { value: 3, label: "Confirm details" },
        ].map((item) => (
          <Card key={item.value} className={step === item.value ? "border-primary/40" : ""}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className={`flex h-9 w-9 items-center justify-center rounded-2xl ${step === item.value ? "bg-primary text-white" : "bg-primary/10 text-primary"}`}>
                {item.value}
              </div>
              <p className="text-sm font-medium">{item.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Step 1</CardTitle>
            <CardDescription>Select a property and service type.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Property</Label>
              <select
                className="flex h-11 w-full rounded-2xl border border-input bg-background px-3 text-sm"
                value={propertyId}
                onChange={(event) => setPropertyId(event.target.value)}
              >
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name} • {property.suburb}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Service</Label>
              <select
                className="flex h-11 w-full rounded-2xl border border-input bg-background px-3 text-sm"
                value={jobType}
                onChange={(event) => setJobType(event.target.value as MarketedJobTypeValue)}
              >
                {BOOKABLE_SERVICES.map((service) => (
                  <option key={service.jobType} value={service.jobType}>
                    {service.label}
                  </option>
                ))}
              </select>
            </div>
            {selectedProperty ? (
              <div className="rounded-2xl border bg-muted/30 p-4 text-sm md:col-span-2">
                <p className="font-medium">{selectedProperty.name}</p>
                <p className="text-muted-foreground">
                  {selectedProperty.suburb} • {selectedProperty.bedrooms} bed • {selectedProperty.bathrooms} bath
                </p>
              </div>
            ) : null}
            <div className="md:col-span-2 flex justify-end">
              <Button onClick={() => setStep(2)} disabled={!propertyId || !jobType}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>Step 2</CardTitle>
            <CardDescription>Pick from the next available booking dates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingDates ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading dates...
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {availableDates.map((date) => (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setSelectedDate(date)}
                    className={`rounded-2xl border px-4 py-3 text-left text-sm transition-colors ${
                      selectedDate === date ? "border-primary bg-primary/10 text-primary" : "bg-white hover:border-primary/30"
                    }`}
                  >
                    <p className="font-medium">{date}</p>
                    <p className="text-xs text-muted-foreground">Available</p>
                  </button>
                ))}
              </div>
            )}
            {!loadingDates && availableDates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No dates are open right now. Try another service type or check again shortly.</p>
            ) : null}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => setStep(3)} disabled={!selectedDate}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle>Step 3</CardTitle>
            <CardDescription>Confirm the booking details before sending.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border bg-muted/30 p-4 text-sm">
              <p><strong>Property:</strong> {selectedProperty?.name ?? "-"}</p>
              <p><strong>Service:</strong> {BOOKABLE_SERVICES.find((service) => service.jobType === jobType)?.label ?? jobType}</p>
              <p><strong>Date:</strong> {selectedDate || "-"}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Special instructions</Label>
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Access, guest timing, or anything the team should know" />
            </div>
            <div className="rounded-2xl border border-primary/20 bg-primary/6 p-4 text-sm text-primary">
              <p className="flex items-center gap-2 font-medium">
                <Sparkles className="h-4 w-4" />
                Admin will review capacity and confirm the exact run sheet.
              </p>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)} disabled={submitting}>
                Back
              </Button>
              <Button onClick={submitBooking} disabled={submitting || !selectedDate}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Confirm booking
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
