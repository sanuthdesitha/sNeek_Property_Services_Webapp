"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { format } from "date-fns";
import { Plus, Save, FileText, Download, RefreshCcw, BarChart3, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ChecklistsWorkspace } from "@/components/forms/checklists-workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MediaGallery } from "@/components/shared/media-gallery";
import { isUploadFieldType } from "@/lib/forms/field-types";
import { toast } from "@/hooks/use-toast";
import { downloadFromApi } from "@/lib/client/download";


type SubmissionTemplateField = {
  id: string;
  label: string;
  type: string;
};

function isInternalSubmissionKey(key: string) {
  return key.startsWith("__");
}

function cloneSubmissionData(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return JSON.parse(JSON.stringify(input));
}

export default function FormsPage() {
  const { data: session } = useSession();
  const [templates, setTemplates] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [viewSubmission, setViewSubmission] = useState<any>(null);
  const [submissionEditMode, setSubmissionEditMode] = useState(false);
  const [submissionDraft, setSubmissionDraft] = useState<Record<string, any>>({});
  const [submissionMediaDraft, setSubmissionMediaDraft] = useState<any[]>([]);
  const [submissionSaving, setSubmissionSaving] = useState(false);
  const [submissionUploading, setSubmissionUploading] = useState(false);
  const [submissionLaundryReady, setSubmissionLaundryReady] = useState<boolean | null>(null);
  const [submissionLaundryOutcome, setSubmissionLaundryOutcome] = useState("");
  const [submissionBagLocation, setSubmissionBagLocation] = useState("");
  const [activeTab, setActiveTab] = useState("builder");
  const [generatingJobId, setGeneratingJobId] = useState<string | null>(null);

  // Deep-link support: /admin/checklists now redirects here with ?tab=checklists.
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab === "checklists" || tab === "submissions" || tab === "builder") setActiveTab(tab);
  }, []);


  async function loadTemplates() {
    const res = await fetch("/api/admin/form-templates");
    const data = await res.json();
    setTemplates(Array.isArray(data) ? data : []);
  }

  async function loadSubmissions() {
    setSubmissionsLoading(true);
    const res = await fetch("/api/admin/form-submissions");
    const data = await res.json();
    setSubmissions(Array.isArray(data) ? data : []);
    setSubmissionsLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    loadTemplates().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab !== "submissions") return;
    if (submissions.length > 0) return;
    loadSubmissions();
  }, [activeTab]);

  async function generateAndDownload(jobId: string) {
    setGeneratingJobId(jobId);
    try {
      await downloadFromApi(`/api/reports/${jobId}/download`, `job-report-${jobId}.pdf`);
      toast({ title: "Report downloaded" });
    } catch (error: any) {
      toast({
        title: "Download failed",
        description: error?.message ?? "Could not download report.",
        variant: "destructive",
      });
    } finally {
      setGeneratingJobId(null);
    }
  }

  async function openSubmission(submission: any) {
    setSubmissionEditMode(false);
    setSubmissionDraft(cloneSubmissionData(submission?.data));
    setSubmissionMediaDraft(Array.isArray(submission?.media) ? submission.media : []);
    setSubmissionLaundryReady(typeof submission?.laundryReady === "boolean" ? submission.laundryReady : null);
    setSubmissionLaundryOutcome(submission?.laundryOutcome ?? "");
    setSubmissionBagLocation(submission?.bagLocation ?? "");
    setViewSubmission(submission);
  }

  async function saveSubmissionChanges() {
    if (!viewSubmission?.id) return;
    setSubmissionSaving(true);
    try {
      const res = await fetch(`/api/admin/form-submissions/${viewSubmission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: submissionDraft,
          laundryReady: submissionLaundryReady,
          laundryOutcome: submissionLaundryOutcome || null,
          bagLocation: submissionBagLocation || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save submission changes.");
      setViewSubmission(body);
      setSubmissionDraft(cloneSubmissionData(body?.data));
      setSubmissionMediaDraft(Array.isArray(body?.media) ? body.media : []);
      setSubmissionEditMode(false);
      await loadSubmissions();
      toast({ title: "Submission updated", description: "The report will refresh in the background." });
    } catch (error: any) {
      toast({ title: "Save failed", description: error?.message ?? "Could not update submission.", variant: "destructive" });
    } finally {
      setSubmissionSaving(false);
    }
  }

  async function deleteSubmissionMedia(mediaId: string) {
    if (!viewSubmission?.id) return;
    setSubmissionSaving(true);
    try {
      const res = await fetch(`/api/admin/form-submissions/${viewSubmission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteMediaIds: [mediaId] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not delete media.");
      setViewSubmission(body);
      setSubmissionMediaDraft(Array.isArray(body?.media) ? body.media : []);
      await loadSubmissions();
      toast({ title: "Media removed" });
    } catch (error: any) {
      toast({ title: "Delete failed", description: error?.message ?? "Could not remove media.", variant: "destructive" });
    } finally {
      setSubmissionSaving(false);
    }
  }

  async function uploadSubmissionMedia(files: FileList | null) {
    if (!viewSubmission?.id || !files?.length) return;
    setSubmissionUploading(true);
    try {
      const uploaded: Array<{ url: string; s3Key: string; fieldId: string; mimeType: string | null; label: string | null }> = [];
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("folder", "submission-edits");
        const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: form });
        const uploadBody = await uploadRes.json().catch(() => ({}));
        if (!uploadRes.ok || !uploadBody?.key) {
          throw new Error(uploadBody.error ?? `Could not upload ${file.name}.`);
        }
        uploaded.push({
          url: uploadBody.url,
          s3Key: uploadBody.key,
          fieldId: "admin_edit",
          mimeType: uploadBody.mimeType ?? file.type ?? null,
          label: file.name,
        });
      }

      const res = await fetch(`/api/admin/form-submissions/${viewSubmission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addMediaUrls: uploaded }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not attach media.");
      setViewSubmission(body);
      setSubmissionMediaDraft(Array.isArray(body?.media) ? body.media : []);
      await loadSubmissions();
      toast({ title: "Media added" });
    } catch (error: any) {
      toast({ title: "Upload failed", description: error?.message ?? "Could not upload media.", variant: "destructive" });
    } finally {
      setSubmissionUploading(false);
    }
  }

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => a.name.localeCompare(b.name)),
    [templates]
  );
  const submissionFields = useMemo<SubmissionTemplateField[]>(() => {
    const sections = Array.isArray(viewSubmission?.template?.schema?.sections)
      ? viewSubmission.template.schema.sections
      : [];
    return sections.flatMap((section: any): SubmissionTemplateField[] =>
      Array.isArray(section?.fields)
        ? section.fields.map((field: any): SubmissionTemplateField => ({
            id: String(field?.id ?? ""),
            label: String(field?.label ?? field?.id ?? "Field"),
            type: String(field?.type ?? "text"),
          }))
        : []
    );
  }, [viewSubmission]);

  if (loading) {
    return <div className="py-10 text-sm text-muted-foreground">Loading form templates...</div>;
  }

  if (session?.user?.role !== "ADMIN" && session?.user?.primaryRole !== "ADMIN") {
    return <Link href="/v2/admin/forms">View form templates and submissions</Link>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<FileText />}
        title="Forms"
        description="Form templates, checklists and submission review. Templates open in the form builder."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/v2/admin/forms?tab=stats">
                <BarChart3 className="mr-2 h-4 w-4" />
                Statistics
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/v2/admin/forms/new">
                <Plus className="mr-2 h-4 w-4" />
                New Template
              </Link>
            </Button>
          </>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="builder">Builder</TabsTrigger>
          <TabsTrigger value="checklists">
            <ListChecks className="mr-1.5 h-3.5 w-3.5" /> Checklists
          </TabsTrigger>
          <TabsTrigger value="submissions">Submissions ({submissions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="checklists" className="space-y-4">
          <ChecklistsWorkspace />
        </TabsContent>

        <TabsContent value="builder" className="space-y-4">
          {/* The form builder lives at /v2/admin/forms/[id]/edit (drafts, versions,
              publish checks). This list only opens it; nothing here writes a form. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Form templates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Forms are edited in the form builder, which saves drafts and publishes them as versions.
              </p>
              <Button asChild size="sm">
                <Link href="/v2/admin/forms/new">
                  <Plus className="mr-2 h-4 w-4" />
                  New template
                </Link>
              </Button>
              <ul className="divide-y rounded-md border">
                {templates.map((template) => (
                  <li key={template.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 break-words">
                      {template.name} <span className="text-muted-foreground">· {String(template.serviceType).replace(/_/g, " ")}</span>
                    </span>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/v2/admin/forms/${template.id}/edit`}>Open in builder</Link>
                    </Button>
                  </li>
                ))}
                {templates.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">No live templates.</li> : null}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="submissions" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Submitted Forms</CardTitle>
              <Button variant="outline" size="sm" onClick={loadSubmissions} disabled={submissionsLoading}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                {submissionsLoading ? "Loading..." : "Refresh"}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {submissionsLoading ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">Loading submissions...</p>
                ) : null}
                {submissions.map((submission) => (
                  <div key={submission.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">
                        {submission.job?.property?.name} - {submission.template?.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {submission.template?.serviceType?.replace(/_/g, " ")} - Submitted by{" "}
                        {submission.submittedBy?.name ?? submission.submittedBy?.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(submission.createdAt), "dd MMM yyyy HH:mm")} - Media: {submission.media?.length ?? 0}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={submission.laundryReady ? "default" : "secondary"}>
                        Laundry {submission.laundryReady ? "Ready" : "Not ready"}
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => openSubmission(submission)}>
                        <FileText className="mr-1 h-4 w-4" />
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={generatingJobId === submission.jobId}
                        onClick={() => generateAndDownload(submission.jobId)}
                      >
                        <Download className="mr-1 h-4 w-4" />
                        {generatingJobId === submission.jobId ? "Generating..." : "PDF"}
                      </Button>
                    </div>
                  </div>
                ))}
                {!submissionsLoading && submissions.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">No form submissions yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={Boolean(viewSubmission)}
        onOpenChange={() => {
          setViewSubmission(null);
          setSubmissionEditMode(false);
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submission Detail</DialogTitle>
          </DialogHeader>
          {viewSubmission && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-sm">
                  <p>
                    <strong>Property:</strong> {viewSubmission.job?.property?.name}
                  </p>
                  <p>
                    <strong>Template:</strong> {viewSubmission.template?.name}
                  </p>
                  <p>
                    <strong>Submitted:</strong> {format(new Date(viewSubmission.createdAt), "dd MMM yyyy HH:mm")}
                  </p>
                </div>
                <div className="flex gap-2">
                  {submissionEditMode ? (
                    <>
                      <Button variant="outline" onClick={() => openSubmission(viewSubmission)} disabled={submissionSaving}>
                        Cancel
                      </Button>
                      <Button onClick={saveSubmissionChanges} disabled={submissionSaving}>
                        {submissionSaving ? "Saving..." : "Save changes"}
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" onClick={() => setSubmissionEditMode(true)}>
                      Edit
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-3 rounded-md border p-4">
                <p className="text-xs font-medium text-muted-foreground">Checklist answers</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {submissionFields
                    .filter((field) => field.id && !isInternalSubmissionKey(field.id))
                    .map((field) => {
                      const value = submissionDraft[field.id];
                      const isBooleanField = field.type === "checkbox";
                      const isNumberField = field.type === "number";
                      const isLongField = field.type === "textarea";
                      const isLockedMediaField = isUploadFieldType(field.type) || field.type === "signature";
                      return (
                        <div key={field.id} className="space-y-1.5 rounded-md border p-3">
                          <Label>{field.label}</Label>
                          {submissionEditMode ? (
                            isBooleanField ? (
                              <label className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                                <span>{value === true ? "Checked" : "Unchecked"}</span>
                                <Switch
                                  checked={value === true}
                                  onCheckedChange={(checked) => setSubmissionDraft((current) => ({ ...current, [field.id]: checked }))}
                                />
                              </label>
                            ) : isLongField ? (
                              <Textarea
                                rows={3}
                                value={typeof value === "string" ? value : value === undefined || value === null ? "" : JSON.stringify(value, null, 2)}
                                onChange={(event) => setSubmissionDraft((current) => ({ ...current, [field.id]: event.target.value }))}
                              />
                            ) : isLockedMediaField ? (
                              <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                                Manage this field via the media section below.
                              </div>
                            ) : (
                              <Input
                                type={isNumberField ? "number" : "text"}
                                value={value === undefined || value === null ? "" : String(value)}
                                onChange={(event) =>
                                  setSubmissionDraft((current) => ({
                                    ...current,
                                    [field.id]: isNumberField ? Number(event.target.value || 0) : event.target.value,
                                  }))
                                }
                              />
                            )
                          ) : (
                            <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                              {typeof value === "boolean"
                                ? value
                                  ? "Yes"
                                  : "No"
                                : value === undefined || value === null || value === ""
                                  ? "-"
                                  : typeof value === "object"
                                    ? JSON.stringify(value)
                                    : String(value)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Laundry ready</Label>
                  {submissionEditMode ? (
                    <Select
                      value={submissionLaundryReady === null ? "unset" : submissionLaundryReady ? "yes" : "no"}
                      onValueChange={(value) =>
                        setSubmissionLaundryReady(value === "unset" ? null : value === "yes")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unset">Not set</SelectItem>
                        <SelectItem value="yes">Ready</SelectItem>
                        <SelectItem value="no">Not ready</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
                      {submissionLaundryReady === null ? "-" : submissionLaundryReady ? "Ready" : "Not ready"}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Laundry outcome</Label>
                  {submissionEditMode ? (
                    <Input value={submissionLaundryOutcome} onChange={(event) => setSubmissionLaundryOutcome(event.target.value)} />
                  ) : (
                    <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">{viewSubmission.laundryOutcome || "-"}</div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label>Bag location</Label>
                  {submissionEditMode ? (
                    <Input value={submissionBagLocation} onChange={(event) => setSubmissionBagLocation(event.target.value)} />
                  ) : (
                    <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">{viewSubmission.bagLocation || "-"}</div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Submission Media</p>
                  {submissionEditMode ? (
                    <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm">
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          void uploadSubmissionMedia(event.target.files);
                          event.currentTarget.value = "";
                        }}
                      />
                      {submissionUploading ? "Uploading..." : "Add photos"}
                    </label>
                  ) : null}
                </div>
                {submissionEditMode ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    {submissionMediaDraft.map((media: any) => (
                      <div key={media.id} className="space-y-2 rounded-md border p-2">
                        {media.mediaType === "VIDEO" ? (
                          <video src={media.url} className="h-32 w-full rounded-md object-cover" controls />
                        ) : (
                          <img src={media.url} alt={media.label || media.fieldId} className="h-32 w-full rounded-md object-cover" />
                        )}
                        <p className="text-xs text-muted-foreground">{media.fieldId}</p>
                        <Button size="sm" variant="destructive" onClick={() => deleteSubmissionMedia(media.id)} disabled={submissionSaving}>
                          Delete
                        </Button>
                      </div>
                    ))}
                    {submissionMediaDraft.length === 0 ? <p className="text-sm text-muted-foreground">No uploaded media.</p> : null}
                  </div>
                ) : (
                  <MediaGallery
                    items={(submissionMediaDraft ?? []).map((m: any) => ({
                      id: m.id,
                      url: m.url,
                      label: `${m.fieldId} (${m.mediaType})`,
                      mediaType: m.mediaType,
                    }))}
                    emptyText="No uploaded media"
                    title="Submission Media"
                  />
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Report Preview</p>
                <div className="h-[65vh] overflow-hidden rounded-md border">
                  <iframe
                    title="Report preview"
                    src={`/api/reports/${viewSubmission.jobId}/download?format=html`}
                    className="h-full w-full bg-white"
                  />
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
