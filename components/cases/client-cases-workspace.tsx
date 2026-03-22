"use client";

import { useEffect, useState } from "react";
import { Paperclip, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type CaseStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type ClientCase = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  status: CaseStatus;
  caseType: string;
  clientCanReply: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
  property?: { id: string; name: string; suburb: string | null } | null;
  job?: {
    id: string;
    jobNumber?: string | null;
    scheduledDate?: string | null;
    property?: { id: string; name: string; suburb: string | null } | null;
  } | null;
  comments: Array<{
    id: string;
    body: string;
    isInternal: boolean;
    createdAt: string;
    author: { id: string; name: string | null; email: string; role: string } | null;
  }>;
  attachments: Array<{
    id: string;
    url: string;
    label: string | null;
    mimeType: string | null;
    createdAt: string;
    uploadedBy: { id: string; name: string | null; email: string; role: string } | null;
  }>;
};

function prettify(value?: string | null) {
  return String(value ?? "").replace(/_/g, " ").trim();
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-AU");
}

function badgeTone(status: CaseStatus) {
  if (status === "RESOLVED") return "default" as const;
  if (status === "IN_PROGRESS") return "secondary" as const;
  return "outline" as const;
}

function authorLabel(author: { name: string | null; email: string } | null | undefined) {
  if (!author) return "Update";
  return author.name?.trim() || author.email;
}

export function ClientCasesWorkspace() {
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replying, setReplying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rows, setRows] = useState<ClientCase[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<ClientCase | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [createDraft, setCreateDraft] = useState({
    title: "",
    description: "",
    severity: "MEDIUM" as Severity,
  });
  const [reply, setReply] = useState("");

  async function loadList() {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (statusFilter !== "ALL") query.set("status", statusFilter);
      const res = await fetch(`/api/client/cases?${query.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => []);
      if (!res.ok) throw new Error(body.error ?? "Could not load cases.");
      const nextRows = Array.isArray(body) ? (body as ClientCase[]) : [];
      setRows(nextRows);
      if (!selectedId && nextRows[0]?.id) {
        setSelectedId(nextRows[0].id);
        setSelected(nextRows[0]);
      } else if (selectedId) {
        const nextSelected = nextRows.find((item) => item.id === selectedId) ?? null;
        if (nextSelected) setSelected(nextSelected);
      }
    } catch (error: any) {
      toast({ title: "Cases failed", description: error?.message ?? "Could not load cases.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function loadCase(id: string) {
    if (!id) {
      setSelected(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/client/cases/${id}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load case.");
      setSelected(body as ClientCase);
    } catch (error: any) {
      toast({ title: "Case failed", description: error?.message ?? "Could not load case.", variant: "destructive" });
    } finally {
      setLoadingDetail(false);
    }
  }

  useEffect(() => {
    void loadList();
  }, [statusFilter]);

  useEffect(() => {
    if (!selectedId) return;
    void loadCase(selectedId);
  }, [selectedId]);

  async function createCase() {
    if (!createDraft.title.trim() || !createDraft.description.trim()) {
      toast({ title: "Title and description are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/client/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createDraft.title.trim(),
          description: createDraft.description.trim(),
          severity: createDraft.severity,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create case.");
      const created = body as ClientCase;
      setCreateDraft({ title: "", description: "", severity: "MEDIUM" });
      setSelectedId(created.id);
      setSelected(created);
      await loadList();
      toast({ title: "Case submitted" });
    } catch (error: any) {
      toast({ title: "Create failed", description: error?.message ?? "Could not create case.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function addReply() {
    if (!selected || !reply.trim()) {
      toast({ title: "Reply required", variant: "destructive" });
      return;
    }
    setReplying(true);
    try {
      const res = await fetch(`/api/client/cases/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: reply.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not add reply.");
      setSelected(body as ClientCase);
      setReply("");
      await loadList();
      toast({ title: "Reply added" });
    } catch (error: any) {
      toast({ title: "Reply failed", description: error?.message ?? "Could not add reply.", variant: "destructive" });
    } finally {
      setReplying(false);
    }
  }

  async function addAttachment(file: File) {
    if (!selected) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "cases");
      const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const uploadBody = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !uploadBody?.key) throw new Error(uploadBody.error ?? "Could not upload file.");
      const res = await fetch(`/api/client/cases/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          s3Key: uploadBody.key,
          url: uploadBody.url ?? null,
          mimeType: uploadBody.mimeType ?? file.type ?? null,
          label: file.name,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not attach file.");
      setSelected(body as ClientCase);
      await loadList();
      toast({ title: "Evidence attached" });
    } catch (error: any) {
      toast({ title: "Attachment failed", description: error?.message ?? "Could not attach file.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Cases</h2>
          <p className="text-sm text-muted-foreground">Raise service disputes, damage follow-up, and report issues in one place.</p>
        </div>
        <Button variant="outline" onClick={() => void loadList()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Open a new case</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1.2fr_220px_auto]">
          <Input placeholder="Case title" value={createDraft.title} onChange={(event) => setCreateDraft((prev) => ({ ...prev, title: event.target.value }))} />
          <select className="h-10 rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={createDraft.severity} onChange={(event) => setCreateDraft((prev) => ({ ...prev, severity: event.target.value as Severity }))}>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <Button onClick={createCase} disabled={saving}>{saving ? "Submitting..." : "Submit case"}</Button>
          <div className="md:col-span-3">
            <Textarea rows={3} placeholder="Explain what happened, what you disagree with, or what follow-up is needed" value={createDraft.description} onChange={(event) => setCreateDraft((prev) => ({ ...prev, description: event.target.value }))} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle className="text-base">Your cases</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <select className="h-10 w-full rounded-xl border border-input/80 bg-white/80 px-3 text-sm" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="ALL">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RESOLVED">Resolved</option>
            </select>
            {loading ? <p className="py-8 text-sm text-muted-foreground">Loading cases...</p> : rows.length === 0 ? <p className="py-8 text-sm text-muted-foreground">No cases found.</p> : rows.map((row) => (
              <button key={row.id} type="button" className={`w-full rounded-xl border px-3 py-3 text-left transition ${selectedId === row.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`} onClick={() => setSelectedId(row.id)}>
                <div className="flex items-center justify-between gap-2"><p className="font-medium">{row.title}</p><Badge variant={badgeTone(row.status)}>{prettify(row.status)}</Badge></div>
                <p className="mt-1 text-xs text-muted-foreground">{prettify(row.caseType)} · {row.property?.name || row.job?.property?.name || "General case"}</p>
                <p className="mt-1 text-xs text-muted-foreground">Opened {formatDateTime(row.createdAt)}</p>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Case detail</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {loadingDetail ? <p className="py-8 text-sm text-muted-foreground">Loading case...</p> : !selected ? <p className="py-8 text-sm text-muted-foreground">Select a case to view updates.</p> : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold">{selected.title}</h3>
                    <p className="text-sm text-muted-foreground">{selected.property?.name || selected.job?.property?.name || "General case"}</p>
                  </div>
                  <Badge variant={badgeTone(selected.status)}>{prettify(selected.status)}</Badge>
                </div>
                <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                  <p><span className="font-medium text-foreground">Priority:</span> {selected.severity}</p>
                  <p><span className="font-medium text-foreground">Job ref:</span> {selected.job?.jobNumber || selected.job?.id || "-"}</p>
                  <p><span className="font-medium text-foreground">Opened:</span> {formatDateTime(selected.createdAt)}</p>
                  <p><span className="font-medium text-foreground">Updated:</span> {formatDateTime(selected.updatedAt)}</p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3 text-sm whitespace-pre-wrap">{selected.description || "No description provided."}</div>
                <div className="space-y-3 rounded-2xl border p-4">
                  <div><h4 className="font-semibold">Updates</h4><p className="text-xs text-muted-foreground">You will see public updates from admin here.</p></div>
                  {selected.comments.length === 0 ? <p className="text-sm text-muted-foreground">No updates yet.</p> : selected.comments.map((comment) => (
                    <div key={comment.id} className="rounded-xl border p-3">
                      <p className="text-xs text-muted-foreground">{authorLabel(comment.author)} · {formatDateTime(comment.createdAt)}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{comment.body}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-3 rounded-2xl border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div><h4 className="font-semibold">Evidence</h4><p className="text-xs text-muted-foreground">Upload photos, receipts, or other supporting files.</p></div>
                    <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">
                      <input type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addAttachment(file); event.currentTarget.value = ""; }} />
                      <Paperclip className="mr-2 h-4 w-4" />
                      {uploading ? "Uploading..." : "Attach file"}
                    </label>
                  </div>
                  {selected.attachments.length === 0 ? <p className="text-sm text-muted-foreground">No evidence uploaded yet.</p> : <div className="grid gap-2 md:grid-cols-2">{selected.attachments.map((attachment) => <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" className="rounded-xl border p-3 text-sm hover:bg-muted/50"><p className="font-medium">{attachment.label || attachment.mimeType || "Attachment"}</p><p className="text-xs text-muted-foreground">Added {formatDateTime(attachment.createdAt)}</p></a>)}</div>}
                </div>
                <div className="space-y-2 rounded-2xl border p-4">
                  <div><h4 className="font-semibold">Reply</h4><p className="text-xs text-muted-foreground">Reply to this case with more context or updated evidence.</p></div>
                  <Textarea rows={3} placeholder={selected.clientCanReply ? "Add your reply" : "Replies are disabled for this case"} value={reply} onChange={(event) => setReply(event.target.value)} disabled={!selected.clientCanReply} />
                  <div className="flex justify-end"><Button onClick={addReply} disabled={!selected.clientCanReply || replying}>{replying ? "Posting..." : "Add reply"}</Button></div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

