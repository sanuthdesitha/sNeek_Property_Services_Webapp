"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { ArrowRight, CheckCircle2 } from "lucide-react";

export default function ClientQuotePage() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      jobType: formData.get("jobType"),
      bedrooms: parseInt(formData.get("bedrooms") as string) || null,
      bathrooms: parseInt(formData.get("bathrooms") as string) || null,
      hasBalcony: formData.get("balcony") === "yes",
      condition: formData.get("condition") || "standard",
      notes: formData.get("notes"),
    };

    try {
      const res = await fetch("/api/client/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to submit quote request");
      }

      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit quote request");
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
            <h2 className="text-2xl font-bold text-text-primary mb-2">Quote Request Submitted!</h2>
            <p className="text-text-secondary mb-6">We&apos;ll prepare a custom quote for you.</p>
            <Button onClick={() => setSubmitted(false)}>Request Another Quote</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Request a Quote</h1>
        <p className="text-text-secondary mt-1">Get a custom quote for your cleaning needs</p>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Quote Request</CardTitle>
          <CardDescription>Tell us about your cleaning requirements</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">{error}</div>
            )}
            <Select name="jobType" label="Service Type" options={[{ value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" }, { value: "DEEP_CLEAN", label: "Deep Clean" }, { value: "END_OF_LEASE", label: "End of Lease" }, { value: "GENERAL_CLEAN", label: "General Clean" }]} placeholder="Select service" required />
            <Input name="address" label="Property Address" placeholder="123 Harbour Street, Sydney NSW 2000" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Input name="bedrooms" label="Bedrooms" type="number" min={1} placeholder="2" />
              <Input name="bathrooms" label="Bathrooms" type="number" min={1} placeholder="1" />
              <Select name="balcony" label="Balcony?" options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} placeholder="Select" />
              <Select name="condition" label="Condition" options={[{ value: "light", label: "Light" }, { value: "standard", label: "Standard" }, { value: "heavy", label: "Heavy" }]} placeholder="Select" />
            </div>
            <Textarea name="notes" label="Additional Notes" placeholder="Any special requirements or requests..." />
            <Button type="submit" className="w-full" size="lg" loading={loading}>Submit Quote Request<ArrowRight className="h-4 w-4 ml-2" /></Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
