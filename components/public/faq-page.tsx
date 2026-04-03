"use client";

import Link from "next/link";
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { WebsiteContent, WebsiteFaqItem } from "@/lib/public-site/content";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/public-site-shell";

const CATEGORIES: { value: WebsiteFaqItem["category"] | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "booking", label: "Booking" },
  { value: "pricing", label: "Pricing" },
  { value: "services", label: "Services" },
  { value: "trust", label: "Trust & Safety" },
  { value: "airbnb", label: "Airbnb" },
];

interface FaqPageProps {
  content: WebsiteContent;
}

export function FaqPage({ content }: FaqPageProps) {
  const [active, setActive] = useState<WebsiteFaqItem["category"] | "all">("all");

  const items = content.faq?.items ?? [];
  const filtered = active === "all" ? items : items.filter((item) => item.category === active);

  return (
    <div>
      {/* Hero */}
      <div className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="max-w-2xl space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Frequently asked questions</p>
          <h1 className="text-3xl font-semibold sm:text-4xl xl:text-5xl">
            {content.faq?.title ?? "Got questions? We have answers."}
          </h1>
          <p className="text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">
            {content.faq?.intro ?? "Everything you need to know before booking your first clean with sNeek."}
          </p>
        </div>
      </div>

      {/* Category tabs */}
      <div className={`${PUBLIC_PAGE_CONTAINER} pb-4`}>
        <div className="flex flex-wrap gap-2">
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
            </button>
          ))}
        </div>
      </div>

      {/* FAQ accordion */}
      <section className={`${PUBLIC_PAGE_CONTAINER} py-6 sm:py-8`}>
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
                className="rounded-2xl border border-white/70 bg-white/80 px-5 shadow-sm data-[state=open]:shadow-md transition-shadow"
              >
                <AccordionTrigger className="py-4 text-sm font-medium hover:no-underline text-left">
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

      {/* Bottom CTA */}
      <section className={`${PUBLIC_PAGE_CONTAINER} pb-16 pt-4 sm:pb-24`}>
        <div className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.28)] sm:p-8 lg:flex lg:items-center lg:justify-between">
          <div className="space-y-2">
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
    </div>
  );
}
