"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

const inquiryTypes = [
  { value: "general-clean", label: "General cleaning" },
  { value: "deep-clean", label: "Deep cleaning" },
  { value: "airbnb-turnover", label: "Airbnb turnover" },
  { value: "end-of-lease", label: "End of lease" },
  { value: "specialty-cleaning", label: "Specialty cleaning / treatment" },
  { value: "exterior-service", label: "Exterior / lawn / pressure washing" },
  { value: "commercial", label: "Office / commercial cleaning" },
  { value: "subscription", label: "Recurring service enquiry" },
  { value: "custom-project", label: "Custom or large job" },
];

export function ContactForm() {
  const [form, setForm] = useState({
    inquiryType: "custom-project",
    name: "",
    email: "",
    phone: "",
    suburb: "",
    address: "",
    message: "",
  });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "Could not send your message.");
      }
      setSent(true);
      toast({ title: "Message sent", description: "Your request has been received." });
    } catch (error: any) {
      toast({ title: "Contact failed", description: error?.message ?? "Could not send your message.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)]">
        <CardContent className="space-y-4 p-6 text-center sm:p-8">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Send className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-semibold">Request received</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              We have your details and message. The team can review the request and reply with the right next step or a tailored quote.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)]">
      <CardHeader>
        <CardTitle>Send a quick message</CardTitle>
        <CardDescription>
          Use this for large homes, unusual scope, commercial-style requests, recurring service discussions, or anything that needs a manual review.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-name">Full name</Label>
              <Input id="contact-name" className="h-11 rounded-2xl" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-email">Email</Label>
              <Input id="contact-email" className="h-11 rounded-2xl" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} required />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-phone">Phone</Label>
              <Input id="contact-phone" className="h-11 rounded-2xl" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="0451217210 or +61451217210" />
            </div>
            <div className="space-y-2">
              <Label>Request type</Label>
              <Select value={form.inquiryType} onValueChange={(value) => setForm((current) => ({ ...current, inquiryType: value }))}>
                <SelectTrigger className="h-11 rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {inquiryTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="contact-suburb">Suburb</Label>
              <Input id="contact-suburb" className="h-11 rounded-2xl" value={form.suburb} onChange={(event) => setForm((current) => ({ ...current, suburb: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contact-address">Address</Label>
              <Input id="contact-address" className="h-11 rounded-2xl" value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="contact-message">Message</Label>
            <Textarea
              id="contact-message"
              rows={6}
              className="min-h-[144px] rounded-[1.4rem]"
              value={form.message}
              onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
              placeholder="Tell us about the property, urgency, access issues, requested outcomes, or anything the quote should account for."
              required
            />
          </div>

          <Button type="submit" disabled={loading} className="w-full rounded-full sm:w-auto">
            {loading ? "Sending..." : "Send message"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
