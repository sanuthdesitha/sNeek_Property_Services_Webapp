import { EBadge, EButton, ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";
import { ChevronRight, Plus } from "lucide-react";

export const metadata = { title: "Tickets · Estate maintenance" };

const TICKETS = [
  { issue: "Dishwasher not draining", property: "12 Marine Parade", priority: "High", tone: "danger" as const, status: "Open" },
  { issue: "Blind cord frayed", property: "88 Ocean View Rd", priority: "Medium", tone: "warning" as const, status: "Open" },
  { issue: "Replace shower head", property: "7 Curlewis St", priority: "Low", tone: "info" as const, status: "Scheduled" },
  { issue: "Aircon service", property: "5/44 Beach St", priority: "Low", tone: "success" as const, status: "Done" },
];

export default function MaintenanceTicketsPage() {
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Work orders"
        title="Tickets"
        description="Every maintenance request."
        actions={<EButton variant="gold" size="sm"><Plus className="h-3.5 w-3.5" /> New ticket</EButton>}
      />
      <div className="space-y-3">
        {TICKETS.map((t, i) => (
          <ECard key={i}>
            <ECardBody className="flex items-center gap-3 pt-6">
              <div className="min-w-0 flex-1">
                <p className="text-[0.875rem] font-medium">{t.issue}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{t.property}</p>
              </div>
              <EBadge tone={t.tone} soft>{t.priority}</EBadge>
              <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{t.status}</span>
              <ChevronRight className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
            </ECardBody>
          </ECard>
        ))}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
