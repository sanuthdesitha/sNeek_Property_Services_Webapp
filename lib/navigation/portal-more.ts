/**
 * Shared shapes for the phone tab bar, the More menu and the desktop rail of the
 * QA and maintenance portals (boards "QA portal" and "Maintenance portal",
 * 2026-11). Plain module: server pages, client layouts and tests read it.
 * Never add "use client" here (tests/lib/server-client-value-imports.test.ts).
 *
 * Nothing here grants access. Each destination keeps its own server guard; the
 * office flag and the maintenance assignment only decide what a menu offers.
 */
import type { LucideIcon } from "lucide-react";

export interface PortalTab {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that belong to this tab, so it stays lit on them. */
  activePrefixes: string[];
}

export interface PortalMoreItem {
  href: string;
  label: string;
  /** What is behind the entry, in the board's words. */
  detail?: string;
  icon: LucideIcon;
  /** Shown only while the person holds a maintenance assignment. */
  requiresMaintenanceAssignment?: boolean;
}

export interface PortalMoreSection {
  title: string;
  /** Shown only to administrators and operations managers. */
  officeOnly?: boolean;
  items: PortalMoreItem[];
}

export interface PortalRailItem {
  href: string;
  label: string;
  icon: LucideIcon;
  group?: string;
}

export interface PortalMoreViewer {
  /** ADMIN or OPS_MANAGER, decided on the server. */
  office: boolean;
  maintenanceAssigned: boolean;
}

/** Whether a More entry is shown to this viewer. */
export function portalMoreItemVisible(item: PortalMoreItem, maintenanceAssigned: boolean): boolean {
  return !(item.requiresMaintenanceAssignment && !maintenanceAssigned);
}

/** The sections a viewer sees, with empty sections dropped. */
export function portalMoreSectionsFor(
  sections: readonly PortalMoreSection[],
  viewer: PortalMoreViewer,
): PortalMoreSection[] {
  return sections
    .filter((section) => !section.officeOnly || viewer.office)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => portalMoreItemVisible(item, viewer.maintenanceAssigned)),
    }))
    .filter((section) => section.items.length > 0);
}
