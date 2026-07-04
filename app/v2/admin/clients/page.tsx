import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import { Plus, Search } from "lucide-react";

export const metadata = { title: "Clients · Estate admin" };

const CLIENTS = [
  { name: "J. Harrington", props: 2, mtd: "$310", tone: "primary" as const, status: "Active" },
  { name: "Coastal Stays Pty", props: 11, mtd: "$4,120", tone: "gold" as const, status: "Key account" },
  { name: "M. Okafor", props: 1, mtd: "$680", tone: "primary" as const, status: "Active" },
  { name: "Bondi Beach Rentals", props: 6, mtd: "$2,940", tone: "primary" as const, status: "Active" },
  { name: "P. Nguyen", props: 1, mtd: "$0", tone: "warning" as const, status: "Onboarding" },
];

export default function AdminClientsPage() {
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Clients"
        title="Client register"
        description="Every client, one canonical 360° record."
        actions={<EButton variant="gold" size="sm"><Plus className="h-3.5 w-3.5" /> New client</EButton>}
      />

      <div className="flex h-9 items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        <Search className="h-4 w-4" /> Search clients…
      </div>

      <ECard>
        <ECardBody className="pt-6">
          <div className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
            <table className="w-full text-[0.8125rem]">
              <thead>
                <tr className="bg-[hsl(var(--e-surface-raised))] text-left">
                  {["Client", "Properties", "Revenue · MTD", "Status", ""].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CLIENTS.map((c) => (
                  <tr key={c.name} className="border-t border-[hsl(var(--e-border)/0.7)] hover:bg-[hsl(var(--e-primary-soft)/0.4)]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full text-[0.6875rem] font-semibold text-[hsl(var(--e-accent-portal-foreground))]" style={{ backgroundColor: "hsl(var(--e-accent-portal))" }}>
                          {c.name.replace(/[^A-Za-z ]/g, "").split(" ").map((w) => w[0]).slice(0, 2).join("")}
                        </span>
                        <span className="font-[550]">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[hsl(var(--e-text-secondary))]">{c.props}</td>
                    <td className="px-4 py-3"><span className="e-numeral text-[0.9375rem]">{c.mtd}</span></td>
                    <td className="px-4 py-3"><EBadge tone={c.tone} soft>{c.status}</EBadge></td>
                    <td className="px-4 py-3 text-right"><EButton variant="ghost" size="sm">Open</EButton></td>
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
