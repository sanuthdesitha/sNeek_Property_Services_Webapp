"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronRight, HelpCircle, Quote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import type { MarketedService } from "@/lib/marketing/catalog";
import type { WebsiteServicePage } from "@/lib/public-site/content";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/public-site-shell";
import { ClientImage } from "@/components/public/client-image";

interface ServiceDetailPageProps {
  service: MarketedService;
  pageContent: WebsiteServicePage;
}

const HOW_IT_WORKS = [
  "Request via our online quote tool or contact us directly — takes under 2 minutes.",
  "We confirm scope, access arrangements, and a suitable time window with you.",
  "We complete the clean and send you a photo report on the same day.",
];

export function ServiceDetailPage({ service, pageContent }: ServiceDetailPageProps) {
  const related = MARKETED_SERVICES.filter(
    (s) => s.family === service.family && s.slug !== service.slug
  ).slice(0, 3);

  return (
    <div>
      {/* ── Hero ── */}
      <div className={`${PUBLIC_PAGE_CONTAINER} pt-6 pb-8 sm:pt-8 sm:pb-10`}>
        {/* Breadcrumb */}
        <nav className="mb-5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-primary transition-colors">Home</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link href="/services" className="hover:text-primary transition-colors">Services</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="text-foreground font-medium">{service.label}</span>
        </nav>

        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#0c2329] to-[#163b41] shadow-[0_24px_70px_-36px_rgba(15,77,84,0.6)]">
          {pageContent.heroImageUrl && (
            <ClientImage
              src={pageContent.heroImageUrl}
              alt={pageContent.heroImageAlt || service.label}
              className="absolute inset-0 h-full w-full object-cover opacity-25 mix-blend-luminosity"
              loading="eager"
            />
          )}
          <div className="relative z-10 p-8 sm:p-12">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary-foreground/60">{service.family.replace("_", " ")}</p>
            <h1 className="mb-3 text-3xl font-semibold text-white sm:text-4xl xl:text-5xl">{service.label}</h1>
            <p className="mb-6 max-w-xl text-base leading-7 text-white/75">{service.summary}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full bg-white text-primary hover:bg-white/90 transition-transform duration-200 hover:-translate-y-0.5">
                <Link href={`/quote?serviceType=${service.jobType}`}>
                  <Quote className="mr-2 h-4 w-4" />
                  Get an instant quote
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
                <Link href="/contact">
                  Contact us
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── What's Included / Not Included ── */}
      {(pageContent.whatIncluded.length > 0 || pageContent.notIncluded.length > 0) && (
        <section className={`${PUBLIC_PAGE_CONTAINER} py-8 sm:py-10`}>
          <div className="grid gap-5 sm:grid-cols-2">
            {pageContent.whatIncluded.length > 0 && (
              <Card className="rounded-[1.8rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.28)]">
                <CardContent className="p-6 sm:p-7">
                  <p className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-primary">What&apos;s included</p>
                  <ul className="space-y-3">
                    {pageContent.whatIncluded.map((item) => (
                      <li key={item} className="flex items-start gap-3 text-sm leading-6">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            {pageContent.notIncluded.length > 0 && (
              <Card className="rounded-[1.8rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.28)]">
                <CardContent className="p-6 sm:p-7">
                  <p className="mb-5 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Not included</p>
                  <ul className="space-y-3">
                    {pageContent.notIncluded.map((item) => (
                      <li key={item} className="flex items-start gap-3 text-sm leading-6 text-muted-foreground">
                        <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      )}

      {/* ── Ideal For + Price Guide ── */}
      {(pageContent.idealFor || pageContent.priceGuide) && (
        <section className={`${PUBLIC_PAGE_CONTAINER} py-4 sm:py-6`}>
          <div className="grid gap-5 sm:grid-cols-2">
            {pageContent.idealFor && (
              <Card className="rounded-[1.8rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.28)]">
                <CardContent className="p-6 sm:p-7">
                  <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary">Who is this for?</p>
                  <p className="text-sm leading-7 text-foreground/80">{pageContent.idealFor}</p>
                </CardContent>
              </Card>
            )}
            {pageContent.priceGuide && (
              <Card className="rounded-[1.8rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.28)]">
                <CardContent className="p-6 sm:p-7">
                  <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-primary">Price guide</p>
                  <p className="text-sm leading-7 text-foreground/80">{pageContent.priceGuide}</p>
                  <p className="mt-3 text-xs text-muted-foreground">Estimates vary based on property size, condition, and add-ons. Use the quote tool for an accurate figure.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      )}

      {/* ── How It Works ── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} py-8 sm:py-10`}>
        <div className="rounded-[2rem] border border-white/70 bg-white/75 p-6 shadow-[0_20px_60px_-32px_rgba(25,67,74,0.28)] sm:p-8">
          <p className="mb-6 text-sm font-semibold uppercase tracking-[0.18em] text-primary">How it works</p>
          <div className="grid gap-4 sm:grid-cols-3">
            {HOW_IT_WORKS.map((step, idx) => (
              <div key={step} className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                  {idx + 1}
                </div>
                <p className="text-sm leading-6 text-foreground/80">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Service FAQ ── */}
      {pageContent.faq.length > 0 && (
        <section className={`${PUBLIC_PAGE_CONTAINER} py-4 sm:py-6`}>
          <div className="grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-10 xl:items-start">
            <div className="space-y-3">
              <div className="rounded-2xl bg-primary/8 p-3 w-fit">
                <HelpCircle className="h-5 w-5 text-primary" />
              </div>
              <p className="font-semibold">Questions about {service.shortLabel}</p>
              <p className="text-sm leading-6 text-muted-foreground">Common questions specific to this service.</p>
            </div>
            <Accordion type="single" collapsible className="space-y-3">
              {pageContent.faq.map((item, idx) => (
                <AccordionItem
                  key={`faq-${idx}`}
                  value={`faq-${idx}`}
                  className="rounded-2xl border border-white/70 bg-white/80 px-5 shadow-sm data-[state=open]:shadow-md"
                >
                  <AccordionTrigger className="py-4 text-sm font-medium hover:no-underline">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="pb-4 text-sm leading-7 text-muted-foreground">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </section>
      )}

      {/* ── Related Services ── */}
      {related.length > 0 && (
        <section className={`${PUBLIC_PAGE_CONTAINER} py-8 sm:py-10`}>
          <p className="mb-6 text-sm font-semibold uppercase tracking-[0.18em] text-primary">Related services</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((rel) => (
              <Link key={rel.slug} href={`/services/${rel.slug}`} className="group">
                <Card className="h-full rounded-[1.8rem] border-white/70 bg-white/80 shadow-[0_16px_45px_-30px_rgba(22,63,70,0.32)] transition-all duration-300 hover:-translate-y-1">
                  <CardContent className="space-y-3 p-6">
                    <div className={`inline-flex rounded-xl bg-gradient-to-br ${rel.cardColor} p-2.5 text-white`}>
                      <Quote className="h-4 w-4" />
                    </div>
                    <p className="font-semibold">{rel.label}</p>
                    <p className="text-sm leading-6 text-muted-foreground">{rel.tagline}</p>
                    <p className="text-xs font-medium text-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100">View details →</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Bottom CTA ── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} pb-12 pt-4 sm:pb-20`}>
        <Card className="overflow-hidden rounded-[2rem] border-white/70 bg-gradient-to-br from-primary/95 to-[#163b41] text-white shadow-[0_24px_70px_-36px_rgba(15,77,84,0.6)]">
          <CardContent className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/60">Ready to book</p>
              <h2 className="text-2xl font-semibold">{service.label}</h2>
              <p className="max-w-xl text-sm leading-7 text-white/75">
                Use our instant quote tool for a price in under 2 minutes, or contact us for a custom scope review.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full bg-white text-primary hover:bg-white/90 transition-transform duration-200 hover:-translate-y-0.5">
                <Link href={`/quote?serviceType=${service.jobType}`}>
                  <Quote className="mr-2 h-4 w-4" />
                  Start your quote
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
                <Link href="/contact">Contact us</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
