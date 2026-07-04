import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { Banknote, FileText, TrendingUp, Users } from "lucide-react";

export const metadata = { title: "Finance · Estate admin" };

const TABS = ["Overview", "Invoices", "Payroll", "Cleaner invoices", "Pricing"];

const INVOICES = [
  { no: "INV-1042", client: "J. Harrington", amount: "$310.00", tone: "warning" as const, status: "Sent" },
  { no: "INV-1041", client: "Coastal Stays", amount: "$2,140.00", tone: "success" as const, status: "Paid" },
  { no: "INV-1040", client: "M. Okafor", amount: "$680.00", tone: "gold" as const, status: "Xero pushed" },
];

export default function AdminFinancePage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Commercial" title="Finance" description="Revenue, invoices, payroll, and pricing — one hub." />

      {/* Tab bar (underline style) */}
      <div className="flex gap-6 border-b border-[hsl(var(--e-border))]">
        {TABS.map((t, i) => (
          <button
            key={t}
            className={
              i === 0
                ? "relative -mb-px pb-2.5 text-[0.875rem] font-semibold text-[hsl(var(--e-foreground))]"
                : "pb-2.5 text-[0.875rem] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
            }
          >
            {t}
            {i === 0 ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded bg-[hsl(var(--e-accent-portal))]" /> : null}
          </button>
        ))}
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <EStatCard label="Revenue · MTD" value="$52,180" delta="+11%" icon={<TrendingUp className="h-4 w-4" />} />
        <EStatCard label="Outstanding" value="$4,290" delta="6 invoices" deltaTone="neutral" icon={<FileText className="h-4 w-4" />} />
        <EStatCard label="Payroll · next run" value="$8,640" delta="Mon 8 Jul" deltaTone="neutral" icon={<Banknote className="h-4 w-4" />} />
        <EStatCard label="Gross margin" value="43%" delta="+2 pts" icon={<Users className="h-4 w-4" />} />
      </section>

      <ECard>
        <ECardHeader className="flex-row items-center justify-between">
          <ECardTitle>Recent invoices</ECardTitle>
          <EButton variant="gold" size="sm">Generate invoices</EButton>
        </ECardHeader>
        <ECardBody className="pt-0">
          <div className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                  {["Invoice", "Client", "Amount", "Status", ""].map((h) => (
                    <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {INVOICES.map((inv) => (
                  <tr key={inv.no} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                    <td className="px-3 py-3 font-medium">{inv.no}</td>
                    <td className="px-3 py-3 text-[hsl(var(--e-text-secondary))]">{inv.client}</td>
                    <td className="px-3 py-3"><span className="e-numeral text-[0.9375rem]">{inv.amount}</span></td>
                    <td className="px-3 py-3"><EBadge tone={inv.tone} soft>{inv.status}</EBadge></td>
                    <td className="px-3 py-3 text-right"><EButton variant="ghost" size="sm">View</EButton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Estate preview · representative data.</p>
    </div>
  );
}
