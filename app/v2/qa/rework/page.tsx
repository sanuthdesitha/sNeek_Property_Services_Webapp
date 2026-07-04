import { EBadge, EButton, ECard, ECardBody, EEmptyState, EPageHeader } from "@/components/v2/ui/primitives";

export const metadata = { title: "Rework · Estate QA" };

const FLAGGED = [
  { property: "9 Palm Ave", area: "Master bathroom · shower glass", cleaner: "Sam T.", tone: "danger" as const, status: "Assigned back" },
];

export default function QaReworkPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Follow-up" title="Rework" description="Areas flagged for correction." />
      {FLAGGED.length === 0 ? (
        <EEmptyState eyebrow="All clear" title="Nothing flagged" description="Every clean passed this shift." />
      ) : (
        <div className="space-y-3">
          {FLAGGED.map((f, i) => (
            <ECard key={i}>
              <ECardBody className="space-y-2 pt-6">
                <div className="flex items-center justify-between">
                  <p className="text-[0.875rem] font-medium">{f.property}</p>
                  <EBadge tone={f.tone} soft>{f.status}</EBadge>
                </div>
                <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{f.area}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Cleaner: {f.cleaner}</p>
                <div className="flex gap-2 pt-1">
                  <EButton variant="outline" size="sm">View flag</EButton>
                  <EButton variant="gold" size="sm">Message cleaner</EButton>
                </div>
              </ECardBody>
            </ECard>
          ))}
        </div>
      )}
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
