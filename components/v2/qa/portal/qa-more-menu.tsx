"use client";

/**
 * The QA More tab (board "QA portal" › "More menu (☰)"). Role filtered: the
 * maintenance entry follows the live assignment check, the office-only queue
 * tools follow the role decided on the server. Each destination keeps its own
 * server guard whatever the menu shows.
 */
import * as React from "react";
import { useMaintenanceSection } from "@/components/v2/portal/use-maintenance-section";
import { MoreMenuList } from "@/components/v2/portal/more-menu-list";
import { portalMoreSectionsFor } from "@/lib/navigation/portal-more";
import { QA_MORE_SECTIONS, QA_ROOT } from "@/components/v2/qa/portal/qa-nav";

export function QaMoreMenu({ office }: { office: boolean }) {
  const maintenance = useMaintenanceSection();
  const sections = portalMoreSectionsFor(QA_MORE_SECTIONS, { office, maintenanceAssigned: maintenance.assigned });
  return (
    <MoreMenuList
      sections={sections}
      badges={{ [`${QA_ROOT}/maintenance`]: maintenance.count }}
      notes={{ "Office-only queue tools": "Shown to administrators and operations managers. Inspectors only review work handed to them." }}
    />
  );
}
