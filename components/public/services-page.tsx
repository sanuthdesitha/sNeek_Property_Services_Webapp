"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MARKETED_SERVICES, SERVICE_FAMILY_META, getServicesByFamily, type ServiceFamily } from "@/lib/marketing/catalog";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";

interface ServicesPageProps {
  content: {
    eyebrow: string;
    title: string;
    intro: string;
  };
}

const familyOrder: ServiceFamily[] = ["short_stay", "residential", "specialty", "exterior", "commercial"];

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

export function ServicesPage({ content }: ServicesPageProps) {
  return (
    <div>
      {/* Hero */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="mx-auto max-w-3xl text-center">
          <p className="marketing-eyebrow lux-rise">{content.eyebrow}</p>
          <h1 className="lux-rise lux-rise-d1 mt-6 text-4xl text-foreground sm:text-5xl xl:text-6xl">{content.title}</h1>
          <p className="lux-rise lux-rise-d2 mx-auto mt-6 max-w-2xl text-base leading-8 text-muted-foreground">{content.intro}</p>
          <div className="lux-rise lux-rise-d3 mt-8 flex justify-center">
            <Button asChild size="lg" className="rounded-full px-8 py-6 text-sm tracking-wide transition-transform duration-300 hover:-translate-y-0.5">
              <Link href="/quote">Get an instant quote</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <div className="public-section-full border-y border-primary/8 bg-secondary/30 py-4 overflow-hidden">
        <div className="flex" aria-hidden="true">
          <div className="flex shrink-0 gap-4 animate-marquee pr-4">
            {[...TRUST_PILLS, ...TRUST_PILLS].map((pill, i) => (
              <span key={`a-${pill}-${i}`} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/80 bg-white dark:border-white/10 dark:bg-surface-raised px-4 py-2 text-sm font-medium text-foreground shadow-sm">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                {pill}
              </span>
            ))}
          </div>
          <div className="flex shrink-0 gap-4 animate-marquee pr-4" aria-hidden="true">
            {[...TRUST_PILLS, ...TRUST_PILLS].map((pill, i) => (
              <span key={`b-${pill}-${i}`} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/80 bg-white dark:border-white/10 dark:bg-surface-raised px-4 py-2 text-sm font-medium text-foreground shadow-sm">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                {pill}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Service families */}
      <div className={`${PUBLIC_PAGE_CONTAINER} py-10 sm:py-14`}>
        <div className="space-y-12 sm:space-y-16">
          {familyOrder.map((familyKey) => {
            const family = SERVICE_FAMILY_META[familyKey];
            const services = getServicesByFamily(familyKey);
            return (
              <section key={familyKey}>
                {/* Family header */}
                <div className="mb-6 grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-8">
                  <div className="space-y-2 xl:sticky xl:top-28 xl:self-start">
                    <p className="marketing-eyebrow">{family.label}</p>
                    <p className="text-sm leading-7 text-muted-foreground">{family.description}</p>
                  </div>
                  <div className="hidden xl:block" />
                </div>
                {/* Service cards */}
                <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-8">
                  <div className="hidden xl:block" />
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {services.map((service) => (
                      <Link key={service.jobType} href={`/services/${service.slug}`} className="group">
                        <Card className="h-full rounded-3xl border border-border/50 bg-card/70 shadow-none transition-all duration-500 hover:-translate-y-1 hover:border-primary/40">
                          <CardContent className="space-y-4 p-7">
                            <div className="inline-flex rounded-full border border-primary/25 p-3 text-primary">
                              <Sparkles className="h-5 w-5" />
                            </div>
                            <div className="space-y-2">
                              <h2 className="text-xl font-semibold">{service.label}</h2>
                              <p className="text-sm font-medium text-primary">{service.tagline}</p>
                              <p className="text-sm leading-6 text-muted-foreground">{service.summary}</p>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                              {service.highlights.map((highlight) => (
                                <span key={highlight} className="rounded-full border border-border/60 px-3 py-1">{highlight}</span>
                              ))}
                            </div>
                            <p className="inline-flex items-center text-xs font-medium text-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                              View details
                              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </p>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:mt-14 sm:flex-row">
          <Button asChild className="rounded-full shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
            <Link href="/quote">Get an instant quote</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/compare">Compare services</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/contact">
              Request a tailored quote
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

