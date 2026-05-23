"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Calendar, Clock, CheckCircle2 } from "lucide-react";

export default function ClientBookingPage() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      propertyId: formData.get("propertyId"),
      jobType: formData.get("jobType"),
      requestedDate: formData.get("requestedDate"),
      requestedTime: formData.get("requestedTime"),
      notes: formData.get("notes"),
    };

    try {
      const res = await fetch("/api/client/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to book cleaning");
      }

      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to book cleaning");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-6">
        <Card variant="outlined" className="border-success-500">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-success-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-text-primary mb-2">Booking Submitted!</h2>
            <p className="text-text-secondary mb-6">We&apos;ll confirm your booking within 24 hours.</p>
            <Button onClick={() => setSubmitted(false)}>Book Another</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Book a Clean</h1>
        <p className="text-text-secondary mt-1">Self-service booking for your properties</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">New Booking</CardTitle>
          <CardDescription>Select your property, service type, and preferred date</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">{error}</div>
            )}
            <Select name="propertyId" label="Property" options={[{ value: "prop_001", label: "Harbour View Apartment" }, { value: "prop_002", label: "Beach House" }]} placeholder="Select property" required />
            <Select name="jobType" label="Service Type" options={[{ value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" }, { value: "DEEP_CLEAN", label: "Deep Clean" }, { value: "GENERAL_CLEAN", label: "General Clean" }]} placeholder="Select service" required />
            <div className="grid grid-cols-2 gap-4">
              <Input name="requestedDate" label="Preferred Date" type="date" leftIcon={<Calendar className="h-4 w-4" />} required />
              <Input name="requestedTime" label="Preferred Time" type="time" leftIcon={<Clock className="h-4 w-4" />} />
            </div>
            <Textarea name="notes" label="Special Requests" placeholder="Any specific requirements or notes..." />
            <Button type="submit" className="w-full" loading={loading}>Book Now</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
