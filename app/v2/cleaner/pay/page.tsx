import { EBadge, EButton, ECard, ECardBody, ECardHeader, ECardTitle, EPageHeader, EStatCard } from "@/components/v2/ui/primitives";

export const metadata = { title: "Pay · Estate cleaner" };

const RECENT = [
  { date: "Wk 27", jobs: "18 jobs", amount: "$1,240", tone: "success" as const, status: "Paid" },
  { date: "Wk 26", jobs: "16 jobs", amount: "$1,090", tone: "success" as const, status: "Paid" },
  { date: "This week", jobs: "9 jobs so far", amount: "$620", tone: "warning" as const, status: "Open" },
];

export default function CleanerPayPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Earnings" title="Pay" description="Your earnings, invoices, and requests." actions={<EButton variant="gold" size="sm">Submit invoice</EButton>} />
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <EStatCard label="This week" value="$620" delta="9 jobs" deltaTone="neutral" />
        <EStatCard label="Pending" value="$620" delta="1 invoice" deltaTone="neutral" />
        <EStatCard label="Paid · YTD" value="$28,400" delta="+6%" />
      </section>
      <ECard>
        <ECardHeader><ECardTitle>Recent</ECardTitle></ECardHeader>
        <ECardBody className="pt-0">
          <div className="divide-y divide-[hsl(var(--e-border))]">
            {RECENT.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-[0.875rem] font-medium">{r.date}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{r.jobs}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="e-numeral text-[0.9375rem]">{r.amount}</span>
                  <EBadge tone={r.tone} soft>{r.status}</EBadge>
                </div>
              </div>
            ))}
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
