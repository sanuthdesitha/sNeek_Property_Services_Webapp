"use client";

import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { Home, Waves, Truck, BarChart3, MoreHorizontal } from "lucide-react";

const NAV: NavItem[] = [
  { href: "/v2/laundry", label: "Today", icon: Home },
  { href: "/v2/laundry/queue", label: "Queue", icon: Waves },
  { href: "/v2/laundry/runs", label: "Runs", icon: Truck },
  { href: "/v2/laundry/stats", label: "Stats", icon: BarChart3 },
  { href: "/v2/laundry/more", label: "More", icon: MoreHorizontal },
];

export default function V2LaundryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" data-portal-accent="laundry">
      <PortalShell accent="laundry" wordmark="sNeek" nav={NAV} roleLabel="Laundry">
        {children}
      </PortalShell>
    </div>
  );
}
