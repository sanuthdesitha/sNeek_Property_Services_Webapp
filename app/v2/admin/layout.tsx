"use client";

import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import {
  LayoutDashboard,
  Briefcase,
  CalendarRange,
  Inbox,
  Building2,
  ShieldCheck,
  ClipboardCheck,
  Shirt,
  Users,
  Wallet,
  Boxes,
  Megaphone,
  Settings,
  PackageSearch,
} from "lucide-react";

const NAV: NavItem[] = [
  { href: "/v2/admin", label: "Command", icon: LayoutDashboard },
  { href: "/v2/admin/jobs", label: "Jobs", icon: Briefcase },
  { href: "/v2/admin/calendar", label: "Calendar", icon: CalendarRange },
  { href: "/v2/admin/approvals", label: "Approvals", icon: Inbox },
  { href: "/v2/admin/properties", label: "Properties", icon: Building2 },
  { href: "/v2/admin/clients", label: "Clients", icon: Users },
  { href: "/v2/admin/quality", label: "Quality", icon: ShieldCheck },
  { href: "/v2/admin/cases", label: "Cases", icon: ClipboardCheck },
  { href: "/v2/admin/lost-found", label: "Lost & found", icon: PackageSearch },
  { href: "/v2/admin/laundry", label: "Laundry", icon: Shirt },
  { href: "/v2/admin/inventory", label: "Inventory", icon: Boxes },
  { href: "/v2/admin/finance", label: "Finance", icon: Wallet },
  { href: "/v2/admin/growth", label: "Growth", icon: Megaphone },
  { href: "/v2/admin/system", label: "System", icon: Settings },
];

export default function V2AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" data-portal-accent="admin">
      <PortalShell accent="admin" wordmark="sNeek" nav={NAV} roleLabel="Admin">
        {children}
      </PortalShell>
    </div>
  );
}
