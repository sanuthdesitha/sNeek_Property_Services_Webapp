import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2, ChevronRight, HelpCircle, Quote, X } from "lucide-react";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { getAppSettings } from "@/lib/settings";
import { EButton, ECard, ECardBody, EEyebrow, EThread } from "@/components/v2/ui/primitives";

export async function generateStaticParams() {
  return MARKETED_SERVICES.map((s) => ({ slug: s.slug }));
}

const HOW_IT_WORKS = [
  "Request via our online quote tool or contact us directly — takes under 2 minutes.",
  "We confirm scope, access arrangements, and a suitable time window with you.",
  "We complete the clean and send you a photo report on the same day.",
];

export default async function V2ServiceDetailPage({ params }: { params: { slug: string } }) {
  const service = MARKETED_SERVICES.find((s) => s.slug === params.slug);
  if (!service) notFound();

  const settings = await getAppSettings().catch(() => null);
  const pageContent = settings?.websiteContent.servicePages?.[params.slug] ?? {
    heroImageUrl: "",
    heroImageAlt: service.label,
    whatIncluded: service.highlights ?? [],
    notIncluded: [],
    idealFor: service.summary,
    priceGuide: "",
    faq: [],
  };

  const related = MARKETED_SERVICES.filter(
    (s) => s.family === service.family && s.slug !== service.slug
  ).slice(0, 3);

  return (
    <div>
      {/* Breadcrumb + hero */}
      <div className="mx-auto max-w-6xl px-6 pt-6 pb-10">
        <nav className="mb-5 flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <Link href="/v2/home" className="hover:text-[hsl(var(--e-foreground))] transition-colors">Home</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <Link href="/v2/services" className="hover:text-[hsl(var(--e-foreground))] transition-colors">Services</Link>
          <ChevronRight className="h-3.5 w-3.5" />
          <span className="font-medium text-[hsl(var(--e-foreground))]">{service.label}</span>
        </nav>

        {/* Dark hero panel */}
        <div className="relative overflow-hidden rounded-[var(--e-radius-xl)] bg-[hsl(var(--e-primary))] shadow-[var(--e-elevation-3)]">
          {pageContent.heroImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={pageContent.heroImageUrl}
              alt={pageContent.heroImageAlt || service.label}
              className="absolute inset-0 h-full w-full object-cover opacity-20 mix-blend-luminosity"
              loading="eager"
            />
          )}
          <div className="relative z-10 p-8 sm:p-14">
            <EEyebrow className="!text-[hsl(var(--e-gold))] mb-4">
              {service.family.replace("_", " ")}
            </EEyebrow>
            <h1 className="e-display-xl max-w-2xl text-[hsl(var(--e-primary-foreground))]">{service.label}</h1>
            <p className="mt-4 max-w-xl text-[1.0625rem] leading-relaxed text-[hsl(var(--e-primary-foreground)/0.75)]">
              {service.summary}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <EButton asChild variant="gold" size="lg">
                <Link href={`/v2/quote?serviceType=${service.jobType}`}>
                  <Quote className="h-4 w-4" /> Get an instant quote
                </Link>
              </EButton>
              <EButton
                asChild
                size="lg"
                className="border border-[hsl(var(--e-primary-foreground)/0.2)] bg-transparent text-[hsl(var(--e-primary-foreground))] hover:bg-[hsl(var(--e-primary-foreground)/0.1)]"
              >
                <Link href="/v2/contact">
                  Contact us <ArrowRight className="h-4 w-4" />
                </Link>
              </EButton>
            </div>
          </div>
        </div>
      </div>

      {/* Included / not included */}
      {(pageContent.whatIncluded?.length > 0 || pageContent.notIncluded?.length > 0) && (
        <section className="mx-auto max-w-6xl px-6 py-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {pageContent.whatIncluded?.length > 0 && (
              <ECard>
                <ECardBody className="pt-6">
                  <EEyebrow className="mb-4">What&apos;s included</EEyebrow>
                  <ul className="space-y-3">
                    {pageContent.whatIncluded.map((item: string) => (
                      <li key={item} className="flex items-start gap-3 text-[0.875rem] leading-relaxed">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-success))]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </ECardBody>
              </ECard>
            )}
            {pageContent.notIncluded?.length > 0 && (
              <ECard>
                <ECardBody className="pt-6">
                  <EEyebrow className="mb-4">Not included</EEyebrow>
                  <ul className="space-y-3">
                    {pageContent.notIncluded.map((item: string) => (
                      <li key={item} className="flex items-start gap-3 text-[0.875rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">
                        <X className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground)/0.5)]" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </ECardBody>
              </ECard>
            )}
          </div>
        </section>
      )}

      {/* Ideal for + price guide */}
      {(pageContent.idealFor || pageContent.priceGuide) && (
        <section className="mx-auto max-w-6xl px-6 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {pageContent.idealFor && (
              <ECard>
                <ECardBody className="pt-6">
                  <EEyebrow className="mb-3">Who is this for?</EEyebrow>
                  <p className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{pageContent.idealFor}</p>
                </ECardBody>
              </ECard>
            )}
            {pageContent.priceGuide && (
              <ECard>
                <ECardBody className="pt-6">
                  <EEyebrow className="mb-3">Price guide</EEyebrow>
                  <p className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{pageContent.priceGuide}</p>
                  <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    Estimates vary by property size and condition. Use the quote tool for an accurate figure.
                  </p>
                </ECardBody>
              </ECard>
            )}
          </div>
        </section>
      )}

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 py-8">
        <ECard>
          <ECardBody className="pt-6">
            <EEyebrow className="mb-6">How it works</EEyebrow>
            <div className="grid gap-6 sm:grid-cols-3">
              {HOW_IT_WORKS.map((step, idx) => (
                <div key={step} className="flex gap-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[0.8125rem] font-semibold text-[hsl(var(--e-accent-portal))]">
                    {idx + 1}
                  </div>
                  <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{step}</p>
                </div>
              ))}
            </div>
          </ECardBody>
        </ECard>
      </section>

      {/* Service FAQ */}
      {pageContent.faq?.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 py-6">
          <div className="grid gap-8 xl:grid-cols-[260px_minmax(0,1fr)] xl:gap-10 xl:items-start">
            <div className="space-y-3">
              <div className="inline-flex rounded-[var(--e-radius)] bg-[hsl(var(--e-primary-soft))] p-3">
                <HelpCircle className="h-5 w-5 text-[hsl(var(--e-primary))]" />
              </div>
              <p className="font-semibold">Questions about {service.shortLabel}</p>
              <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">
                Common questions specific to this service.
              </p>
            </div>
            <div className="space-y-3">
              {pageContent.faq.map((item: { question: string; answer: string }, idx: number) => (
                <ECard key={idx}>
                  <ECardBody className="pt-6">
                    <p className="font-[550]">{item.question}</p>
                    <p className="mt-2 text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{item.answer}</p>
                  </ECardBody>
                </ECard>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Related services */}
      {related.length > 0 && (
        <section className="mx-auto max-w-6xl px-6 py-8">
          <EEyebrow className="mb-6">Related services</EEyebrow>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((rel) => (
              <Link key={rel.slug} href={`/v2/services/${rel.slug}`} className="group">
                <ECard className="h-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--e-elevation-2)]">
                  <ECardBody className="pt-6">
                    <p className="font-semibold">{rel.label}</p>
                    <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-gold-ink))]">{rel.tagline}</p>
                    <p className="mt-2 text-[0.8125rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{rel.summary}</p>
                    <p className="mt-4 text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      View details →
                    </p>
                  </ECardBody>
                </ECard>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Bottom CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-4">
        <div className="overflow-hidden rounded-[var(--e-radius-xl)] bg-[hsl(var(--e-primary))] p-8 shadow-[var(--e-elevation-3)] sm:p-12 lg:flex lg:items-center lg:justify-between lg:gap-10">
          <div className="space-y-2">
            <EEyebrow className="!text-[hsl(var(--e-gold))]">Ready to book</EEyebrow>
            <h2 className="e-display-sm text-[hsl(var(--e-primary-foreground))]">{service.label}</h2>
            <p className="max-w-xl text-[0.875rem] leading-relaxed text-[hsl(var(--e-primary-foreground)/0.75)]">
              Use our instant quote tool for a price in under 2 minutes, or contact us for a custom scope review.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3 lg:mt-0 lg:shrink-0">
            <EButton asChild variant="gold" size="lg">
              <Link href={`/v2/quote?serviceType=${service.jobType}`}>
                <Quote className="h-4 w-4" /> Start your quote
              </Link>
            </EButton>
            <EButton
              asChild
              size="lg"
              className="border border-[hsl(var(--e-primary-foreground)/0.2)] bg-transparent text-[hsl(var(--e-primary-foreground))] hover:bg-[hsl(var(--e-primary-foreground)/0.1)]"
            >
              <Link href="/v2/contact">Contact us</Link>
            </EButton>
          </div>
        </div>
      </section>
    </div>
  );
}
