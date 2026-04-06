"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, MessageCircle, Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { WebsiteContent, WebsiteFaqItem } from "@/lib/public-site/content";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";

const CATEGORIES: { value: WebsiteFaqItem["category"] | "all"; label: string }[] = [
  { value: "all", label: "All questions" },
  { value: "booking", label: "Booking" },
  { value: "pricing", label: "Pricing" },
  { value: "services", label: "Services" },
  { value: "trust", label: "Trust & Safety" },
  { value: "airbnb", label: "Airbnb" },
];

interface FaqPageProps {
  readonly content: WebsiteContent;
}

export function FaqPage({ content }: FaqPageProps) {
  const [active, setActive] = useState<WebsiteFaqItem["category"] | "all">("all");

  const items = content.faq?.items ?? [];
  const filtered = active === "all" ? items : items.filter((item) => item.category === active);

  return (
    <main className="page-fade">
      {/* ─── HERO ─── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)] xl:items-start xl:gap-14">
          <div className="space-y-6 animate-fade-up">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Frequently asked questions</p>
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
              {content.faq?.title ?? "Got questions? We have answers."}
            </h1>
            <p className="max-w-lg text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              {content.faq?.intro ?? "Everything you need to know before booking your first clean with sNeek."}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-full px-6 shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/quote">
                  <Quote className="mr-2 h-4 w-4" />
                  Get instant quote
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full px-6 transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/contact">
                  Contact us
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          {/* Quick summary card */}
          <div className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_24px_70px_-34px_rgba(26,67,74,0.38)] space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Quick answers</p>
            {[
              { q: "Do I need to be home?", a: "No — we work with access codes, lockboxes, or building concierge." },
              { q: "How do I get a price?", a: "Use our instant quote tool online. Most quotes are ready in under 2 minutes." },
              { q: "Are you insured?", a: "Yes — $5M public liability and a police-checked team on every job." },
              { q: "What areas do you cover?", a: "Parramatta and Greater Sydney within ~50km." },
            ].map((item) => (
              <div key={item.q} className="rounded-[1.2rem] border border-border/60 bg-background/60 p-4">
                <p className="text-sm font-semibold">{item.q}</p>
                <p className="mt-1 text-sm text-muted-foreground">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FULL-BLEED: CATEGORY TABS + ACCORDION ─── */}
      <div className="public-section-full bg-primary/4">
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          {/* Category tabs */}
          <div className="mb-8 flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setActive(cat.value)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ${
                  active === cat.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-white/80 text-muted-foreground hover:bg-white hover:text-foreground"
                }`}
              >
                {cat.label}
                {cat.value !== "all" && (
                  <span className="ml-1.5 text-xs opacity-60">
                    ({items.filter((i) => i.category === cat.value).length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* FAQ accordion */}
          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-white/70 bg-white/80 p-8 text-center text-muted-foreground">
              No questions in this category yet.
            </div>
          ) : (
            <Accordion type="single" collapsible className="space-y-3">
              {filtered.map((item) => (
                <AccordionItem
                  key={item.id}
                  value={item.id}
                  className="rounded-2xl border border-white/70 bg-white/85 px-5 shadow-sm data-[state=open]:shadow-md transition-all duration-200"
                >
                  <AccordionTrigger className="py-4 text-sm font-medium hover:no-underline text-left sm:text-base">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="pb-5 text-sm leading-7 text-muted-foreground">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </section>
      </div>

      {/* ─── BOTTOM CTA ─── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.28)] sm:p-8 lg:flex lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="rounded-2xl bg-[#25D366]/10 p-3 w-fit">
              <MessageCircle className="h-5 w-5 text-[#25D366]" />
            </div>
            <p className="text-lg font-semibold">Still have questions?</p>
            <p className="text-sm leading-6 text-muted-foreground">
              Chat with us on WhatsApp for the fastest response — we typically reply within minutes during business hours.
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row lg:mt-0 lg:ml-8 lg:shrink-0">
            <a
              href="https://wa.me/61451217210"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-6 py-3 text-sm font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5 hover:opacity-90"
            >
              Chat on WhatsApp
            </a>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/contact">Send us a message</Link>
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
