"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";

interface SubscriptionsPageProps {
  plans: any[];
  content: {
    eyebrow: string;
    title: string;
    intro: string;
    compareTitle: string;
    compareBody: string;
  };
}

export function SubscriptionsPage({ plans, content }: SubscriptionsPageProps) {
  return (
    <div>
      {/* ── Hero ── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="max-w-3xl space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">{content.eyebrow}</p>
            <h1 className="text-3xl font-semibold sm:text-4xl xl:text-5xl">{content.title}</h1>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">{content.intro}</p>
          </div>
          <div className="hidden xl:flex">
            <Button asChild variant="outline" className="rounded-full transition-transform duration-200 hover:-translate-y-0.5">
              <Link href="/contact">Talk to us about your plan</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Plan cards ── */}
      <div className="public-section-full bg-primary/4">
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          {plans.length === 0 ? (
            <div className="rounded-[2rem] border border-white/70 bg-white/80 p-10 text-center text-muted-foreground shadow-sm">
              No subscription plans have been published yet. Check back soon.
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan: any) => (
                <Card key={plan.id} className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-32px_rgba(25,67,74,0.4)]">
                  <CardContent className="space-y-5 p-7">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">{plan.name}</p>
                      <p className="text-3xl font-semibold">
                        {plan.priceLabel || (typeof plan.startingPrice === "number" ? `$${plan.startingPrice}` : "Custom")}
                      </p>
                      {plan.tagline ? <p className="text-sm font-medium text-primary">{plan.tagline}</p> : null}
                      <p className="text-sm leading-6 text-muted-foreground">{plan.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {(Array.isArray(plan.serviceTypes) ? plan.serviceTypes : []).map((jobType: any) => (
                        <span key={String(jobType)} className="rounded-full border border-border/70 px-3 py-1">
                          {MARKETED_SERVICES.find((s) => s.jobType === jobType)?.shortLabel ?? String(jobType)}
                        </span>
                      ))}
                    </div>
                    <ul className="space-y-3 text-sm text-muted-foreground">
                      {(Array.isArray(plan.features) ? plan.features : []).map((point: any) => (
                        <li key={String(point)} className="flex gap-3">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          <span>{String(point)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button asChild className="rounded-full">
                        <Link href={plan.ctaHref || "/contact"}>{plan.ctaLabel || "Register interest"}</Link>
                      </Button>
                      <Button asChild variant="outline" className="rounded-full">
                        <Link href="/terms">Read terms</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ── Compare / CTA card ── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)] sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold sm:text-2xl">{content.compareTitle}</h2>
              <p className="text-sm leading-7 text-muted-foreground">{content.compareBody}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
              <Button asChild className="rounded-full shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/contact">Ask about recurring service</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link href="/quote">Get pricing first</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} pb-16 pt-2 sm:pb-24`}>
        <Card className="rounded-[2rem] border-white/70 bg-gradient-to-br from-primary/95 to-[#163b41] text-white shadow-[0_24px_70px_-36px_rgba(15,77,84,0.6)]">
          <CardContent className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/60">Ongoing property care</p>
              <h2 className="text-2xl font-semibold">Consistent cleaning without rebooking every time.</h2>
              <p className="max-w-xl text-sm leading-7 text-white/75">
                Lock in a plan that suits your property, get recurring service at a better rate, and stop thinking about it.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:shrink-0">
              <Button asChild size="lg" className="rounded-full bg-white text-primary hover:bg-white/90 transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/quote">Start your quote</Link>
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

