"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
};

const CASE_TYPES: CaseType[] = ["DAMAGE", "CLIENT_DISPUTE", "LOST_FOUND", "OPS", "SLA", "OTHER"];
const CASE_STATUSES: CaseStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED"];
const SEVERITIES: Severity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

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
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [postingComment, setPostingComment] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [items, setItems] = useState<CaseItem[]>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<CaseItem | null>(null);
  const [filters, setFilters] = useState({ q: "", status: "ALL", caseType: "ALL", assigneeUserId: "ALL" });
  const [createDraft, setCreateDraft] = useState({ title: "", description: "", caseType: "OPS" as CaseType, severity: "MEDIUM" as Severity, clientVisible: false, clientCanReply: true });
  const [commentDraft, setCommentDraft] = useState({ body: "", isInternal: false });

  async function loadList() {
    setLoadingList(true);
    try {
      const query = new URLSearchParams();
      if (filters.q.trim()) query.set("q", filters.q.trim());
      if (filters.status !== "ALL") query.set("status", filters.status);
      if (filters.caseType !== "ALL") query.set("caseType", filters.caseType);
      if (filters.assigneeUserId !== "ALL") query.set("assigneeUserId", filters.assigneeUserId);
      const res = await fetch(`/api/admin/cases?${query.toString()}`, { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Partial<CasesResponse> & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not load cases.");
      const nextItems = Array.isArray(body.items) ? body.items : [];
      const nextAssignees = Array.isArray(body.assignees) ? body.assignees : [];
      setItems(nextItems);
      setAssignees(nextAssignees);
      if (!selectedId && nextItems[0]?.id) {
        setSelectedId(nextItems[0].id);
        setSelected(nextItems[0]);
      } else if (selectedId) {
        const nextSelected = nextItems.find((item) => item.id === selectedId) ?? null;
        if (nextSelected) setSelected(nextSelected);
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
    } catch (error: any) {
      toast({ title: "Case failed", description: error?.message ?? "Could not load case details.", variant: "destructive" });
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadList();
    }, 180);
    return () => clearTimeout(timer);
  }, [filters.q, filters.status, filters.caseType, filters.assigneeUserId]);

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

  async function saveCase() {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/cases/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selected.title,
          description: selected.description,
          severity: selected.severity,
          status: selected.status,
          caseType: selected.caseType,
          assignedToUserId: selected.assignedTo?.id ?? null,
          clientVisible: selected.clientVisible,
          clientCanReply: selected.clientCanReply,
          resolutionNote: selected.resolutionNote ?? null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as CaseItem & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not save case.");
      setSelected(body);
      await loadList();
      toast({ title: "Case updated" });
    } catch (error: any) {
      toast({ title: "Save failed", description: error?.message ?? "Could not save case.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
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

  async function deleteCase() {
    if (!selected) return;
    if (!window.confirm("Delete this case? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/cases/${selected.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not delete case.");
      toast({ title: "Case deleted" });
      setSelected(null);
      setSelectedId("");
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
            {loadingList ? <p className="py-10 text-center text-sm text-muted-foreground">Loading cases...</p> : items.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No cases found.</p> : (
              <div className="space-y-2">
                {items.map((item) => (
                  <button key={item.id} type="button" className={`w-full rounded-xl border px-3 py-3 text-left transition ${selectedId === item.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`} onClick={() => setSelectedId(item.id)}>
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{item.title}</p><div className="flex flex-wrap gap-1"><Badge variant={severityTone(item.severity)}>{item.severity}</Badge><Badge variant={statusTone(item.status)}>{prettify(item.status)}</Badge></div></div>
                    <p className="mt-1 text-xs text-muted-foreground">{prettify(item.caseType)} · {item.property?.name || item.job?.property?.name || item.client?.name || "General case"}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Owner: {item.assignedTo?.name?.trim() || item.assignedTo?.email || "Unassigned"}</p>
                  </button>
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
                <div className="space-y-1.5"><Label>Resolution / admin note</Label><Textarea rows={3} value={selected.resolutionNote || ""} onChange={(event) => setSelected((prev) => prev ? { ...prev, resolutionNote: event.target.value } : prev)} /></div>
                <div className="flex flex-wrap gap-2"><Button onClick={saveCase} disabled={saving}>{saving ? "Saving..." : "Save case"}</Button><Button variant="destructive" onClick={deleteCase} disabled={deleting}>{deleting ? "Deleting..." : "Delete case"}</Button></div>
                <div className="space-y-3 rounded-2xl border p-4">
                  <div><h3 className="font-semibold">Timeline</h3><p className="text-xs text-muted-foreground">Public updates and internal admin notes live in one thread.</p></div>
                  <div className="space-y-3">{selected.comments.length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : selected.comments.map((comment) => <div key={comment.id} className="rounded-xl border p-3"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge variant={comment.isInternal ? "destructive" : "secondary"}>{comment.isInternal ? "Internal" : "Public"}</Badge><span className="text-xs text-muted-foreground">{authorLabel(comment.author)} · {formatDateTime(comment.createdAt)}</span></div><p className="whitespace-pre-wrap text-sm">{comment.body}</p></div>)}</div>
                  <div className="space-y-2 rounded-xl border border-dashed p-3"><Textarea rows={3} placeholder="Add a public update or internal note" value={commentDraft.body} onChange={(event) => setCommentDraft((prev) => ({ ...prev, body: event.target.value }))} /><div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><Switch checked={commentDraft.isInternal} onCheckedChange={(checked) => setCommentDraft((prev) => ({ ...prev, isInternal: checked }))} />Internal note only</label><Button onClick={postComment} disabled={postingComment}>{postingComment ? "Posting..." : "Add comment"}</Button></div></div>
                </div>
                <div className="space-y-3 rounded-2xl border p-4">
                  <div className="flex items-center justify-between gap-2"><div><h3 className="font-semibold">Attachments</h3><p className="text-xs text-muted-foreground">Upload evidence, documents, and photos against the case.</p></div><label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm"><input type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAttachment(file); event.currentTarget.value = ""; }} /><Upload className="mr-2 h-4 w-4" />{uploadingAttachment ? "Uploading..." : "Attach file"}</label></div>
                  {selected.attachments.length === 0 ? <p className="text-sm text-muted-foreground">No attachments yet.</p> : <div className="grid gap-2 md:grid-cols-2">{selected.attachments.map((attachment) => <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="rounded-xl border p-3 text-sm hover:bg-muted/50"><p className="font-medium">{attachment.label || attachment.mimeType || "Attachment"}</p><p className="text-xs text-muted-foreground">{authorLabel(attachment.uploadedBy)} · {formatDateTime(attachment.createdAt)}</p></a>)}</div>}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

