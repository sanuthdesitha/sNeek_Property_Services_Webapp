import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import {
  LayoutDashboard,
  Briefcase,
  ShieldCheck,
  Users,
  Wallet,
  Megaphone,
  Settings,
  Shirt,
} from "lucide-react";

const NAV: NavItem[] = [
  { href: "/v2/admin", label: "Command", icon: LayoutDashboard },
  { href: "/v2/admin/jobs", label: "Jobs", icon: Briefcase, badge: 3 },
  { href: "/v2/admin/quality", label: "Quality", icon: ShieldCheck },
  { href: "/v2/admin/laundry", label: "Laundry", icon: Shirt },
  { href: "/v2/admin/clients", label: "Clients", icon: Users },
  { href: "/v2/admin/finance", label: "Finance", icon: Wallet },
  { href: "/v2/admin/growth", label: "Growth", icon: Megaphone },
  { href: "/v2/admin/system", label: "System", icon: Settings },
];

export default function V2AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" data-portal-accent="admin">
      <PortalShell accent="admin" wordmark="sNeek" nav={NAV} user={{ name: "Sanuth D.", role: "Administrator" }}>
        {children}
      </PortalShell>
    </div>
  );
}
