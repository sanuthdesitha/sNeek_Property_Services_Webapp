"use client";

import { useState } from "react";
import { Mail, MapPin, MessageSquareMore, Phone, PhoneCall } from "lucide-react";
import { EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";
import { EField, EInput, ETextarea, ESelect } from "@/components/v2/admin/estate-kit";

const WHATSAPP_HREF = "https://wa.me/61451217210";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

interface ContactPageClientProps {
  displayEmail: string;
  displayPhone: string;
  addressLine: string;
  eyebrow: string;
  title: string;
  intro: string;
  formIntro: string;
  responsePromise: string;
}

export function ContactPageClient({
  displayEmail,
  displayPhone,
  addressLine,
  eyebrow,
  title,
  intro,
  formIntro,
  responsePromise,
}: ContactPageClientProps) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", service: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const telHref = `tel:${displayPhone.replace(/\s+/g, "")}`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div>
      <section className="mx-auto max-w-6xl px-6 py-20">
        {/* Heading */}
        <div className="mb-10 max-w-2xl space-y-3 e-rise">
          <EEyebrow>{eyebrow}</EEyebrow>
          <h1 className="e-display-xl">{title}</h1>
          <p className="text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{intro}</p>
        </div>

        {/* Quick contact cards */}
        <div className="mb-12 grid gap-4 sm:grid-cols-3">
          <a
            href={telHref}
            className="group flex flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--e-elevation-2)]"
          >
            <div className="rounded-[var(--e-radius)] bg-[hsl(var(--e-primary-soft))] p-3 w-fit">
              <PhoneCall className="h-5 w-5 text-[hsl(var(--e-primary))]" />
            </div>
            <div>
              <p className="font-semibold">{displayPhone}</p>
              <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Call us directly</p>
              <p className="mt-2 text-[0.75rem] font-medium text-[hsl(var(--e-gold-ink))]">Mon–Sat, 7am–6pm</p>
            </div>
          </a>

          <a
            href={WHATSAPP_HREF}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--e-elevation-2)]"
          >
            <div className="rounded-[var(--e-radius)] bg-[#25D366]/10 p-3 w-fit">
              <WhatsAppIcon className="h-5 w-5 text-[#25D366]" />
            </div>
            <div>
              <p className="font-semibold">Chat on WhatsApp</p>
              <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Fastest response</p>
              <p className="mt-2 text-[0.75rem] font-medium text-[#25D366]">Typically replies within minutes →</p>
            </div>
          </a>

          <a
            href={`mailto:${displayEmail}`}
            className="group flex flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--e-elevation-2)]"
          >
            <div className="rounded-[var(--e-radius)] bg-[hsl(var(--e-primary-soft))] p-3 w-fit">
              <Mail className="h-5 w-5 text-[hsl(var(--e-primary))]" />
            </div>
            <div>
              <p className="font-semibold">{displayEmail}</p>
              <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">We reply within 1 business day</p>
              <p className="mt-2 text-[0.75rem] font-medium text-[hsl(var(--e-gold-ink))]">Send us an email →</p>
            </div>
          </a>
        </div>

        {/* Form + sidebar */}
        <div className="grid gap-8 xl:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.1fr)] xl:gap-10">
          {/* Sidebar */}
          <div className="space-y-5 xl:sticky xl:top-24 xl:self-start">
            <p className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{formIntro}</p>
            <div className="grid gap-3">
              {[
                { icon: MessageSquareMore, title: "Custom quote requests", body: "Best for large homes, unusual scope, staged cleans, specialty treatments, Airbnb packages, or anything that needs a proper review." },
                { icon: PhoneCall, title: "Recurring service discussions", body: "Use this for weekly, fortnightly, monthly, or hosting-support subscriptions rather than a once-off clean." },
              ].map((item) => (
                <ECard key={item.title}>
                  <ECardBody className="flex gap-4 pt-6">
                    <div className="rounded-[var(--e-radius)] bg-[hsl(var(--e-primary-soft))] p-3 shrink-0">
                      <item.icon className="h-5 w-5 text-[hsl(var(--e-primary))]" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-semibold text-[0.875rem]">{item.title}</p>
                      <p className="text-[0.75rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">{item.body}</p>
                    </div>
                  </ECardBody>
                </ECard>
              ))}
            </div>
            <ECard>
              <ECardBody className="space-y-1.5 pt-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-gold-ink))]" />
                  <span>{addressLine}</span>
                </div>
                <p>{responsePromise}</p>
              </ECardBody>
            </ECard>
          </div>

          {/* Contact form */}
          <ECard variant="ceremony">
            <ECardBody className="pt-6">
              {status === "sent" ? (
                <div className="space-y-3 py-8 text-center">
                  <p className="e-display-sm">Message sent.</p>
                  <p className="text-[0.9375rem] text-[hsl(var(--e-text-secondary))]">
                    We'll get back to you within 1 business day.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <EField label="Full name *">
                      <EInput
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="Your name"
                      />
                    </EField>
                    <EField label="Email *">
                      <EInput
                        type="email"
                        required
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        placeholder="you@example.com"
                      />
                    </EField>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <EField label="Phone">
                      <EInput
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        placeholder="04xx xxx xxx"
                      />
                    </EField>
                    <EField label="Service interested in">
                      <ESelect
                        value={form.service}
                        onChange={(e) => setForm({ ...form, service: e.target.value })}
                      >
                        <option value="">Select a service…</option>
                        <option>Airbnb turnover</option>
                        <option>End of lease</option>
                        <option>Deep clean</option>
                        <option>General clean</option>
                        <option>Recurring / subscription</option>
                        <option>Other</option>
                      </ESelect>
                    </EField>
                  </div>
                  <EField label="Message *">
                    <ETextarea
                      required
                      rows={5}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      placeholder="Tell us about your property and what you need…"
                    />
                  </EField>
                  {status === "error" && (
                    <p className="text-[0.875rem] text-[hsl(var(--e-danger))]">
                      Something went wrong. Please try again or contact us directly.
                    </p>
                  )}
                  <EButton variant="gold" size="lg" className="w-full" type="submit" disabled={status === "sending"}>
                    {status === "sending" ? "Sending…" : "Send message"}
                  </EButton>
                </form>
              )}
            </ECardBody>
          </ECard>
        </div>
      </section>
    </div>
  );
}
