import Link from "next/link";
import { ArrowRight, BadgeCheck, Camera, CheckCircle2, Leaf, MapPin, ShieldCheck, Star, Zap } from "lucide-react";
import { getAppSettings } from "@/lib/settings";
import { EButton, ECard, ECardBody, EEyebrow, EThread } from "@/components/v2/ui/primitives";
import type { WebsiteWhyItem } from "@/lib/public-site/content";

export const metadata = { title: "Why sNeek · sNeek Property Services" };

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

const FALLBACK_ITEMS = [
  { icon: "ShieldCheck", title: "Fully insured team", description: "$5M public liability and police-checked cleaners on every job." },
  { icon: "Camera", title: "Photo-backed reports", description: "Every clean is documented with photos and submitted as a report to your portal." },
  { icon: "Zap", title: "Same-day availability", description: "Urgent Airbnb turnovers and last-minute inspection preps handled fast." },
  { icon: "MapPin", title: "Sydney-wide coverage", description: "Based in Parramatta, servicing Greater Sydney within 50km." },
  { icon: "BadgeCheck", title: "Clear communication", description: "No chasing — you get updates at every stage without needing to ask." },
  { icon: "Leaf", title: "Eco-friendly products", description: "Biodegradable, low-VOC cleaning products safe for families and pets." },
];

export default async function V2WhyUsPage() {
  const settings = await getAppSettings().catch(() => null);
  const content = settings?.websiteContent;
  const whyItems: WebsiteWhyItem[] = content?.whyChooseUs?.items?.length
    ? content.whyChooseUs.items
    : (FALLBACK_ITEMS as any);

  const title = content?.whyChooseUs?.title ?? "Cared for like it's ours.";
  const intro = content?.whyChooseUs?.intro ?? "What makes working with us different from the next cleaning company you'll find online.";

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.1fr)_minmax(460px,0.9fr)] xl:items-center xl:gap-16">
          <div className="space-y-7 e-rise">
            <EEyebrow>Why sNeek</EEyebrow>
            <h1 className="e-display-xl max-w-2xl">{title}</h1>
            <p className="max-w-xl text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{intro}</p>
            <div className="flex flex-wrap gap-3">
              <EButton asChild variant="gold" size="lg">
                <Link href="/v2/quote">Start your quote</Link>
              </EButton>
              <EButton asChild variant="outline" size="lg">
                <Link href="/v2/contact">
                  Talk to the team <ArrowRight className="h-4 w-4" />
                </Link>
              </EButton>
            </div>
            {/* Trust stats */}
            <div className="grid gap-3 sm:grid-cols-3">
              {TRUST_STATS.map((stat) => (
                <div key={stat.label} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-5">
                  <p className="e-numeral text-[1.75rem]">{stat.value}</p>
                  <p className="mt-1 text-[0.875rem] font-medium">{stat.label}</p>
                  <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{stat.note}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Trust card */}
          <ECard variant="ceremony">
            <ECardBody className="space-y-4 pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-[var(--e-radius)] bg-[hsl(var(--e-primary-soft))] p-3 shrink-0">
                  <ShieldCheck className="h-5 w-5 text-[hsl(var(--e-primary))]" />
                </div>
                <div>
                  <p className="font-semibold">Quiet, reliable property care.</p>
                  <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Police-checked · $5M insured · Photo-backed</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { icon: Star, label: "4.9★ Rating" },
                  { icon: ShieldCheck, label: "$5M Insured" },
                  { icon: CheckCircle2, label: "500+ Cleans" },
                  { icon: BadgeCheck, label: "Police-checked" },
                ].map(({ icon: Icon, label }) => (
                  <span key={label} className="inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-primary-soft))] bg-[hsl(var(--e-primary-soft))] px-3 py-1.5 text-[0.75rem] font-medium text-[hsl(var(--e-primary))]">
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </span>
                ))}
              </div>
              <div className="space-y-2">
                {[
                  "$5M public liability insured",
                  "Photo-backed reports and operational follow-up",
                  "Parramatta-based with Greater Sydney coverage",
                  "Police-checked and vetted cleaning team",
                  "Same-day turnovers for Airbnb hosts",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-4 py-3 text-[0.875rem]">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[hsl(var(--e-success))]" />
                    {item}
                  </div>
                ))}
              </div>
              <EButton asChild variant="gold" className="w-full">
                <Link href="/v2/quote">Get a free quote</Link>
              </EButton>
            </ECardBody>
          </ECard>
        </div>
      </section>

      {/* Why items grid */}
      <div className="bg-[hsl(var(--e-surface-raised))] border-y border-[hsl(var(--e-border))]">
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="mb-10 max-w-2xl space-y-3">
            <EEyebrow>What sets us apart</EEyebrow>
            <h2 className="e-display-md">Built around reliable, low-friction property care.</h2>
            <p className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
              Every process is designed to reduce your admin load and keep your property consistently guest-ready without constant follow-up.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {whyItems.map((item: WebsiteWhyItem, idx: number) => (
              <div
                key={item.id ?? item.title}
                className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--e-elevation-2)]"
              >
                <div className={`mb-4 inline-flex rounded-[var(--e-radius)] p-3 ${idx % 2 === 0 ? "bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-primary))]" : "bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"}`}>
                  <WhyIcon iconName={item.icon} className="h-5 w-5" />
                </div>
                <p className="mb-2 font-semibold">{item.title}</p>
                <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Bottom CTA */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <ECard variant="ceremony">
          <ECardBody className="pt-6 lg:flex lg:items-center lg:justify-between lg:gap-10">
            <div className="space-y-3">
              <EEyebrow>Ready to get started?</EEyebrow>
              <h2 className="e-display-sm">Book a clean, or ask us anything first.</h2>
              <p className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
                Get an instant online estimate in under two minutes — no sign-up required.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row lg:mt-0 lg:shrink-0">
              <EButton asChild variant="gold" size="lg">
                <Link href="/v2/quote">Get instant quote</Link>
              </EButton>
              <EButton asChild variant="outline" size="lg">
                <Link href="/v2/contact">
                  Contact us <ArrowRight className="h-4 w-4" />
                </Link>
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      </section>
    </div>
  );
}
