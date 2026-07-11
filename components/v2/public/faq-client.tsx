"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";
import { EButton, ECard, ECardBody, EEyebrow, EThread } from "@/components/v2/ui/primitives";
import type { WebsiteContent, WebsiteFaqItem } from "@/lib/public-site/content";

const CATEGORIES: { value: WebsiteFaqItem["category"] | "all"; label: string }[] = [
  { value: "all", label: "All questions" },
  { value: "booking", label: "Booking" },
  { value: "pricing", label: "Pricing" },
  { value: "services", label: "Services" },
  { value: "trust", label: "Trust & Safety" },
  { value: "airbnb", label: "Airbnb" },
];

const QUICK_ANSWERS = [
  { q: "Do I need to be home?", a: "No — we work with access codes, lockboxes, or building concierge." },
  { q: "How do I get a price?", a: "Use our instant quote tool online. Most quotes are ready in under 2 minutes." },
  { q: "Are you insured?", a: "Yes — $5M public liability and a police-checked team on every job." },
  { q: "What areas do you cover?", a: "Parramatta and Greater Sydney within ~50km." },
];

export function FaqClient({ content }: { content: WebsiteContent }) {
  const [active, setActive] = useState<WebsiteFaqItem["category"] | "all">("all");
  const items = content.faq?.items ?? [];
  const filtered = active === "all" ? items : items.filter((i) => i.category === active);

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.1fr)_380px] xl:items-start xl:gap-14">
          <div className="space-y-6 e-rise">
            <EEyebrow>Frequently asked questions</EEyebrow>
            <h1 className="e-display-xl">
              {content.faq?.title ?? "Got questions? We have answers."}
            </h1>
            <p className="max-w-lg text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
              {content.faq?.intro ?? "Everything you need to know before booking your first clean with sNeek."}
            </p>
            <div className="flex flex-wrap gap-3">
              <EButton asChild variant="gold" size="lg">
                <Link href="/v2/quote">Get instant quote</Link>
              </EButton>
              <EButton asChild variant="outline" size="lg">
                <Link href="/v2/contact">
                  Contact us <ArrowRight className="h-4 w-4" />
                </Link>
              </EButton>
            </div>
          </div>

          {/* Quick answers card */}
          <ECard variant="ceremony">
            <ECardBody className="space-y-3 pt-6">
              <EEyebrow>Quick answers</EEyebrow>
              {QUICK_ANSWERS.map((item) => (
                <div key={item.q} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
                  <p className="text-[0.875rem] font-[550]">{item.q}</p>
                  <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{item.a}</p>
                </div>
              ))}
            </ECardBody>
          </ECard>
        </div>
      </section>

      {/* Category tabs + accordion */}
      <div className="bg-[hsl(var(--e-surface-raised))] border-y border-[hsl(var(--e-border))]">
        <section className="mx-auto max-w-6xl px-6 py-16">
          {/* Category filter */}
          <div className="mb-8 flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setActive(cat.value)}
                className={`rounded-[var(--e-radius-pill)] px-4 py-2 text-[0.8125rem] font-medium transition-all duration-150 ${
                  active === cat.value
                    ? "bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]"
                    : "border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))] hover:text-[hsl(var(--e-foreground))]"
                }`}
              >
                {cat.label}
                {cat.value !== "all" && (
                  <span className="ml-1.5 text-[0.6875rem] opacity-60">
                    ({items.filter((i) => i.category === cat.value).length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <ECard>
              <ECardBody className="py-12 text-center pt-6">
                <p className="text-[hsl(var(--e-muted-foreground))]">No questions in this category yet.</p>
              </ECardBody>
            </ECard>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => (
                <ECard key={item.id}>
                  <ECardBody className="pt-6">
                    <p className="font-[550]">{item.question}</p>
                    <p className="mt-2 text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{item.answer}</p>
                  </ECardBody>
                </ECard>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Bottom CTA */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <ECard variant="ceremony">
          <ECardBody className="pt-6 lg:flex lg:items-center lg:justify-between lg:gap-10">
            <div className="space-y-3">
              <div className="inline-flex rounded-[var(--e-radius)] bg-[#25D366]/10 p-3">
                <MessageCircle className="h-5 w-5 text-[#25D366]" />
              </div>
              <p className="text-[1.0625rem] font-semibold">Still have questions?</p>
              <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
                Chat with us on WhatsApp for the fastest response — we typically reply within minutes during business hours.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row lg:mt-0 lg:ml-8 lg:shrink-0">
              <a
                href="https://wa.me/61451217210"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-[var(--e-radius-pill)] bg-[#25D366] px-6 py-3 text-[0.875rem] font-semibold text-white transition-all duration-150 hover:brightness-105"
              >
                Chat on WhatsApp
              </a>
              <EButton asChild variant="outline">
                <Link href="/v2/contact">Send us a message</Link>
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      </section>
    </div>
  );
}
