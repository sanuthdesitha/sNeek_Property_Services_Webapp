import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { CalendarDays, LayoutGrid, MapPin, Plus, Search, SlidersHorizontal } from "lucide-react";

export const metadata = { title: "Jobs · Estate admin" };

const COLUMNS = [
  {
    title: "Unassigned",
    tone: "warning" as const,
    cards: [
      { p: "Unit 3, 210 Oxford St", t: "End of lease", time: "10:15", suburb: "Paddington" },
      { p: "9 Wentworth Ave", t: "Deep clean", time: "13:00", suburb: "Randwick" },
    ],
  },
  {
    title: "Scheduled",
    tone: "primary" as const,
    cards: [
      { p: "12 Marine Parade", t: "Turnover", time: "08:30", suburb: "Coogee", who: "Ana R." },
      { p: "7 Curlewis St", t: "General", time: "14:00", suburb: "Bondi", who: "Kate L." },
    ],
  },
  {
    title: "In progress",
    tone: "info" as const,
    cards: [{ p: "5/44 Beach St", t: "Deep clean", time: "09:00", suburb: "Bondi", who: "Marco P." }],
  },
  {
    title: "QA / Done",
    tone: "success" as const,
    cards: [
      { p: "88 Ocean View Rd", t: "Turnover", time: "11:00", suburb: "Bronte", who: "Ana R.", qa: true },
    ],
  },
];

export default function AdminJobsPage() {
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Jobs"
        description="One board, every job. Switch to calendar or map without leaving the page."
        actions={
          <>
            <EButton variant="outline" size="sm"><LayoutGrid className="h-3.5 w-3.5" /> Board</EButton>
            <EButton variant="ghost" size="sm"><CalendarDays className="h-3.5 w-3.5" /> Calendar</EButton>
            <EButton variant="ghost" size="sm"><MapPin className="h-3.5 w-3.5" /> Map</EButton>
            <EButton variant="gold" size="sm"><Plus className="h-3.5 w-3.5" /> New job</EButton>
          </>
        }
      />

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 flex-1 items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          <Search className="h-4 w-4" /> Search jobs, clients, properties…
        </div>
        <EButton variant="outline" size="sm"><SlidersHorizontal className="h-3.5 w-3.5" /> Filters</EButton>
        <EBadge tone="primary" soft>Today</EBadge>
        <EBadge tone="neutral">All cleaners</EBadge>
      </div>

      {/* Board */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => (
          <div key={col.title} className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="e-eyebrow">{col.title}</span>
              <span className="e-numeral text-[0.9375rem]">{col.cards.length}</span>
            </div>
            {col.cards.map((c, i) => (
              <ECard key={i} className="relative overflow-hidden">
                <span className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: `hsl(var(--e-${col.tone === "primary" ? "accent-portal" : col.tone}))` }} />
                <ECardBody className="space-y-2 pt-5">
                  <p className="text-[0.875rem] font-[550]">{c.p}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{c.t} · {c.suburb}</p>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[0.75rem] font-medium tabular-nums">{c.time}</span>
                    {"qa" in c && c.qa ? (
                      <EBadge tone="aubergine" soft>QA</EBadge>
                    ) : "who" in c && c.who ? (
                      <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full text-[0.5625rem] font-semibold text-[hsl(var(--e-accent-portal-foreground))]" style={{ backgroundColor: "hsl(var(--e-accent-portal))" }}>
                          {c.who.slice(0, 2)}
                        </span>
                        {c.who}
                      </span>
                    ) : (
                      <EButton variant="outline-gold" size="sm">Assign</EButton>
                    )}
                  </div>
                </ECardBody>
              </ECard>
            ))}
          </div>
        ))}
      </div>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
