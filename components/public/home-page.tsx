"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import {
  ArrowRight,
  BadgeCheck,
  Camera,
  CheckCircle2,
  Leaf,
  Loader2,
  MapPin,
  ShieldCheck,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import type { WebsiteContent, WebsiteWhyItem } from "@/lib/public-site/content";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";
import { ScrollVacuum } from "@/components/public/scroll-vacuum";
import type { ServiceSuburb } from "@/lib/public-site/suburbs";
import { DEFAULT_PUBLIC_WIDGETS, type PublicWidgetFlags } from "@/lib/public-site/widgets-types";

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

const featuredServices = MARKETED_SERVICES.slice(0, 6);

type QuoteEstimatorState = {
  serviceType: string;
  bedrooms: number;
  bathrooms: number;
};

type LiveQuoteState = {
  total: number;
  subtotal: number;
  gst: number;
  pricingMode: "exact" | "fallback";
  requiresAdminApproval: boolean;
} | null;

type AvailabilityState =
  | { available?: boolean; nextSlot?: string | null; message?: string | null; error?: string | null }
  | null;

type GoogleReviewCard = {
  author_name: string;
  text: string;
  rating: number;
  relative_time_description?: string | null;
};

type GoogleReviewsState = {
  rating: number | null;
  user_ratings_total: number | null;
  reviews: GoogleReviewCard[];
  source?: string;
} | null;

function hasAvailabilityError(value: AvailabilityState) {
  return Boolean(value && typeof value === "object" && "error" in value && value.error);
}

export function HomePage({
  content,
  latestBlogPosts = [],
  widgetFlags = DEFAULT_PUBLIC_WIDGETS,
}: {
  content: WebsiteContent;
  latestBlogPosts?: Array<{
    id: string;
    slug: string;
    title: string;
    excerpt: string;
    coverImageUrl: string | null;
    publishedAt: string | Date | null;
    updatedAt?: string | Date;
    authorName?: string | null;
  }>;
  widgetFlags?: PublicWidgetFlags;
}) {
  const faqPreview = content.faq?.items?.slice(0, 6) ?? [];
  const whyItems = (content.whyChooseUs?.items ?? []).slice(0, 6);
  const estimatorOptions = useMemo(
    () => MARKETED_SERVICES.filter((service) => service.autoPricingMode === "estimate"),
    []
  );
  const [estimator, setEstimator] = useState<QuoteEstimatorState>(() => ({
    serviceType: estimatorOptions[0]?.jobType ?? "GENERAL_CLEAN",
    bedrooms: 2,
    bathrooms: 1,
  }));
  const [liveQuote, setLiveQuote] = useState<LiveQuoteState>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [suburb, setSuburb] = useState("");
  const [availability, setAvailability] = useState<AvailabilityState>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilitySuggestions, setAvailabilitySuggestions] = useState<ServiceSuburb[]>([]);
  const [nextSlot, setNextSlot] = useState<string | null>(null);
  const [reviews, setReviews] = useState<GoogleReviewsState>(null);
  const [hostingPreviewIndex, setHostingPreviewIndex] = useState<number | null>(null);
  const scrollRef = useScrollReveal();
  const activeHostingFeature =
    hostingPreviewIndex != null ? content.home.hostingFeatures[hostingPreviewIndex] ?? null : null;

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setQuoteLoading(true);
      try {
        const response = await fetch("/api/public/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceType: estimator.serviceType,
            bedrooms: estimator.bedrooms,
            bathrooms: estimator.bathrooms,
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!active) return;
        if (response.ok) {
          setLiveQuote({
            total: Number(body.total ?? 0),
            subtotal: Number(body.subtotal ?? 0),
            gst: Number(body.gst ?? 0),
            pricingMode: body.pricingMode === "exact" ? "exact" : "fallback",
            requiresAdminApproval: body.requiresAdminApproval !== false,
          });
        } else {
          setLiveQuote(null);
        }
      } finally {
        if (active) setQuoteLoading(false);
      }
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [estimator.bathrooms, estimator.bedrooms, estimator.serviceType]);

  useEffect(() => {
    let active = true;

    async function loadLivePublicData() {
      try {
        const [slotRes, reviewRes] = await Promise.all([
          fetch("/api/public/next-slot", { cache: "no-store" }),
          fetch("/api/public/google-reviews", { cache: "no-store" }),
        ]);
        const slotBody = await slotRes.json().catch(() => ({}));
        const reviewBody = await reviewRes.json().catch(() => ({}));
        if (!active) return;
        setNextSlot(typeof slotBody?.nextSlot === "string" ? slotBody.nextSlot : null);
        setReviews({
          rating:
            typeof reviewBody?.rating === "number" ? reviewBody.rating : null,
          user_ratings_total:
            typeof reviewBody?.user_ratings_total === "number"
              ? reviewBody.user_ratings_total
              : null,
          reviews: Array.isArray(reviewBody?.reviews) ? reviewBody.reviews.slice(0, 6) : [],
          source: typeof reviewBody?.source === "string" ? reviewBody.source : undefined,
        });
      } catch {
        if (!active) return;
        setNextSlot(null);
        setReviews(null);
      }
    }

    loadLivePublicData();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const query = suburb.trim();
    if (query.length < 2) {
      setAvailabilitySuggestions([]);
      return;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/public/availability/suggestions?q=${encodeURIComponent(query)}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        if (!active) return;
        setAvailabilitySuggestions(Array.isArray(body?.items) ? body.items : []);
      } catch {
        if (!active) return;
        setAvailabilitySuggestions([]);
      }
    }, 180);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [suburb]);

  const displayedTestimonials =
    reviews?.reviews && reviews.reviews.length > 0
      ? reviews.reviews.map((item) => ({
          quote: item.text,
          author: item.author_name,
          meta: item.relative_time_description || "Google Review",
          rating: item.rating,
        }))
      : content.home.testimonials.map((item) => ({ ...item, rating: 5 }));

  async function handleAvailabilityCheck() {
    if (!suburb.trim()) {
      setAvailability({ error: "Enter your suburb to check availability." });
      return;
    }
    setAvailabilityLoading(true);
    try {
      const response = await fetch(`/api/public/availability?suburb=${encodeURIComponent(suburb.trim())}`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      setAvailability(
        response.ok
          ? {
              available: body.available !== false,
              nextSlot: typeof body.nextSlot === "string" ? body.nextSlot : null,
              message: typeof body.message === "string" ? body.message : null,
            }
          : {
              error: body.error ?? "Could not check availability right now.",
            }
      );
    } finally {
      setAvailabilityLoading(false);
    }
  }

  return (
    <div ref={scrollRef as React.RefObject<HTMLDivElement>}>
      {/* ─────────────────────────────────────────────────
          HERO — calm, editorial. WHO WE ARE.
          The scroll-vacuum travels right → left behind the copy.
      ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Signature scroll-driven vacuum (image-sequence ready, SVG fallback now) */}
        <ScrollVacuum />

        <div className={`${PUBLIC_PAGE_CONTAINER} relative z-10`}>
          <div className="mx-auto max-w-3xl py-24 text-center sm:py-32 lg:py-40">
            <p className="marketing-eyebrow lux-rise">{content.home.eyebrow}</p>
            <h1 className="lux-rise lux-rise-d1 mt-7 text-balance text-[2.6rem] leading-[1.05] text-foreground sm:text-6xl lg:text-7xl">
              {content.home.title}
            </h1>
            <p className="lux-rise lux-rise-d2 mx-auto mt-8 max-w-xl text-base leading-8 text-muted-foreground sm:text-lg">
              {content.home.subtitle}
            </p>
            <div className="lux-rise lux-rise-d3 mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="min-w-[200px] rounded-full px-8 py-6 text-sm tracking-wide shadow-sm transition-transform duration-300 hover:-translate-y-0.5">
                <Link href="/quote">{content.home.primaryCtaLabel}</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="min-w-[200px] rounded-full border-foreground/15 px-8 py-6 text-sm tracking-wide transition-transform duration-300 hover:-translate-y-0.5">
                <Link href="/contact">
                  {content.home.secondaryCtaLabel}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <p className="lux-rise lux-rise-d4 mt-8 text-xs uppercase tracking-[0.22em] text-muted-foreground/80">
              {nextSlot ? `Next available · ${nextSlot}` : "Quiet, dependable property care across Sydney"}
            </p>
          </div>
        </div>
      </section>

      {/* Hero image — large, editorial, full-bleed band */}
      <div className="public-section-full">
        <div className={`${PUBLIC_PAGE_CONTAINER}`}>
          <div className="lux-fade relative overflow-hidden rounded-[2rem]">
            <img
              src={content.home.heroImageUrl}
              alt={content.home.heroImageAlt}
              className="h-[340px] w-full object-cover sm:h-[480px] lg:h-[620px]"
              loading="eager"
              onError={(e) => { e.currentTarget.style.background = "hsl(var(--muted))"; }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 p-6 text-xs uppercase tracking-[0.22em] text-white/90 sm:p-8">
              <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> $5M Insured</span>
              <span className="flex items-center gap-2"><Camera className="h-3.5 w-3.5" /> Photo Reports</span>
              <span className="flex items-center gap-2"><Star className="h-3.5 w-3.5" /> 4.9 Rated</span>
              <span className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" /> Parramatta</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────
          BRAND STATEMENT + STATS — quiet, generous whitespace
      ───────────────────────────────────────────────── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="mx-auto max-w-3xl text-center">
          <p className="scroll-reveal text-balance text-2xl leading-[1.5] text-foreground/90 sm:text-[1.75rem] sm:leading-[1.55]">
            {content.home.brandIdea}
          </p>
        </div>
        <div className="mx-auto mt-16 grid max-w-4xl gap-px overflow-hidden rounded-3xl border border-border/60 bg-border/40 sm:grid-cols-3">
          {content.home.stats.map((item, i) => (
            <div key={item.label} className={`scroll-reveal scroll-delay-${[100, 200, 300][i % 3]} bg-card/80 px-8 py-10 text-center backdrop-blur-sm`}>
              <p className="text-4xl font-light text-primary sm:text-5xl">{item.value}</p>
              <p className="mt-3 text-sm font-medium text-foreground">{item.label}</p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────────────────────────────────────────
          WHY CHOOSE US — second core message, calm grid
      ───────────────────────────────────────────────── */}
      <div className="public-section-full bg-secondary/30">
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <p className="marketing-eyebrow scroll-reveal">Why choose sNeek</p>
            <h2 className="scroll-reveal mt-5 text-4xl text-foreground sm:text-5xl">
              {content.whyChooseUs?.title ?? "The sNeek difference"}
            </h2>
            <p className="scroll-reveal mt-6 text-base leading-8 text-muted-foreground">
              {content.whyChooseUs?.intro ??
                "What makes working with us different from the next cleaning company you will find online."}
            </p>
          </div>
          <div className="grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {whyItems.map((item: WebsiteWhyItem, idx: number) => (
              <div key={item.id} className={`scroll-reveal scroll-delay-${[100, 200, 300][idx % 3]} text-center sm:text-left`}>
                <div className="mx-auto mb-5 inline-flex h-12 w-12 items-center justify-center rounded-full border border-primary/25 text-primary sm:mx-0">
                  <WhyIcon iconName={item.icon} className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2.5 text-sm leading-7 text-muted-foreground">{item.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-16 flex justify-center">
            <Button asChild size="lg" className="rounded-full px-8 py-6 text-sm tracking-wide">
              <Link href="/why-us">More about our approach</Link>
            </Button>
          </div>
        </section>
      </div>

      {/* ─────────────────────────────────────────────────
          WHAT WE OFFER — third core message, editorial list
      ───────────────────────────────────────────────── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="marketing-eyebrow scroll-reveal">What we offer</p>
          <h2 className="scroll-reveal mt-5 text-4xl text-foreground sm:text-5xl">{content.home.servicesTitle}</h2>
          <p className="scroll-reveal mt-6 text-base leading-8 text-muted-foreground">{content.home.servicesIntro}</p>
        </div>

        {/* Three primary capability cards */}
        <div className="grid gap-6 lg:grid-cols-3">
          {content.home.serviceBenefits.map((card, i) => (
            <div key={card.id} className={`scroll-reveal scroll-delay-${[100, 200, 300][i % 3]} group overflow-hidden rounded-3xl border border-border/50 bg-card/70`}>
              <div className="relative h-60 overflow-hidden">
                <img
                  src={card.imageUrl}
                  alt={card.imageAlt}
                  className="h-full w-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-105"
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.background = "hsl(var(--muted))"; }}
                />
              </div>
              <div className="space-y-3 p-8">
                <h3 className="text-xl font-semibold text-foreground">{card.title}</h3>
                <p className="text-sm leading-7 text-muted-foreground">{card.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Popular services — quiet linked list */}
        <div className="mt-16">
          <div className="lux-rule mb-10" />
          <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {featuredServices.map((service) => (
              <Link
                key={service.jobType}
                href={`/services/${service.slug}`}
                className="scroll-reveal group flex items-start gap-4 border-b border-border/40 pb-6 transition-colors hover:border-primary/40"
              >
                <Sparkles className="mt-1 h-4 w-4 shrink-0 text-primary/70" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground transition-colors group-hover:text-primary">{service.label}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{service.tagline}</p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 -translate-x-1 text-primary opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
              </Link>
            ))}
          </div>
          <div className="mt-12 flex flex-wrap justify-center gap-3">
            <Button asChild variant="outline" className="rounded-full px-7">
              <Link href="/services">View all services</Link>
            </Button>
            <Button asChild variant="outline" className="rounded-full px-7">
              <Link href="/subscriptions">Explore subscriptions</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────
          AIRBNB HOSTING — editorial split
      ───────────────────────────────────────────────── */}
      <div className="public-section-full bg-secondary/30">
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
            <div className="scroll-reveal-left space-y-6">
              <p className="marketing-eyebrow">Airbnb &amp; managed properties</p>
              <h2 className="text-4xl text-foreground sm:text-5xl">{content.home.hostingTitle}</h2>
              <p className="text-base leading-8 text-muted-foreground">{content.home.hostingIntro}</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-foreground/80">
                {["Photo Reports", "Laundry Handled", "Same-Day Turnovers"].map((badge) => (
                  <span key={badge} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    {badge}
                  </span>
                ))}
              </div>
              <Button asChild className="rounded-full px-7">
                <Link href="/airbnb-hosting">
                  See hosting support
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {content.home.hostingFeatures.map((card, index) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => setHostingPreviewIndex(index)}
                  className="scroll-reveal group overflow-hidden rounded-2xl border border-border/50 bg-card/70 text-left transition-transform duration-500 hover:-translate-y-1"
                >
                  <img
                    src={card.imageUrl}
                    alt={card.imageAlt}
                    className="h-28 w-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-105"
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.background = "hsl(var(--muted))"; e.currentTarget.style.minHeight = "7rem"; }}
                  />
                  <div className="p-4">
                    <p className="text-sm font-semibold text-foreground">{card.title}</p>
                    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{card.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ─────────────────────────────────────────────────
          QUOTE + AVAILABILITY TOOLS — restyled containers, same wiring
      ───────────────────────────────────────────────── */}
      {(widgetFlags.instantQuoteEstimator || widgetFlags.availabilityChecker) && (
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <p className="marketing-eyebrow scroll-reveal">Begin the conversation</p>
            <h2 className="scroll-reveal mt-5 text-4xl text-foreground sm:text-5xl">A clear price, before you enquire.</h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {widgetFlags.instantQuoteEstimator && (
              <div className="scroll-reveal rounded-3xl border border-border/50 bg-card/70 p-8">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-lg font-semibold text-foreground">Instant estimator</h3>
                  <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Estimate only</span>
                </div>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  <label className="space-y-1.5 text-sm">
                    <span className="text-muted-foreground">Service</span>
                    <select
                      className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                      value={estimator.serviceType}
                      onChange={(event) =>
                        setEstimator((current) => ({ ...current, serviceType: event.target.value }))
                      }
                    >
                      {estimatorOptions.map((service) => (
                        <option key={service.jobType} value={service.jobType}>
                          {service.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="text-muted-foreground">Bedrooms</span>
                    <select
                      className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                      value={estimator.bedrooms}
                      onChange={(event) =>
                        setEstimator((current) => ({ ...current, bedrooms: Number(event.target.value) }))
                      }
                    >
                      {Array.from({ length: 6 }).map((_, index) => (
                        <option key={`bed-${index + 1}`} value={index + 1}>
                          {index + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5 text-sm">
                    <span className="text-muted-foreground">Bathrooms</span>
                    <select
                      className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                      value={estimator.bathrooms}
                      onChange={(event) =>
                        setEstimator((current) => ({ ...current, bathrooms: Number(event.target.value) }))
                      }
                    >
                      {Array.from({ length: 5 }).map((_, index) => (
                        <option key={`bath-${index + 1}`} value={index + 1}>
                          {index + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="mt-6 rounded-2xl border border-border/50 bg-secondary/40 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Live result</p>
                  {quoteLoading ? (
                    <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Calculating estimate...
                    </div>
                  ) : liveQuote ? (
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="text-3xl font-light text-foreground">From ${liveQuote.total.toFixed(2)}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {liveQuote.gst > 0 ? "GST included." : "GST not applied."}{" "}
                          {liveQuote.pricingMode === "exact" ? "Matched from active pricing." : "Condition-based guide pending review."}
                        </p>
                      </div>
                      <Button asChild className="rounded-full">
                        <Link href="/quote">Open full quote</Link>
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Choose the service and room counts above to load a live starting estimate.
                    </p>
                  )}
                </div>
              </div>
            )}

            {widgetFlags.availabilityChecker && (
              <div className="scroll-reveal rounded-3xl border border-border/50 bg-card/70 p-8">
                <h3 className="text-lg font-semibold text-foreground">Availability checker</h3>
                <p className="mt-1 text-sm text-muted-foreground">Check your suburb and see the next likely slot.</p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <input
                      value={suburb}
                      onChange={(event) => setSuburb(event.target.value)}
                      placeholder="Enter suburb or postcode"
                      className="flex h-11 w-full rounded-xl border border-input bg-background px-4 text-sm outline-none transition-colors focus:border-primary"
                    />
                    {availabilitySuggestions.length > 0 ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-20 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_18px_48px_-28px_rgba(22,63,70,0.32)]">
                        {availabilitySuggestions.map((item) => (
                          <button
                            key={`${item.slug}-${item.postcode}`}
                            type="button"
                            onClick={() => {
                              setSuburb(item.name);
                              setAvailabilitySuggestions([]);
                            }}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-primary/6"
                          >
                            <span className="font-medium text-foreground">
                              {item.name} <span className="font-normal text-muted-foreground">{item.postcode}</span>
                            </span>
                            <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${item.coverage === "standard" ? "bg-primary/10 text-primary" : "bg-amber-100 text-amber-900"}`}>
                              {item.coverage === "standard" ? "Within 50km" : "Contact team"}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    onClick={handleAvailabilityCheck}
                    disabled={availabilityLoading}
                    className="rounded-full"
                  >
                    {availabilityLoading ? "Checking..." : "Check"}
                  </Button>
                </div>
                <div className="mt-5 rounded-2xl border border-border/50 bg-secondary/40 p-5">
                  {hasAvailabilityError(availability) ? (
                    <p className="text-sm text-destructive">{availability?.error}</p>
                  ) : availability ? (
                    <div className="space-y-2 text-sm">
                      <p className={`font-medium ${availability?.available === false ? "text-amber-900" : "text-foreground"}`}>
                        {availability?.message || "We cover your area and can review the next suitable window."}
                      </p>
                      {availability?.nextSlot ? (
                        <p className="text-muted-foreground">Next likely slot: {availability.nextSlot}</p>
                      ) : null}
                      <p className="text-muted-foreground">
                        {availability?.available === false
                          ? "Your suburb is outside our main Parramatta service radius, so call or message the team for a manual check."
                          : "If the job is urgent, use WhatsApp or call for the fastest response."}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Enter your suburb or postcode to check local coverage and likely next availability.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ─────────────────────────────────────────────────
          TESTIMONIALS — quiet, generous
      ───────────────────────────────────────────────── */}
      <div className="public-section-full bg-secondary/30">
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <p className="marketing-eyebrow scroll-reveal">What clients say</p>
            <h2 className="scroll-reveal mt-5 text-4xl text-foreground sm:text-5xl">Trusted across Sydney.</h2>
            {reviews?.rating ? (
              <p className="scroll-reveal mt-4 text-sm text-muted-foreground">
                {reviews.rating.toFixed(1)} stars
                {reviews.user_ratings_total ? ` from ${reviews.user_ratings_total}+ Google reviews` : ""}
              </p>
            ) : null}
          </div>
          <div className="grid gap-10 md:grid-cols-3">
            {displayedTestimonials.slice(0, 3).map((item, i) => (
              <figure key={`${item.author}-${item.meta}`} className={`scroll-reveal scroll-delay-${[100, 200, 300][i % 3]} flex flex-col`}>
                <div className="mb-4 flex gap-0.5">
                  {Array.from({ length: Math.max(1, Math.min(5, Number((item as any).rating ?? 5))) }).map((_, s) => (
                    <Star key={s} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <blockquote className="flex-1 font-display-serif text-xl leading-[1.6] text-foreground/90">
                  &ldquo;{item.quote}&rdquo;
                </blockquote>
                <figcaption className="mt-6">
                  <p className="font-semibold text-foreground">{item.author}</p>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.meta}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>

      {/* ─────────────────────────────────────────────────
          BLOG (optional)
      ───────────────────────────────────────────────── */}
      {content.pageVisibility.blog !== false && latestBlogPosts.length > 0 ? (
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          <div className="mb-12 flex flex-wrap items-end justify-between gap-4">
            <div className="scroll-reveal max-w-xl space-y-3">
              <p className="marketing-eyebrow">From the journal</p>
              <h2 className="text-4xl text-foreground sm:text-5xl">Notes on cleaning &amp; hosting.</h2>
            </div>
            <Button asChild variant="outline" className="rounded-full px-7">
              <Link href="/blog">Visit the blog</Link>
            </Button>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {latestBlogPosts.map((post, i) => (
              <Link key={post.id} href={`/blog/${post.slug}`} className={`scroll-reveal scroll-delay-${[100, 200, 300][i % 3]} group block`}>
                {post.coverImageUrl ? (
                  <div className="mb-5 overflow-hidden rounded-2xl">
                    <img src={post.coverImageUrl} alt={post.title} className="h-52 w-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-105" loading="lazy" />
                  </div>
                ) : null}
                <p className="text-lg font-semibold text-foreground transition-colors group-hover:text-primary">{post.title}</p>
                <p className="mt-2 line-clamp-3 text-sm leading-7 text-muted-foreground">{post.excerpt}</p>
                <span className="mt-4 inline-flex items-center text-sm font-medium text-primary">
                  Read article
                  <ArrowRight className="ml-2 h-4 w-4" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* ─────────────────────────────────────────────────
          FAQ
      ───────────────────────────────────────────────── */}
      {faqPreview.length > 0 && (
        <div className="public-section-full bg-secondary/30">
          <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
            <div className="grid gap-12 lg:grid-cols-[0.8fr_minmax(0,1fr)] lg:gap-20">
              <div className="scroll-reveal-left space-y-5">
                <p className="marketing-eyebrow">Frequently asked</p>
                <h2 className="text-4xl text-foreground sm:text-5xl">{content.faq?.title ?? "Got questions?"}</h2>
                <p className="text-base leading-8 text-muted-foreground">{content.faq?.intro ?? "Everything you need to know before booking."}</p>
                <Button asChild variant="outline" className="rounded-full px-7">
                  <Link href="/faq">See all FAQs</Link>
                </Button>
              </div>
              <Accordion type="single" collapsible className="divide-y divide-border/50">
                {faqPreview.map((item) => (
                  <AccordionItem key={item.id} value={item.id} className="border-none">
                    <AccordionTrigger className="py-5 text-left text-base font-medium hover:no-underline [&[data-state=open]>svg]:rotate-180">
                      {item.question}
                    </AccordionTrigger>
                    <AccordionContent className="pb-5 text-sm leading-7 text-muted-foreground">
                      {item.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </section>
        </div>
      )}

      {/* Hosting feature dialog (preserved) */}
      <Dialog open={hostingPreviewIndex != null} onOpenChange={(open) => !open && setHostingPreviewIndex(null)}>
        <DialogContent className="max-w-4xl">
          {activeHostingFeature ? (
            <>
              <DialogHeader>
                <DialogTitle>{activeHostingFeature.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <img
                  src={activeHostingFeature.imageUrl}
                  alt={activeHostingFeature.imageAlt}
                  className="max-h-[70vh] w-full rounded-3xl object-contain"
                />
                <p className="text-sm leading-7 text-muted-foreground">{activeHostingFeature.description}</p>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────
          FINAL CTA — calm, confident
      ───────────────────────────────────────────────── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="mx-auto max-w-3xl text-center">
          <p className="marketing-eyebrow scroll-reveal">Next step</p>
          <h2 className="scroll-reveal mt-5 text-4xl text-foreground sm:text-6xl">{content.home.finalCtaTitle}</h2>
          <p className="scroll-reveal mx-auto mt-6 max-w-xl text-base leading-8 text-muted-foreground">{content.home.finalCtaBody}</p>
          <div className="scroll-reveal mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="min-w-[200px] rounded-full px-8 py-6 text-sm tracking-wide">
              <Link href="/quote">Start your quote</Link>
            </Button>
            <a
              href={WHATSAPP_HREF}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-[200px] items-center justify-center gap-2 rounded-full border border-foreground/15 px-8 py-[1.15rem] text-sm font-medium tracking-wide text-foreground transition-transform duration-300 hover:-translate-y-0.5"
            >
              <WhatsAppIcon className="h-4 w-4 text-[#25D366]" />
              WhatsApp us
            </a>
          </div>
          <p className="scroll-reveal mt-8 text-2xl font-light text-foreground/80">+61 451 217 210</p>
        </div>
      </section>
    </div>
  );
}
