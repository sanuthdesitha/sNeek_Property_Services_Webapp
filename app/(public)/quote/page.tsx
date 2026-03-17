"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const SERVICE_TYPES = [
  { value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" },
  { value: "DEEP_CLEAN", label: "Deep Clean" },
  { value: "END_OF_LEASE", label: "End of Lease" },
  { value: "GENERAL_CLEAN", label: "General Clean" },
];

export default function PublicQuotePage() {
  const [step, setStep] = useState<"calc" | "lead">("calc");
  const [form, setForm] = useState({
    serviceType: "AIRBNB_TURNOVER",
    bedrooms: "2",
    bathrooms: "1",
    hasBalcony: false,
    oven: false,
    fridge: false,
    heavyMess: false,
    sameDay: false,
    conditionLevel: "standard",
  });
  const [result, setResult] = useState<any>(null);
  const [manualQuoteRequired, setManualQuoteRequired] = useState(false);
  const [lead, setLead] = useState({ name: "", email: "", phone: "", address: "", suburb: "" });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function calculate() {
    setLoading(true);
    try {
      const res = await fetch("/api/public/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceType: form.serviceType,
          bedrooms: parseInt(form.bedrooms),
          bathrooms: parseInt(form.bathrooms),
          hasBalcony: form.hasBalcony,
          addOns: { oven: form.oven, fridge: form.fridge, heavyMess: form.heavyMess, sameDay: form.sameDay },
          conditionLevel: form.conditionLevel,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body?.requiresManualQuote) {
          setManualQuoteRequired(true);
          setResult(null);
          setStep("lead");
          toast({
            title: "Manual quote required",
            description: "No automatic price is available. Send your details and admin will prepare a quote.",
          });
        } else {
          toast({ title: body?.error ?? "No price found for those options", variant: "destructive" });
        }
      } else {
        setManualQuoteRequired(false);
        setResult(body);
        setStep("lead");
      }
    } finally { setLoading(false); }
  }

  async function submitLead() {
    setLoading(true);
    await fetch("/api/public/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serviceType: form.serviceType,
        ...lead,
        bedrooms: parseInt(form.bedrooms),
        bathrooms: parseInt(form.bathrooms),
        hasBalcony: form.hasBalcony,
        estimateMin: result?.subtotal,
        estimateMax: result?.total,
        notes: [
          lead.address ? `Address: ${lead.address}` : "",
          manualQuoteRequired ? "Manual quote required: no automatic price match found." : "",
          result?.requiresAdminApproval ? "Estimate shown to customer; final quote requires admin approval." : "",
        ]
          .filter(Boolean)
          .join("\n"),
      }),
    });
    setLoading(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-brand-50 to-brand-100">
        <Card className="max-w-md w-full text-center">
          <CardContent className="pt-10 pb-10 space-y-4">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <span className="text-3xl">✓</span>
            </div>
            <h2 className="text-xl font-bold">Thanks, {lead.name.split(" ")[0]}!</h2>
            <p className="text-muted-foreground">We've received your request. A member of our team will be in touch within 24 hours.</p>
            <p className="text-2xl font-bold text-primary">
              {manualQuoteRequired ? "Manual Quote" : formatCurrency(result?.total)}
            </p>
            <p className="text-sm text-muted-foreground">
              {manualQuoteRequired ? "Admin will confirm pricing after review." : "Estimate only (final quote requires admin approval)"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-brand-100 py-12 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center">
          <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center mx-auto mb-4">
            <span className="text-white font-bold text-xl">S</span>
          </div>
          <h1 className="text-3xl font-bold">Get an Instant Quote</h1>
          <p className="text-muted-foreground mt-2">Professional cleaning services across Sydney</p>
        </div>

        {step === "calc" ? (
          <Card>
            <CardHeader>
              <CardTitle>Tell us about the space</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Service Type</Label>
                <Select value={form.serviceType} onValueChange={v => setForm(f => ({ ...f, serviceType: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_TYPES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Bedrooms</Label>
                  <Select value={form.bedrooms} onValueChange={v => setForm(f => ({ ...f, bedrooms: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Bathrooms</Label>
                  <Select value={form.bathrooms} onValueChange={v => setForm(f => ({ ...f, bathrooms: v }))}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Add-ons</Label>
                <div className="space-y-2">
                  {[
                    { key: "hasBalcony", label: "Balcony" },
                    { key: "oven", label: "Oven clean" },
                    { key: "fridge", label: "Fridge clean" },
                    { key: "heavyMess", label: "Heavy mess" },
                    { key: "sameDay", label: "Same-day booking" },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-2">
                      <Checkbox
                        id={key}
                        checked={(form as any)[key]}
                        onCheckedChange={v => setForm(f => ({ ...f, [key]: !!v }))}
                      />
                      <Label htmlFor={key} className="cursor-pointer">{label}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <Button className="w-full" onClick={calculate} disabled={loading}>
                {loading ? "Calculating…" : "Get my estimate →"}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Result */}
            <Card className="border-primary">
              <CardContent className="pt-6 text-center space-y-1">
                <p className="text-sm text-muted-foreground">Your estimate</p>
                <p className="text-4xl font-bold text-primary">
                  {manualQuoteRequired ? "Manual Quote" : formatCurrency(result?.total ?? 0)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {manualQuoteRequired
                    ? "No auto-price found. Admin will review and send a formal quote."
                    : `Includes GST (${formatCurrency(result?.gst ?? 0)})`}
                </p>
                {!manualQuoteRequired ? (
                  <p className="text-xs text-muted-foreground">
                    Estimate only. Final quote is subject to admin approval and scope confirmation.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {/* Lead capture */}
            <Card>
              <CardHeader>
                <CardTitle>Book or enquire</CardTitle>
                <CardDescription>We'll confirm availability and contact you shortly.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { id: "name", label: "Full name", type: "text", placeholder: "Jane Smith" },
                  { id: "email", label: "Email", type: "email", placeholder: "jane@example.com" },
                  { id: "phone", label: "Phone", type: "tel", placeholder: "+61 4XX XXX XXX" },
                  { id: "suburb", label: "Suburb", type: "text", placeholder: "Bondi Beach" },
                  { id: "address", label: "Address (optional)", type: "text", placeholder: "42 Example St" },
                ].map(f => (
                  <div key={f.id}>
                    <Label>{f.label}</Label>
                    <Input
                      type={f.type}
                      placeholder={f.placeholder}
                      className="mt-1"
                      value={(lead as any)[f.id]}
                      onChange={e => setLead(l => ({ ...l, [f.id]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={() => setStep("calc")}>← Back</Button>
                  <Button
                    className="flex-1"
                    onClick={submitLead}
                    disabled={loading || !lead.name || !lead.email}
                  >
                    {loading ? "Submitting…" : manualQuoteRequired ? "Request manual quote" : "Send enquiry"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
