import Link from "next/link";
import { EButton, EEyebrow, EThread } from "@/components/v2/ui/primitives";
import { ArrowRight, Check, Star } from "lucide-react";

export const metadata = { title: "sNeek Property Services — pristine by standard" };

const SERVICES = [
  { name: "Airbnb turnovers", desc: "Hotel-ready resets between every guest, with photo-verified checklists." },
  { name: "End of lease", desc: "Bond-back deep cleans held to agent standard, guaranteed." },
  { name: "Recurring homes", desc: "The same trusted team, on a rhythm that suits your household." },
  { name: "Post-construction", desc: "Dust-to-detail handovers for builders and developers." },
];

const PROOF = [
  ["1,200+", "properties cared for"],
  ["4.9", "average rating"],
  ["40+", "Sydney suburbs"],
];

export default function PublicHomeV2() {
  return (
    <div data-skin="estate" data-portal-accent="public" className="min-h-screen bg-[hsl(var(--e-background))] text-[hsl(var(--e-foreground))]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-background)/0.85)] backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <span className="e-serif text-[1.35rem] font-[520]">sNeek</span>
          <nav className="hidden items-center gap-7 text-[0.875rem] text-[hsl(var(--e-text-secondary))] md:flex">
            <Link href="#services" className="hover:text-[hsl(var(--e-foreground))]">Services</Link>
            <Link href="#why" className="hover:text-[hsl(var(--e-foreground))]">Why sNeek</Link>
            <Link href="#proof" className="hover:text-[hsl(var(--e-foreground))]">Reviews</Link>
          </nav>
          <EButton variant="gold" size="sm">Get a quote <ArrowRight className="h-3.5 w-3.5" /></EButton>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="max-w-3xl e-rise">
            <EEyebrow>SYDNEY&apos;S PROPERTY CARE ATELIER</EEyebrow>
            <h1 className="e-display-2xl mt-4 leading-[1.02]">
              Pristine,
              <br />
              by standard.
            </h1>
            <p className="mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
              Boutique cleaning for short-stay hosts, tenants, and homeowners who treat their property as an asset —
              photo-verified, insured, and held to a standard you can forward to your agent.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <EButton variant="gold" size="lg">Request a quote <ArrowRight className="h-4 w-4" /></EButton>
              <EButton variant="outline" size="lg">See our work</EButton>
            </div>
          </div>
        </div>
        {/* deep panel accent */}
        <div className="pointer-events-none absolute -right-24 top-10 hidden h-72 w-72 rounded-full opacity-[0.06] blur-3xl md:block" style={{ background: "hsl(var(--e-gold))" }} />
      </section>

      {/* Proof strip */}
      <section id="proof" className="border-y border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        <div className="mx-auto grid max-w-6xl grid-cols-3 divide-x divide-[hsl(var(--e-border))] px-6">
          {PROOF.map(([stat, label]) => (
            <div key={label} className="py-8 text-center">
              <p className="e-numeral text-[2rem]">{stat}</p>
              <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Services */}
      <section id="services" className="mx-auto max-w-6xl px-6 py-20">
        <EEyebrow>WHAT WE DO</EEyebrow>
        <h2 className="e-display-lg mt-2 max-w-lg">Every kind of clean, one standard.</h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-2">
          {SERVICES.map((s) => (
            <div key={s.name} className="group">
              <EThread className="mb-4 w-16" />
              <h3 className="e-serif text-[1.5rem]">{s.name}</h3>
              <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{s.desc}</p>
              <Link href="#" className="mt-3 inline-flex items-center gap-1 text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))]">
                Learn more <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Why band */}
      <section id="why" className="bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <EEyebrow className="!text-[hsl(var(--e-gold))]">THE SNEEK DIFFERENCE</EEyebrow>
          <h2 className="e-display-lg mt-2 max-w-xl">Cared for like it&apos;s ours.</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              ["Photo-verified", "Every clean documented room by room, sent straight to you."],
              ["Insured & vetted", "Background-checked cleaners, full public liability cover."],
              ["Quality assured", "Independent QA inspections on a schedule you can trust."],
            ].map(([t, d]) => (
              <div key={t}>
                <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: "hsl(var(--e-gold) / 0.2)" }}>
                  <Check className="h-4 w-4 text-[hsl(var(--e-gold))]" />
                </span>
                <h3 className="mt-3 text-[1.0625rem] font-semibold">{t}</h3>
                <p className="mt-1 text-[0.875rem] text-[hsl(var(--e-primary-foreground)/0.75)]">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial */}
      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <div className="flex justify-center gap-1 text-[hsl(var(--e-gold))]">
          {Array.from({ length: 5 }).map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}
        </div>
        <blockquote className="e-serif mt-5 text-[1.75rem] leading-snug">
          &ldquo;They treat my Coogee apartment better than I do. Every turnover is flawless and I never think about it.&rdquo;
        </blockquote>
        <p className="mt-4 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">— Priya M., Superhost</p>
      </section>

      {/* CTA */}
      <section className="border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-6 py-16 text-center">
          <h2 className="e-display-lg max-w-lg">Ready for a property that&apos;s always guest-ready?</h2>
          <EButton variant="gold" size="lg">Get your quote in 2 minutes <ArrowRight className="h-4 w-4" /></EButton>
        </div>
      </section>

      <footer className="border-t border-[hsl(var(--e-border))]">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <p className="e-eyebrow">SNEEK PROPERTY SERVICES · SYDNEY</p>
          <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate rebrand preview.</p>
        </div>
      </footer>
    </div>
  );
}
