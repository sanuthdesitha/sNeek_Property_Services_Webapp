"use client";

/**
 * Native Estate read-only render of the public website content. This is NOT the
 * live marketing site — it's a faithful Estate-styled preview of the same
 * `websiteContent` object the editor mutates, so admins can eyeball structure,
 * copy and imagery before publishing. Rendered inside the framed preview at
 * /v2/admin/website/preview.
 */
import * as React from "react";
import type { WebsiteContent } from "@/lib/public-site/content";
import { EBadge } from "@/components/v2/ui/primitives";

function SectionHeading({ eyebrow, title, intro }: { eyebrow?: string; title: string; intro?: string }) {
  return (
    <div className="mx-auto mb-8 max-w-2xl text-center">
      {eyebrow ? <p className="e-eyebrow mb-2 justify-center">{eyebrow}</p> : null}
      <h2 className="e-display-md">{title}</h2>
      {intro ? <p className="mt-3 text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">{intro}</p> : null}
    </div>
  );
}

function FeatureGrid({ cards }: { cards: WebsiteContent["home"]["serviceBenefits"] }) {
  if (!cards.length) return null;
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <div key={card.id} className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          {card.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.imageUrl} alt={card.imageAlt} className="h-40 w-full object-cover" />
          ) : (
            <div className="flex h-40 items-center justify-center bg-[hsl(var(--e-surface-raised))] text-[0.75rem] uppercase tracking-[0.12em] text-[hsl(var(--e-text-faint))]">
              No image
            </div>
          )}
          <div className="space-y-2 p-5">
            <h3 className="text-[1rem] font-semibold tracking-[-0.01em]">{card.title}</h3>
            <p className="text-[0.875rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">{card.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function WebsitePreviewRender({ content }: { content: WebsiteContent }) {
  const { announcementBar: ab, maintenanceMode, home, contact, footer, whyChooseUs, faq, gallery } = content;

  if (maintenanceMode.enabled) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-20 text-center">
        <EBadge tone="warning" soft>
          Maintenance mode
        </EBadge>
        <h1 className="e-display-md mt-4 max-w-xl">{maintenanceMode.message}</h1>
        <p className="mt-3 max-w-md text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
          {maintenanceMode.supportMessage}
        </p>
      </div>
    );
  }

  return (
    <div className="pb-16">
      {/* Announcement bar */}
      {ab.enabled ? (
        <div className="border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-primary))] px-6 py-2 text-center text-[0.8125rem] text-[hsl(var(--e-primary-foreground))]">
          {ab.promoMessage}
          {ab.promoLink ? <span className="ml-1 font-semibold underline">{ab.promoLinkLabel || "Book now →"}</span> : null}
          <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[0.6875rem] opacity-90">
            {ab.showPhone ? <span>{contact.displayPhone}</span> : null}
            {ab.showLocation ? <span>{contact.addressLine}</span> : null}
            {ab.showHours ? <span>Mon–Sat 7am–6pm</span> : null}
            {ab.showEmail ? <span>{contact.displayEmail}</span> : null}
          </div>
        </div>
      ) : null}

      {/* Hero */}
      <section className="grid items-center gap-8 px-6 py-14 lg:grid-cols-2 lg:px-10">
        <div>
          {home.eyebrow ? <p className="e-eyebrow mb-3">{home.eyebrow}</p> : null}
          <h1 className="e-display-lg">{home.title}</h1>
          <p className="mt-4 text-[1.0625rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">{home.subtitle}</p>
          {home.brandIdea ? (
            <p className="mt-3 text-[0.9375rem] italic text-[hsl(var(--e-text-secondary))]">{home.brandIdea}</p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <span className="inline-flex items-center rounded-[var(--e-radius)] bg-[hsl(var(--e-primary))] px-5 py-2.5 text-[0.875rem] font-[550] text-[hsl(var(--e-primary-foreground))]">
              {home.primaryCtaLabel}
            </span>
            <span className="inline-flex items-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] px-5 py-2.5 text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">
              {home.secondaryCtaLabel}
            </span>
          </div>
        </div>
        <div className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]">
          {home.heroImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={home.heroImageUrl} alt={home.heroImageAlt} className="h-72 w-full object-cover" />
          ) : (
            <div className="flex h-72 items-center justify-center bg-[hsl(var(--e-surface-raised))] text-[0.75rem] uppercase tracking-[0.12em] text-[hsl(var(--e-text-faint))]">
              Hero image
            </div>
          )}
        </div>
      </section>

      {/* Stats */}
      {home.stats.length ? (
        <section className="border-y border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-6 py-8 lg:px-10">
          <div className="grid gap-6 sm:grid-cols-3">
            {home.stats.map((s, i) => (
              <div key={i} className="text-center">
                <p className="e-numeral text-[2rem] leading-none text-[hsl(var(--e-gold-ink))]">{s.value}</p>
                <p className="mt-1 text-[0.875rem] font-semibold">{s.label}</p>
                {s.note ? <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{s.note}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Service benefits */}
      <section className="px-6 py-14 lg:px-10">
        <SectionHeading title={home.servicesTitle} intro={home.servicesIntro} />
        <FeatureGrid cards={home.serviceBenefits} />
      </section>

      {/* Hosting features */}
      <section className="bg-[hsl(var(--e-surface-raised))] px-6 py-14 lg:px-10">
        <SectionHeading title={home.hostingTitle} intro={home.hostingIntro} />
        <FeatureGrid cards={home.hostingFeatures} />
      </section>

      {/* Why choose us */}
      {whyChooseUs.items.length ? (
        <section className="px-6 py-14 lg:px-10">
          <SectionHeading title={whyChooseUs.title} intro={whyChooseUs.intro} />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {whyChooseUs.items.map((item) => (
              <div key={item.id} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-5">
                <EBadge tone="gold" soft>
                  {item.icon}
                </EBadge>
                <h3 className="mt-3 text-[1rem] font-semibold tracking-[-0.01em]">{item.title}</h3>
                <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Testimonials */}
      {home.testimonials.length ? (
        <section className="bg-[hsl(var(--e-surface-raised))] px-6 py-14 lg:px-10">
          <div className="grid gap-5 lg:grid-cols-3">
            {home.testimonials.map((t, i) => (
              <figure key={i} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-6">
                <blockquote className="text-[0.9375rem] leading-relaxed text-[hsl(var(--e-foreground))]">“{t.quote}”</blockquote>
                <figcaption className="mt-4 text-[0.8125rem]">
                  <span className="font-semibold">{t.author}</span>
                  {t.meta ? <span className="text-[hsl(var(--e-muted-foreground))]"> · {t.meta}</span> : null}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}

      {/* Gallery */}
      {gallery.items.some((g) => g.imageUrl) ? (
        <section className="px-6 py-14 lg:px-10">
          <SectionHeading title={gallery.title} intro={gallery.intro} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.items
              .filter((g) => g.imageUrl)
              .map((g) => (
                <figure key={g.id} className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={g.imageUrl} alt={g.imageAlt} className="h-48 w-full object-cover" />
                  {(g.caption || g.serviceType) ? (
                    <figcaption className="flex items-center justify-between gap-2 p-3 text-[0.75rem]">
                      <span>{g.caption}</span>
                      {g.serviceType ? <EBadge soft>{g.serviceType}</EBadge> : null}
                    </figcaption>
                  ) : null}
                </figure>
              ))}
          </div>
        </section>
      ) : null}

      {/* FAQ */}
      {faq.items.length ? (
        <section className="bg-[hsl(var(--e-surface-raised))] px-6 py-14 lg:px-10">
          <SectionHeading title={faq.title} intro={faq.intro} />
          <div className="mx-auto max-w-3xl space-y-3">
            {faq.items.map((item) => (
              <div key={item.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[0.9375rem] font-semibold">{item.question}</p>
                  <EBadge soft>{item.category}</EBadge>
                </div>
                <p className="mt-2 text-[0.875rem] leading-relaxed text-[hsl(var(--e-muted-foreground))]">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Final CTA */}
      <section className="px-6 py-16 text-center lg:px-10">
        <h2 className="e-display-md mx-auto max-w-2xl">{home.finalCtaTitle}</h2>
        <p className="mx-auto mt-3 max-w-xl text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">{home.finalCtaBody}</p>
      </section>

      {/* Footer */}
      <footer className="border-t border-[hsl(var(--e-border))] px-6 py-10 lg:px-10">
        <div className="grid gap-6 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] sm:grid-cols-3">
          <p>{footer.blurb}</p>
          <p>{footer.areas}</p>
          <p>{footer.supportLine}</p>
        </div>
        <p className="mt-6 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          {contact.displayEmail} · {contact.displayPhone} · {contact.addressLine}
        </p>
      </footer>
    </div>
  );
}
