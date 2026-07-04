import Link from "next/link";
import { ECard, ECardBody, EPageHeader } from "@/components/v2/ui/primitives";
import { ChevronRight, FileText, Package, Settings, Users } from "lucide-react";

export const metadata = { title: "More · Estate laundry" };

const ITEMS = [
  { label: "Inventory", desc: "Linen sets & par levels", icon: Package },
  { label: "Reports", desc: "Weekly summaries", icon: FileText },
  { label: "Team", desc: "Laundry roster", icon: Users },
  { label: "Settings", desc: "Loops & thresholds", icon: Settings },
];

export default function LaundryMorePage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Account" title="More" />
      <ECard>
        <ECardBody className="pt-6">
          <div className="divide-y divide-[hsl(var(--e-border))]">
            {ITEMS.map((it) => {
              const Icon = it.icon;
              return (
                <Link key={it.label} href="/v2/laundry" className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:opacity-80">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))]">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.875rem] font-medium">{it.label}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{it.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-[hsl(var(--e-text-faint))]" />
                </Link>
              );
            })}
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
