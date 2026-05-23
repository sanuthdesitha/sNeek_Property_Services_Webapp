"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Mail, Phone, MapPin, Clock, Send, CheckCircle2 } from "lucide-react";

export default function ContactPage() {
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
      subject: formData.get("subject"),
      message: formData.get("message"),
    };

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to send message");
      }

      setSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send message");
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
            <h2 className="text-2xl font-bold text-text-primary mb-2">Message Sent!</h2>
            <p className="text-text-secondary mb-6">We&apos;ll get back to you within 24 hours.</p>
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
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><span className="text-sm font-bold text-white">S</span></div>
            <span className="font-semibold text-text-primary">sNeek Property Service</span>
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild><Link href="/login">Sign In</Link></Button>
            <Button size="sm" asChild><Link href="/quote">Get a Quote</Link></Button>
          </div>
        </div>
      </header>

      <section className="py-16 lg:py-24 bg-gradient-to-b from-brand-50 to-white dark:from-neutral-900 dark:to-neutral-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-text-primary tracking-tight">Contact Us</h1>
            <p className="mt-4 text-lg text-text-secondary">Get in touch with our team</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <Card variant="outlined" className="lg:col-span-2">
              <CardContent className="pt-6">
                <form onSubmit={handleSubmit} className="space-y-4">
                  {error && (
                    <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">{error}</div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input name="name" label="Full Name" placeholder="John Doe" required />
                    <Input name="email" label="Email" type="email" placeholder="john@example.com" required />
                  </div>
                  <Input name="phone" label="Phone" type="tel" placeholder="+61 400 000 000" />
                  <Select name="subject" label="Subject" options={[
                    { value: "quote", label: "Request a Quote" },
                    { value: "support", label: "Customer Support" },
                    { value: "feedback", label: "Feedback" },
                    { value: "complaint", label: "Complaint" },
                    { value: "other", label: "Other" },
                  ]} placeholder="Select subject" />
                  <Textarea name="message" label="Message" placeholder="How can we help you?" className="min-h-32" required />
                  <Button type="submit" size="lg" loading={loading}><Send className="h-4 w-4 mr-2" />Send Message</Button>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card variant="outlined">
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    <div className="flex items-start gap-3"><Mail className="h-5 w-5 text-brand-600 mt-0.5" /><div><p className="font-medium text-sm">Email</p><p className="text-sm text-text-secondary">info@sneekops.com.au</p></div></div>
                    <div className="flex items-start gap-3"><Phone className="h-5 w-5 text-brand-600 mt-0.5" /><div><p className="font-medium text-sm">Phone</p><p className="text-sm text-text-secondary">+61 400 000 000</p></div></div>
                    <div className="flex items-start gap-3"><MapPin className="h-5 w-5 text-brand-600 mt-0.5" /><div><p className="font-medium text-sm">Address</p><p className="text-sm text-text-secondary">Sydney, NSW, Australia</p></div></div>
                    <div className="flex items-start gap-3"><Clock className="h-5 w-5 text-brand-600 mt-0.5" /><div><p className="font-medium text-sm">Hours</p><p className="text-sm text-text-secondary">Mon-Fri: 7am - 7pm</p><p className="text-sm text-text-secondary">Sat: 8am - 5pm</p></div></div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      <footer className="py-12 border-t border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600"><span className="text-sm font-bold text-white">S</span></div>
              <span className="font-semibold text-text-primary">sNeek Property Service</span>
            </div>
            <p className="text-sm text-text-tertiary">&copy; {new Date().getFullYear()} sNeek Property Service. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
