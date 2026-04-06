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
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="max-w-3xl space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">{content.eyebrow}</p>
            <h1 className="text-3xl font-semibold sm:text-4xl xl:text-5xl">{content.title}</h1>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">{content.intro}</p>
          </div>
          <div className="hidden xl:flex">
            <Button asChild className="rounded-full shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
              <Link href="/quote">Get an instant quote</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Trust strip */}
      <div className="public-section-full border-y border-primary/8 bg-primary/4 py-4 overflow-hidden">
        <div className="flex" aria-hidden="true">
          <div className="flex shrink-0 gap-4 animate-marquee pr-4">
            {[...TRUST_PILLS, ...TRUST_PILLS].map((pill, i) => (
              <span key={`a-${pill}-${i}`} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/80 bg-white px-4 py-2 text-sm font-medium text-foreground shadow-sm">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                {pill}
              </span>
            ))}
          </div>
          <div className="flex shrink-0 gap-4 animate-marquee pr-4" aria-hidden="true">
            {[...TRUST_PILLS, ...TRUST_PILLS].map((pill, i) => (
              <span key={`b-${pill}-${i}`} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/80 bg-white px-4 py-2 text-sm font-medium text-foreground shadow-sm">
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
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">{family.label}</p>
                    <p className="text-sm leading-7 text-muted-foreground">{family.description}</p>
                  </div>
                  <div className="hidden xl:block" />
                </div>
                {/* Service cards */}
                <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-8">
                  <div className="hidden xl:block" />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {services.map((service) => (
                      <Link key={service.jobType} href={`/services/${service.slug}`} className="group">
                        <Card className="h-full rounded-[1.8rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-32px_rgba(25,67,74,0.4)]">
                          <CardContent className="space-y-4 p-6">
                            <div className={`inline-flex rounded-2xl bg-gradient-to-br ${service.cardColor} p-3 text-white shadow-sm`}>
                              <Sparkles className="h-5 w-5" />
                            </div>
                            <div className="space-y-2">
                              <h2 className="text-lg font-semibold">{service.label}</h2>
                              <p className="text-sm font-medium text-primary">{service.tagline}</p>
                              <p className="text-sm leading-6 text-muted-foreground">{service.summary}</p>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                              {service.highlights.map((highlight) => (
                                <span key={highlight} className="rounded-full border border-border/70 px-3 py-1">{highlight}</span>
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

