"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Paperclip, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CaseAttachmentsGallery } from "@/components/cases/case-attachments-gallery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

type CaseStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type ClientCaseType = "DAMAGE" | "CLIENT_DISPUTE" | "LOST_FOUND" | "OTHER";

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

type RecentJob = {
  id: string;
  jobNumber?: string | null;
  jobType: string;
  scheduledDate: string;
  property: { id: string; name: string; suburb: string | null };
};

const CASE_TYPE_OPTIONS: Array<{
  value: ClientCaseType;
  title: string;
  description: string;
  severity: Severity;
  defaultTitle: string;
}> = [
  {
    value: "DAMAGE",
    title: "Something was damaged",
    description: "Report damaged items, breakages, or property issues that need follow-up.",
    severity: "HIGH",
    defaultTitle: "Damage reported",
  },
  {
    value: "CLIENT_DISPUTE",
    title: "I have a complaint",
    description: "Raise quality concerns, missing work, or service issues that need review.",
    severity: "MEDIUM",
    defaultTitle: "Client complaint",
  },
  {
    value: "LOST_FOUND",
    title: "I found / lost something",
    description: "Log items that were found, misplaced, or need matching with a booking.",
    severity: "MEDIUM",
    defaultTitle: "Lost or found item",
  },
  {
    value: "OTHER",
    title: "Other issue",
    description: "Use this when the issue does not fit the other case types.",
    severity: "MEDIUM",
    defaultTitle: "Service issue",
  },
];

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

async function uploadCaseFiles(files: File[]) {
  const uploaded: Array<{ s3Key: string; url: string | null; mimeType: string | null; label: string | null }> = [];
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", "cases");
    const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: form });
    const uploadBody = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || !uploadBody?.key) {
      throw new Error(uploadBody.error ?? `Could not upload ${file.name}.`);
    }
    uploaded.push({
      s3Key: uploadBody.key,
      url: uploadBody.url ?? null,
      mimeType: uploadBody.mimeType ?? file.type ?? null,
      label: file.name,
    });
  }
  return uploaded;
}

export function ClientCasesWorkspace() {
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replying, setReplying] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rows, setRows] = useState<ClientCase[]>([]);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<ClientCase | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [createStep, setCreateStep] = useState(1);
  const [createDraft, setCreateDraft] = useState<{
    caseType: ClientCaseType;
    title: string;
    description: string;
    severity: Severity;
    jobId: string;
    propertyId: string;
    attachments: File[];
  }>({
    caseType: "CLIENT_DISPUTE",
    title: "Client complaint",
    description: "",
    severity: "MEDIUM",
    jobId: "",
    propertyId: "",
    attachments: [],
  });
  const [reply, setReply] = useState("");

  const selectedCaseTypeMeta = useMemo(
    () => CASE_TYPE_OPTIONS.find((option) => option.value === createDraft.caseType) ?? CASE_TYPE_OPTIONS[1],
    [createDraft.caseType]
  );
  const selectedJob = useMemo(
    () => recentJobs.find((job) => job.id === createDraft.jobId) ?? null,
    [createDraft.jobId, recentJobs]
  );

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
        if (nextSelected) {
          setSelected(nextSelected);
        } else if (nextRows[0]?.id) {
          setSelectedId(nextRows[0].id);
          setSelected(nextRows[0]);
        } else {
          setSelectedId("");
          setSelected(null);
        }
      }
    } catch (error: any) {
      toast({ title: "Cases failed", description: error?.message ?? "Could not load cases.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function loadRecentJobs() {
    try {
      const res = await fetch("/api/client/jobs", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      if (!res.ok) throw new Error(body.error ?? "Could not load jobs.");
      const jobs = Array.isArray(body) ? body : [];
      setRecentJobs(
        jobs
          .slice()
          .sort((left: any, right: any) => new Date(right.scheduledDate).getTime() - new Date(left.scheduledDate).getTime())
          .slice(0, 10)
      );
    } catch {
      setRecentJobs([]);
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
    void loadRecentJobs();
  }, [statusFilter]);

  useEffect(() => {
    if (!selectedId) return;
    void loadCase(selectedId);
  }, [selectedId]);

  async function createCase() {
    if (!createDraft.description.trim()) {
      toast({ title: "Description required", variant: "destructive" });
      return;
    }
    if (createDraft.attachments.length > 3) {
      toast({ title: "Upload up to 3 photos", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const attachments = createDraft.attachments.length > 0 ? await uploadCaseFiles(createDraft.attachments) : [];
      const res = await fetch("/api/client/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: createDraft.title,
          description: createDraft.description.trim(),
          severity: createDraft.severity,
          caseType: createDraft.caseType,
          jobId: createDraft.jobId || null,
          propertyId: createDraft.propertyId || null,
          attachments,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create case.");
      const created = body as ClientCase;
      setCreateStep(1);
      setCreateDraft({
        caseType: "CLIENT_DISPUTE",
        title: "Client complaint",
        description: "",
        severity: "MEDIUM",
        jobId: "",
        propertyId: "",
        attachments: [],
      });
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
      const [uploaded] = await uploadCaseFiles([file]);
      const res = await fetch(`/api/client/cases/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(uploaded),
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

  function handleCreatePhotoSelection(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).slice(0, 3);
    setCreateDraft((prev) => ({ ...prev, attachments: files }));
  }

  function selectCaseType(value: ClientCaseType) {
    const nextType = CASE_TYPE_OPTIONS.find((option) => option.value === value) ?? CASE_TYPE_OPTIONS[1];
    setCreateDraft((prev) => ({
      ...prev,
      caseType: value,
      title: nextType.defaultTitle,
      severity: nextType.severity,
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Cases</h2>
          <p className="text-sm text-muted-foreground">Raise damage, complaints, or lost-and-found issues in one place.</p>
        </div>
        <Button variant="outline" onClick={() => void loadList()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open a new case</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant={createStep >= 1 ? "default" : "outline"}>1. What happened?</Badge>
            <Badge variant={createStep >= 2 ? "default" : "outline"}>2. Tell us more</Badge>
            <Badge variant={createStep >= 3 ? "default" : "outline"}>3. Which job?</Badge>
          </div>

          {createStep === 1 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {CASE_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`rounded-2xl border p-4 text-left transition ${createDraft.caseType === option.value ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                  onClick={() => selectCaseType(option.value)}
                >
                  <p className="font-semibold">{option.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                </button>
              ))}
            </div>
          ) : null}

          {createStep === 2 ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/20 p-3 text-sm">
                <p className="font-medium">{selectedCaseTypeMeta.title}</p>
                <p className="text-muted-foreground">{selectedCaseTypeMeta.description}</p>
              </div>
              <div className="space-y-1.5">
                <Label>Short title</Label>
                <Input
                  value={createDraft.title}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="Short case title"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Describe what happened</Label>
                <Textarea
                  rows={5}
                  placeholder="Tell us what happened, what you expected, and what follow-up you need."
                  value={createDraft.description}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, description: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Optional photos (up to 3)</Label>
                <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      handleCreatePhotoSelection(event.currentTarget.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <Paperclip className="mr-2 h-4 w-4" />
                  Choose photos
                </label>
                {createDraft.attachments.length > 0 ? (
                  <div className="rounded-xl border p-3">
                    <p className="text-xs text-muted-foreground">
                      {createDraft.attachments.map((file) => file.name).join(", ")}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {createStep === 3 ? (
            <div className="space-y-4">
              <div className="rounded-xl border bg-muted/20 p-3 text-sm">
                <p className="font-medium">Link a recent job if relevant</p>
                <p className="text-muted-foreground">This step is optional. Skip it if the issue is not tied to a specific visit.</p>
              </div>
              <select
                className="h-10 w-full rounded-xl border border-input/80 bg-white/80 px-3 text-sm"
                value={createDraft.jobId || "__none"}
                onChange={(event) => {
                  const value = event.target.value === "__none" ? "" : event.target.value;
                  const job = recentJobs.find((row) => row.id === value) ?? null;
                  setCreateDraft((prev) => ({
                    ...prev,
                    jobId: value,
                    propertyId: job?.property.id ?? "",
                  }));
                }}
              >
                <option value="__none">No specific job</option>
                {recentJobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {(job.jobNumber ? `Job ${job.jobNumber}` : prettify(job.jobType))} - {job.property.name} - {new Date(job.scheduledDate).toLocaleDateString("en-AU")}
                  </option>
                ))}
              </select>
              {selectedJob ? (
                <div className="rounded-xl border p-3 text-sm">
                  <p className="font-medium">{selectedJob.property.name}</p>
                  <p className="text-muted-foreground">
                    {selectedJob.property.suburb || "Property"} · {prettify(selectedJob.jobType)} · {new Date(selectedJob.scheduledDate).toLocaleDateString("en-AU")}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => setCreateStep((prev) => Math.max(1, prev - 1))} disabled={createStep === 1 || saving}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            {createStep < 3 ? (
              <Button
                onClick={() => {
                  if (createStep === 2 && !createDraft.description.trim()) {
                    toast({ title: "Description required", variant: "destructive" });
                    return;
                  }
                  setCreateStep((prev) => Math.min(3, prev + 1));
                }}
              >
                Next
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={createCase} disabled={saving}>
                {saving ? "Submitting..." : "Submit case"}
              </Button>
            )}
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
                    <div><h4 className="font-semibold">Evidence</h4><p className="text-xs text-muted-foreground">Upload photos or other supporting files.</p></div>
                    <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">
                      <input type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addAttachment(file); event.currentTarget.value = ""; }} />
                      <Paperclip className="mr-2 h-4 w-4" />
                      {uploading ? "Uploading..." : "Attach file"}
                    </label>
                  </div>
                  <CaseAttachmentsGallery
                    attachments={selected.attachments.map((attachment) => ({
                      id: attachment.id,
                      url: attachment.url,
                      label: attachment.label,
                      mimeType: attachment.mimeType,
                      meta: `Added ${formatDateTime(attachment.createdAt)}`,
                    }))}
                    emptyText="No evidence uploaded yet."
                  />
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
