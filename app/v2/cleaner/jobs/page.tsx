import { EBadge, ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";
import { ChevronRight } from "lucide-react";

export const metadata = { title: "Jobs · Estate cleaner" };

const JOBS = [
  { time: "8:30", property: "12 Marine Parade, Coogee", type: "Turnover", tone: "info" as const, status: "Next" },
  { time: "11:00", property: "88 Ocean View Rd, Bronte", type: "Turnover", tone: "primary" as const, status: "Scheduled" },
  { time: "14:00", property: "7 Curlewis St, Bondi", type: "General", tone: "primary" as const, status: "Scheduled" },
];

export default function CleanerJobsPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Your schedule" title="Jobs" description="Today's assignments." />
      <div className="space-y-3">
        {JOBS.map((j, i) => (
          <ECard key={i}>
            <ECardBody className="flex items-center gap-3 pt-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] text-[0.8125rem] font-semibold tabular-nums">{j.time}</div>
              <div className="min-w-0 flex-1">
                <p className="text-[0.875rem] font-[550]">{j.property}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{j.type}</p>
              </div>
              <EBadge tone={j.tone} soft>{j.status}</EBadge>
              <ChevronRight className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
            </ECardBody>
          </ECard>
        ))}
      </div>
    </div>
  );
}
