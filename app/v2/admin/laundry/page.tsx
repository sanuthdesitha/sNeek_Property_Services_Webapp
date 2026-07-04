import { EBadge, EButton, ECard, ECardBody, EPageHeader, EStatCard } from "@/components/v2/ui/primitives";
import { PackageCheck, Shirt, Truck } from "lucide-react";

export const metadata = { title: "Laundry · Estate admin" };

const RUNS = [
  { property: "12 Marine Parade", bags: 3, stage: "Pickup", tone: "primary" as const, time: "Today 9:00" },
  { property: "5/44 Beach St", bags: 2, stage: "Washing", tone: "info" as const, time: "In progress" },
  { property: "88 Ocean View Rd", bags: 4, stage: "Delivered", tone: "success" as const, time: "Done 8:20" },
];

export default function AdminLaundryPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Operations" title="Laundry" description="Runs, live tracking, suppliers." actions={<EButton variant="gold" size="sm">New run</EButton>} />
      <section className="grid gap-4 sm:grid-cols-3">
        <EStatCard label="Bags today" value="9" delta="3 properties" deltaTone="neutral" icon={<Shirt className="h-4 w-4" />} />
        <EStatCard label="In transit" value="2" delta="on the road" deltaTone="neutral" icon={<Truck className="h-4 w-4" />} />
        <EStatCard label="Delivered" value="4" delta="today" icon={<PackageCheck className="h-4 w-4" />} />
      </section>
      <div className="space-y-3">
        <span className="e-eyebrow">TODAY&apos;S RUNS</span>
        {RUNS.map((r, i) => (
          <ECard key={i}>
            <ECardBody className="flex items-center gap-4 pt-6">
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] font-[550]">{r.property}</p>
                <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{r.bags} bags · {r.time}</p>
              </div>
              <EBadge tone={r.tone} soft>{r.stage}</EBadge>
              <EButton variant="outline" size="sm">Track</EButton>
            </ECardBody>
          </ECard>
        ))}
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
