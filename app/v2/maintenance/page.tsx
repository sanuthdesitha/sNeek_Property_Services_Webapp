import {
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
import { CheckCircle2, Package, Timer, Wrench } from "lucide-react";

export const metadata = { title: "Today · Estate maintenance" };

const OPEN = [
  { property: "12 Marine Parade", issue: "Dishwasher not draining", priority: "High", tone: "danger" as const },
  { property: "88 Ocean View Rd", issue: "Blind cord frayed", priority: "Medium", tone: "warning" as const },
  { property: "7 Curlewis St", issue: "Replace shower head", priority: "Low", tone: "info" as const },
];

export default function MaintenanceTodayPage() {
  return (
    <div className="space-y-8">
      <header className="e-rise">
        <EEyebrow>MAINTENANCE · SYDNEY</EEyebrow>
        <h1 className="e-display-lg mt-2">Today's work orders.</h1>
        <div className="e-signature-rule mt-4" />
      </header>

      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="Open tickets" value="5" delta="1 high" deltaTone="neutral" icon={<Wrench className="h-4 w-4" />} />
        <EStatCard label="Due today" value="2" delta="scheduled" deltaTone="neutral" icon={<Timer className="h-4 w-4" />} />
        <EStatCard label="Replacements" value="3" delta="pending order" deltaTone="neutral" icon={<Package className="h-4 w-4" />} />
        <EStatCard label="Closed · week" value="14" delta="+4" icon={<CheckCircle2 className="h-4 w-4" />} />
      </section>

      <ECard variant="ceremony">
        <ECardBody className="space-y-3 pt-6">
          <div className="flex items-center justify-between">
            <EEyebrow>NEXT TICKET · HIGH</EEyebrow>
            <EBadge tone="danger" soft><Timer className="h-3 w-3" /> Due today</EBadge>
          </div>
          <p className="e-display-sm">Dishwasher not draining</p>
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">12 Marine Parade, Coogee · reported by Ana R. during turnover</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <EButton variant="gold" size="sm">Start ticket</EButton>
            <EButton variant="outline" size="sm">View photos</EButton>
          </div>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader><ECardTitle>Open tickets</ECardTitle></ECardHeader>
        <ECardBody className="space-y-1">
          {OPEN.map((o, i) => (
            <div key={i}>
              {i > 0 ? <EThread className="my-1" /> : null}
              <div className="flex items-center justify-between gap-2 py-1.5">
                <div>
                  <p className="text-[0.875rem] font-medium">{o.issue}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{o.property}</p>
                </div>
                <EBadge tone={o.tone} soft>{o.priority}</EBadge>
              </div>
            </div>
          ))}
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
