"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { RefreshCw, Upload, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CaseAttachmentsGallery } from "@/components/cases/case-attachments-gallery";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { toast } from "@/hooks/use-toast";

type CaseStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
type CaseType = "DAMAGE" | "CLIENT_DISPUTE" | "LOST_FOUND" | "OPS" | "SLA" | "OTHER";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type AssigneeOption = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

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
const CASE_STATUSES: CaseStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED"];
const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const CASE_FILTER_DEFAULTS = {
  q: "",
  status: "ALL",
  caseType: "ALL",
  assigneeUserId: "ALL",
  jobId: "",
};
const RESOLUTION_TEMPLATES: Record<CaseType, string> = {
  DAMAGE: "We have reviewed the reported damage. We will arrange a follow-up visit to assess and resolve.",
  CLIENT_DISPUTE: "We acknowledge your concern and are investigating. We'll be in touch within 24 hours.",
  LOST_FOUND: "We've followed up with the assigned cleaner. [Item status]. Please let us know if you need further assistance.",
  OPS: "Operations has reviewed this case and is coordinating the next steps now.",
  SLA: "We are reviewing the service timing and will confirm the follow-up action shortly.",
  OTHER: "We have logged the issue and will update this case after our review.",
};

function parseFilters(params: { get(name: string): string | null }) {
  return {
    q: params.get("q") || CASE_FILTER_DEFAULTS.q,
    status: params.get("status") || CASE_FILTER_DEFAULTS.status,
    caseType: params.get("caseType") || CASE_FILTER_DEFAULTS.caseType,
    assigneeUserId: params.get("assigneeUserId") || CASE_FILTER_DEFAULTS.assigneeUserId,
    jobId: params.get("jobId") || CASE_FILTER_DEFAULTS.jobId,
  };
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-AU");
}

function prettify(value?: string | null) {
  return String(value ?? "").replace(/_/g, " ").trim();
}

function authorLabel(author: { name: string | null; email: string; role: string } | null | undefined) {
  if (!author) return "Unknown";
  return author.name?.trim() || author.email;
}

function severityTone(value: Severity) {
  if (value === "CRITICAL" || value === "HIGH") return "destructive" as const;
  return "secondary" as const;
}

function statusTone(value: CaseStatus) {
  if (value === "RESOLVED") return "default" as const;
  if (value === "IN_PROGRESS") return "secondary" as const;
  return "outline" as const;
}

export function AdminCasesWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [items, setItems] = useState<CaseItem[]>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [viewer, setViewer] = useState<{ id: string; name: string | null; email: string | null; role: string | null } | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<CaseItem | null>(null);
  const [selectedPersistedStatus, setSelectedPersistedStatus] = useState<CaseStatus | null>(null);
  const [filters, setFilters] = useState(() => parseFilters(searchParams));
  const [createDraft, setCreateDraft] = useState({ title: "", description: "", caseType: "OPS" as CaseType, severity: "MEDIUM" as Severity, clientVisible: false, clientCanReply: true });
  const [commentDraft, setCommentDraft] = useState({ body: "", isInternal: false });
  const [statusChangeDialog, setStatusChangeDialog] = useState<{
    caseId: string;
    nextStatus: CaseStatus;
    patch: Record<string, unknown>;
    successTitle: string;
  } | null>(null);
  const [statusChangeNote, setStatusChangeNote] = useState("");

  async function loadList() {
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
      const nextAssignees = Array.isArray(body.assignees) ? body.assignees : [];
      setItems(nextItems);
      setAssignees(nextAssignees);
      setViewer(body.viewer ?? null);
      if (!selectedId && nextItems[0]?.id) {
        setSelectedId(nextItems[0].id);
        setSelected(nextItems[0]);
      } else if (selectedId) {
        const nextSelected = nextItems.find((item) => item.id === selectedId) ?? null;
        if (nextSelected) {
          setSelected(nextSelected);
        } else if (nextItems[0]?.id) {
          setSelectedId(nextItems[0].id);
          setSelected(nextItems[0]);
        } else {
          setSelectedId("");
          setSelected(null);
        }
      }
    } catch (error: any) {
      toast({ title: "Cases failed", description: error?.message ?? "Could not load cases.", variant: "destructive" });
    } finally {
      setLoadingList(false);
    }
  }

  async function loadCase(id: string) {
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
  }

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.status !== CASE_FILTER_DEFAULTS.status) params.set("status", filters.status);
    if (filters.caseType !== CASE_FILTER_DEFAULTS.caseType) params.set("caseType", filters.caseType);
    if (filters.assigneeUserId !== CASE_FILTER_DEFAULTS.assigneeUserId) params.set("assigneeUserId", filters.assigneeUserId);
    if (filters.jobId.trim()) params.set("jobId", filters.jobId.trim());
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [filters, pathname, router]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadList();
    }, 180);
    return () => clearTimeout(timer);
  }, [filters.q, filters.status, filters.caseType, filters.assigneeUserId, filters.jobId]);

  useEffect(() => {
    if (!selectedId) return;
    void loadCase(selectedId);
  }, [selectedId]);

  const selectedPropertyLabel = useMemo(() => {
    if (!selected) return "-";
    const property = selected.property ?? selected.job?.property;
    if (!property) return "-";
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
      setSelectedId(body.id);
      setSelected(body);
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
      }
      setSelectedPersistedStatus(body.status);
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
      setStatusChangeDialog({
        caseId: selected.id,
        nextStatus: selected.status,
        patch,
        successTitle: "Case updated",
      });
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
      setStatusChangeDialog({
        caseId: item.id,
        nextStatus: patch.status,
        patch,
        successTitle,
      });
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
      {
        ...statusChangeDialog.patch,
        statusChangeNote: note,
      },
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
        body: JSON.stringify({ s3Key: uploadBody.key, url: uploadBody.url ?? null, mimeType: uploadBody.mimeType ?? file.type ?? null, label: file.name }),
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Cases</h2>
          <p className="text-sm text-muted-foreground">Damage reports, client disputes, lost and found, and other operational follow-up now run through one case workflow.</p>
        </div>
        <Button variant="outline" onClick={() => void loadList()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Open a case</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_220px_220px_auto]">
          <Input placeholder="Case title" value={createDraft.title} onChange={(event) => setCreateDraft((prev) => ({ ...prev, title: event.target.value }))} />
          <select className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={createDraft.caseType} onChange={(event) => setCreateDraft((prev) => ({ ...prev, caseType: event.target.value as CaseType }))}>{CASE_TYPES.map((caseType) => <option key={caseType} value={caseType}>{prettify(caseType)}</option>)}</select>
          <select className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={createDraft.severity} onChange={(event) => setCreateDraft((prev) => ({ ...prev, severity: event.target.value as Severity }))}>{SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}</select>
          <Button onClick={createCase} disabled={saving}>{saving ? "Creating..." : "Create case"}</Button>
          <div className="space-y-2 md:col-span-2 xl:col-span-4">
            <Textarea rows={3} placeholder="Case description" value={createDraft.description} onChange={(event) => setCreateDraft((prev) => ({ ...prev, description: event.target.value }))} />
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm"><Switch checked={createDraft.clientVisible} onCheckedChange={(checked) => setCreateDraft((prev) => ({ ...prev, clientVisible: checked }))} />Client can see this case</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={createDraft.clientCanReply} onCheckedChange={(checked) => setCreateDraft((prev) => ({ ...prev, clientCanReply: checked }))} />Client can reply</label>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle className="text-base">Case queue</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Search title, description, notes" value={filters.q} onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))} />
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
              <select className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}><option value="ALL">All statuses</option>{CASE_STATUSES.map((status) => <option key={status} value={status}>{prettify(status)}</option>)}</select>
              <select className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={filters.caseType} onChange={(event) => setFilters((prev) => ({ ...prev, caseType: event.target.value }))}><option value="ALL">All case types</option>{CASE_TYPES.map((caseType) => <option key={caseType} value={caseType}>{prettify(caseType)}</option>)}</select>
              <select className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={filters.assigneeUserId} onChange={(event) => setFilters((prev) => ({ ...prev, assigneeUserId: event.target.value }))}><option value="ALL">All owners</option><option value="__unassigned">Unassigned</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name?.trim() || assignee.email}</option>)}</select>
            </div>
            <Input placeholder="Filter by job id" value={filters.jobId} onChange={(event) => setFilters((prev) => ({ ...prev, jobId: event.target.value }))} />
            {loadingList ? <p className="py-10 text-center text-sm text-muted-foreground">Loading cases...</p> : items.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No cases found.</p> : (
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className={`rounded-xl border px-3 py-3 transition ${selectedId === item.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}>
                    <button type="button" className="w-full text-left" onClick={() => setSelectedId(item.id)}>
                      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{item.title}</p><div className="flex flex-wrap gap-1"><Badge variant={severityTone(item.severity)}>{item.severity}</Badge><Badge variant={statusTone(item.status)}>{prettify(item.status)}</Badge></div></div>
                      <p className="mt-1 text-xs text-muted-foreground">{prettify(item.caseType)} · {item.property?.name || item.job?.property?.name || item.client?.name || "General case"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Owner: {item.assignedTo?.name?.trim() || item.assignedTo?.email || "Unassigned"}</p>
                    </button>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.status === "OPEN" ? (
                        <Button size="sm" variant="outline" onClick={() => void runQuickUpdate(item, { status: "IN_PROGRESS" }, "Case started")}>
                          Start
                        </Button>
                      ) : null}
                      {item.status !== "RESOLVED" ? (
                        <Button size="sm" variant="outline" onClick={() => void runQuickUpdate(item, { status: "RESOLVED" }, "Case resolved")}>
                          Resolve
                        </Button>
                      ) : null}
                      {!item.assignedTo?.id && viewer?.id ? (
                        <Button size="sm" variant="outline" onClick={() => void runQuickUpdate(item, { assignedToUserId: viewer.id }, "Case assigned")}>
                          Assign to me
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Case details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {loadingDetail ? <p className="py-10 text-sm text-muted-foreground">Loading case...</p> : !selected ? <p className="py-10 text-sm text-muted-foreground">Select a case to view and update it.</p> : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5"><Label>Title</Label><Input value={selected.title} onChange={(event) => setSelected((prev) => prev ? { ...prev, title: event.target.value } : prev)} /></div>
                  <div className="space-y-1.5"><Label>Property</Label><Input value={selectedPropertyLabel} disabled /></div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>Created {formatDateTime(selected.createdAt)}</span><span>Updated {formatDateTime(selected.updatedAt)}</span><span>Job {selected.job?.jobNumber || selected.job?.id || "Not linked"}</span><span>Client {selected.client?.name || "Not linked"}</span></div>
                <div className="flex flex-wrap gap-2">{selected.job?.id ? <Button asChild variant="outline" size="sm"><Link href={`/admin/jobs/${selected.job.id}`}>Open job</Link></Button> : null}{selected.reportId ? <Button asChild variant="outline" size="sm"><Link href={`/admin/reports?reportId=${selected.reportId}`}>Open report</Link></Button> : null}</div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div className="space-y-1.5"><Label>Type</Label><select className="h-10 w-full rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={selected.caseType} onChange={(event) => setSelected((prev) => prev ? { ...prev, caseType: event.target.value as CaseType } : prev)}>{CASE_TYPES.map((caseType) => <option key={caseType} value={caseType}>{prettify(caseType)}</option>)}</select></div>
                  <div className="space-y-1.5"><Label>Status</Label><select className="h-10 w-full rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={selected.status} onChange={(event) => setSelected((prev) => prev ? { ...prev, status: event.target.value as CaseStatus } : prev)}>{CASE_STATUSES.map((status) => <option key={status} value={status}>{prettify(status)}</option>)}</select></div>
                  <div className="space-y-1.5"><Label>Priority</Label><select className="h-10 w-full rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={selected.severity} onChange={(event) => setSelected((prev) => prev ? { ...prev, severity: event.target.value as Severity } : prev)}>{SEVERITIES.map((severity) => <option key={severity} value={severity}>{severity}</option>)}</select></div>
                  <div className="space-y-1.5"><Label>Owner</Label><select className="h-10 w-full rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={selected.assignedTo?.id ?? "__unassigned"} onChange={(event) => setSelected((prev) => prev ? { ...prev, assignedTo: event.target.value === "__unassigned" ? null : assignees.find((item) => item.id === event.target.value) || null } : prev)}><option value="__unassigned">Unassigned</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name?.trim() || assignee.email}</option>)}</select></div>
                </div>
                <div className="grid gap-3 md:grid-cols-2"><label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm"><span>Client can see this case</span><Switch checked={selected.clientVisible} onCheckedChange={(checked) => setSelected((prev) => prev ? { ...prev, clientVisible: checked } : prev)} /></label><label className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm"><span>Client can reply</span><Switch checked={selected.clientCanReply} onCheckedChange={(checked) => setSelected((prev) => prev ? { ...prev, clientCanReply: checked } : prev)} /></label></div>
                <div className="space-y-1.5"><Label>Description</Label><Textarea rows={5} value={selected.description || ""} onChange={(event) => setSelected((prev) => prev ? { ...prev, description: event.target.value } : prev)} /></div>
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label>Resolution / admin note</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSelected((prev) => (prev ? { ...prev, resolutionNote: selectedResolutionTemplate } : prev))
                      }
                    >
                      <Wand2 className="mr-2 h-4 w-4" />
                      Use template
                    </Button>
                  </div>
                  <Textarea rows={3} value={selected.resolutionNote || ""} onChange={(event) => setSelected((prev) => prev ? { ...prev, resolutionNote: event.target.value } : prev)} />
                </div>
                <div className="flex flex-wrap gap-2"><Button onClick={saveCase} disabled={saving}>{saving ? "Saving..." : "Save case"}</Button><Button variant="destructive" onClick={() => setDeleteOpen(true)} disabled={deleting}>{deleting ? "Deleting..." : "Delete case"}</Button></div>
                <div className="space-y-3 rounded-2xl border p-4">
                  <div><h3 className="font-semibold">Timeline</h3><p className="text-xs text-muted-foreground">Public updates and internal admin notes live in one thread.</p></div>
                  <div className="space-y-3">{selected.comments.length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : selected.comments.map((comment) => <div key={comment.id} className="rounded-xl border p-3"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant={comment.isInternal ? "destructive" : "secondary"}>{comment.isInternal ? "Internal" : "Public"}</Badge><span className="text-xs text-muted-foreground">{authorLabel(comment.author)} · {formatDateTime(comment.createdAt)}</span></div><p className="whitespace-pre-wrap text-sm">{comment.body}</p></div>)}</div>
                  <div className="space-y-2 rounded-xl border border-dashed p-3"><Textarea rows={3} placeholder="Add a public update or internal note" value={commentDraft.body} onChange={(event) => setCommentDraft((prev) => ({ ...prev, body: event.target.value }))} /><div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><Switch checked={commentDraft.isInternal} onCheckedChange={(checked) => setCommentDraft((prev) => ({ ...prev, isInternal: checked }))} />Internal note only</label><Button onClick={postComment} disabled={postingComment}>{postingComment ? "Posting..." : "Add comment"}</Button></div></div>
                </div>
                <div className="space-y-3 rounded-2xl border p-4">
                  <div className="flex items-center justify-between gap-2"><div><h3 className="font-semibold">Attachments</h3><p className="text-xs text-muted-foreground">Upload evidence, documents, and photos against the case.</p></div><label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm"><input type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file); event.currentTarget.value = ""; }} /><Upload className="mr-2 h-4 w-4" />{uploadingAttachment ? "Uploading..." : "Attach file"}</label></div>
                  <CaseAttachmentsGallery
                    attachments={selected.attachments.map((attachment) => ({
                      id: attachment.id,
                      url: attachment.url,
                      label: attachment.label,
                      mimeType: attachment.mimeType,
                      meta: `${authorLabel(attachment.uploadedBy)} · ${formatDateTime(attachment.createdAt)}`,
                    }))}
                    emptyText="No attachments yet."
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <TwoStepConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete case"
        description="This permanently removes the case, comments, and attachments."
        actionKey="deleteCase"
        confirmLabel="Delete case"
        requireSecurityVerification
        loading={deleting}
        onConfirm={deleteCase}
      />

      <Dialog open={Boolean(statusChangeDialog)} onOpenChange={(open) => !open && setStatusChangeDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Update case status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border bg-muted/30 p-3 text-sm">
              <p className="font-medium">
                {selected?.title || items.find((item) => item.id === statusChangeDialog?.caseId)?.title || "Selected case"}
              </p>
              <p className="mt-1 text-muted-foreground">
                Status will change to {prettify(statusChangeDialog?.nextStatus || "")}.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Reason / note</Label>
              <Textarea
                rows={4}
                value={statusChangeNote}
                onChange={(event) => setStatusChangeNote(event.target.value)}
                placeholder="Explain why this case is moving to the new status."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStatusChangeDialog(null)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={() => void submitStatusChange()} disabled={saving}>
                {saving ? "Saving..." : "Save status change"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

