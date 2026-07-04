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
import { PackageCheck, Timer, Truck, Waves } from "lucide-react";

export const metadata = { title: "Today · Estate laundry" };

const QUEUE = [
  { property: "12 Marine Parade", sets: "3 sets", stage: "Washing", tone: "info" as const },
  { property: "88 Ocean View Rd", sets: "2 sets", stage: "Drying", tone: "warning" as const },
  { property: "7 Curlewis St", sets: "4 sets", stage: "Ready", tone: "success" as const },
];

export default function LaundryTodayPage() {
  return (
    <div className="space-y-8">
      <header className="e-rise">
        <EEyebrow>LAUNDRY OPERATIONS · SYDNEY</EEyebrow>
        <h1 className="e-display-lg mt-2">Today's linen.</h1>
        <div className="e-signature-rule mt-4" />
      </header>

      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="In queue" value="9" delta="sets" deltaTone="neutral" icon={<Waves className="h-4 w-4" />} />
        <EStatCard label="Drying" value="2" delta="~40 min" deltaTone="neutral" icon={<Timer className="h-4 w-4" />} />
        <EStatCard label="Ready" value="4" delta="for dispatch" icon={<PackageCheck className="h-4 w-4" />} />
        <EStatCard label="Runs today" value="3" delta="2 done" deltaTone="neutral" icon={<Truck className="h-4 w-4" />} />
      </section>

      <ECard variant="ceremony">
        <ECardBody className="space-y-3 pt-6">
          <div className="flex items-center justify-between">
            <EEyebrow>NEXT DISPATCH · 2:00 PM</EEyebrow>
            <EBadge tone="primary" soft><Truck className="h-3 w-3" /> Eastern loop</EBadge>
          </div>
          <p className="e-display-sm">4 properties · 9 sets</p>
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">Coogee → Bronte → Bondi · est. 55 min</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <EButton variant="gold" size="sm">Build run</EButton>
            <EButton variant="outline" size="sm">View manifest</EButton>
          </div>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader><ECardTitle>Live queue</ECardTitle></ECardHeader>
        <ECardBody className="space-y-1">
          {QUEUE.map((q, i) => (
            <div key={i}>
              {i > 0 ? <EThread className="my-1" /> : null}
              <div className="flex items-center justify-between gap-2 py-1.5">
                <div>
                  <p className="text-[0.875rem] font-medium">{q.property}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{q.sets}</p>
                </div>
                <EBadge tone={q.tone} soft>{q.stage}</EBadge>
              </div>
            </div>
          ))}
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
