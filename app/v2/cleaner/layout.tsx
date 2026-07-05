"use client";

import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { Home, Briefcase, Package, Wallet, MoreHorizontal } from "lucide-react";

const NAV: NavItem[] = [
  { href: "/v2/cleaner", label: "Today", icon: Home },
  { href: "/v2/cleaner/jobs", label: "Jobs", icon: Briefcase },
  { href: "/v2/cleaner/supplies", label: "Supplies", icon: Package },
  { href: "/v2/cleaner/pay", label: "Pay", icon: Wallet },
  { href: "/v2/cleaner/more", label: "More", icon: MoreHorizontal },
];

export default function V2CleanerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" data-portal-accent="cleaner">
      <PortalShell accent="cleaner" wordmark="sNeek" nav={NAV} roleLabel="Cleaner">
        {children}
      </PortalShell>
    </div>
  );
}
