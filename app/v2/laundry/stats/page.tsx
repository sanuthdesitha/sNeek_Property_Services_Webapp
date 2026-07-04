import { ECard, ECardBody, ECardHeader, ECardTitle, EPageHeader, EStatCard, EThread } from "@/components/v2/ui/primitives";

export const metadata = { title: "Stats · Estate laundry" };

const TURNAROUND = [
  ["12 Marine Parade", "4.2 h avg"],
  ["88 Ocean View Rd", "3.8 h avg"],
  ["7 Curlewis St", "5.1 h avg"],
];

export default function LaundryStatsPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Performance" title="Stats" description="Throughput and turnaround." />
      <section className="grid gap-4 sm:grid-cols-4">
        <EStatCard label="Sets · week" value="146" delta="+8%" />
        <EStatCard label="Avg turnaround" value="4.3h" delta="-0.4h" />
        <EStatCard label="On-time %" value="97%" delta="+2 pts" />
        <EStatCard label="Reprocessed" value="1.2%" delta="-0.3 pts" />
      </section>
      <ECard>
        <ECardHeader><ECardTitle>Turnaround by property</ECardTitle></ECardHeader>
        <ECardBody className="space-y-1">
          {TURNAROUND.map(([name, val], i) => (
            <div key={i}>
              {i > 0 ? <EThread className="my-1" /> : null}
              <div className="flex items-center justify-between gap-2 py-2">
                <p className="text-[0.875rem] font-medium">{name}</p>
                <span className="e-numeral text-[0.9375rem]">{val}</span>
              </div>
            </div>
          ))}
        </ECardBody>
      </ECard>
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
