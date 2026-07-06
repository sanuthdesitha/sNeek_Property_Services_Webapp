import Link from "next/link";
import { ECard, ECardBody, ECardHeader, ECardTitle, EPageHeader } from "@/components/v2/ui/primitives";
import {
  CalendarRange, CalendarPlus, ChevronRight, ClipboardCheck, FileText, Gift,
  LifeBuoy, Package, Receipt, Settings, Shirt, ShoppingCart, Sparkles, User, Wrench,
} from "lucide-react";

export const metadata = { title: "More · Estate client" };

const GROUPS: { title: string; items: { href: string; label: string; desc: string; icon: typeof User }[] }[] = [
  {
    title: "Services",
    items: [
      { href: "/v2/client/jobs", label: "Jobs", desc: "Every service, past & upcoming", icon: ClipboardCheck },
      { href: "/v2/client/calendar", label: "Calendar", desc: "Your schedule at a glance", icon: CalendarRange },
      { href: "/v2/client/booking", label: "Book a clean", desc: "Request a new service", icon: CalendarPlus },
      { href: "/v2/client/approvals", label: "Approvals", desc: "Requests awaiting your OK", icon: Sparkles },
      { href: "/v2/client/reports", label: "Report archive", desc: "Every clean, documented", icon: FileText },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/v2/client/finance", label: "Finance", desc: "Invoices, rates & balance", icon: Receipt },
      { href: "/v2/client/quotes", label: "Quotes", desc: "Proposals to review", icon: FileText },
      { href: "/v2/client/quote", label: "Request a quote", desc: "Get a new estimate", icon: FileText },
    ],
  },
  {
    title: "Property care",
    items: [
      { href: "/v2/client/inventory", label: "Inventory", desc: "Stock across your properties", icon: Package },
      { href: "/v2/client/shopping", label: "Shopping", desc: "Restock & purchases", icon: ShoppingCart },
      { href: "/v2/client/stock-runs", label: "Stock runs", desc: "Counts & requests", icon: Package },
      { href: "/v2/client/laundry", label: "Laundry", desc: "Linen tracking", icon: Shirt },
      { href: "/v2/client/maintenance", label: "Maintenance", desc: "Repairs & replacements", icon: Wrench },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/v2/client/cases", label: "Cases & disputes", desc: "Raise or track an issue", icon: LifeBuoy },
      { href: "/v2/client/referrals", label: "Rewards & referrals", desc: "Earn credit for referrals", icon: Gift },
      { href: "/v2/client/profile", label: "Profile", desc: "Your details & security", icon: User },
      { href: "/v2/client/settings", label: "Settings", desc: "Notifications & preferences", icon: Settings },
    ],
  },
];

export default function ClientMorePage() {
  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Account" title="More" description="Everything else, one tap away." />
      {GROUPS.map((group) => (
        <ECard key={group.title}>
          <ECardHeader><ECardTitle>{group.title}</ECardTitle></ECardHeader>
          <ECardBody className="pt-0">
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {group.items.map((it) => {
                const Icon = it.icon;
                return (
                  <Link key={it.href} href={it.href} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:opacity-80">
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
      ))}
    </div>
  );
}
