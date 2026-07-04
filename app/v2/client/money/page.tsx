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
import { Download, Wallet } from "lucide-react";

export const metadata = { title: "Money · Estate client" };

const INVOICES = [
  { no: "INV-1042", period: "Jun 2026", amount: "$310.00", status: "Open", tone: "warning" as const },
  { no: "INV-1021", period: "May 2026", amount: "$1,180.00", status: "Paid", tone: "success" as const },
  { no: "INV-0998", period: "Apr 2026", amount: "$940.00", status: "Paid", tone: "success" as const },
];

export default function ClientMoneyPage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Account" title="Money" description="Your balance, charges, and invoices — in one place." />

      <section className="grid gap-4 sm:grid-cols-3">
        <EStatCard label="Balance due" value="$310.00" delta="due 15 Jul" deltaTone="neutral" icon={<Wallet className="h-4 w-4" />} />
        <EStatCard label="Paid · YTD" value="$6,420" delta="6 invoices" deltaTone="neutral" />
        <EStatCard label="Avg per clean" value="$147" delta="across your homes" deltaTone="neutral" />
      </section>

      <ECard>
        <ECardHeader className="flex-row items-center justify-between">
          <ECardTitle>Invoices</ECardTitle>
          <EButton variant="gold" size="sm">Pay balance</EButton>
        </ECardHeader>
        <ECardBody className="pt-0">
          <div className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                  {["Invoice", "Period", "Amount", "Status", ""].map((h) => (
                    <th key={h} className="px-3 py-2 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {INVOICES.map((inv) => (
                  <tr key={inv.no} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                    <td className="px-3 py-3 font-medium">{inv.no}</td>
                    <td className="px-3 py-3 text-[hsl(var(--e-text-secondary))]">{inv.period}</td>
                    <td className="px-3 py-3"><span className="e-numeral text-[0.9375rem]">{inv.amount}</span></td>
                    <td className="px-3 py-3"><EBadge tone={inv.tone} soft>{inv.status}</EBadge></td>
                    <td className="px-3 py-3 text-right">
                      <EButton variant="ghost" size="sm"><Download className="h-3.5 w-3.5" /> PDF</EButton>
                    </td>
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
