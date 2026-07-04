import { EBadge, EButton, ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";
import { Plus } from "lucide-react";

export const metadata = { title: "Replacements · Estate maintenance" };

const ITEMS = [
  { item: "Shower head · chrome", property: "7 Curlewis St", cost: "$48", tone: "warning" as const, status: "To order" },
  { item: "Bedside lamp × 2", property: "12 Marine Parade", cost: "$120", tone: "info" as const, status: "Ordered" },
  { item: "Bath mat set", property: "88 Ocean View Rd", cost: "$35", tone: "success" as const, status: "Installed" },
];

export default function MaintenanceReplacementsPage() {
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Airbnb assets"
        title="Replacements"
        description="Track worn items and reorders."
        actions={<EButton variant="gold" size="sm"><Plus className="h-3.5 w-3.5" /> Log replacement</EButton>}
      />
      <div className="space-y-3">
        {ITEMS.map((it, i) => (
          <ECard key={i}>
            <ECardBody className="flex items-center gap-3 pt-6">
              <div className="min-w-0 flex-1">
                <p className="text-[0.875rem] font-medium">{it.item}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{it.property}</p>
              </div>
              <span className="e-numeral text-[0.9375rem]">{it.cost}</span>
              <EBadge tone={it.tone} soft>{it.status}</EBadge>
            </ECardBody>
          </ECard>
        ))}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
