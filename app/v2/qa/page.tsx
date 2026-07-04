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
import { AlertTriangle, ClipboardCheck, Star, Timer } from "lucide-react";

export const metadata = { title: "Today · Estate QA" };

const PENDING = [
  { property: "12 Marine Parade", cleaner: "Ana R.", submitted: "10 min ago", tone: "warning" as const },
  { property: "88 Ocean View Rd", cleaner: "Marco P.", submitted: "40 min ago", tone: "info" as const },
  { property: "7 Curlewis St", cleaner: "Lena K.", submitted: "1 h ago", tone: "info" as const },
];

export default function QaTodayPage() {
  return (
    <div className="space-y-8">
      <header className="e-rise">
        <EEyebrow>QUALITY ASSURANCE · SYDNEY</EEyebrow>
        <h1 className="e-display-lg mt-2">Today's reviews.</h1>
        <div className="e-signature-rule mt-4" />
      </header>

      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="Awaiting review" value="3" delta="oldest 1 h" deltaTone="neutral" icon={<ClipboardCheck className="h-4 w-4" />} />
        <EStatCard label="Reviewed today" value="11" delta="+3 vs avg" icon={<Star className="h-4 w-4" />} />
        <EStatCard label="Rework flagged" value="1" delta="this shift" deltaTone="neutral" icon={<AlertTriangle className="h-4 w-4" />} />
        <EStatCard label="Avg review time" value="6m" delta="-1m" icon={<Timer className="h-4 w-4" />} />
      </section>

      <ECard variant="ceremony">
        <ECardBody className="space-y-3 pt-6">
          <div className="flex items-center justify-between">
            <EEyebrow>NEXT REVIEW</EEyebrow>
            <EBadge tone="warning" soft><Timer className="h-3 w-3" /> 10 min ago</EBadge>
          </div>
          <p className="e-display-sm">12 Marine Parade</p>
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">Ana R. · Airbnb turnover · 24 photos · 8 checklist areas</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <EButton variant="gold" size="sm">Start review</EButton>
            <EButton variant="outline" size="sm">View submission</EButton>
          </div>
        </ECardBody>
      </ECard>

      <ECard>
        <ECardHeader><ECardTitle>Pending queue</ECardTitle></ECardHeader>
        <ECardBody className="space-y-1">
          {PENDING.map((p, i) => (
            <div key={i}>
              {i > 0 ? <EThread className="my-1" /> : null}
              <div className="flex items-center justify-between gap-2 py-1.5">
                <div>
                  <p className="text-[0.875rem] font-medium">{p.property}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{p.cleaner}</p>
                </div>
                <EBadge tone={p.tone} soft>{p.submitted}</EBadge>
              </div>
            </div>
          ))}
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
