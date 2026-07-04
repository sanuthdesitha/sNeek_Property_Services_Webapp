import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { CalendarPlus, ChevronRight } from "lucide-react";

export const metadata = { title: "Services · Estate client" };

const UPCOMING = [
  { date: "Fri 5 Jul", time: "9:00 AM", property: "12 Marine Parade", type: "Airbnb turnover", who: "Ana R.", tone: "primary" as const, status: "Confirmed" },
  { date: "Mon 8 Jul", time: "10:00 AM", property: "5/44 Beach St", type: "Deep clean", who: "Marco P.", tone: "primary" as const, status: "Scheduled" },
];
const PAST = [
  { date: "2 Jul", property: "12 Marine Parade", type: "Turnover", tone: "success" as const, status: "Completed" },
  { date: "29 Jun", property: "5/44 Beach St", type: "Deep clean", tone: "success" as const, status: "Completed" },
  { date: "27 Jun", property: "88 Ocean View Rd", type: "Turnover", tone: "aubergine" as const, status: "QA reviewed" },
];

export default function ClientServicesPage() {
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your bookings"
        title="Services"
        description="Everything upcoming and everything done — in one lifecycle."
        actions={<EButton variant="gold" size="sm"><CalendarPlus className="h-3.5 w-3.5" /> Book a clean</EButton>}
      />

      <section className="space-y-3">
        <span className="e-eyebrow">UPCOMING</span>
        {UPCOMING.map((s, i) => (
          <ECard key={i}>
            <ECardBody className="flex items-center gap-4 pt-6">
              <div className="flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-primary))] text-[hsl(var(--e-primary-foreground))]">
                <span className="text-[0.625rem] uppercase opacity-70">{s.date.split(" ")[0]}</span>
                <span className="e-serif text-[1.25rem] leading-none">{s.date.split(" ")[1]}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] font-[550]">{s.property}</p>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{s.time} · {s.type} · {s.who}</p>
              </div>
              <EBadge tone={s.tone} soft>{s.status}</EBadge>
              <ChevronRight className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
            </ECardBody>
          </ECard>
        ))}
      </section>

      <section className="space-y-3">
        <span className="e-eyebrow">SERVICE HISTORY</span>
        <ECard>
          <ECardBody className="pt-6">
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {PAST.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-[0.875rem] font-medium">{s.property}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{s.type}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))] tabular-nums">{s.date}</span>
                    <EBadge tone={s.tone} soft>{s.status}</EBadge>
                    <EButton variant="outline-gold" size="sm">Report</EButton>
                  </div>
                </div>
              ))}
            </div>
          </ECardBody>
        </ECard>
      </section>
    </div>
  );
}
