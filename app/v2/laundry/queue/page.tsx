import { EBadge, ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Queue · Estate laundry" };

const STAGES = [
  { name: "Intake", items: ["12 Marine Parade · 3 sets", "5/44 Beach St · 2 sets"], tone: "neutral" as const },
  { name: "Washing", items: ["88 Ocean View Rd · 2 sets"], tone: "info" as const },
  { name: "Drying", items: ["7 Curlewis St · 4 sets"], tone: "warning" as const },
  { name: "Ready", items: ["3 Sunny Ln · 2 sets", "9 Palm Ave · 1 set"], tone: "success" as const },
];

export default function LaundryQueuePage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Board" title="Queue" description="Every set, by stage." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {STAGES.map((s) => (
          <ECard key={s.name}>
            <ECardBody className="space-y-3 pt-6">
              <div className="flex items-center justify-between">
                <p className="text-[0.8125rem] font-semibold uppercase tracking-wide text-[hsl(var(--e-muted-foreground))]">{s.name}</p>
                <EBadge tone={s.tone} soft>{s.items.length}</EBadge>
              </div>
              <div className="space-y-2">
                {s.items.map((it) => (
                  <div key={it} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
                    {it}
                  </div>
                ))}
              </div>
            </ECardBody>
          </ECard>
        ))}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
