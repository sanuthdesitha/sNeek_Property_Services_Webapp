"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Quote, ShieldCheck, Star, Zap, Camera, BadgeCheck, Leaf, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PUBLIC_PAGE_CONTAINER } from "@/components/public/constants";
import type { WebsiteContent, WebsiteWhyItem } from "@/lib/public-site/content";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  ShieldCheck, Camera, MapPin, Leaf, Zap, BadgeCheck, Star,
};

function WhyIcon({ iconName, className }: { iconName: string; className?: string }) {
  const Icon = ICON_MAP[iconName] ?? ShieldCheck;
  return <Icon className={className} />;
}

const TRUST_STATS = [
  { value: "500+", label: "Cleans completed", note: "Across Greater Sydney" },
  { value: "4.9★", label: "Average rating", note: "From verified clients" },
  { value: "$5M", label: "Public liability", note: "Fully insured team" },
];

export function WhyUsPage({ content }: { content: WebsiteContent }) {
  const whyItems = content.whyChooseUs.items ?? [];

  return (
    <>
      {/* ─── HERO ─── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.08fr)_minmax(520px,0.92fr)] xl:items-center xl:gap-14 2xl:gap-20">
          <div className="space-y-7 animate-fade-up">
            <Badge className="w-fit rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] sm:text-xs">
              Why sNeek
            </Badge>
            <div className="space-y-4">
              <h1 className="max-w-2xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                {content.whyChooseUs.title}
              </h1>
              <p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                {content.whyChooseUs.intro}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-full px-6 shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/quote">
                  <Quote className="mr-2 h-4 w-4" />
                  Start your quote
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full px-6 transition-transform duration-200 hover:-translate-y-0.5">
                <Link href="/contact">
                  Talk to the team
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/6 px-3 py-1.5 font-medium text-primary">
                <CheckCircle2 className="h-4 w-4" />
                Trusted cleaning and property support
              </span>
              <span className="text-muted-foreground">Clear updates, accountable finishes, and less follow-up stress.</span>
            </div>

            {/* Trust stats */}
            <div className="grid gap-3 sm:grid-cols-3">
              {TRUST_STATS.map((stat) => (
                <Card key={stat.label} className="rounded-3xl border-white/70 bg-white/75 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.35)]">
                  <CardContent className="space-y-1 p-5">
                    <p className="text-2xl font-semibold">{stat.value}</p>
                    <p className="text-sm font-medium">{stat.label}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{stat.note}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_24px_70px_-34px_rgba(26,67,74,0.38)] space-y-5 sm:p-7">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-primary/10 p-3 shrink-0">
                <ShieldCheck className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">Quiet, reliable property care.</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Police-checked · $5M insured · Photo-backed</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { icon: Star, label: "4.9★ Rating" },
                { icon: ShieldCheck, label: "$5M Insured" },
                { icon: CheckCircle2, label: "500+ Cleans" },
                { icon: BadgeCheck, label: "Police-checked" },
              ].map(({ icon: Icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/6 px-3 py-1.5 text-xs font-medium text-primary">
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </span>
              ))}
            </div>
            <div className="space-y-3">
              {[
                "$5M public liability insured",
                "Photo-backed reports and operational follow-up",
                "Parramatta-based with Greater Sydney coverage",
                "Police-checked and vetted cleaning team",
                "Same-day turnovers for Airbnb hosts",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2.5 rounded-[1.2rem] border border-border/60 bg-background/60 px-4 py-3 text-sm">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                  {item}
                </div>
              ))}
            </div>
            <Button asChild className="w-full rounded-full">
              <Link href="/quote">Get a free quote</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ─── FULL-BLEED: WHY ITEMS GRID ─── */}
      <div className="public-section-full bg-primary/4">
        <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
          <div className="scroll-reveal mb-10 max-w-2xl space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">What sets us apart</p>
            <h2 className="text-2xl font-semibold sm:text-3xl">
              Built around reliable, low-friction property care.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              Every process is designed to reduce your admin load and keep your property consistently guest-ready without constant follow-up.
            </p>
          </div>
          {whyItems.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {whyItems.map((item: WebsiteWhyItem, idx: number) => (
                <div
                  key={item.id}
                  className={`scroll-reveal ${["scroll-delay-100","scroll-delay-200","scroll-delay-300"][idx % 3]} rounded-[1.6rem] border border-white/80 bg-white/85 p-6 shadow-[0_12px_36px_-20px_rgba(22,63,70,0.28)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_-24px_rgba(22,63,70,0.34)]`}
                >
                  <div className={`mb-4 inline-flex rounded-2xl p-3 ${idx % 2 === 0 ? "bg-primary/10 text-primary" : "bg-accent text-accent-foreground"}`}>
                    <WhyIcon iconName={item.icon} className="h-5 w-5" />
                  </div>
                  <p className="mb-2 font-semibold">{item.title}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[
                { icon: ShieldCheck, title: "Fully insured team", desc: "$5M public liability and police-checked cleaners on every job.", tint: true },
                { icon: Camera, title: "Photo-backed reports", desc: "Every clean is documented with photos and submitted as a report to your portal.", tint: false },
                { icon: Zap, title: "Same-day availability", desc: "Urgent Airbnb turnovers and last-minute inspection preps handled fast.", tint: true },
                { icon: MapPin, title: "Sydney-wide coverage", desc: "Based in Parramatta, servicing Greater Sydney within 50km.", tint: false },
                { icon: BadgeCheck, title: "Clear communication", desc: "No chasing — you get updates at every stage without needing to ask.", tint: true },
                { icon: Leaf, title: "Eco-friendly products", desc: "Biodegradable, low-VOC cleaning products safe for families and pets.", tint: false },
              ].map((item, idx) => (
                <div
                  key={item.title}
                  className={`scroll-reveal ${["scroll-delay-100","scroll-delay-200","scroll-delay-300"][idx % 3]} rounded-[1.6rem] border border-white/80 bg-white/85 p-6 shadow-[0_12px_36px_-20px_rgba(22,63,70,0.28)] transition-all duration-300 hover:-translate-y-1`}
                >
                  <div className={`mb-4 inline-flex rounded-2xl p-3 ${item.tint ? "bg-primary/10 text-primary" : "bg-accent text-accent-foreground"}`}>
                    <item.icon className="h-5 w-5" />
                  </div>
                  <p className="mb-2 font-semibold">{item.title}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{item.desc}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ─── BOTTOM CTA ─── */}
      <section className={`${PUBLIC_PAGE_CONTAINER} section-gap`}>
        <div className="rounded-[2rem] border border-white/70 bg-white/80 p-7 shadow-[0_20px_60px_-32px_rgba(25,67,74,0.30)] sm:p-10 lg:flex lg:items-center lg:justify-between lg:gap-10">
          <div className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Ready to get started?</p>
            <h2 className="text-2xl font-semibold sm:text-3xl">
              Book a clean, or ask us anything first.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              Get an instant online estimate in under two minutes — no sign-up required. Or reach out if your scope is unusual and we will advise.
            </p>
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row lg:mt-0 lg:shrink-0">
            <Button asChild size="lg" className="rounded-full px-6 shadow-sm transition-transform duration-200 hover:-translate-y-0.5">
              <Link href="/quote">Get instant quote</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-full px-6 transition-transform duration-200 hover:-translate-y-0.5">
              <Link href="/contact">
                Contact us
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
