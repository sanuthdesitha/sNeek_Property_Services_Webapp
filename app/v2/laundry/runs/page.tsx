import { EBadge, EButton, ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";
import { Truck } from "lucide-react";

export const metadata = { title: "Runs · Estate laundry" };

const RUNS = [
  { window: "8:00 AM", loop: "Morning pickup", stops: "5 stops · 11 sets", tone: "success" as const, status: "Complete" },
  { window: "11:30 AM", loop: "Midday swap", stops: "3 stops · 6 sets", tone: "success" as const, status: "Complete" },
  { window: "2:00 PM", loop: "Eastern loop", stops: "4 stops · 9 sets", tone: "info" as const, status: "Next" },
];

export default function LaundryRunsPage() {
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Dispatch"
        title="Runs"
        description="Pickup and drop-off loops."
        actions={<EButton variant="gold" size="sm"><Truck className="h-3.5 w-3.5" /> New run</EButton>}
      />
      <div className="space-y-3">
        {RUNS.map((r, i) => (
          <ECard key={i}>
            <ECardBody className="flex items-center gap-3 pt-6">
              <div className="flex h-11 w-14 items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] text-[0.75rem] font-semibold tabular-nums">{r.window}</div>
              <div className="min-w-0 flex-1">
                <p className="text-[0.875rem] font-medium">{r.loop}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{r.stops}</p>
              </div>
              <EBadge tone={r.tone} soft>{r.status}</EBadge>
            </ECardBody>
          </ECard>
        ))}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
