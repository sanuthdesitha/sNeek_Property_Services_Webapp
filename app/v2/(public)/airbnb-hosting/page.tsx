import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { getAppSettings } from "@/lib/settings";
import { EButton, ECard, ECardBody, EEyebrow, EThread } from "@/components/v2/ui/primitives";

export const metadata = { title: "Airbnb Hosting Support · sNeek Property Services" };

export default async function V2AirbnbHostingPage() {
  const settings = await getAppSettings().catch(() => null);
  const content = (settings?.websiteContent as any)?.airbnbHosting ?? {
    eyebrow: "Airbnb & managed properties",
    title: "Hotel-ready between every guest.",
    subtitle: "Same-day turnovers, photo-verified checklists, and linen handled — so your listing stays five-star without the management stress.",
    heroImageUrl: "",
    heroImageAlt: "Airbnb turnover service",
    featuresTitle: "What we handle for hosts",
    featuresIntro: "A complete turnover service built around the Airbnb check-in/check-out rhythm.",
    features: [
      { id: "1", title: "Same-day turnovers", description: "Guest checks out — we clean and reset before the next check-in, same day.", imageUrl: "", imageAlt: "" },
      { id: "2", title: "Linen & laundry", description: "We coordinate pickup, washing, and drop-off so fresh linen is always ready.", imageUrl: "", imageAlt: "" },
      { id: "3", title: "Photo reports", description: "Every turnover documented room by room and sent directly to you.", imageUrl: "", imageAlt: "" },
    ],
    reportsTitle: "Full visibility after every visit",
    reportsBody: "After each turnover, you receive a timestamped photo report covering every room — so you know exactly what was done and the condition it was left in.",
  };

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 xl:grid-cols-2 xl:items-center xl:gap-16">
          <div className="space-y-6 e-rise">
            <EEyebrow>{content.eyebrow}</EEyebrow>
            <h1 className="e-display-xl">{content.title}</h1>
            <p className="text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{content.subtitle}</p>
            <div className="flex flex-wrap gap-2 text-[0.875rem]">
              {["Photo Reports", "Laundry Handled", "Same-Day Turnovers"].map((badge) => (
                <span key={badge} className="inline-flex items-center gap-2 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--e-success))]" /> {badge}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <EButton asChild variant="gold" size="lg">
                <Link href="/v2/quote">Quote your property</Link>
              </EButton>
              <EButton asChild variant="outline" size="lg">
                <Link href="/v2/contact">
                  Ask about managed support <ArrowRight className="h-4 w-4" />
                </Link>
              </EButton>
            </div>
          </div>

          <div className="overflow-hidden rounded-[var(--e-radius-xl)] border border-[hsl(var(--e-border-gold)/0.4)] bg-[hsl(var(--e-gold-soft))] shadow-[var(--e-elevation-gold)]">
            {content.heroImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={content.heroImageUrl} alt={content.heroImageAlt} className="h-[340px] w-full object-cover sm:h-[420px]" loading="eager" />
            ) : (
              <div className="flex h-[340px] sm:h-[420px] items-center justify-center">
                <p className="e-serif text-[2rem] text-[hsl(var(--e-gold-ink)/0.4)]">sNeek</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <div className="bg-[hsl(var(--e-surface-raised))] border-y border-[hsl(var(--e-border))]">
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="mb-10 max-w-2xl space-y-3">
            <EEyebrow>{content.featuresTitle}</EEyebrow>
            <p className="text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{content.featuresIntro}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {content.features.map((feature: any) => (
              <div key={feature.id} className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--e-elevation-2)]">
                {feature.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={feature.imageUrl} alt={feature.imageAlt} className="h-48 w-full object-cover" />
                )}
                <div className="space-y-2 p-6">
                  <EThread className="mb-4 w-12" />
                  <h2 className="text-[1.0625rem] font-semibold">{feature.title}</h2>
                  <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Reports + outcome */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-5 lg:grid-cols-2">
          <ECard>
            <ECardBody className="space-y-4 pt-6">
              <EEyebrow>{content.reportsTitle}</EEyebrow>
              <p className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{content.reportsBody}</p>
            </ECardBody>
          </ECard>
          <div className="overflow-hidden rounded-[var(--e-radius-lg)] bg-[hsl(var(--e-primary))] p-6 shadow-[var(--e-elevation-2)]">
            <EEyebrow className="!text-[hsl(var(--e-gold))] mb-4">The hosting outcome</EEyebrow>
            {[
              "Guests arrive to a cleaner, better-presented property.",
              "Reports and issue notes give you fast visibility after each turnover.",
              "Laundry, stock, shopping, invoicing, and maintenance follow-up stay easier to manage.",
            ].map((line) => (
              <div key={line} className="mt-3 flex gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-primary-foreground)/0.1)] bg-[hsl(var(--e-primary-foreground)/0.05)] p-4">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-gold))]" />
                <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-primary-foreground)/0.85)]">{line}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-4">
        <div className="overflow-hidden rounded-[var(--e-radius-xl)] bg-[hsl(var(--e-primary))] p-8 shadow-[var(--e-elevation-3)] sm:p-12 lg:flex lg:items-center lg:justify-between lg:gap-10">
          <div className="space-y-2">
            <EEyebrow className="!text-[hsl(var(--e-gold))]">Ready to get started?</EEyebrow>
            <h2 className="e-display-sm text-[hsl(var(--e-primary-foreground))]">Let us handle your property&apos;s turnover.</h2>
            <p className="max-w-xl text-[0.875rem] leading-relaxed text-[hsl(var(--e-primary-foreground)/0.75)]">
              Get an instant quote for your Airbnb or managed property, or contact us to discuss a custom hosting support package.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3 lg:mt-0 lg:shrink-0">
            <EButton asChild variant="gold" size="lg"><Link href="/v2/quote">Get an instant quote</Link></EButton>
            <EButton asChild size="lg" className="border border-[hsl(var(--e-primary-foreground)/0.2)] bg-transparent text-[hsl(var(--e-primary-foreground))] hover:bg-[hsl(var(--e-primary-foreground)/0.1)]">
              <Link href="/v2/contact">Contact us</Link>
            </EButton>
          </div>
        </div>
      </section>
    </div>
  );
}
