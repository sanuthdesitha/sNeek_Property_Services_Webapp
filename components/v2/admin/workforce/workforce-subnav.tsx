import { Award, LayoutDashboard, ShieldCheck, Users } from "lucide-react";
import { EChipTabs } from "@/components/v2/admin/estate-kit";

/**
 * Estate Workforce hub sub-navigation. Server-safe wrapper around the client
 * EChipTabs — each page passes its own `active` key (and optional badge counts)
 * so the chip bar highlights without a client-side usePathname.
 */
const TABS: Array<{ key: string; label: string; href: string; icon: typeof Users }> = [
  { key: "overview", label: "Overview", href: "/v2/admin/workforce", icon: LayoutDashboard },
  { key: "roster", label: "Roster", href: "/v2/admin/workforce/roster", icon: Users },
  { key: "compliance", label: "Compliance", href: "/v2/admin/workforce/compliance", icon: ShieldCheck },
  { key: "recognition", label: "Recognition", href: "/v2/admin/workforce/recognition", icon: Award },
];

export function WorkforceSubnav({
  active,
  counts,
}: {
  active: string;
  counts?: Partial<Record<string, number>>;
}) {
  return (
    <EChipTabs
      tabs={TABS.map((tab) => {
        const Icon = tab.icon;
        return {
          key: tab.key,
          label: tab.label,
          href: tab.href,
          active: tab.key === active,
          icon: <Icon className="h-3.5 w-3.5" />,
          count: counts?.[tab.key],
        };
      })}
    />
  );
}
