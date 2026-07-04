import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEyebrow,
  EStatCard,
  EThread,
} from "@/components/v2/ui/primitives";
import { CalendarClock, FileText, MapPin, MessageSquare, Star } from "lucide-react";

export const metadata = { title: "Home · Estate client" };

export default function ClientHomePage() {
  return (
    <div className="space-y-8">
      <header className="e-rise">
        <EEyebrow>YOUR PROPERTIES · SYDNEY</EEyebrow>
        <h1 className="e-display-lg mt-2">Welcome back, James.</h1>
        <div className="e-signature-rule mt-4" />
      </header>

      {/* Next-service hero */}
      <ECard variant="ceremony" className="overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[1.4fr_1fr]">
          <ECardBody className="space-y-3 pt-6">
            <EEyebrow>NEXT SERVICE</EEyebrow>
            <p className="e-display-sm">Tomorrow · 9:00 AM</p>
            <p className="text-[0.9375rem] text-[hsl(var(--e-text-secondary))]">
              Airbnb turnover at <span className="font-medium text-[hsl(var(--e-foreground))]">12 Marine Parade, Coogee</span>
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <EBadge tone="primary" soft><MapPin className="h-3 w-3" /> Ana R. assigned</EBadge>
              <EBadge tone="gold" soft>Confirmed</EBadge>
            </div>
            <div className="flex flex-wrap gap-2 pt-3">
              <EButton variant="gold" size="sm">Reschedule</EButton>
              <EButton variant="outline" size="sm"><MessageSquare className="h-3.5 w-3.5" /> Message ops</EButton>
            </div>
          </ECardBody>
          <div className="hidden items-center justify-center bg-[hsl(var(--e-primary))] p-6 md:flex">
            <div className="text-center text-[hsl(var(--e-primary-foreground))]">
              <CalendarClock className="mx-auto h-10 w-10 opacity-80" />
              <p className="e-serif mt-2 text-[1.5rem]">Fri 5</p>
              <p className="text-[0.75rem] opacity-70">July 2026</p>
            </div>
          </div>
        </div>
      </ECard>

      {/* KPIs */}
      <section className="grid gap-4 sm:grid-cols-3">
        <EStatCard label="Balance due" value="$310.00" delta="1 invoice open" deltaTone="neutral" icon={<FileText className="h-4 w-4" />} />
        <EStatCard label="Services · 30d" value="8" delta="+2 vs last month" icon={<CalendarClock className="h-4 w-4" />} />
        <EStatCard label="Avg rating" value="4.9" delta="last 10 cleans" deltaTone="neutral" icon={<Star className="h-4 w-4" />} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Approvals */}
        <ECard>
          <ECardHeader><ECardTitle>Awaiting your approval</ECardTitle></ECardHeader>
          <ECardBody className="space-y-2">
            <EAlert tone="warning" title="Extra charge · $45.00">
              Ana requested approval for extra oven degreasing at 12 Marine Parade.
              <div className="mt-2 flex gap-2">
                <EButton variant="gold" size="sm">Approve</EButton>
                <EButton variant="ghost" size="sm">Decline</EButton>
              </div>
            </EAlert>
          </ECardBody>
        </ECard>

        {/* Recent reports */}
        <ECard>
          <ECardHeader className="flex-row items-center justify-between">
            <ECardTitle>Recent reports</ECardTitle>
            <EButton variant="ghost" size="sm">View all</EButton>
          </ECardHeader>
          <ECardBody className="space-y-1">
            {[
              ["12 Marine Parade", "2 Jul", "Turnover"],
              ["5/44 Beach St", "29 Jun", "Deep clean"],
              ["88 Ocean View Rd", "27 Jun", "Turnover"],
            ].map(([name, date, type], i) => (
              <div key={i}>
                {i > 0 ? <EThread className="my-1" /> : null}
                <div className="flex items-center justify-between gap-2 py-1.5">
                  <div>
                    <p className="text-[0.875rem] font-medium">{name}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{type}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))] tabular-nums">{date}</span>
                    <EButton variant="outline-gold" size="sm">Read</EButton>
                  </div>
                </div>
              </div>
            ))}
          </ECardBody>
        </ECard>
      </div>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
