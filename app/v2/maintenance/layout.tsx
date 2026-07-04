import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { Home, Wrench, Package, ClipboardList, MoreHorizontal } from "lucide-react";

const NAV: NavItem[] = [
  { href: "/v2/maintenance", label: "Today", icon: Home },
  { href: "/v2/maintenance/tickets", label: "Tickets", icon: Wrench },
  { href: "/v2/maintenance/replacements", label: "Replacements", icon: Package },
  { href: "/v2/maintenance/log", label: "Log", icon: ClipboardList },
  { href: "/v2/maintenance/more", label: "More", icon: MoreHorizontal },
];

export default function V2MaintenanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" data-portal-accent="maintenance">
      <PortalShell accent="maintenance" wordmark="sNeek" nav={NAV} user={{ name: "Maintenance", role: "Maintenance" }}>
        {children}
      </PortalShell>
    </div>
  );
}
