"use client";

/**
 * ESTATE — Admin cases workspace (native v2 port of
 * components/cases/admin-cases-workspace). One case queue for damage reports,
 * client disputes, lost & found, and operational follow-up. Full CRUD parity
 * with v1 against the SAME endpoints — zero live (v1) UI imports.
 *
 * Endpoints (unchanged from v1):
 *   GET   /api/admin/cases?status&caseType&assigneeUserId&jobId&q → { items, assignees, viewer }
 *   POST  /api/admin/cases                                        → created case
 *   GET   /api/admin/cases/:id                                    → case detail (comments, attachments)
 *   PATCH /api/admin/cases/:id   { ...patch, statusChangeNote }   → updated case
 *   DELETE /api/admin/cases/:id  { security: { pin?, password? } }
 *   POST  /api/admin/cases/:id/comments      { body, isInternal }
 *   POST  /api/admin/cases/:id/attachments   { s3Key, url, mimeType, label }
 *   POST  /api/uploads/direct    (multipart)                      → { key, url, mimeType }
 */

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  RefreshCw,
  Upload,
  Wand2,
  Plus,
  Search,
  Trash2,
  MessageSquare,
  Paperclip,
  UserPlus,
  FileText,
} from "lucide-react";
import {
  EButton,
  ECard,
  ECardHeader,
  ECardTitle,
  ECardBody,
  EBadge,
  EPageHeader,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import {
  EInput,
  ETextarea,
  ESelect,
  EField,
  ESwitch,
  EConfirmModal,
  EModal,
} from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";
import {
  CASE_STATUSES,
  CASE_STATUS_LABELS,
  type UnifiedCaseStatus,
} from "@/lib/cases/status";

type CaseStatus = UnifiedCaseStatus;
type CaseType = "DAMAGE" | "CLIENT_DISPUTE" | "LOST_FOUND" | "OPS" | "SLA" | "OTHER";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type ETone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info" | "aubergine";

type AssigneeOption = { id: string; name: string | null; email: string; role: string };

type CaseComment = {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: { id: string; name: string | null; email: string; role: string } | null;
};

type CaseAttachment = {
  id: string;
  url: string;
  label: string | null;
  mimeType: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string | null; email: string; role: string } | null;
};

type CaseItem = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  priority: Severity;
  status: CaseStatus;
  slaBreachAt: string | null;
  caseType: CaseType;
  clientVisible: boolean;
  clientCanReply: boolean;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  jobId: string | null;
  reportId: string | null;
  clientId: string | null;
  propertyId: string | null;
  job?: {
    id: string;
    jobNumber?: string | null;
    scheduledDate?: string | null;
    property?: { id: string; name: string; suburb: string | null } | null;
  } | null;
  client?: { id: string; name: string; email: string | null } | null;
  property?: { id: string; name: string; suburb: string | null } | null;
  assignedTo?: AssigneeOption | null;
  comments: CaseComment[];
  attachments: CaseAttachment[];
};

type CasesResponse = {
  items: CaseItem[];
  assignees: AssigneeOption[];
  viewer?: { id: string; name: string | null; email: string | null; role: string | null } | null;
};

const CASE_TYPES: CaseType[] = ["DAMAGE", "CLIENT_DISPUTE", "LOST_FOUND", "OPS", "SLA", "OTHER"];
const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

type CaseView = "open" | "mine" | "awaitingClient" | "slaRisk" | "all";
const CASE_VIEWS: { key: CaseView; label: string }[] = [
  { key: "open", label: "All open" },
  { key: "mine", label: "Awaiting me" },
  { key: "awaitingClient", label: "Awaiting client" },
  { key: "slaRisk", label: "SLA at risk" },
  { key: "all", label: "All" },
];

const RESOLUTION_TEMPLATES: Record<CaseType, string> = {
  DAMAGE: "We have reviewed the reported damage. We will arrange a follow-up visit to assess and resolve.",
  CLIENT_DISPUTE: "We acknowledge your concern and are investigating. We'll be in touch within 24 hours.",
  LOST_FOUND: "We've followed up with the assigned cleaner. [Item status]. Please let us know if you need further assistance.",
  OPS: "Operations has reviewed this case and is coordinating the next steps now.",
  SLA: "We are reviewing the service timing and will confirm the follow-up action shortly.",
  OTHER: "We have logged the issue and will update this case after our review.",
};

function applyCaseView(view: CaseView, list: CaseItem[], viewerId: string | null | undefined): CaseItem[] {
  const nowMs = Date.now();
  return list.filter((c) => {
    const status = c.status;
    switch (view) {
      case "open":
        return status !== "RESOLVED" && status !== "CLOSED";
      case "mine":
        return (
          !!viewerId &&
          c.assignedTo?.id === viewerId &&
          status !== "RESOLVED" &&
          status !== "CLOSED"
        );
      case "awaitingClient":
        return status === "WAITING_CLIENT";
      case "slaRisk": {
        if (!c.slaBreachAt) return false;
        if (status === "RESOLVED" || status === "CLOSED") return false;
        const breachMs = new Date(c.slaBreachAt).getTime();
        if (Number.isNaN(breachMs)) return false;
        return breachMs - nowMs < 4 * 60 * 60 * 1000;
      }
      case "all":
      default:
        return true;
    }
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-AU");
}

function prettify(value?: string | null) {
  return String(value ?? "").replace(/_/g, " ").trim();
}

function authorLabel(author: { name: string | null; email: string; role: string } | null | undefined) {
  if (!author) return "Unknown";
  return author.name?.trim() || author.email;
}

function severityTone(value: Severity): ETone {
  if (value === "CRITICAL" || value === "HIGH") return "danger";
  if (value === "MEDIUM") return "warning";
  return "neutral";
}

function statusTone(value: CaseStatus): ETone {
  if (value === "RESOLVED" || value === "CLOSED") return "success";
  if (value === "INVESTIGATING") return "info";
  if (value === "TRIAGE") return "primary";
  if (value === "WAITING_CLIENT" || value === "WAITING_INTERNAL") return "warning";
  return "neutral";
}

function ageLabel(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - created) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

type SlaIndicator = { label: string; tone: ETone } | null;
function slaIndicator(item: CaseItem): SlaIndicator {
  if (item.status === "RESOLVED" || item.status === "CLOSED") return null;
  if (item.slaBreachAt) {
    const breach = new Date(item.slaBreachAt).getTime();
    if (!Number.isNaN(breach)) {
      const diffMin = Math.round((breach - Date.now()) / 60_000);
      if (diffMin <= 0) return { label: "SLA breached", tone: "danger" };
      if (diffMin < 240) {
        const hrs = Math.max(1, Math.round(diffMin / 60));
        return { label: `Due in ${hrs}h`, tone: "warning" };
      }
    }
  }
  return { label: `Age ${ageLabel(item.createdAt)}`, tone: "neutral" };
}

const QUICK_ACTIONS: Array<{
  label: string;
  next: CaseStatus;
  toast: string;
  show: (status: CaseStatus) => boolean;
}> = [
  { label: "Triage", next: "TRIAGE", toast: "Case moved to triage", show: (s) => s === "OPEN" },
  {
    label: "Investigate",
    next: "INVESTIGATING",
    toast: "Case moved to investigation",
    show: (s) => s === "OPEN" || s === "TRIAGE" || s === "WAITING_CLIENT" || s === "WAITING_INTERNAL",
  },
  {
    label: "Need client",
    next: "WAITING_CLIENT",
    toast: "Case waiting on client",
    show: (s) => s !== "WAITING_CLIENT" && s !== "RESOLVED" && s !== "CLOSED",
  },
  {
    label: "Need team",
    next: "WAITING_INTERNAL",
    toast: "Case waiting on internal team",
    show: (s) => s !== "WAITING_INTERNAL" && s !== "RESOLVED" && s !== "CLOSED",
  },
  {
    label: "Resolve",
    next: "RESOLVED",
    toast: "Case resolved",
    show: (s) => s !== "RESOLVED" && s !== "CLOSED",
  },
  { label: "Close", next: "CLOSED", toast: "Case closed", show: (s) => s === "RESOLVED" },
  {
    label: "Reopen",
    next: "OPEN",
    toast: "Case reopened",
    show: (s) => s === "RESOLVED" || s === "CLOSED",
  },
];

export function CasesWorkspace() {
  const [loadingList, setLoadingList] = React.useState(true);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [postingComment, setPostingComment] = React.useState(false);
  const [uploadingAttachment, setUploadingAttachment] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  const [items, setItems] = React.useState<CaseItem[]>([]);
  const [assignees, setAssignees] = React.useState<AssigneeOption[]>([]);
  const [viewer, setViewer] = React.useState<CasesResponse["viewer"]>(null);
  const [selectedId, setSelectedId] = React.useState("");
  const [selected, setSelected] = React.useState<CaseItem | null>(null);
  const [selectedPersistedStatus, setSelectedPersistedStatus] = React.useState<CaseStatus | null>(null);

  const [view, setView] = React.useState<CaseView>("open");
  const [filters, setFilters] = React.useState({ q: "", status: "ALL", caseType: "ALL", assigneeUserId: "ALL", jobId: "" });

  const [createDraft, setCreateDraft] = React.useState({
    title: "",
    description: "",
    caseType: "OPS" as CaseType,
    severity: "MEDIUM" as Severity,
    clientVisible: false,
    clientCanReply: true,
  });
  const [commentDraft, setCommentDraft] = React.useState({ body: "", isInternal: false });
  const [statusChangeDialog, setStatusChangeDialog] = React.useState<{
    caseId: string;
    nextStatus: CaseStatus;
    patch: Record<string, unknown>;
    successTitle: string;
  } | null>(null);
  const [statusChangeNote, setStatusChangeNote] = React.useState("");

  const loadList = React.useCallback(async () => {
    setLoadingList(true);
    try {
      const query = new URLSearchParams();
      if (filters.q.trim()) query.set("q", filters.q.trim());
      if (filters.status !== "ALL") query.set("status", filters.status);
      if (filters.caseType !== "ALL") query.set("caseType", filters.caseType);
      if (filters.assigneeUserId !== "ALL") query.set("assigneeUserId", filters.assigneeUserId);
      if (filters.jobId.trim()) query.set("jobId", filters.jobId.trim());
      const res = await fetch(`/api/admin/cases?${query.toString()}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Partial<CasesResponse> & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not load cases.");
      const nextItems = Array.isArray(body.items) ? body.items : [];
      setItems(nextItems);
      setAssignees(Array.isArray(body.assignees) ? body.assignees : []);
      setViewer(body.viewer ?? null);
      setSelectedId((current) => {
        if (current && nextItems.some((i) => i.id === current)) return current;
        return nextItems[0]?.id ?? "";
      });
    } catch (error: any) {
      toast({ title: "Cases failed", description: error?.message ?? "Could not load cases.", variant: "destructive" });
    } finally {
      setLoadingList(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.status, filters.caseType, filters.assigneeUserId, filters.jobId]);

  const loadCase = React.useCallback(async (id: string) => {
    if (!id) {
      setSelected(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/cases/${id}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as CaseItem & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not load case.");
      setSelected(body);
      setSelectedPersistedStatus(body.status);
    } catch (error: any) {
      toast({ title: "Case failed", description: error?.message ?? "Could not load case details.", variant: "destructive" });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // Debounced list reload on filter change.
  React.useEffect(() => {
    const timer = setTimeout(() => void loadList(), 180);
    return () => clearTimeout(timer);
  }, [loadList]);

  React.useEffect(() => {
    if (selectedId) void loadCase(selectedId);
    else setSelected(null);
  }, [selectedId, loadCase]);

  const viewCounts = React.useMemo(() => {
    const counts: Record<CaseView, number> = {
      open: applyCaseView("open", items, viewer?.id).length,
      mine: applyCaseView("mine", items, viewer?.id).length,
      awaitingClient: applyCaseView("awaitingClient", items, viewer?.id).length,
      slaRisk: applyCaseView("slaRisk", items, viewer?.id).length,
      all: items.length,
    };
    return counts;
  }, [items, viewer?.id]);

  const visibleItems = React.useMemo(() => applyCaseView(view, items, viewer?.id), [view, items, viewer?.id]);

  const selectedPropertyLabel = React.useMemo(() => {
    if (!selected) return "—";
    const property = selected.property ?? selected.job?.property;
    if (!property) return "—";
    return property.suburb ? `${property.name} (${property.suburb})` : property.name;
  }, [selected]);

  const selectedResolutionTemplate = selected ? RESOLUTION_TEMPLATES[selected.caseType] : "";

  async function createCase() {
    if (!createDraft.title.trim()) {
      toast({ title: "Case title required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createDraft.title.trim(),
          description: createDraft.description.trim() || null,
          caseType: createDraft.caseType,
          severity: createDraft.severity,
          clientVisible: createDraft.clientVisible,
          clientCanReply: createDraft.clientCanReply,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as CaseItem & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not create case.");
      setCreateDraft({ title: "", description: "", caseType: "OPS", severity: "MEDIUM", clientVisible: false, clientCanReply: true });
      setCreateOpen(false);
      setSelectedId(body.id);
      await loadList();
      toast({ title: "Case created" });
    } catch (error: any) {
      toast({ title: "Create failed", description: error?.message ?? "Could not create case.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function submitCasePatch(
    caseId: string,
    patch: Record<string, unknown>,
    successTitle: string,
    options?: { syncSelected?: boolean }
  ) {
    const syncSelected = options?.syncSelected !== false;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => ({}))) as CaseItem & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not save case.");
      if (syncSelected) {
        setSelected(body);
        setSelectedPersistedStatus(body.status);
      }
      setItems((current) => current.map((row) => (row.id === body.id ? body : row)));
      await loadList();
      toast({ title: successTitle });
    } catch (error: any) {
      toast({ title: "Save failed", description: error?.message ?? "Could not save case.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function saveCase() {
    if (!selected) return;
    const patch = {
      title: selected.title,
      description: selected.description,
      severity: selected.severity,
      status: selected.status,
      caseType: selected.caseType,
      assignedToUserId: selected.assignedTo?.id ?? null,
      clientVisible: selected.clientVisible,
      clientCanReply: selected.clientCanReply,
      resolutionNote: selected.resolutionNote ?? null,
    };
    if (selectedPersistedStatus && selected.status !== selectedPersistedStatus) {
      setStatusChangeNote("");
      setStatusChangeDialog({ caseId: selected.id, nextStatus: selected.status, patch, successTitle: "Case updated" });
      return;
    }
    await submitCasePatch(selected.id, patch, "Case updated");
  }

  async function runQuickUpdate(
    item: CaseItem,
    patch: Partial<{ status: CaseStatus; assignedToUserId: string | null }>,
    successTitle: string
  ) {
    if (patch.status && patch.status !== item.status) {
      setStatusChangeNote("");
      setStatusChangeDialog({ caseId: item.id, nextStatus: patch.status, patch, successTitle });
      return;
    }
    await submitCasePatch(item.id, patch as Record<string, unknown>, successTitle, { syncSelected: selectedId === item.id });
  }

  async function submitStatusChange() {
    if (!statusChangeDialog) return;
    const note = statusChangeNote.trim();
    if (!note) {
      toast({ title: "Status note required", description: "Add a note explaining the status change.", variant: "destructive" });
      return;
    }
    await submitCasePatch(
      statusChangeDialog.caseId,
      { ...statusChangeDialog.patch, statusChangeNote: note },
      statusChangeDialog.successTitle,
      { syncSelected: selectedId === statusChangeDialog.caseId }
    );
    setStatusChangeDialog(null);
    setStatusChangeNote("");
  }

  async function postComment() {
    if (!selected || !commentDraft.body.trim()) {
      toast({ title: "Comment required", variant: "destructive" });
      return;
    }
    setPostingComment(true);
    try {
      const res = await fetch(`/api/admin/cases/${selected.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentDraft.body.trim(), isInternal: commentDraft.isInternal }),
      });
      const body = (await res.json().catch(() => ({}))) as CaseItem & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not add comment.");
      setSelected(body);
      setCommentDraft({ body: "", isInternal: false });
      await loadList();
      toast({ title: "Comment added" });
    } catch (error: any) {
      toast({ title: "Comment failed", description: error?.message ?? "Could not add comment.", variant: "destructive" });
    } finally {
      setPostingComment(false);
    }
  }

  async function uploadAttachment(file: File) {
    if (!selected) return;
    setUploadingAttachment(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "cases");
      const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const uploadBody = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !uploadBody?.key) throw new Error(uploadBody.error ?? "Could not upload file.");
      const res = await fetch(`/api/admin/cases/${selected.id}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          s3Key: uploadBody.key,
          url: uploadBody.url ?? null,
          mimeType: uploadBody.mimeType ?? file.type ?? null,
          label: file.name,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as CaseItem & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not attach file.");
      setSelected(body);
      await loadList();
      toast({ title: "Attachment added" });
    } catch (error: any) {
      toast({ title: "Upload failed", description: error?.message ?? "Could not attach file.", variant: "destructive" });
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function deleteCase(credentials?: { pin?: string; password?: string }) {
    if (!selected) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/cases/${selected.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not delete case.");
      toast({ title: "Case deleted" });
      setSelected(null);
      setSelectedId("");
      setDeleteOpen(false);
      await loadList();
    } catch (error: any) {
      toast({ title: "Delete failed", description: error?.message ?? "Could not delete case.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  const isImage = (a: CaseAttachment) => (a.mimeType ?? "").startsWith("image/");

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Operations"
        title="Cases"
        description="Damage reports, client disputes, lost & found, and operational follow-up — one case workflow."
        actions={
          <>
            <EButton variant="outline" onClick={() => void loadList()} disabled={loadingList}>
              <RefreshCw className={loadingList ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh
            </EButton>
            <EButton variant="gold" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Open a case
            </EButton>
          </>
        }
      />

      {/* View tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1.5">
        {CASE_VIEWS.map(({ key, label }) => {
          const isActive = view === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={
                "inline-flex items-center gap-2 rounded-[var(--e-radius)] px-3.5 py-1.5 text-[0.8125rem] font-[550] tracking-[0.01em] transition-colors duration-[160ms] " +
                (isActive
                  ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                  : "text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-surface))] hover:text-[hsl(var(--e-foreground))]")
              }
            >
              {label}
              <span
                className={
                  "e-tnum rounded-[var(--e-radius-pill)] px-1.5 text-[0.6875rem] " +
                  (isActive
                    ? "bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold-ink))]"
                    : "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]")
                }
              >
                {viewCounts[key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* Queue */}
        <ECard className="self-start">
          <ECardHeader>
            <ECardTitle className="text-[1rem]">Case queue</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
              <EInput
                className="pl-9"
                placeholder="Search title, description, notes"
                value={filters.q}
                onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
              <ESelect value={filters.status} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}>
                <option value="ALL">All statuses</option>
                {CASE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CASE_STATUS_LABELS[s]}
                  </option>
                ))}
              </ESelect>
              <ESelect value={filters.caseType} onChange={(e) => setFilters((p) => ({ ...p, caseType: e.target.value }))}>
                <option value="ALL">All case types</option>
                {CASE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {prettify(t)}
                  </option>
                ))}
              </ESelect>
              <ESelect
                value={filters.assigneeUserId}
                onChange={(e) => setFilters((p) => ({ ...p, assigneeUserId: e.target.value }))}
              >
                <option value="ALL">All owners</option>
                <option value="__unassigned">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name?.trim() || a.email}
                  </option>
                ))}
              </ESelect>
            </div>
            <EInput
              placeholder="Filter by job id"
              value={filters.jobId}
              onChange={(e) => setFilters((p) => ({ ...p, jobId: e.target.value }))}
            />

            {loadingList ? (
              <p className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading cases…</p>
            ) : visibleItems.length === 0 ? (
              <p className="py-10 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No cases in this view.</p>
            ) : (
              <div className="space-y-2">
                {visibleItems.map((item) => {
                  const active = selectedId === item.id;
                  const sla = slaIndicator(item);
                  return (
                    <div
                      key={item.id}
                      className={
                        "rounded-[var(--e-radius)] border px-3 py-3 transition-colors duration-[160ms] " +
                        (active
                          ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]"
                          : "border-[hsl(var(--e-border))] hover:bg-[hsl(var(--e-muted))]")
                      }
                    >
                      <button type="button" className="w-full text-left" onClick={() => setSelectedId(item.id)}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-[550] text-[hsl(var(--e-foreground))]">{item.title}</p>
                          <div className="flex flex-wrap gap-1">
                            <EBadge tone={severityTone(item.severity)} soft>
                              {item.severity}
                            </EBadge>
                            <EBadge tone={statusTone(item.status)} soft>
                              {CASE_STATUS_LABELS[item.status]}
                            </EBadge>
                            {sla ? <EBadge tone={sla.tone}>{sla.label}</EBadge> : null}
                          </div>
                        </div>
                        <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {prettify(item.caseType)} ·{" "}
                          {item.property?.name || item.job?.property?.name || item.client?.name || "General case"}
                        </p>
                        <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          Owner: {item.assignedTo?.name?.trim() || item.assignedTo?.email || "Unassigned"}
                        </p>
                      </button>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {QUICK_ACTIONS.filter((a) => a.show(item.status)).map((a) => (
                          <EButton
                            key={a.label}
                            size="sm"
                            variant="outline"
                            disabled={saving}
                            onClick={() => void runQuickUpdate(item, { status: a.next }, a.toast)}
                          >
                            {a.label}
                          </EButton>
                        ))}
                        {!item.assignedTo?.id && viewer?.id ? (
                          <EButton
                            size="sm"
                            variant="outline"
                            disabled={saving}
                            onClick={() => void runQuickUpdate(item, { assignedToUserId: viewer.id }, "Case assigned")}
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            Assign to me
                          </EButton>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ECardBody>
        </ECard>

        {/* Detail */}
        <ECard>
          <ECardHeader>
            <ECardTitle className="text-[1rem]">Case details</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-5">
            {loadingDetail ? (
              <p className="py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading case…</p>
            ) : !selected ? (
              <EEmptyState
                eyebrow="Cases"
                title="Select a case"
                description="Choose a case from the queue to view and update its details."
              />
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <EField label="Title">
                    <EInput
                      value={selected.title}
                      onChange={(e) => setSelected((p) => (p ? { ...p, title: e.target.value } : p))}
                    />
                  </EField>
                  <EField label="Property">
                    <EInput value={selectedPropertyLabel} disabled />
                  </EField>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  <span>Created {formatDateTime(selected.createdAt)}</span>
                  <span>Updated {formatDateTime(selected.updatedAt)}</span>
                  <span>Job {selected.job?.jobNumber || selected.job?.id || "Not linked"}</span>
                  <span>Client {selected.client?.name || "Not linked"}</span>
                </div>

                {selected.job?.id || selected.reportId ? (
                  <div className="flex flex-wrap gap-2">
                    {selected.job?.id ? (
                      <EButton asChild variant="outline" size="sm">
                        <Link href={`/v2/admin/jobs/${selected.job.id}`}>Open job</Link>
                      </EButton>
                    ) : null}
                    {selected.reportId ? (
                      <EButton asChild variant="outline" size="sm">
                        <Link href={`/v2/admin/reports?reportId=${selected.reportId}`}>Open report</Link>
                      </EButton>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <EField label="Type">
                    <ESelect
                      value={selected.caseType}
                      onChange={(e) => setSelected((p) => (p ? { ...p, caseType: e.target.value as CaseType } : p))}
                    >
                      {CASE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {prettify(t)}
                        </option>
                      ))}
                    </ESelect>
                  </EField>
                  <EField label="Status">
                    <ESelect
                      value={selected.status}
                      onChange={(e) => setSelected((p) => (p ? { ...p, status: e.target.value as CaseStatus } : p))}
                    >
                      {CASE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {CASE_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </ESelect>
                  </EField>
                  <EField label="Priority">
                    <ESelect
                      value={selected.severity}
                      onChange={(e) => setSelected((p) => (p ? { ...p, severity: e.target.value as Severity } : p))}
                    >
                      {SEVERITIES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </ESelect>
                  </EField>
                  <EField label="Owner">
                    <ESelect
                      value={selected.assignedTo?.id ?? "__unassigned"}
                      onChange={(e) =>
                        setSelected((p) =>
                          p
                            ? {
                                ...p,
                                assignedTo:
                                  e.target.value === "__unassigned"
                                    ? null
                                    : assignees.find((a) => a.id === e.target.value) || null,
                              }
                            : p
                        )
                      }
                    >
                      <option value="__unassigned">Unassigned</option>
                      {assignees.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name?.trim() || a.email}
                        </option>
                      ))}
                    </ESelect>
                  </EField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5 text-[0.875rem]">
                    <span>Client can see this case</span>
                    <ESwitch
                      checked={selected.clientVisible}
                      onCheckedChange={(v) => setSelected((p) => (p ? { ...p, clientVisible: v } : p))}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5 text-[0.875rem]">
                    <span>Client can reply</span>
                    <ESwitch
                      checked={selected.clientCanReply}
                      onCheckedChange={(v) => setSelected((p) => (p ? { ...p, clientCanReply: v } : p))}
                    />
                  </label>
                </div>

                <EField label="Description">
                  <ETextarea
                    rows={5}
                    value={selected.description || ""}
                    onChange={(e) => setSelected((p) => (p ? { ...p, description: e.target.value } : p))}
                  />
                </EField>

                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">
                      Resolution / admin note
                    </span>
                    <EButton
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSelected((p) => (p ? { ...p, resolutionNote: selectedResolutionTemplate } : p))
                      }
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      Use template
                    </EButton>
                  </div>
                  <ETextarea
                    rows={3}
                    value={selected.resolutionNote || ""}
                    onChange={(e) => setSelected((p) => (p ? { ...p, resolutionNote: e.target.value } : p))}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <EButton variant="gold" onClick={() => void saveCase()} disabled={saving}>
                    {saving ? "Saving…" : "Save case"}
                  </EButton>
                  <EButton variant="danger" onClick={() => setDeleteOpen(true)} disabled={deleting}>
                    <Trash2 className="h-4 w-4" />
                    {deleting ? "Deleting…" : "Delete case"}
                  </EButton>
                </div>

                {/* Timeline */}
                <div className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
                  <div>
                    <h3 className="flex items-center gap-1.5 text-[0.9375rem] font-semibold">
                      <MessageSquare className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Timeline
                    </h3>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      Public updates and internal admin notes live in one thread.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {selected.comments.length === 0 ? (
                      <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No comments yet.</p>
                    ) : (
                      selected.comments.map((comment) => (
                        <div
                          key={comment.id}
                          className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3"
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <EBadge tone={comment.isInternal ? "danger" : "info"} soft>
                              {comment.isInternal ? "Internal" : "Public"}
                            </EBadge>
                            <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                              {authorLabel(comment.author)} · {formatDateTime(comment.createdAt)}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-foreground))]">
                            {comment.body}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="space-y-2 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] p-3">
                    <ETextarea
                      rows={3}
                      placeholder="Add a public update or internal note"
                      value={commentDraft.body}
                      onChange={(e) => setCommentDraft((p) => ({ ...p, body: e.target.value }))}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <ESwitch
                        checked={commentDraft.isInternal}
                        onCheckedChange={(v) => setCommentDraft((p) => ({ ...p, isInternal: v }))}
                        label="Internal note only"
                      />
                      <EButton size="sm" onClick={() => void postComment()} disabled={postingComment}>
                        {postingComment ? "Posting…" : "Add comment"}
                      </EButton>
                    </div>
                  </div>
                </div>

                {/* Attachments */}
                <div className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="flex items-center gap-1.5 text-[0.9375rem] font-semibold">
                        <Paperclip className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" /> Evidence & attachments
                      </h3>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        Upload photos and documents against the case.
                      </p>
                    </div>
                    <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))] transition-colors hover:bg-[hsl(var(--e-muted))]">
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadAttachment(file);
                          e.currentTarget.value = "";
                        }}
                      />
                      <Upload className="h-3.5 w-3.5" />
                      {uploadingAttachment ? "Uploading…" : "Attach file"}
                    </label>
                  </div>
                  {selected.attachments.length === 0 ? (
                    <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No attachments yet.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                      {selected.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="group flex flex-col overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]"
                        >
                          {isImage(a) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.url} alt={a.label ?? ""} className="aspect-square w-full object-cover" />
                          ) : (
                            <span className="flex aspect-square w-full items-center justify-center bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]">
                              <FileText className="h-8 w-8" />
                            </span>
                          )}
                          <span className="truncate px-2 py-1.5 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                            {a.label || "Attachment"}
                            <span className="block truncate text-[0.625rem] text-[hsl(var(--e-text-faint))]">
                              {authorLabel(a.uploadedBy)} · {formatDateTime(a.createdAt)}
                            </span>
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </ECardBody>
        </ECard>
      </div>

      {/* Create case modal */}
      <EModal open={createOpen} onClose={() => setCreateOpen(false)} title="Open a case" eyebrow="New case">
        <div className="space-y-4">
          <EField label="Case title">
            <EInput
              placeholder="Short summary"
              value={createDraft.title}
              onChange={(e) => setCreateDraft((p) => ({ ...p, title: e.target.value }))}
            />
          </EField>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Case type">
              <ESelect
                value={createDraft.caseType}
                onChange={(e) => setCreateDraft((p) => ({ ...p, caseType: e.target.value as CaseType }))}
              >
                {CASE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {prettify(t)}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Priority">
              <ESelect
                value={createDraft.severity}
                onChange={(e) => setCreateDraft((p) => ({ ...p, severity: e.target.value as Severity }))}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </ESelect>
            </EField>
          </div>
          <EField label="Description">
            <ETextarea
              rows={4}
              placeholder="What happened?"
              value={createDraft.description}
              onChange={(e) => setCreateDraft((p) => ({ ...p, description: e.target.value }))}
            />
          </EField>
          <div className="flex flex-wrap gap-4">
            <ESwitch
              checked={createDraft.clientVisible}
              onCheckedChange={(v) => setCreateDraft((p) => ({ ...p, clientVisible: v }))}
              label="Client can see this case"
            />
            <ESwitch
              checked={createDraft.clientCanReply}
              onCheckedChange={(v) => setCreateDraft((p) => ({ ...p, clientCanReply: v }))}
              label="Client can reply"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <EButton variant="outline" size="sm" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={() => void createCase()} disabled={saving}>
              {saving ? "Creating…" : "Create case"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Status-change note modal */}
      <EModal
        open={Boolean(statusChangeDialog)}
        onClose={() => setStatusChangeDialog(null)}
        title="Update case status"
        eyebrow="Confirm change"
      >
        <div className="space-y-4">
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.875rem]">
            <p className="font-[550]">
              {selected?.title ||
                items.find((i) => i.id === statusChangeDialog?.caseId)?.title ||
                "Selected case"}
            </p>
            <p className="mt-1 text-[hsl(var(--e-muted-foreground))]">
              Status will change to {prettify(statusChangeDialog?.nextStatus || "")}.
            </p>
          </div>
          <EField label="Reason / note">
            <ETextarea
              rows={4}
              value={statusChangeNote}
              onChange={(e) => setStatusChangeNote(e.target.value)}
              placeholder="Explain why this case is moving to the new status."
            />
          </EField>
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setStatusChangeDialog(null)} disabled={saving}>
              Cancel
            </EButton>
            <EButton size="sm" onClick={() => void submitStatusChange()} disabled={saving}>
              {saving ? "Saving…" : "Save status change"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Delete confirm (two-step: type DELETE + security verification) */}
      <EConfirmModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete case"
        description="This permanently removes the case, its comments, and attachments. This cannot be undone."
        confirmLabel="Delete case"
        confirmPhrase="DELETE"
        requireSecurity
        loading={deleting}
        onConfirm={(credentials) => void deleteCase(credentials)}
      />
    </div>
  );
}
