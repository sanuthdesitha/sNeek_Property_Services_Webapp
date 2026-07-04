import { EBadge, EButton, ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";
import { PackagePlus } from "lucide-react";

export const metadata = { title: "Supplies · Estate cleaner" };

const TABS = ["Restock", "Stock counts", "Shopping"];
const ONHAND = [
  { item: "Microfibre cloths", qty: "12 on hand", tone: "success" as const },
  { item: "All-purpose spray", qty: "2 left", tone: "warning" as const },
  { item: "Bin liners", qty: "Out", tone: "danger" as const },
];

export default function CleanerSuppliesPage() {
  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Inventory"
        title="Supplies"
        description="Restock, count, and shop — one place."
        actions={<EButton variant="gold" size="sm"><PackagePlus className="h-3.5 w-3.5" /> Request restock</EButton>}
      />
      <div className="inline-flex rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-0.5">
        {TABS.map((t, i) => (
          <button
            key={t}
            className={
              "rounded-[var(--e-radius-sm)] px-3 py-1.5 text-[0.8125rem] font-medium " +
              (i === 0 ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]" : "text-[hsl(var(--e-muted-foreground))]")
            }
          >
            {t}
          </button>
        ))}
      </div>
      <ECard>
        <ECardBody className="pt-6">
          <div className="divide-y divide-[hsl(var(--e-border))]">
            {ONHAND.map((s) => (
              <div key={s.item} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <p className="text-[0.875rem] font-medium">{s.item}</p>
                <EBadge tone={s.tone} soft>{s.qty}</EBadge>
              </div>
            ))}
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
