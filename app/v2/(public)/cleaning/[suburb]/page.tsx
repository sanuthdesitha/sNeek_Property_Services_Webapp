import Link from "next/link";
import { notFound } from "next/navigation";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { getSydneySuburbBySlug, SYDNEY_SUBURBS } from "@/lib/public-site/suburbs";
import { EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";

export async function generateStaticParams() {
  return SYDNEY_SUBURBS.map((s) => ({ suburb: s.slug }));
}

export default function V2SuburbLandingPage({ params }: { params: { suburb: string } }) {
  const suburb = getSydneySuburbBySlug(params.suburb);
  if (!suburb) notFound();

  return (
    <div>
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="max-w-3xl space-y-5 e-rise">
          <EEyebrow>Sydney service area</EEyebrow>
          <h1 className="e-display-xl">Cleaning services in {suburb.name}</h1>
          <p className="text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{suburb.intro}</p>
          <div className="flex flex-wrap gap-2">
            {[suburb.statsLabel, "Photo-backed reporting available", "Airbnb turnovers supported"].map((badge) => (
              <span key={badge} className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-2 text-[0.875rem]">
                {badge}
              </span>
            ))}
          </div>
          <EButton asChild variant="gold" size="lg">
            <Link href="/v2/quote">Get a quote for {suburb.name}</Link>
          </EButton>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <EEyebrow className="mb-6">Services available in {suburb.name}</EEyebrow>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {MARKETED_SERVICES.slice(0, 9).map((service) => (
            <ECard key={service.slug} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--e-elevation-2)]">
              <ECardBody className="space-y-2 pt-6">
                <h2 className="text-[1.0625rem] font-semibold">{service.label}</h2>
                <p className="text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))]">{service.tagline}</p>
                <p className="text-[0.8125rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{service.summary}</p>
                <EButton asChild variant="outline" size="sm" className="mt-2">
                  <Link href={`/v2/services/${service.slug}`}>View service</Link>
                </EButton>
              </ECardBody>
            </ECard>
          ))}
        </div>
      </section>
    </div>
  );
}
