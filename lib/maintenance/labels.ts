import {
  MaintenanceAction,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceSource,
  MaintenanceStatus,
} from "@prisma/client";

export const CATEGORY_LABELS: Record<MaintenanceCategory, string> = {
  FURNITURE: "Furniture",
  APPLIANCE: "Appliance",
  ELECTRONICS: "Electronics",
  LINEN: "Linen",
  BEDDING: "Bedding",
  FIXTURE: "Fixture",
  LIGHTING: "Lighting",
  PLUMBING: "Plumbing",
  FLOORING: "Flooring",
  WALLS: "Walls",
  DECOR: "Decor",
  KITCHENWARE: "Kitchenware",
  BATHROOM: "Bathroom",
  SAFETY: "Safety",
  OUTDOOR: "Outdoor",
  OTHER: "Other",
};

export const ACTION_LABELS: Record<MaintenanceAction, string> = {
  REPLACE: "Replace",
  REPAIR: "Repair",
  DEEP_CLEAN: "Deep clean",
  MONITOR: "Monitor",
  REMOVE: "Remove",
  RESTOCK: "Restock",
};

export const PRIORITY_LABELS: Record<MaintenancePriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROGRESS: "In progress",
  ORDERED: "Ordered",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

export const SOURCE_LABELS: Record<MaintenanceSource, string> = {
  CLEANER: "Cleaner",
  CLIENT: "Client",
  QA: "QA inspector",
  ADMIN: "Admin",
};

// Badge tone mapping — only the variants the shared Badge supports
// (default | secondary | destructive | outline | success | warning).
export type BadgeTone = "default" | "secondary" | "destructive" | "outline" | "success" | "warning";

export function priorityTone(priority: MaintenancePriority): BadgeTone {
  switch (priority) {
    case "URGENT":
      return "destructive";
    case "HIGH":
      return "warning";
    case "MEDIUM":
      return "default";
    default:
      return "secondary";
  }
}

export function statusTone(status: MaintenanceStatus): BadgeTone {
  switch (status) {
    case "RESOLVED":
      return "success";
    case "DISMISSED":
      return "secondary";
    case "IN_PROGRESS":
      return "default";
    case "ORDERED":
      return "warning";
    case "ACKNOWLEDGED":
      return "default";
    default:
      return "warning";
  }
}
