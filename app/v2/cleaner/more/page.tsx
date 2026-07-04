import Link from "next/link";
import { ECard, ECardBody, ECardHeader, ECardTitle, EPageHeader } from "@/components/v2/ui/primitives";
import {
  CalendarRange, ChevronRight, ClipboardList, MapPin, Package, PackageSearch,
  Receipt, Search, Settings, ShoppingCart, User, Users,
} from "lucide-react";

export const metadata = { title: "More · Estate cleaner" };

const GROUPS: { title: string; items: { href: string; label: string; desc: string; icon: typeof User }[] }[] = [
  {
    title: "Work",
    items: [
      { href: "/v2/cleaner/calendar", label: "Calendar", desc: "Your schedule", icon: CalendarRange },
      { href: "/v2/cleaner/availability", label: "Availability", desc: "Set weekly hours & time off", icon: ClipboardList },
      { href: "/v2/cleaner/route", label: "Route", desc: "Today's optimised run", icon: MapPin },
      { href: "/v2/cleaner/lost-found", label: "Lost & found", desc: "Log found items", icon: Search },
      { href: "/v2/cleaner/hub", label: "Team hub", desc: "Feed & recognition", icon: Users },
    ],
  },
  {
    title: "Supplies",
    items: [
      { href: "/v2/cleaner/shopping", label: "Shopping", desc: "Runs & purchases", icon: ShoppingCart },
      { href: "/v2/cleaner/restock", label: "Restock", desc: "Request supplies", icon: Package },
      { href: "/v2/cleaner/stock-runs", label: "Stock runs", desc: "Counts & requests", icon: PackageSearch },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/v2/cleaner/invoices", label: "Invoices", desc: "Download & send", icon: Receipt },
      { href: "/v2/cleaner/pay-requests", label: "Pay requests", desc: "Extra pay & adjustments", icon: Receipt },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/v2/cleaner/profile", label: "Profile", desc: "Your details & banking", icon: User },
      { href: "/v2/cleaner/settings", label: "Settings", desc: "Security & preferences", icon: Settings },
    ],
  },
];

export default function CleanerMorePage() {
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
