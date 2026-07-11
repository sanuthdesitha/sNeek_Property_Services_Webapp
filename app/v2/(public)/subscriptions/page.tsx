import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getAppSettings } from "@/lib/settings";
import { MARKETED_SERVICES } from "@/lib/marketing/catalog";
import { EButton, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";

export const metadata = { title: "Subscriptions · sNeek Property Services" };

export default async function V2SubscriptionsPage() {
  const settings = await getAppSettings().catch(() => null);
  const content = settings?.websiteContent?.subscriptions ?? {
    eyebrow: "Recurring property care",
    title: "Consistent cleaning without rebooking every time.",
    intro: "Lock in a plan that suits your property, get recurring service at a better rate, and stop thinking about it.",
    compareTitle: "Not sure which plan fits?",
    compareBody: "Talk to us about your property and we'll recommend the right cadence and service type.",
  };

  // Fetch published subscription plans
  const { db } = await import("@/lib/db");
  const plans = await db.subscriptionPlan
    .findMany({ where: { isPublished: true }, orderBy: { sortOrder: "asc" } })
    .catch(() => []);

  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="max-w-3xl space-y-4 e-rise">
            <EEyebrow>{content.eyebrow}</EEyebrow>
            <h1 className="e-display-xl">{content.title}</h1>
            <p className="text-[1.0625rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{content.intro}</p>
          </div>
          <div className="hidden xl:flex">
            <EButton asChild variant="outline">
              <Link href="/v2/contact">Talk to us about your plan</Link>
            </EButton>
          </div>
        </div>
      </section>

      {/* Plan cards */}
      <div className="bg-[hsl(var(--e-surface-raised))] border-y border-[hsl(var(--e-border))]">
        <section className="mx-auto max-w-6xl px-6 py-16">
          {plans.length === 0 ? (
            <ECard>
              <ECardBody className="py-14 text-center pt-6 text-[hsl(var(--e-muted-foreground))]">
                No subscription plans have been published yet. Check back soon.
              </ECardBody>
            </ECard>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan: any) => (
                <ECard key={plan.id} className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--e-elevation-2)]">
                  <ECardBody className="space-y-5 pt-6">
                    <div className="space-y-2">
                      <EEyebrow>{plan.name}</EEyebrow>
                      <p className="e-numeral text-[2rem]">
                        {plan.priceLabel || (typeof plan.startingPrice === "number" ? `$${plan.startingPrice}` : "Custom")}
                      </p>
                      {plan.tagline ? <p className="text-[0.875rem] font-medium text-[hsl(var(--e-gold-ink))]">{plan.tagline}</p> : null}
                      <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{plan.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(Array.isArray(plan.serviceTypes) ? plan.serviceTypes : []).map((jobType: any) => (
                        <span key={String(jobType)} className="rounded-[var(--e-radius-pill)] border border-[hsl(var(--e-border))] px-2.5 py-0.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                          {MARKETED_SERVICES.find((s) => s.jobType === jobType)?.shortLabel ?? String(jobType)}
                        </span>
                      ))}
                    </div>
                    <ul className="space-y-2.5 text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
                      {(Array.isArray(plan.features) ? plan.features : []).map((point: any) => (
                        <li key={String(point)} className="flex gap-2.5">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--e-accent-portal))]" />
                          <span>{String(point)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <EButton asChild variant="gold" className="flex-1">
                        <Link href={plan.ctaHref || "/v2/contact"}>{plan.ctaLabel || "Register interest"}</Link>
                      </EButton>
                      <EButton asChild variant="outline" className="flex-1">
                        <Link href="/v2/terms">Read terms</Link>
                      </EButton>
                    </div>
                  </ECardBody>
                </ECard>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Compare / CTA */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <ECard>
          <ECardBody className="pt-6 lg:flex lg:items-center lg:justify-between lg:gap-10">
            <div className="space-y-2">
              <h2 className="text-[1.25rem] font-semibold">{content.compareTitle}</h2>
              <p className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-text-secondary))]">{content.compareBody}</p>
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row lg:mt-0 lg:shrink-0">
              <EButton asChild variant="gold">
                <Link href="/v2/contact">Ask about recurring service</Link>
              </EButton>
              <EButton asChild variant="outline">
                <Link href="/v2/quote">Get pricing first</Link>
              </EButton>
            </div>
          </ECardBody>
        </ECard>
      </section>

      {/* Bottom CTA */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-2">
        <div className="overflow-hidden rounded-[var(--e-radius-xl)] bg-[hsl(var(--e-primary))] p-8 shadow-[var(--e-elevation-3)] sm:p-12 lg:flex lg:items-center lg:justify-between lg:gap-10">
          <div className="space-y-2">
            <EEyebrow className="!text-[hsl(var(--e-gold))]">Ongoing property care</EEyebrow>
            <h2 className="e-display-sm text-[hsl(var(--e-primary-foreground))]">Consistent cleaning without rebooking every time.</h2>
            <p className="max-w-xl text-[0.875rem] leading-relaxed text-[hsl(var(--e-primary-foreground)/0.75)]">
              Lock in a plan that suits your property, get recurring service at a better rate, and stop thinking about it.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3 lg:mt-0 lg:shrink-0">
            <EButton asChild variant="gold" size="lg"><Link href="/v2/quote">Start your quote</Link></EButton>
            <EButton asChild size="lg" className="border border-[hsl(var(--e-primary-foreground)/0.2)] bg-transparent text-[hsl(var(--e-primary-foreground))] hover:bg-[hsl(var(--e-primary-foreground)/0.1)]">
              <Link href="/v2/contact">Contact us <ArrowRight className="h-4 w-4" /></Link>
            </EButton>
          </div>
        </div>
      </section>
    </div>
  );
}
