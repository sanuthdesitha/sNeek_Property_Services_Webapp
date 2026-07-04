import { EBadge, EButton, ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";
import { Building2, Plus } from "lucide-react";

export const metadata = { title: "Properties · Estate client" };

const PROPS = [
  { name: "12 Marine Parade", suburb: "Coogee", beds: "2 bd · 1 ba", tone: "primary" as const, status: "Active", next: "Tomorrow 9:00 AM" },
  { name: "5/44 Beach St", suburb: "Bondi", beds: "1 bd · 1 ba", tone: "primary" as const, status: "Active", next: "Mon 8 Jul" },
];

export default function ClientPropertiesPage() {
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Your homes"
        title="Properties"
        description="Inventory, supplies, and laundry live inside each property."
        actions={<EButton variant="gold" size="sm"><Plus className="h-3.5 w-3.5" /> Add property</EButton>}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {PROPS.map((p) => (
          <ECard key={p.name}>
            <ECardBody className="space-y-3 pt-6">
              <div className="flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
                  <Building2 className="h-5 w-5" />
                </span>
                <EBadge tone={p.tone} soft>{p.status}</EBadge>
              </div>
              <div>
                <p className="text-[1rem] font-[550]">{p.name}</p>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{p.suburb} · {p.beds}</p>
              </div>
              <div className="e-signature-rule" />
              <p className="text-[0.8125rem]"><span className="e-eyebrow">NEXT SERVICE</span><br />{p.next}</p>
              <EButton variant="outline" size="sm">Manage property</EButton>
            </ECardBody>
          </ECard>
        ))}
      </div>
    </div>
  );
}
