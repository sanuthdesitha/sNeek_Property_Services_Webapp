import Link from "next/link";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EEyebrow,
  EPageHeader,
  EStatCard,
  EThread,
} from "@/components/v2/ui/primitives";
import { ArrowUpRight, ClipboardCheck, Home, Sparkles, Wallet } from "lucide-react";

export const metadata = { title: "Estate — Style guide" };

const ACCENTS = ["admin", "client", "cleaner", "laundry", "qa", "maintenance"] as const;

/** M1 living style guide — the surface the owner reviews to approve the brand. */
export default function ShowcasePage() {
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-6 py-12">
      {/* Greeting header signature moment */}
      <header className="e-rise">
        <EEyebrow>THE ESTATE DESIGN SYSTEM · REBRAND PREVIEW</EEyebrow>
        <h1 className="e-display-lg mt-2">Good morning, Sanuth.</h1>
        <p className="mt-1 text-[0.9375rem] text-[hsl(var(--e-muted-foreground))]">
          A calm, luxurious workspace in estate green, champagne, and warm ivory. Everything below is live —
          these are the real components the rebrand will be built from.
        </p>
        <div className="e-signature-rule mt-4" />
      </header>

      {/* Palette */}
      <section className="space-y-4">
        <EPageHeader eyebrow="Foundations" title="Palette" description="Warm ivory ground, deep estate green, champagne gold." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            ["Paper", "--e-background"],
            ["Surface", "--e-surface"],
            ["Estate green", "--e-primary"],
            ["Champagne", "--e-gold"],
            ["Gold ink", "--e-gold-ink"],
            ["Ink", "--e-foreground"],
          ].map(([name, token]) => (
            <div key={token} className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))]">
              <div className="h-16" style={{ backgroundColor: `hsl(var(${token}))` }} />
              <div className="bg-[hsl(var(--e-surface))] px-3 py-2">
                <p className="text-[0.8125rem] font-medium">{name}</p>
                <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">{token}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Typography */}
      <section className="space-y-4">
        <EPageHeader eyebrow="Foundations" title="Typography" description="Fraunces display serif · Inter UI · serif numerals for money." />
        <ECard>
          <ECardBody className="space-y-3 pt-6">
            <p className="e-display-2xl">Estate</p>
            <p className="e-display-lg">Pristine by standard.</p>
            <p className="e-display-sm">Twelve turnovers on the board.</p>
            <p className="text-[0.9375rem]">Body copy in Inter at 15px, 1.55 line-height — legibility is luxury.</p>
            <p className="flex items-baseline gap-3">
              <span className="e-numeral text-[2rem]">$4,280.50</span>
              <EBadge tone="success" soft>+12.4%</EBadge>
            </p>
          </ECardBody>
        </ECard>
      </section>

      {/* Stat cards */}
      <section className="space-y-4">
        <EPageHeader eyebrow="Components" title="Stat cards" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <EStatCard label="Revenue · 7d" value="$18,940" delta="+8.1% vs last week" icon={<Wallet className="h-4 w-4" />} />
          <EStatCard label="Jobs today" value="14" delta="2 unassigned" deltaTone="neutral" icon={<Home className="h-4 w-4" />} />
          <EStatCard label="QA pass rate" value="96%" delta="+3 pts" icon={<ClipboardCheck className="h-4 w-4" />} />
          <EStatCard label="New leads" value="7" delta="−1 vs yesterday" deltaTone="danger" icon={<Sparkles className="h-4 w-4" />} />
        </div>
      </section>

      {/* Buttons */}
      <section className="space-y-4">
        <EPageHeader eyebrow="Components" title="Buttons" description="Gold is reserved for the single money action per screen." />
        <ECard>
          <ECardBody className="flex flex-wrap items-center gap-3 pt-6">
            <EButton variant="primary">Primary action</EButton>
            <EButton variant="gold">Send quote</EButton>
            <EButton variant="outline">Secondary</EButton>
            <EButton variant="outline-gold">Approve</EButton>
            <EButton variant="ghost">Ghost</EButton>
            <EButton variant="danger">Delete</EButton>
            <EButton variant="primary" size="sm">Small</EButton>
            <EButton variant="primary" size="lg">Large <ArrowUpRight className="h-4 w-4" /></EButton>
          </ECardBody>
        </ECard>
      </section>

      {/* Badges + alerts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ECard>
          <ECardHeader><ECardTitle>Status pills</ECardTitle></ECardHeader>
          <ECardBody className="flex flex-wrap gap-2">
            <EBadge tone="primary" soft>Scheduled</EBadge>
            <EBadge tone="info" soft>In progress</EBadge>
            <EBadge tone="aubergine" soft>QA review</EBadge>
            <EBadge tone="success" soft>Completed</EBadge>
            <EBadge tone="warning" soft>Unassigned</EBadge>
            <EBadge tone="danger" soft>Flagged</EBadge>
            <EBadge tone="gold" soft>Invoiced</EBadge>
            <EBadge tone="neutral">Draft</EBadge>
          </ECardBody>
        </ECard>
        <ECard>
          <ECardHeader><ECardTitle>Callouts</ECardTitle></ECardHeader>
          <ECardBody className="space-y-2">
            <EAlert tone="success" title="Quote accepted">The client approved the proposal for 12 Marine Parade.</EAlert>
            <EAlert tone="warning" title="Margin floor">This quote is below the 40% floor.</EAlert>
          </ECardBody>
        </ECard>
      </section>

      {/* Portal accents */}
      <section className="space-y-4">
        <EPageHeader eyebrow="System" title="Portal accents" description="One shell, six mineral accents — the white-label story." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {ACCENTS.map((accent) => (
            <div key={accent} data-portal-accent={accent} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
              <div className="e-signature-rule mb-3" />
              <p className="text-[0.8125rem] font-semibold capitalize">{accent}</p>
              <div className="mt-2 h-6 w-full rounded-[var(--e-radius-sm)]" style={{ backgroundColor: "hsl(var(--e-accent-portal))" }} />
            </div>
          ))}
        </div>
      </section>

      {/* Ceremony + empty state */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ECard variant="ceremony">
          <ECardBody className="space-y-2 pt-6">
            <EThread />
            <p className="e-display-sm pt-2">Send this quote?</p>
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              <span className="e-numeral text-[1.25rem]">$1,240.00</span> to 12 Marine Parade.
            </p>
            <div className="flex gap-2 pt-2">
              <EButton variant="gold">Send</EButton>
              <EButton variant="ghost">Cancel</EButton>
            </div>
          </ECardBody>
        </ECard>
        <EEmptyState
          eyebrow="NO JOBS TODAY"
          title="A quiet morning."
          description="Nothing on the board. Enjoy the calm — or create a job to get started."
          action={<EButton variant="outline">Create a job</EButton>}
        />
      </section>

      <footer className="border-t border-[hsl(var(--e-border))] pt-6">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Estate rebrand · v2 preview ·{" "}
          <Link href="/v2" className="text-[hsl(var(--e-gold-ink))] underline underline-offset-2">v2 home</Link>
        </p>
      </footer>
    </div>
  );
}
