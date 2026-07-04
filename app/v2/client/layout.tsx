"use client";

import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { Home, CalendarRange, Building2, Wallet, MessageSquare, MoreHorizontal } from "lucide-react";

const NAV: NavItem[] = [
  { href: "/v2/client", label: "Home", icon: Home },
  { href: "/v2/client/services", label: "Services", icon: CalendarRange },
  { href: "/v2/client/properties", label: "Properties", icon: Building2 },
  { href: "/v2/client/money", label: "Money", icon: Wallet },
  { href: "/v2/client/messages", label: "Messages", icon: MessageSquare },
  { href: "/v2/client/more", label: "More", icon: MoreHorizontal },
];

export default function V2ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" data-portal-accent="client">
      <PortalShell accent="client" wordmark="sNeek" nav={NAV} user={{ name: "J. Harrington", role: "Client" }}>
        {children}
      </PortalShell>
    </div>
  );
}
