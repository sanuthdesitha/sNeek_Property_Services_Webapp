import Link from "next/link";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { MARKETED_SERVICES, SERVICE_FAMILY_META, getServicesByFamily } from "@/lib/marketing/catalog";
import type { ServiceFamily } from "@/lib/marketing/catalog";
import { getAppSettings } from "@/lib/settings";
import { EButton, EEyebrow, EThread } from "@/components/v2/ui/primitives";

export const metadata = { title: "Services · sNeek Property Services" };

const FAMILY_ORDER: ServiceFamily[] = ["short_stay", "residential", "specialty", "exterior", "commercial"];

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

export default async function V2ServicesPage() {
  const settings = await getAppSettings().catch(() => null);
  const content = settings?.websiteContent.services ?? {
    eyebrow: "What we offer",
    title: "Professional cleaning for every property",
    intro: "From Airbnb turnovers to deep cleans and end-of-lease — a full suite of services backed by photo reports and quality assurance.",
  };

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="mx-auto max-w-3xl text-center e-rise">
          <EEyebrow>{content.eyebrow}</EEyebrow>
          <h1 className="e-display-xl mt-4">{content.title}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
            {content.intro}
          </p>
          <div className="mt-8 flex justify-center">
            <EButton asChild variant="gold" size="lg">
              <Link href="/v2/quote">
                Get an instant quote <ArrowRight className="h-4 w-4" />
              </Link>
            </EButton>
          </div>
        </div>
      </section>

      {/* Trust marquee strip */}
      <div className="overflow-hidden border-y border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] py-4">
        <div className="flex" aria-hidden="true">
          <div className="flex shrink-0 gap-4 pr-4" style={{ animation: "marquee 30s linear infinite" }}>
            {[...TRUST_PILLS, ...TRUST_PILLS].map((pill, i) => (
              <span
                key={`${pill}-${i}`}
                className="inline-flex shrink-0 items-center gap-2 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-2 text-[0.8125rem] font-medium"
              >
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-primary))]" />
                {pill}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Service families */}
      <div className="mx-auto max-w-6xl space-y-16 px-6 py-16">
        {FAMILY_ORDER.map((familyKey) => {
          const family = SERVICE_FAMILY_META[familyKey];
          const services = getServicesByFamily(familyKey);
          return (
            <section key={familyKey}>
              <div className="mb-8 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)] xl:gap-8">
                <div className="space-y-2">
                  <EEyebrow>{family.label}</EEyebrow>
                  <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
                    {family.description}
                  </p>
                </div>
                <div className="hidden xl:block" />
              </div>
              <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)] xl:gap-8">
                <div className="hidden xl:block" />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {services.map((service) => (
                    <Link key={service.jobType} href={`/v2/services/${service.slug}`} className="group">
                      <div className="h-full rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--e-gold)/0.5)] hover:shadow-[var(--e-elevation-2)]">
                        <div className="mb-4 inline-flex rounded-full border border-[hsl(var(--e-border-strong))] p-2.5 text-[hsl(var(--e-accent-portal))]">
                          <Sparkles className="h-4 w-4" />
                        </div>
                        <h2 className="text-[1.0625rem] font-semibold">{service.label}</h2>
                        <p className="mt-1 text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))]">{service.tagline}</p>
                        <p className="mt-2 text-[0.8125rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{service.summary}</p>
                        <div className="mt-4 flex flex-wrap gap-1.5">
                          {service.highlights.map((h) => (
                            <span key={h} className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] px-2.5 py-0.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                              {h}
                            </span>
                          ))}
                        </div>
                        <p className="mt-4 inline-flex items-center gap-1 text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                          View details <ArrowRight className="h-3.5 w-3.5" />
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
              <EThread className="mt-12" />
            </section>
          );
        })}

        <div className="flex flex-wrap gap-3">
          <EButton asChild variant="gold">
            <Link href="/v2/quote">Get an instant quote</Link>
          </EButton>
          <EButton asChild variant="outline">
            <Link href="/v2/compare">Compare services</Link>
          </EButton>
          <EButton asChild variant="outline">
            <Link href="/v2/contact">
              Request a tailored quote <ArrowRight className="h-4 w-4" />
            </Link>
          </EButton>
        </div>
      </div>
    </div>
  );
}
