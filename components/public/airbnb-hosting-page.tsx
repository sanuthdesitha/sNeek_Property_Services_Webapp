"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/public-site-shell";
import { ClientImage, ClientImageCover } from "@/components/public/client-image";

interface AirbnbHostingPageProps {
  content: {
    eyebrow: string;
    title: string;
    subtitle: string;
    heroImageUrl: string;
    heroImageAlt: string;
    featuresTitle: string;
    featuresIntro: string;
    features: { id: string; title: string; description: string; imageUrl: string; imageAlt: string }[];
    reportsTitle: string;
    reportsBody: string;
  };
}

export function AirbnbHostingPage({ content }: AirbnbHostingPageProps) {
  return (
    <div>
      {/* ── Hero ── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(520px,1fr)] xl:items-center xl:gap-14">
          <div className="space-y-5">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">{content.eyebrow}</p>
            <h1 className="text-3xl font-semibold sm:text-4xl xl:text-5xl">{content.title}</h1>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">{content.subtitle}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild className="rounded-full shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/quote">Quote your property</Link>
              </Button>
              <Button asChild variant="outline" className="rounded-full transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/contact">
                  Ask about managed support
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
          <Card className="overflow-hidden rounded-[2rem] border-white/70 bg-white/80 shadow-[0_24px_70px_-34px_rgba(26,67,74,0.38)]">
            <ClientImage
              src={content.heroImageUrl}
              alt={content.heroImageAlt}
              className="h-[280px] w-full object-cover sm:h-[360px] xl:h-[460px]"
              loading="eager"
            />
          </Card>
        </div>
      </section>

      {/* ── Feature cards ── */}
      <div className="public-section-full bg-primary/4">
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          <div className="mb-8 max-w-2xl space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">{content.featuresTitle}</p>
            <p className="text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">{content.featuresIntro}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {content.features.map((feature) => (
              <Card key={feature.id} className="overflow-hidden rounded-[1.8rem] border-white/70 bg-white/80 shadow-[0_16px_45px_-30px_rgba(22,63,70,0.38)] transition-all duration-300 hover:-translate-y-1">
                <ClientImageCover
                  src={feature.imageUrl}
                  alt={feature.imageAlt}
                  className="h-52 w-full object-cover"
                />
                <CardContent className="space-y-3 p-6">
                  <h2 className="text-lg font-semibold">{feature.title}</h2>
                  <p className="text-sm leading-6 text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>

      {/* ── Reports + outcome ── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="rounded-[2rem] border-white/70 bg-white/80 shadow-[0_16px_45px_-30px_rgba(22,63,70,0.38)]">
            <CardContent className="space-y-4 p-7">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">{content.reportsTitle}</p>
              <p className="text-sm leading-7 text-muted-foreground">{content.reportsBody}</p>
            </CardContent>
          </Card>
          <Card className="rounded-[2rem] border-white/70 bg-[#1d2d32] text-white shadow-[0_24px_70px_-34px_rgba(18,32,36,0.55)]">
            <CardContent className="space-y-4 p-7">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-200">The hosting outcome</p>
              {[
                "Guests arrive to a cleaner, better-presented property.",
                "Reports and issue notes give you fast visibility after each turnover.",
                "Laundry, stock, shopping, invoicing, and maintenance follow-up stay easier to manage.",
              ].map((line) => (
                <div key={line} className="flex gap-3 rounded-[1.3rem] border border-white/10 bg-white/5 p-4">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
                  <p className="text-sm leading-6 text-white/85">{line}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Bottom CTA ── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} pb-16 pt-2 sm:pb-24`}>
        <Card className="rounded-[2rem] border-white/70 bg-gradient-to-br from-primary/95 to-[#163b41] text-white shadow-[0_24px_70px_-36px_rgba(15,77,84,0.6)]">
          <CardContent className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="space-y-2">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/60">Ready to get started?</p>
              <h2 className="text-2xl font-semibold">Let us handle your property&apos;s turnover.</h2>
              <p className="max-w-xl text-sm leading-7 text-white/75">
                Get an instant quote for your Airbnb or managed property, or contact us to discuss a custom hosting support package.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="rounded-full bg-white text-primary hover:bg-white/90 transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/quote">Get an instant quote</Link>
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
