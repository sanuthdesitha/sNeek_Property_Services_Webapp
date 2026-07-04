import Link from "next/link";
import { EBadge, ECard, ECardBody, EEyebrow } from "@/components/v2/ui/primitives";
import { ArrowUpRight } from "lucide-react";

export const metadata = { title: "Estate — rebrand preview" };

const LINKS = [
  { href: "/v2/showcase", label: "Design system", desc: "Living style guide — tokens, typography, components", accent: "admin" },
  { href: "/v2/admin", label: "Admin", desc: "Command dashboard", accent: "admin" },
  { href: "/v2/client", label: "Client portal", desc: "Home, services, money", accent: "client" },
  { href: "/v2/cleaner", label: "Cleaner app", desc: "Today, jobs, supplies, pay", accent: "cleaner" },
  { href: "/v2/laundry", label: "Laundry", desc: "Queue, runs, stats", accent: "laundry" },
  { href: "/v2/qa", label: "Quality", desc: "Reviews, rework, stats", accent: "qa" },
  { href: "/v2/maintenance", label: "Maintenance", desc: "Tickets, replacements, log", accent: "maintenance" },
  { href: "/v2/home", label: "Public site", desc: "Marketing home", accent: "public" },
];

export default function V2Home() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <EEyebrow>SNEEK PROPERTY SERVICES</EEyebrow>
      <h1 className="e-display-xl mt-2">The Estate rebrand.</h1>
      <p className="mt-2 max-w-xl text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
        An in-progress preview of the luxury redesign, built in isolation from the live app. Nothing here
        affects production.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {LINKS.map((link) => (
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
      <p className="mt-8 flex items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <EBadge tone="gold" soft>Preview</EBadge> Admin-only · not the live UI
      </p>
    </div>
  );
}
