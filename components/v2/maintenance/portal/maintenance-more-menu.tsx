"use client";

/**
 * The maintenance More tab (board "Maintenance portal" › "More menu (☰)"):
 * Log, Settings and the account block. Each destination keeps its own guard.
 */
import * as React from "react";
import { MoreMenuList } from "@/components/v2/portal/more-menu-list";
import { portalMoreSectionsFor } from "@/lib/navigation/portal-more";
import { MAINTENANCE_MORE_SECTIONS } from "@/components/v2/maintenance/portal/maintenance-nav";

export function MaintenanceMoreMenu({ office }: { office: boolean }) {
  const sections = portalMoreSectionsFor(MAINTENANCE_MORE_SECTIONS, { office, maintenanceAssigned: false });
  return <MoreMenuList sections={sections} />;
}
