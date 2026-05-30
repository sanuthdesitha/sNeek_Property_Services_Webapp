"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Camera, CheckCircle2, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { MediaGallery } from "@/components/shared/media-gallery";
import { toast } from "@/hooks/use-toast";
import { isUploadFieldType } from "@/lib/forms/types";

export function QaJobClient({ jobId }: { jobId: string }) {
  const [payload, setPayload] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<Record<string, any>>({});
  const [notes, setNotes] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/qa/jobs/${jobId}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast({ title: "Could not load QA job", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    setPayload(body);
  }

  useEffect(() => {
    void load();
  }, [jobId]);

  const template = payload?.template;
  const job = payload?.job;
  const latestSubmission = job?.formSubmissions?.[0];
  const mediaItems = useMemo(
    () =>
      (latestSubmission?.media ?? []).map((item: any) => ({
        id: item.id,
        url: item.annotatedUrl || item.url,
        mediaType: item.mediaType,
        label: item.label || item.fieldId,
      })),
    [latestSubmission]
  );

  function setField(id: string, value: unknown) {
    setData((prev) => ({ ...prev, [id]: value }));
  }

  async function submit() {
    if (!template?.id) return;
    setSaving(true);
    const res = await fetch(`/api/qa/jobs/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignmentId: payload.assignment?.id ?? null,
        templateId: template.id,
        data,
        notes,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "QA submission failed", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    toast({ title: "QA submitted", description: `Score ${Math.round(body.review?.score ?? 0)}%.` });
    await load();
  }

  async function decideOverride(id: string, status: "APPROVED" | "DECLINED") {
    const res = await fetch(`/api/admin/media-overrides/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Override update failed", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    toast({ title: status === "APPROVED" ? "Upload-later approved" : "Upload-later declined" });
    await load();
  }

  if (loading) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading QA job...</CardContent></Card>;
  }
  if (!payload || !job) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">QA job not found.</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/qa"><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">QA inspection</p>
          <h1 className="truncate text-2xl font-semibold">{job.property?.name}</h1>
          <p className="text-sm text-muted-foreground">{job.property?.address}, {job.property?.suburb}</p>
        </div>
        <Badge variant={job.status === "COMPLETED" ? "success" : "warning"}>{String(job.status).replace(/_/g, " ")}</Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Cleaner submission evidence</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Submitted by {latestSubmission?.submittedBy?.name || latestSubmission?.submittedBy?.email || "Unknown"}.
              </p>
              {mediaItems.length > 0 ? (
                <MediaGallery items={mediaItems} />
              ) : (
                <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">No cleaner media was attached.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Tasks, laundry, and issues</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Job tasks</p>
                <p className="text-2xl font-semibold">{job.jobTasks?.length ?? 0}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Laundry status</p>
                <p className="text-sm font-semibold">{job.laundryTask?.status?.replace(/_/g, " ") ?? "No laundry task"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">Open cases/issues</p>
                <p className="text-2xl font-semibold">{job.issueTickets?.length ?? 0}</p>
              </div>
            </CardContent>
          </Card>

          {payload.mediaOverrides?.length > 0 ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Upload-later approvals</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {payload.mediaOverrides.map((item: any) => (
                  <div key={item.id} className="rounded-lg border p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold">{item.fieldLabel || item.fieldId}</p>
                        <p className="text-xs text-muted-foreground">{item.reason || "No reason supplied."}</p>
                        <p className="text-xs text-muted-foreground">
                          Requested by {item.requestedBy?.name || item.requestedBy?.email || "Cleaner"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={item.status === "APPROVED" ? "success" : item.status === "DECLINED" ? "destructive" : "warning"}>
                          {String(item.status).replace(/_/g, " ")}
                        </Badge>
                        {item.status === "PENDING" ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => void decideOverride(item.id, "DECLINED")}>Decline</Button>
                            <Button size="sm" onClick={() => void decideOverride(item.id, "APPROVED")}>Approve</Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="h-4 w-4 text-amber-500" />
              {template?.name ?? "QA form"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {(template?.schema?.sections ?? []).map((section: any) => (
              <div key={section.id} className="space-y-3">
                <p className="text-sm font-semibold">{section.label}</p>
                {(section.fields ?? []).map((field: any) => (
                  <div key={field.id} className="space-y-1.5">
                    {field.type === "rating" ? (
                      <>
                        <Label>{field.label}</Label>
                        <Input
                          type="number"
                          min={0}
                          max={field.max ?? 5}
                          value={data[field.id] ?? ""}
                          onChange={(event) => setField(field.id, Number(event.target.value || 0))}
                        />
                      </>
                    ) : field.type === "checkbox" ? (
                      <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                        <Checkbox checked={data[field.id] === true} onCheckedChange={(value) => setField(field.id, value === true)} />
                        {field.label}
                      </label>
                    ) : isUploadFieldType(field.type) ? (
                      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                        <Camera className="mb-2 h-4 w-4" />
                        QA photo upload uses the shared media uploader in the next pass. Add media references in notes for now.
                      </div>
                    ) : (
                      <>
                        <Label>{field.label}</Label>
                        <Textarea value={data[field.id] ?? ""} onChange={(event) => setField(field.id, event.target.value)} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}

            <div className="space-y-1.5">
              <Label>QA notes</Label>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Internal notes and follow-up instructions" />
            </div>

            <Button className="w-full" onClick={() => void submit()} disabled={saving}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {saving ? "Submitting..." : "Submit QA review"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
