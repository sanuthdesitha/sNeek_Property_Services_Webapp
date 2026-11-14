/**
 * Admin Maintenance list: the shapes shared by the list route, the export, the
 * server page and the client workspace. Plain module (no server imports, no
 * "use client"), so server pages may read its constants.
 */
import type {
  MaintenanceAction,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceSource,
  MaintenanceStatus,
} from "@prisma/client";
import type { MaintenanceAttention } from "./attention";

export const MAINTENANCE_LIST_SORTS = ["priority", "status", "title", "assigned", "visit", "cost", "reported"] as const;
export type MaintenanceListSort = (typeof MAINTENANCE_LIST_SORTS)[number];

/** The status bar: every open status together, or one stored status. */
export const MAINTENANCE_STATUS_TABS = ["open", "OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "ORDERED", "RESOLVED", "DISMISSED"] as const;
export type MaintenanceStatusTab = (typeof MAINTENANCE_STATUS_TABS)[number];

/** Client price: nothing sent yet, or the stored approval state. */
export const MAINTENANCE_PRICE_FILTERS = ["any", "NOT_SENT", "PENDING", "APPROVED", "DECLINED"] as const;
export type MaintenancePriceFilter = (typeof MAINTENANCE_PRICE_FILTERS)[number];

export const MAINTENANCE_VISIBILITY_FILTERS = ["any", "yes", "no"] as const;
export type MaintenanceVisibilityFilter = (typeof MAINTENANCE_VISIBILITY_FILTERS)[number];

/** Tile shortcuts that are not plain field filters. */
export const MAINTENANCE_PERIOD_FILTERS = ["any", "visits-week", "resolved-month"] as const;
export type MaintenancePeriodFilter = (typeof MAINTENANCE_PERIOD_FILTERS)[number];

/**
 * Assigned to: "any", "none" (nobody on it), or `worker:<MaintenanceWorker id>`
 * (the visit worker) or `user:<User id>` (someone in the role roster).
 */
export type MaintenanceAssignedFilter = string;

export type MaintenanceListFilters = {
  status: MaintenanceStatusTab;
  q: string;
  propertyId: string;
  priority: MaintenancePriority[];
  category: MaintenanceCategory | "";
  source: MaintenanceSource[];
  assigned: MaintenanceAssignedFilter;
  price: MaintenancePriceFilter;
  visible: MaintenanceVisibilityFilter;
  period: MaintenancePeriodFilter;
};

export const DEFAULT_MAINTENANCE_FILTERS: MaintenanceListFilters = {
  status: "open",
  q: "",
  propertyId: "",
  priority: [],
  category: "",
  source: [],
  assigned: "any",
  price: "any",
  visible: "any",
  period: "any",
};

export type MaintenanceRosterPerson = { role: "MAINTENANCE" | "CLEANER" | "QA"; name: string };

export type MaintenanceListRow = {
  id: string;
  title: string;
  area: string | null;
  category: MaintenanceCategory;
  recommendedAction: MaintenanceAction;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  source: MaintenanceSource;
  clientVisible: boolean;
  createdAt: string;
  property: { id: string; name: string; suburb: string | null };
  job: { id: string; jobNumber: string | null } | null;
  reportedByName: string | null;
  photoCount: number;
  /** A preview of the first reported photo, or null when none could be resolved. */
  photoUrl: string | null;
  assignedWorker: { id: string; name: string; trade: string | null; company: string | null; hasLogin: boolean } | null;
  roster: MaintenanceRosterPerson[];
  nobodyAssigned: boolean;
  scheduledFor: string | null;
  estimatedCost: number | null;
  quotedCost: number | null;
  costApprovalStatus: string | null;
  costDecidedAt: string | null;
  pricePending: boolean;
  attention: MaintenanceAttention | null;
};

export type MaintenanceStatusCounts = Record<MaintenanceStatusTab, number>;

/** Figures for the six tiles. Every number is a real count of the whole list. */
export type MaintenanceTiles = {
  open: number;
  urgent: number;
  urgentNobody: number;
  nobody: number;
  /** Days the oldest unassigned open item has waited; null when there is none. */
  nobodyOldestDays: number | null;
  waitingClient: number;
  /** Sum of the quoted prices that exist; null when no waiting item has one. */
  waitingClientQuoted: number | null;
  visitsWeek: number;
  visitsToday: number;
  resolvedMonth: number;
  dismissedMonth: number;
};

export type MaintenanceListResponse = {
  rows: MaintenanceListRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  sort: MaintenanceListSort;
  dir: "asc" | "desc";
  statusCounts: MaintenanceStatusCounts;
  tiles: MaintenanceTiles;
  timeZone: string;
};
