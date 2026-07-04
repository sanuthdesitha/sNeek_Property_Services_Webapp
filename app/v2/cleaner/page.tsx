import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEyebrow,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { CheckCircle2, Clock, MapPin, Navigation, Play } from "lucide-react";

export const metadata = { title: "Today · Estate cleaner" };

const LATER = [
  { time: "11:00", property: "88 Ocean View Rd, Bronte", type: "Turnover", tone: "primary" as const, status: "Scheduled" },
  { time: "14:00", property: "7 Curlewis St, Bondi", type: "General clean", tone: "primary" as const, status: "Scheduled" },
];

export default function CleanerTodayPage() {
  return (
    <div className="space-y-6">
      <header className="e-rise">
        <EEyebrow>THURSDAY · 4 JULY</EEyebrow>
        <h1 className="e-display-md mt-1">Morning, Ana.</h1>
        <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Three jobs today · $210 in earnings.</p>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <EStatCard label="Jobs" value="3" />
        <EStatCard label="Hours" value="6.5" />
        <EStatCard label="Earnings" value="$210" />
      </section>

      {/* Next job — the hero card */}
      <ECard variant="ceremony">
        <ECardBody className="space-y-3 pt-6">
          <div className="flex items-center justify-between">
            <EEyebrow>NEXT JOB · NOW</EEyebrow>
            <EBadge tone="info" soft><Clock className="h-3 w-3" /> Due 8:30</EBadge>
          </div>
          <p className="e-display-sm">12 Marine Parade</p>
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">Coogee · Airbnb turnover · 2 bd · 1 ba</p>
          <div className="grid grid-cols-3 gap-2 pt-2">
            <EButton variant="outline"><Navigation className="h-4 w-4" /> Navigate</EButton>
            <EButton variant="outline"><MapPin className="h-4 w-4" /> Arrive</EButton>
            <EButton variant="gold"><Play className="h-4 w-4" /> Start</EButton>
          </div>
        </ECardBody>
      </ECard>

      {/* Later today */}
      <section className="space-y-3">
        <span className="e-eyebrow">LATER TODAY</span>
        {LATER.map((j, i) => (
          <ECard key={i}>
            <ECardBody className="flex items-center gap-3 pt-6">
              <div className="flex h-11 w-11 flex-col items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))]">
                <span className="text-[0.8125rem] font-semibold tabular-nums">{j.time}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[0.875rem] font-[550]">{j.property}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{j.type}</p>
              </div>
              <EBadge tone={j.tone} soft>{j.status}</EBadge>
            </ECardBody>
          </ECard>
        ))}
      </section>

      {/* End of day (signature moment placeholder) */}
      <ECard className="border-dashed">
        <ECardBody className="flex items-center gap-3 pt-6 text-[hsl(var(--e-muted-foreground))]">
          <CheckCircle2 className="h-5 w-5" />
          <p className="text-[0.8125rem]">Finish all three and the day closes with a flourish.</p>
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
