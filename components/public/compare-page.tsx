"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, ClipboardList, ShieldCheck, X, Zap } from "lucide-react";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const COMPARISON_ROWS = [
  { key: "idealFor", label: "Ideal for" },
  { key: "priceGuide", label: "Price guide" },
];

export function ComparePage({ servicePages }: { readonly servicePages: Record<string, any> }) {
  const slugs = ["general-clean", "deep-clean", "end-of-lease", "airbnb-turnover"];
  const services = slugs
    .map((slug) => ({ marketing: MARKETED_SERVICES.find((item) => item.slug === slug), page: servicePages[slug], slug }))
    .filter((item) => item.marketing && item.page);

  return (
    <>
      {/* ─── HERO ─── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.08fr)_minmax(440px,0.92fr)] xl:items-center xl:gap-14 2xl:gap-20">
          <div className="space-y-7 animate-fade-up">
            <Badge className="w-fit rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] sm:text-xs">
              Compare services
            </Badge>
            <div className="space-y-4">
              <h1 className="max-w-2xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Choose the right cleaning scope before you book
              </h1>
              <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                Compare the most requested service types side by side so you can book the right level of detail the first time.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full px-6 shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/quote">Get an instant quote</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full px-6 transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/services">
                  Browse all services
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/6 px-3 py-1.5 font-medium text-primary">
                <CheckCircle2 className="h-4 w-4" />
                4 popular service types compared side by side
              </span>
              <span className="text-muted-foreground">Useful before booking if you are unsure whether you need standard, deep, end-of-lease, or turnover scope.</span>
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_24px_70px_-34px_rgba(26,67,74,0.38)] space-y-5 sm:p-7">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-primary/10 p-3 shrink-0">
                <ClipboardList className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">Choose the right scope first.</p>
                <p className="mt-0.5 text-xs text-muted-foreground">4 service types compared side by side</p>
              </div>
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Quick guide</p>
            <div className="space-y-2.5">
              {[
                { label: "General Clean", note: "Regular maintenance visits", tint: true },
                { label: "Deep Clean", note: "Heavy soiling & neglect reset", tint: false },
                { label: "End of Lease", note: "Bond-back inspection ready", tint: true },
                { label: "Airbnb Turnover", note: "Same-day guest-ready reset", tint: false },
              ].map(({ label, note, tint }) => (
                <div key={label} className={`flex items-start gap-3 rounded-[1.2rem] border border-border/60 px-4 py-3 ${tint ? "bg-primary/5" : "bg-background/60"}`}>
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{note}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { icon: ShieldCheck, label: "Fully insured" },
                { icon: Zap, label: "Same-day available" },
                { icon: CheckCircle2, label: "Instant quotes" },
              ].map(({ icon: Icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/6 px-3 py-1.5 text-xs font-medium text-primary">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── FULL-BLEED: COMPARISON CARDS ─── */}
      <div className="public-section-full bg-primary/4">
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          <div className="mb-10 space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Side-by-side comparison</p>
            <h2 className="text-2xl font-semibold sm:text-3xl">What is included in each service type</h2>
          </div>
          {services.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {services.map(({ marketing, page, slug }, idx) => (
                <Card
                  key={slug}
                  className="animate-fade-up rounded-[1.8rem] border-white/70 bg-white/85 shadow-[0_18px_50px_-28px_rgba(22,63,70,0.32)] transition-all duration-300 hover:-translate-y-1"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <CardHeader className="pb-3">
                    <div className={`mb-3 inline-flex rounded-2xl p-2.5 w-fit ${idx % 2 === 0 ? "bg-primary/10" : "bg-accent"}`}>
                      <ClipboardList className={`h-4 w-4 ${idx % 2 === 0 ? "text-primary" : "text-accent-foreground"}`} />
                    </div>
                    <CardTitle className="text-lg">{marketing?.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {COMPARISON_ROWS.map((row) => (
                      <div key={row.key} className="space-y-1">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{row.label}</p>
                        <p className="text-sm leading-6">{page?.[row.key] || "-"}</p>
                      </div>
                    ))}
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">What is included</p>
                      <ul className="space-y-2 text-sm">
                        {(page?.whatIncluded ?? []).slice(0, 6).map((item: string) => (
                          <li key={`${slug}-${item}`} className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {(page?.notIncluded ?? []).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Not included</p>
                        <ul className="space-y-1.5 text-sm text-muted-foreground">
                          {(page?.notIncluded ?? []).slice(0, 3).map((item: string) => (
                            <li key={`${slug}-not-${item}`} className="flex items-start gap-2">
                              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <Button asChild className="w-full rounded-full">
                      <Link href={`/services/${slug}`}>
                        View full details
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/70 bg-white/80 p-8 text-center text-muted-foreground">
              Service comparison details are coming soon.
            </div>
          )}
        </section>
      </div>

      {/* ─── BOTTOM CTA ─── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="rounded-[2rem] border border-white/70 bg-white/80 p-7 shadow-[0_20px_60px_-32px_rgba(25,67,74,0.30)] sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-10">
          <div className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Not sure which service fits?</p>
            <h2 className="text-2xl font-semibold sm:text-3xl">
              Get a quote and let us recommend the right scope.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              Our instant quote tool walks you through the key questions and recommends the most appropriate service level for your situation.
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row lg:mt-0 lg:shrink-0">
            <Button asChild size="lg" className="rounded-full px-6 shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
              <Link href="/quote">Get instant quote</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-6 transition-transform duration-200 hover:-translate-y-0.5">
              <Link href="/contact">
                Ask the team
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
