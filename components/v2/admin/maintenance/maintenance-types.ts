/**
 * The maintenance item as GET /api/maintenance/:id returns it to the office
 * (dates as ISO strings). Plain types module.
 */
import type {
  MaintenanceAction,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceSource,
  MaintenanceStatus,
} from "@prisma/client";

export type MaintenancePhoto = { key: string; url: string; mediaType?: string };

export type MaintenancePing = { id: string; lat: number; lng: number; accuracy: number | null; kind: string | null; createdAt: string };

export type MaintenanceWorkerRef = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  trade: string | null;
  company: string | null;
  isPermanent: boolean;
  userId: string | null;
};

export type MaintenanceEventRow = {
  id: string;
  fromStatus: MaintenanceStatus | null;
  toStatus: MaintenanceStatus;
  note: string | null;
  createdAt: string;
  user: { name: string | null; email: string | null; role: string } | null;
};

export type MaintenancePropertyDetail = {
  id: string;
  name: string;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  clientId: string | null;
  client: { id?: string; name: string | null; email: string | null; phone: string | null } | null;
};

export type MaintenanceDetailItem = {
  id: string;
  title: string;
  description: string | null;
  category: MaintenanceCategory;
  area: string | null;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  source: MaintenanceSource;
  recommendedAction: MaintenanceAction;
  estimatedCost: number | null;
  quotedCost: number | null;
  costApprovalStatus: string | null;
  costDecidedAt: string | null;
  clientVisible: boolean;
  caseId: string | null;
  jobId: string | null;
  job: { id: string; jobNumber: string | null; scheduledDate: string | null } | null;
  photos: MaintenancePhoto[];
  finishPhotos: MaintenancePhoto[];
  outcome: string | null;
  originalOutcome?: string | null;
  workerNote: string | null;
  issuesNote: string | null;
  scheduledFor: string | null;
  shareAccess: boolean;
  enRouteAt: string | null;
  arrivedAt: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  assignedAt: string | null;
  assignedWorker: MaintenanceWorkerRef | null;
  assignedBy?: { name: string | null } | null;
  contactPerson: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  contactPersonUserId: string | null;
  pings: MaintenancePing[];
  events: MaintenanceEventRow[];
  property: MaintenancePropertyDetail;
  reportedBy: { name: string | null; email: string | null; role: string } | null;
  resolvedBy?: { name: string | null } | null;
  createdAt: string;
  /** Raw Json; normalised by parseInstructions where it is used. */
  assignmentInstructions?: unknown;
};

/** Everything an action needs to know about the item it acts on. */
export type MaintenanceActionTarget = {
  id: string;
  title: string;
  status: MaintenanceStatus;
  clientVisible: boolean;
  propertyId: string;
  propertyName: string;
  jobId: string | null;
  assignedWorkerId: string | null;
  quotedCost: number | null;
  costApprovalStatus: string | null;
};

export function targetFromDetail(item: MaintenanceDetailItem): MaintenanceActionTarget {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    clientVisible: item.clientVisible,
    propertyId: item.property.id,
    propertyName: item.property.name,
    jobId: item.jobId,
    assignedWorkerId: item.assignedWorker?.id ?? null,
    quotedCost: item.quotedCost,
    costApprovalStatus: item.costApprovalStatus,
  };
}

/** Reads one item for the office. Aborted reads reject with an AbortError. */
export async function readMaintenanceItem(itemId: string, signal?: AbortSignal): Promise<MaintenanceDetailItem> {
  const response = await fetch(`/api/maintenance/${encodeURIComponent(itemId)}`, { cache: "no-store", signal });
  const body = (await response.json().catch(() => null)) as { item?: MaintenanceDetailItem; error?: string } | null;
  if (!response.ok || !body?.item) {
    throw new Error(response.status === 404 ? "This item no longer exists." : body?.error ?? "This item could not be loaded.");
  }
  return body.item;
}
