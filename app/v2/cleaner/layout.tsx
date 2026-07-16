"use client";

import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import { LocationTracker } from "@/components/v2/cleaner/location-tracker";
import { Home, CalendarDays, CalendarRange, LayoutGrid } from "lucide-react";

// Four-item cleaner nav — a clean phone-first bottom tab bar (PortalShell renders
// nav.slice(0,5) as the mobile tabs and the full list as the desktop rail/drawer).
// Everything else lives one tap away under "More". Native Estate — no v1 UI.
const NAV: NavItem[] = [
  { href: "/v2/cleaner", label: "Today", icon: Home },
  { href: "/v2/cleaner/jobs", label: "Jobs", icon: CalendarDays },
  { href: "/v2/cleaner/calendar", label: "Schedule", icon: CalendarRange },
  { href: "/v2/cleaner/more", label: "More", icon: LayoutGrid },
];

export default function V2CleanerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-skin="estate" data-portal-accent="cleaner">
      {/* Background live-location tracker — persists for the whole active-job
          window regardless of which screen is open. Renders nothing. */}
      <LocationTracker />
      <PortalShell accent="cleaner" wordmark="sNeek" nav={NAV} roleLabel="Cleaner">
        {children}
      </PortalShell>
    </div>
  );
}
