"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { ArrowRight, CheckCircle2, Star, Shield, Clock } from "lucide-react";

export default function QuotePage() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      serviceType: formData.get("serviceType"),
      address: formData.get("address"),
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
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-success-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-text-primary mb-2">Quote Request Submitted!</h2>
            <p className="text-text-secondary mb-6">We&apos;ll get back to you within 24 hours with a detailed quote.</p>
            <Button asChild><Link href="/">Back to Home</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-neutral-950/80 backdrop-blur border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
              <span className="text-sm font-bold text-white">S</span>
            </div>
            <span className="font-semibold text-text-primary">sNeek Property Service</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild><Link href="/login">Sign In</Link></Button>
          </div>
        </div>
      </header>

      <section className="py-16 lg:py-24 bg-gradient-to-b from-brand-50 to-white dark:from-neutral-900 dark:to-neutral-950">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-text-primary tracking-tight">Get a Free Quote</h1>
            <p className="mt-4 text-lg text-text-secondary">Tell us about your property and cleaning needs. We&apos;ll get back to you within 24 hours.</p>
          </div>

          <Card variant="outlined">
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
                    {error}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input name="name" label="Full Name" placeholder="John Doe" required />
                  <Input name="email" label="Email" type="email" placeholder="john@example.com" required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input name="phone" label="Phone" type="tel" placeholder="+61 400 000 000" />
                  <Select name="serviceType" label="Service Type" options={[
                    { value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" },
                    { value: "DEEP_CLEAN", label: "Deep Clean" },
                    { value: "END_OF_LEASE", label: "End of Lease" },
                    { value: "GENERAL_CLEAN", label: "General Clean" },
                    { value: "POST_CONSTRUCTION", label: "Post Construction" },
                    { value: "PRESSURE_WASH", label: "Pressure Wash" },
                    { value: "WINDOW_CLEAN", label: "Window Clean" },
                    { value: "OTHER", label: "Other" },
                  ]} placeholder="Select service" required />
                </div>
                <Input name="address" label="Property Address" placeholder="123 Harbour Street, Sydney NSW 2000" required />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <Input name="bedrooms" label="Bedrooms" type="number" min={1} placeholder="2" />
                  <Input name="bathrooms" label="Bathrooms" type="number" min={1} placeholder="1" />
                  <Select name="balcony" label="Balcony?" options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} placeholder="Select" />
                  <Select name="condition" label="Condition" options={[{ value: "light", label: "Light" }, { value: "standard", label: "Standard" }, { value: "heavy", label: "Heavy" }]} placeholder="Select" />
                </div>
                <Textarea name="notes" label="Additional Notes" placeholder="Any special requirements or requests..." />
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  Submit Quote Request
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-12">
            {[
              { icon: Clock, title: "24hr Response", desc: "We'll get back to you within 24 hours" },
              { icon: Shield, title: "No Obligation", desc: "Free quote with no commitment required" },
              { icon: Star, title: "Trusted Service", desc: "Hundreds of satisfied clients across Sydney" },
            ].map((feature) => (
              <div key={feature.title} className="text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-brand-100 dark:bg-brand-900/30 mb-3">
                  <feature.icon className="h-5 w-5 text-brand-600" />
                </div>
                <h3 className="font-semibold text-text-primary">{feature.title}</h3>
                <p className="text-sm text-text-secondary mt-1">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="py-12 border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
                <span className="text-sm font-bold text-white">S</span>
              </div>
              <span className="font-semibold text-text-primary">sNeek Property Service</span>
            </div>
            <p className="text-sm text-text-tertiary">&copy; {new Date().getFullYear()} sNeek Property Service. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
