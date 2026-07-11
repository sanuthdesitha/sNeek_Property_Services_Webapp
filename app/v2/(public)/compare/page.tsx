import Link from "next/link";
import { ArrowRight, CheckCircle2, ClipboardList, ShieldCheck, X, Zap } from "lucide-react";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { getAppSettings } from "@/lib/settings";
import { EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";

export const metadata = { title: "Compare Services · sNeek Property Services" };

const COMPARISON_SLUGS = ["general-clean", "deep-clean", "end-of-lease", "airbnb-turnover"];

export default async function V2ComparePage() {
  const settings = await getAppSettings().catch(() => null);
  const servicePages = (settings?.websiteContent as any)?.servicePages ?? {};

  const services = COMPARISON_SLUGS
    .map((slug) => ({
      marketing: MARKETED_SERVICES.find((s) => s.slug === slug),
      page: servicePages[slug],
      slug,
    }))
    .filter((s) => s.marketing);

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.1fr)_420px] xl:items-center xl:gap-14">
          <div className="space-y-7 e-rise">
            <EEyebrow>Compare services</EEyebrow>
            <h1 className="e-display-xl max-w-2xl">Choose the right cleaning scope before you book.</h1>
            <p className="max-w-xl text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
              Compare the most requested service types side by side so you can book the right level of detail the first time.
            </p>
            <div className="flex flex-wrap gap-3">
              <EButton asChild variant="gold" size="lg">
                <Link href="/v2/quote">Get an instant quote</Link>
              </EButton>
              <EButton asChild variant="outline" size="lg">
                <Link href="/v2/services">
                  Browse all services <ArrowRight className="h-4 w-4" />
                </Link>
              </EButton>
            </div>
          </div>

          {/* Quick guide card */}
          <ECard variant="ceremony">
            <ECardBody className="space-y-4 pt-6">
              <div className="flex items-center gap-3">
                <div className="rounded-[var(--e-radius)] bg-[hsl(var(--e-primary-soft))] p-3 shrink-0">
                  <ClipboardList className="h-5 w-5 text-[hsl(var(--e-primary))]" />
                </div>
                <div>
                  <p className="font-semibold">Choose the right scope first.</p>
                  <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">4 service types compared side by side</p>
                </div>
              </div>
              <EEyebrow>Quick guide</EEyebrow>
              <div className="space-y-2.5">
                {[
                  { label: "General Clean", note: "Regular maintenance visits" },
                  { label: "Deep Clean", note: "Heavy soiling & neglect reset" },
                  { label: "End of Lease", note: "Bond-back inspection ready" },
                  { label: "Airbnb Turnover", note: "Same-day guest-ready reset" },
                ].map(({ label, note }) => (
                  <div key={label} className="flex items-start gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-4 py-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-success))]" />
                    <div>
                      <p className="text-[0.875rem] font-semibold">{label}</p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{note}</p>
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
                  <span key={label} className="inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-primary-soft))] bg-[hsl(var(--e-primary-soft))] px-3 py-1.5 text-[0.75rem] font-medium text-[hsl(var(--e-primary))]">
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </span>
                ))}
              </div>
            </ECardBody>
          </ECard>
        </div>
      </section>

      {/* Comparison cards */}
      <div className="bg-[hsl(var(--e-surface-raised))] border-y border-[hsl(var(--e-border))]">
        <section className="mx-auto max-w-6xl px-6 py-16">
          <div className="mb-10 space-y-2">
            <EEyebrow>Side-by-side comparison</EEyebrow>
            <h2 className="e-display-md">What is included in each service type</h2>
          </div>
          {services.length > 0 ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
              {services.map(({ marketing, page, slug }, idx) => (
                <ECard key={slug} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--e-elevation-2)]">
                  <ECardBody className="space-y-5 pt-6">
                    <div className={`inline-flex rounded-[var(--e-radius)] p-2.5 ${idx % 2 === 0 ? "bg-[hsl(var(--e-primary-soft))]" : "bg-[hsl(var(--e-gold-soft))]"}`}>
                      <ClipboardList className={`h-4 w-4 ${idx % 2 === 0 ? "text-[hsl(var(--e-primary))]" : "text-[hsl(var(--e-gold-ink))]"}`} />
                    </div>
                    <h3 className="text-[1.0625rem] font-semibold">{marketing?.label}</h3>

                    {page?.idealFor && (
                      <div className="space-y-1">
                        <p className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">Ideal for</p>
                        <p className="text-[0.8125rem] leading-relaxed">{page.idealFor}</p>
                      </div>
                    )}
                    {page?.priceGuide && (
                      <div className="space-y-1">
                        <p className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">Price guide</p>
                        <p className="text-[0.8125rem] leading-relaxed">{page.priceGuide}</p>
                      </div>
                    )}

                    {(page?.whatIncluded ?? []).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">What is included</p>
                        <ul className="space-y-2 text-[0.8125rem]">
                          {(page?.whatIncluded ?? []).slice(0, 6).map((item: string) => (
                            <li key={item} className="flex items-start gap-2">
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--e-success))]" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(page?.notIncluded ?? []).length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-muted-foreground))]">Not included</p>
                        <ul className="space-y-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                          {(page?.notIncluded ?? []).slice(0, 3).map((item: string) => (
                            <li key={item} className="flex items-start gap-2">
                              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <EButton asChild variant="outline" className="w-full">
                      <Link href={`/v2/services/${slug}`}>
                        View full details <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </EButton>
                  </ECardBody>
                </ECard>
              ))}
            </div>
          ) : (
            <ECard>
              <ECardBody className="py-12 text-center pt-6 text-[hsl(var(--e-muted-foreground))]">
                Service comparison details are coming soon.
              </ECardBody>
            </ECard>
          )}
        </section>
      </div>

      {/* Bottom CTA */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <ECard variant="ceremony">
          <ECardBody className="pt-6 lg:flex lg:items-center lg:justify-between lg:gap-10">
            <div className="space-y-3">
              <EEyebrow>Not sure which service fits?</EEyebrow>
              <h2 className="e-display-sm">Get a quote and let us recommend the right scope.</h2>
              <p className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">
                Our instant quote tool walks you through the key questions and recommends the most appropriate service level for your situation.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3 lg:mt-0 lg:shrink-0">
              <EButton asChild variant="gold" size="lg">
                <Link href="/v2/quote">Get instant quote</Link>
              </EButton>
              <EButton asChild variant="outline" size="lg">
                <Link href="/v2/contact">
                  Ask the team <ArrowRight className="h-4 w-4" />
                </Link>
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      </section>
    </div>
  );
}
