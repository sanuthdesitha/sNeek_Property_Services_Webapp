"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  CheckCircle2,
  ChevronDown,
  Leaf,
  MapPin,
  Quote,
  ShieldCheck,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import type { WebsiteContent, WebsiteWhyItem } from "@/lib/public-site/content";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/public-site-shell";

const WHATSAPP_HREF = "https://wa.me/61451217210";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// Map icon name strings to Lucide components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  ShieldCheck,
  Camera,
  MapPin,
  Leaf,
  Zap,
  BadgeCheck,
};

function WhyIcon({ iconName, className }: { iconName: string; className?: string }) {
  const Icon = ICON_MAP[iconName] ?? ShieldCheck;
  return <Icon className={className} />;
}

const TRUST_PILLS = [
  "$5M Public Liability Insured",
  "Photo Reports Included",
  "100% Satisfaction Guarantee",
  "Police Checked Team",
  "Eco-Friendly Products",
  "Parramatta-Based",
  "Same-Day Service Available",
  "Airbnb Turnovers Covered",
];

const featuredServices = MARKETED_SERVICES.slice(0, 6);

export function HomePage({ content }: { content: WebsiteContent }) {
  const faqPreview = content.faq?.items?.slice(0, 6) ?? [];
  const whyItems = content.whyChooseUs?.items ?? [];
  const galleryItems = content.gallery?.items ?? [];
  const partnerItems = content.partners?.items ?? [];
  const hasPartners = partnerItems.some((p) => p.name || p.logoUrl);

  return (
    <div>
      {/* ─────────────────────────────────────────────────
          SECTION 1 — HERO
      ───────────────────────────────────────────────── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.08fr)_minmax(540px,0.92fr)] xl:items-center xl:gap-14 2xl:gap-20">
          {/* Left column */}
          <div className="space-y-7 animate-fade-up">
            <Badge className="w-fit rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] sm:text-xs">
              {content.home.eyebrow}
            </Badge>
            <div className="space-y-4">
              <h1 className="max-w-2xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                {content.home.title}
              </h1>
              <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                {content.home.subtitle}
              </p>
              <p className="max-w-xl text-sm leading-7 text-foreground/75">
                {content.home.brandIdea}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full px-6 shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/quote">
                  <Quote className="mr-2 h-4 w-4" />
                  {content.home.primaryCtaLabel}
                </Link>
              </Button>
              <a
                href={WHATSAPP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-transform duration-200 hover:-translate-y-0.5 hover:opacity-90"
              >
                <WhatsAppIcon className="h-4 w-4" />
                WhatsApp Us
              </a>
              <Button asChild size="lg" variant="outline" className="rounded-full px-6 transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/contact">
                  {content.home.secondaryCtaLabel}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>

            {/* Stats */}
            <div className="grid gap-3 sm:grid-cols-3">
              {content.home.stats.map((item) => (
                <Card key={item.label} className="rounded-3xl border-white/70 bg-white/75 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.35)] transition-transform duration-300 hover:-translate-y-1">
                  <CardContent className="space-y-1 p-5">
                    <p className="text-2xl font-semibold">{item.value}</p>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{item.note}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Right column — hero image */}
          <div className="relative">
            <div className="absolute -left-6 top-10 hidden h-16 w-16 rounded-full bg-accent/80 blur-2xl lg:block motion-safe:animate-float-slow" />
            <div className="absolute -right-8 bottom-8 hidden h-24 w-24 rounded-full bg-primary/15 blur-3xl lg:block motion-safe:animate-float-slower" />
            <Card className="overflow-hidden rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_70px_-34px_rgba(26,67,74,0.38)]">
              <div className="relative">
                <img
                  src={content.home.heroImageUrl}
                  alt={content.home.heroImageAlt}
                  className="h-[280px] w-full object-cover transition-transform duration-700 hover:scale-[1.03] sm:h-[360px] lg:h-[440px]"
                  loading="eager"
                  onError={(e) => { e.currentTarget.style.background = "hsl(var(--muted))"; }}
                />
                {/* Floating trust pills over image */}
                <div className="absolute bottom-4 left-4 flex items-center gap-1.5 rounded-full bg-white/92 px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-sm">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  500+ Cleans Completed
                </div>
                <div className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-white/92 px-3 py-1.5 text-xs font-semibold shadow-sm backdrop-blur-sm">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  4.9 Rated
                </div>
              </div>
              <CardContent className="grid gap-4 p-5 sm:p-6 md:grid-cols-2">
                <div className="flex gap-3">
                  <div className="rounded-2xl bg-primary/10 p-3 shrink-0">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">Trusted presentation standards</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Guest-ready finishing, clear evidence, and less back-and-forth after the clean.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="rounded-2xl bg-accent p-3 shrink-0">
                    <Sparkles className="h-5 w-5 text-accent-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold">Stay guest-ready without the admin drag</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">Turnovers, linen, restocks, reports, and follow-ups stay coordinated without chasing five people.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────
          SECTION 2 — TRUST STRIP (marquee)
      ───────────────────────────────────────────────── */}
      <div className="public-section-full border-y border-primary/8 bg-primary/4 py-4 overflow-hidden">
        <div className="flex" aria-hidden="true">
          <div className="flex shrink-0 gap-4 animate-marquee pr-4">
            {[...TRUST_PILLS, ...TRUST_PILLS].map((pill, i) => (
              <span key={i} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/80 bg-white px-4 py-2 text-sm font-medium text-foreground shadow-sm">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                {pill}
              </span>
            ))}
          </div>
          <div className="flex shrink-0 gap-4 animate-marquee pr-4" aria-hidden="true">
            {[...TRUST_PILLS, ...TRUST_PILLS].map((pill, i) => (
              <span key={i} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/80 bg-white px-4 py-2 text-sm font-medium text-foreground shadow-sm">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                {pill}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────
          SECTION 3 — SERVICES GRID
      ───────────────────────────────────────────────── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="grid gap-8 xl:grid-cols-[320px_minmax(0,1fr)] xl:gap-10">
          <div className="space-y-5 xl:sticky xl:top-28 xl:self-start">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Why clients book sNeek</p>
            <h2 className="text-2xl font-semibold sm:text-3xl">{content.home.servicesTitle}</h2>
            <p className="text-sm leading-7 text-muted-foreground">{content.home.servicesIntro}</p>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/services">View all services</Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {content.home.serviceBenefits.map((card) => (
              <Card key={card.id} className="overflow-hidden rounded-[1.8rem] border-white/70 bg-white/80 shadow-[0_16px_45px_-30px_rgba(22,63,70,0.38)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-32px_rgba(22,63,70,0.42)]">
                <img
                  src={card.imageUrl}
                  alt={card.imageAlt}
                  className="h-48 w-full object-cover"
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.background = "hsl(var(--muted))"; e.currentTarget.style.minHeight = "12rem"; }}
                />
                <CardContent className="space-y-3 p-6">
                  <h3 className="text-lg font-semibold">{card.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{card.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────
          SECTION 4 — WHY CHOOSE US
      ───────────────────────────────────────────────── */}
      <div className="public-section-full bg-primary/4">
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          <div className="grid gap-10 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-14 lg:items-start">
            <div className="space-y-5">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Why choose sNeek</p>
              <h2 className="text-2xl font-semibold sm:text-3xl">
                {content.whyChooseUs?.title ?? "The sNeek difference"}
              </h2>
              <p className="text-sm leading-7 text-muted-foreground">
                {content.whyChooseUs?.intro ?? "Here's what makes working with us different from the next cleaning company you'll find on Google."}
              </p>
              <Button asChild className="rounded-full shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/quote">
                  <Quote className="mr-2 h-4 w-4" />
                  Get a free quote
                </Link>
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {whyItems.map((item: WebsiteWhyItem, idx: number) => (
                <div
                  key={item.id}
                  className="animate-fade-up rounded-[1.6rem] border border-white/80 bg-white/80 p-5 shadow-[0_12px_36px_-20px_rgba(22,63,70,0.28)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_-24px_rgba(22,63,70,0.34)]"
                  style={{ animationDelay: `${idx * 80}ms` }}
                >
                  <div className={`mb-4 inline-flex rounded-2xl p-3 ${idx % 2 === 0 ? "bg-primary/10 text-primary" : "bg-accent text-accent-foreground"}`}>
                    <WhyIcon iconName={item.icon} className="h-5 w-5" />
                  </div>
                  <p className="mb-2 font-semibold">{item.title}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ─────────────────────────────────────────────────
          SECTION 5 — AIRBNB HOSTING
      ───────────────────────────────────────────────── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="grid gap-6 rounded-[2rem] border border-white/70 bg-white/75 p-6 shadow-[0_20px_60px_-32px_rgba(25,67,74,0.34)] sm:p-8 lg:grid-cols-[1fr_1.05fr] lg:gap-10 lg:items-center">
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Airbnb &amp; managed properties</p>
            <h2 className="text-2xl font-semibold sm:text-3xl">{content.home.hostingTitle}</h2>
            <p className="text-sm leading-7 text-muted-foreground">{content.home.hostingIntro}</p>
            {/* Trust badge strip */}
            <div className="flex flex-wrap gap-2">
              {["Photo Reports", "Laundry Handled", "Same-Day Turnovers"].map((badge) => (
                <span key={badge} className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/6 px-3 py-1.5 text-xs font-medium text-primary">
                  <CheckCircle2 className="h-3 w-3" />
                  {badge}
                </span>
              ))}
            </div>
            <Button asChild className="rounded-full">
              <Link href="/airbnb-hosting">
                See hosting support
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {content.home.hostingFeatures.map((card) => (
              <div key={card.id} className="rounded-[1.5rem] border border-border/70 bg-white p-4 transition-transform duration-300 hover:-translate-y-1">
                <img
                  src={card.imageUrl}
                  alt={card.imageAlt}
                  className="mb-4 h-28 w-full rounded-2xl object-cover"
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.background = "hsl(var(--muted))"; e.currentTarget.style.minHeight = "7rem"; }}
                />
                <p className="font-semibold text-sm">{card.title}</p>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{card.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────
          SECTION 6 — POPULAR SERVICES (cards linking to /services/slug)
      ───────────────────────────────────────────────── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="grid gap-8 xl:grid-cols-[320px_minmax(0,1fr)] xl:gap-10">
          <div className="space-y-5 xl:sticky xl:top-28 xl:self-start">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Popular services</p>
            <h2 className="text-2xl font-semibold sm:text-3xl">
              Book the clean you need now, then scale into recurring care.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              Start with the services most clients book, then move into a recurring plan when you want consistent property presentation without rebooking every time.
            </p>
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/subscriptions">Explore subscriptions</Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {featuredServices.map((service) => (
              <Link key={service.jobType} href={`/services/${service.slug}`} className="group">
                <Card className="h-full rounded-[1.7rem] border-white/70 bg-white/75 shadow-[0_16px_45px_-30px_rgba(22,63,70,0.38)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-32px_rgba(22,63,70,0.42)]">
                  <CardContent className="space-y-4 p-6">
                    <div className={`inline-flex rounded-2xl bg-gradient-to-br ${service.cardColor} p-3 text-white shadow-sm`}>
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-lg font-semibold">{service.label}</h3>
                      <p className="text-sm font-medium text-primary">{service.tagline}</p>
                      <p className="text-sm leading-6 text-muted-foreground">{service.summary}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {service.highlights.map((h) => (
                        <span key={h} className="rounded-full border border-border/70 px-3 py-1">{h}</span>
                      ))}
                    </div>
                    <p className="text-xs font-medium text-primary opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      View details →
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────
          SECTION 7 — GALLERY
      ───────────────────────────────────────────────── */}
      <div className="public-section-full bg-primary/3">
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          <div className="space-y-2 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Our work</p>
            <h2 className="text-2xl font-semibold sm:text-3xl">{content.gallery?.title ?? "Before &amp; after results"}</h2>
            <p className="mx-auto max-w-xl text-sm leading-7 text-muted-foreground">{content.gallery?.intro ?? "Real results from real jobs across residential, Airbnb, and specialty cleaning projects."}</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {galleryItems.length > 0
              ? galleryItems.slice(0, 6).map((item) => (
                  <div key={item.id} className="group relative overflow-hidden rounded-[1.6rem] bg-muted shadow-sm">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.imageAlt || item.caption}
                        className="h-56 w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    ) : (
                      <div className="h-56 w-full bg-gradient-to-br from-muted to-secondary/50" />
                    )}
                    <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/60 via-black/10 to-transparent p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      <p className="text-sm font-semibold text-white">{item.caption}</p>
                      {item.serviceType && (
                        <span className="mt-1 w-fit rounded-full bg-white/20 px-2.5 py-0.5 text-xs text-white backdrop-blur-sm">{item.serviceType}</span>
                      )}
                    </div>
                  </div>
                ))
              : Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-56 rounded-[1.6rem] bg-gradient-to-br from-muted/60 to-secondary/40 skeleton" />
                ))}
          </div>
          <div className="mt-8 text-center">
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/quote">Request a quote →</Link>
            </Button>
          </div>
        </section>
      </div>

      {/* ─────────────────────────────────────────────────
          SECTION 8 — PARTNERS (only render if has data)
      ───────────────────────────────────────────────── */}
      {hasPartners && (
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          <div className="space-y-2 text-center">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Trusted by &amp; working with</p>
            <h2 className="text-xl font-semibold sm:text-2xl">{content.partners?.title ?? "Our partners"}</h2>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-6 sm:gap-8">
            {partnerItems.map((partner) => (
              partner.url ? (
                <a
                  key={partner.id}
                  href={partner.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-16 w-36 items-center justify-center rounded-2xl border border-border/60 bg-white/80 px-4 grayscale transition-all duration-300 hover:grayscale-0 hover:shadow-md"
                >
                  {partner.logoUrl ? (
                    <img src={partner.logoUrl} alt={partner.name} className="max-h-10 w-auto object-contain" loading="lazy" />
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground">{partner.name}</span>
                  )}
                </a>
              ) : (
                <div
                  key={partner.id}
                  className="flex h-16 w-36 items-center justify-center rounded-2xl border border-border/60 bg-white/80 px-4 grayscale transition-all duration-300 hover:grayscale-0"
                >
                  {partner.logoUrl ? (
                    <img src={partner.logoUrl} alt={partner.name} className="max-h-10 w-auto object-contain" loading="lazy" />
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground">{partner.name}</span>
                  )}
                </div>
              )
            ))}
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────
          SECTION 8/9 — TESTIMONIALS
      ───────────────────────────────────────────────── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="space-y-2 mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">What clients say</p>
          <h2 className="text-2xl font-semibold sm:text-3xl">Don't just take our word for it.</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {content.home.testimonials.map((item) => (
            <Card key={`${item.author}-${item.meta}`} className="rounded-[1.8rem] border-white/70 bg-white/80 shadow-[0_14px_40px_-24px_rgba(22,63,70,0.32)] transition-transform duration-300 hover:-translate-y-1">
              <CardContent className="space-y-4 p-6">
                {/* Stars */}
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-base leading-7 text-foreground/85">"{item.quote}"</p>
                <div>
                  <p className="font-semibold">{item.author}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.meta}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ─────────────────────────────────────────────────
          SECTION 9/10 — FAQ ACCORDION
      ───────────────────────────────────────────────── */}
      {faqPreview.length > 0 && (
        <div className="public-section-full bg-primary/4">
          <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
            <div className="grid gap-10 xl:grid-cols-[360px_minmax(0,1fr)] xl:gap-14 xl:items-start">
              <div className="space-y-4">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Frequently asked</p>
                <h2 className="text-2xl font-semibold sm:text-3xl">{content.faq?.title ?? "Got questions?"}</h2>
                <p className="text-sm leading-7 text-muted-foreground">{content.faq?.intro ?? "Everything you need to know before booking."}</p>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/faq">See all FAQs</Link>
                </Button>
              </div>
              <Accordion type="single" collapsible className="space-y-3">
                {faqPreview.map((item) => (
                  <AccordionItem
                    key={item.id}
                    value={item.id}
                    className="rounded-2xl border border-white/70 bg-white/80 px-5 shadow-sm data-[state=open]:shadow-md"
                  >
                    <AccordionTrigger className="py-4 text-sm font-medium hover:no-underline [&[data-state=open]>svg]:rotate-180">
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
        </div>
      )}

      {/* ─────────────────────────────────────────────────
          SECTION 10 — FINAL CTA
      ───────────────────────────────────────────────── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} pb-12 pt-2 sm:pt-4 lg:pb-24`}>
        <Card className="overflow-hidden rounded-[2rem] border-white/70 bg-gradient-to-br from-primary/95 to-[#163b41] text-white shadow-[0_24px_70px_-36px_rgba(15,77,84,0.6)]">
          <CardContent className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="space-y-3">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/60">Next step</p>
              <h2 className="text-2xl font-semibold sm:text-3xl">{content.home.finalCtaTitle}</h2>
              <p className="max-w-2xl text-sm leading-7 text-white/75">{content.home.finalCtaBody}</p>
              <p className="text-2xl font-semibold text-white/90">+61 451 217 210</p>
            </div>
            <div className="flex flex-col gap-3">
              <Button asChild size="lg" className="rounded-full bg-white text-primary hover:bg-white/90 transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/quote">Start your quote</Link>
              </Button>
              <a
                href={WHATSAPP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#25D366] px-6 py-3 text-sm font-semibold text-white transition-transform duration-200 hover:-translate-y-0.5 hover:opacity-90"
              >
                <WhatsAppIcon className="h-4 w-4" />
                Chat on WhatsApp
              </a>
              <Button asChild size="lg" variant="outline" className="rounded-full border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white">
                <Link href="/contact">Email / call us</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
