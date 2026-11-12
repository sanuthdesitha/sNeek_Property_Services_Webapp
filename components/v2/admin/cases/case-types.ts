/**
 * Shared types and pure helpers for the admin Cases inbox. The list carries
 * summaries (lib/cases/summaries); the conversation carries the full case
 * from GET /api/admin/cases/[id].
 */
import type { CaseQueue, CaseSort, CaseTypeKey } from "@/lib/cases/queues";
import type { CaseQueueCounts, CaseSummary, CaseTypeCounts } from "@/lib/cases/summaries";
import { normalizeUnifiedCaseStatus, type UnifiedCaseStatus } from "@/lib/cases/status";
import type { EPillTone } from "@/components/v2/ui/pill";

export type { CaseQueue, CaseSort, CaseTypeKey, CaseSummary, CaseQueueCounts, CaseTypeCounts };
export type CaseStatus = UnifiedCaseStatus;
export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export type CasePersonRef = { id: string; name: string | null; email: string; role: string };
export type AssigneeOption = CasePersonRef;

export type CaseComment = {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: CasePersonRef | null;
};

export type CaseAttachment = {
  id: string;
  url: string;
  label: string | null;
  mimeType: string | null;
  createdAt: string;
  uploadedBy: CasePersonRef | null;
};

/** The full case (GET/PATCH /api/admin/cases/[id]). */
export type CaseDetail = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  status: CaseStatus;
  slaBreachAt: string | null;
  caseType: CaseTypeKey;
  clientVisible: boolean;
  clientCanReply: boolean;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  source: string | null;
  jobId: string | null;
  reportId: string | null;
  clientId: string | null;
  propertyId: string | null;
  job?: { id: string; jobNumber?: string | null; scheduledDate?: string | null } | null;
  client?: { id: string; name: string } | null;
  property?: { id: string; name: string; suburb: string | null } | null;
  assignedTo?: CasePersonRef | null;
  comments: CaseComment[];
  attachments: CaseAttachment[];
};

export type CaseViewer = { id: string; name: string | null; email: string | null; role: string | null };

export type CaseListFilters = {
  q: string;
  caseType: string;
  status: string;
  assigneeUserId: string;
  jobId: string;
  reportId: string;
};

export const EMPTY_FILTERS: CaseListFilters = { q: "", caseType: "", status: "", assigneeUserId: "", jobId: "", reportId: "" };

export const CASE_TYPE_LABELS: Record<CaseTypeKey, string> = {
  DAMAGE: "Damage",
  CLIENT_DISPUTE: "Client dispute",
  LOST_FOUND: "Lost and found",
  OPS: "Ops",
  SLA: "SLA",
  OTHER: "Other",
};

export const SORT_OPTIONS: Array<{ key: CaseSort; dir: "asc" | "desc"; label: string }> = [
  { key: "sla", dir: "asc", label: "SLA soonest" },
  { key: "created", dir: "desc", label: "Newest" },
  { key: "created", dir: "asc", label: "Oldest" },
  { key: "priority", dir: "desc", label: "Priority" },
  { key: "updated", dir: "desc", label: "Recently updated" },
  { key: "type", dir: "asc", label: "Type (damage first)" },
];

/** The existing resolution templates; they also serve as reply templates. */
export const RESOLUTION_TEMPLATES: Record<CaseTypeKey, string> = {
  DAMAGE: "We have reviewed the reported damage. We will arrange a follow-up visit to assess and resolve.",
  CLIENT_DISPUTE: "We acknowledge your concern and are investigating. We'll be in touch within 24 hours.",
  LOST_FOUND: "We've followed up with the assigned cleaner. [Item status]. Please let us know if you need further assistance.",
  OPS: "Operations has reviewed this case and is coordinating the next steps now.",
  SLA: "We are reviewing the service timing and will confirm the follow-up action shortly.",
  OTHER: "We have logged the issue and will update this case after our review.",
};

export function personLabel(person: { name: string | null; email: string } | null | undefined): string {
  if (!person) return "Unknown";
  return person.name?.trim() || person.email;
}

export function prettify(value?: string | null): string {
  return String(value ?? "").replace(/_/g, " ").trim();
}

export function severityTone(value: string): EPillTone {
  if (value === "CRITICAL" || value === "HIGH") return "bad";
  if (value === "MEDIUM") return "warn";
  return "neutral";
}

export function isClosedStatus(status: CaseStatus): boolean {
  return status === "RESOLVED" || status === "CLOSED";
}

export type SlaPill = { label: string; tone: EPillTone };

/** "SLA 5 h" / "SLA 1 d" / "SLA passed", or the case's age when it has no live deadline. */
export function slaPill(row: { status: CaseStatus; slaBreachAt: string | null; createdAt: string }, nowMs: number): SlaPill | null {
  if (isClosedStatus(row.status)) return null;
  if (row.slaBreachAt) {
    const breach = new Date(row.slaBreachAt).getTime();
    if (!Number.isNaN(breach)) {
      const minutes = Math.round((breach - nowMs) / 60_000);
      if (minutes <= 0) return { label: "SLA passed", tone: "bad" };
      if (minutes < 240) return { label: `SLA ${Math.max(1, Math.round(minutes / 60))} h`, tone: "bad" };
      if (minutes < 48 * 60) return { label: `SLA ${Math.round(minutes / 60)} h`, tone: "warn" };
      return { label: `SLA ${Math.round(minutes / 1440)} d`, tone: "warn" };
    }
  }
  const created = new Date(row.createdAt).getTime();
  if (Number.isNaN(created)) return null;
  const hours = Math.max(0, Math.round((nowMs - created) / 3_600_000));
  return { label: hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} d`, tone: "neutral" };
}

/** A full case reduced to the summary the list shows, so a save updates its row without a list reload. */
export function summaryFromDetail(detail: CaseDetail, previous?: CaseSummary): CaseSummary {
  const publicComments = detail.comments.filter((comment) => !comment.isInternal);
  const latest = publicComments[publicComments.length - 1] ?? null;
  const fromClient = latest?.author?.role === "CLIENT" || latest?.author?.role === "VA";
  return {
    id: detail.id,
    title: detail.title,
    status: normalizeUnifiedCaseStatus(detail.status),
    severity: detail.severity,
    caseType: detail.caseType,
    slaBreachAt: detail.slaBreachAt,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
    clientVisible: detail.clientVisible,
    clientCanReply: detail.clientCanReply,
    jobId: detail.jobId,
    reportId: detail.reportId,
    clientId: detail.clientId,
    propertyId: detail.propertyId,
    job: detail.job ? { id: detail.job.id, jobNumber: detail.job.jobNumber ?? null, scheduledDate: detail.job.scheduledDate ?? null } : null,
    client: detail.client ? { id: detail.client.id, name: detail.client.name } : null,
    property: detail.property ?? null,
    assignedTo: detail.assignedTo ?? null,
    invoiceRef: previous?.invoiceRef ?? null,
    commentCount: detail.comments.length,
    attachmentCount: detail.attachments.length,
    lastMessage: latest
      ? {
          at: latest.createdAt,
          authorName: personLabel(latest.author),
          fromClient,
          excerpt: latest.body.replace(/\s+/g, " ").trim().slice(0, 140),
        }
      : null,
    clientReplied: fromClient,
  };
}

export async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
