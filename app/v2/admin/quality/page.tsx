import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { ClipboardCheck, ShieldCheck, Star } from "lucide-react";

export const metadata = { title: "Quality · Estate admin" };

const QUEUE = [
  { property: "88 Ocean View Rd", cleaner: "Ana R.", type: "Turnover", due: "Today", tone: "primary" as const, state: "Awaiting inspection" },
  { property: "5/44 Beach St", cleaner: "Marco P.", type: "Deep clean", due: "Today", tone: "warning" as const, state: "Flagged 72%" },
  { property: "7 Curlewis St", cleaner: "Kate L.", type: "General", due: "Tomorrow", tone: "primary" as const, state: "Awaiting inspection" },
];

export default function AdminQualityPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Operations" title="Quality" description="QA queue, inspection templates, and reclean reviews." />

      <section className="grid gap-4 sm:grid-cols-3">
        <EStatCard label="Pass rate · 30d" value="96%" delta="+3 pts" icon={<ClipboardCheck className="h-4 w-4" />} />
        <EStatCard label="Awaiting QA" value="3" delta="1 flagged" deltaTone="neutral" icon={<ShieldCheck className="h-4 w-4" />} />
        <EStatCard label="Avg score" value="4.7" delta="of 5.0" deltaTone="neutral" icon={<Star className="h-4 w-4" />} />
      </section>

      <div className="space-y-3">
        <span className="e-eyebrow">INSPECTION QUEUE</span>
        {QUEUE.map((q, i) => (
          <ECard key={i}>
            <ECardBody className="flex flex-wrap items-center gap-4 pt-6">
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] font-[550]">{q.property}</p>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{q.type} · {q.cleaner} · due {q.due}</p>
              </div>
              <EBadge tone={q.tone} soft>{q.state}</EBadge>
              <EButton variant="gold" size="sm">Inspect</EButton>
            </ECardBody>
          </ECard>
        ))}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
