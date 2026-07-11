import Link from "next/link";
import { EBadge, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";
import { ArrowUpRight } from "lucide-react";

export const metadata = { title: "Estate — rebrand preview" };

const PORTAL_LINKS = [
  { href: "/v2/showcase", label: "Design system", desc: "Living style guide — tokens, typography, components", accent: "admin" },
  { href: "/v2/admin", label: "Admin", desc: "Command dashboard", accent: "admin" },
  { href: "/v2/client", label: "Client portal", desc: "Home, services, money", accent: "client" },
  { href: "/v2/cleaner", label: "Cleaner app", desc: "Today, jobs, supplies, pay", accent: "cleaner" },
  { href: "/v2/laundry", label: "Laundry", desc: "Queue, runs, stats", accent: "laundry" },
  { href: "/v2/qa", label: "Quality", desc: "Reviews, rework, stats", accent: "qa" },
  { href: "/v2/maintenance", label: "Maintenance", desc: "Tickets, replacements, log", accent: "maintenance" },
];

const PUBLIC_LINKS = [
  { href: "/v2/home", label: "Home", desc: "Marketing homepage", accent: "public" },
  { href: "/v2/services", label: "Services", desc: "All service families", accent: "public" },
  { href: "/v2/why-us", label: "Why sNeek", desc: "Trust & differentiators", accent: "public" },
  { href: "/v2/airbnb-hosting", label: "Airbnb hosting", desc: "Short-stay support page", accent: "public" },
  { href: "/v2/faq", label: "FAQ", desc: "Categorised Q&A with filter", accent: "public" },
  { href: "/v2/contact", label: "Contact", desc: "Contact form + quick-contact cards", accent: "public" },
  { href: "/v2/compare", label: "Compare", desc: "Side-by-side service comparison", accent: "public" },
  { href: "/v2/subscriptions", label: "Subscriptions", desc: "Recurring plan cards", accent: "public" },
  { href: "/v2/blog", label: "Blog", desc: "Article index + featured post", accent: "public" },
  { href: "/v2/careers", label: "Careers", desc: "Open position cards", accent: "public" },
  { href: "/v2/quote", label: "Quote", desc: "Live 8-step quote wizard", accent: "public" },
  { href: "/v2/terms", label: "Terms", desc: "Terms & conditions", accent: "public" },
  { href: "/v2/privacy", label: "Privacy", desc: "Privacy policy", accent: "public" },
];

function LinkGrid({ links }: { links: typeof PORTAL_LINKS }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {links.map((link) => (
        <Link key={link.href} href={link.href} data-portal-accent={link.accent}>
          <ECard className="group h-full transition-shadow duration-200 hover:shadow-[var(--e-elevation-2)]">
            <ECardBody className="flex items-start justify-between gap-3 pt-6">
              <div>
                <div className="e-signature-rule mb-3 w-24" />
                <p className="text-[1.0625rem] font-semibold">{link.label}</p>
                <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{link.desc}</p>
              </div>
              <ArrowUpRight className="h-5 w-5 flex-shrink-0 text-[hsl(var(--e-gold-ink))] transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </ECardBody>
          </ECard>
        </Link>
      ))}
    </div>
  );
}

export default function V2Home() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16 space-y-12">
      <div>
        <EEyebrow>SNEEK PROPERTY SERVICES</EEyebrow>
        <h1 className="e-display-xl mt-2">The Estate rebrand.</h1>
        <p className="mt-2 max-w-xl text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
          An in-progress preview of the luxury redesign, built in isolation from the live app. Nothing here
          affects production.
        </p>
      </div>

      <section>
        <EEyebrow className="mb-4">Portals &amp; design system</EEyebrow>
        <LinkGrid links={PORTAL_LINKS} />
      </section>

      <section>
        <EEyebrow className="mb-4">Public site — M2</EEyebrow>
        <LinkGrid links={PUBLIC_LINKS} />
      </section>

      <p className="flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <EBadge tone="gold" soft>Preview</EBadge> Admin-only · not the live UI
      </p>
    </div>
  );
}
