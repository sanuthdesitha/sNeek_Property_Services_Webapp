"use client";

import { useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MediaGallery } from "@/components/shared/media-gallery";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

interface JobOption {
  id: string;
  label: string;
}

interface PropertyOption {
  id: string;
  label: string;
}

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

async function uploadPayRequestFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "pay-adjustments");
  const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Could not upload image.");
  return {
    key: String(body.key),
    url: String(body.url),
    label: file.name,
  };
}

export function CleanerPayRequestsPage({
  jobs,
  properties,
}: {
  jobs: JobOption[];
  properties: PropertyOption[];
}) {
  const [payRequests, setPayRequests] = useState<any[]>([]);
  const [loadingPayRequests, setLoadingPayRequests] = useState(false);
  const [savingPayRequest, setSavingPayRequest] = useState(false);
  const [scope, setScope] = useState<"JOB" | "PROPERTY" | "STANDALONE">("JOB");
  const [payJobId, setPayJobId] = useState<string>(jobs[0]?.id ?? "");
  const [propertyId, setPropertyId] = useState<string>(properties[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [payType, setPayType] = useState<"HOURLY" | "FIXED">("HOURLY");
  const [payHours, setPayHours] = useState("1");
  const [payRate, setPayRate] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [extraPaymentRequired, setExtraPaymentRequired] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ key: string; url: string; label: string }>>([]);
  const [uploading, setUploading] = useState(false);

  async function loadPayRequests() {
    setLoadingPayRequests(true);
    const res = await fetch("/api/cleaner/pay-adjustments");
    const body = await res.json().catch(() => []);
    setLoadingPayRequests(false);
    setPayRequests(Array.isArray(body) ? body : []);
  }

  useEffect(() => {
    loadPayRequests();
  }, []);

  async function handleAttachmentSelection(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded: Array<{ key: string; url: string; label: string }> = [];
      for (const file of Array.from(files)) {
        uploaded.push(await uploadPayRequestFile(file));
      }
      setAttachments((prev) => [...prev, ...uploaded]);
      toast({ title: `${uploaded.length} image(s) uploaded` });
    } catch (error: any) {
      toast({ title: "Upload failed", description: error?.message ?? "Could not upload image.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function submitPayRequest() {
    if (!extraPaymentRequired) {
      toast({ title: "Select extra payment required first.", variant: "destructive" });
      return;
    }
    if (!title.trim()) {
      toast({ title: "Request title is required.", variant: "destructive" });
      return;
    }
    if (scope === "JOB" && !payJobId) {
      toast({ title: "Select a related job.", variant: "destructive" });
      return;
    }
    if (scope === "PROPERTY" && !propertyId) {
      toast({ title: "Select a property.", variant: "destructive" });
      return;
    }

    const payload: Record<string, unknown> = {
      scope,
      title: title.trim(),
      type: payType,
      cleanerNote: payNote.trim() || undefined,
      attachmentKeys: attachments.map((item) => item.key),
    };

    if (scope === "JOB") payload.jobId = payJobId;
    if (scope === "PROPERTY") payload.propertyId = propertyId;
    if (scope === "STANDALONE" && propertyId) payload.propertyId = propertyId;

    if (payType === "HOURLY") {
      const hours = Number(payHours || 0);
      const rate = Number(payRate || 0);
      if (!Number.isFinite(hours) || hours <= 0) {
        toast({ title: "Enter valid hours.", variant: "destructive" });
        return;
      }
      payload.requestedHours = hours;
      if (Number.isFinite(rate) && rate > 0) {
        payload.requestedRate = rate;
      }
    } else {
      const amount = Number(payAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast({ title: "Enter a valid fixed amount.", variant: "destructive" });
        return;
      }
      payload.requestedAmount = amount;
    }

    setSavingPayRequest(true);
    const res = await fetch("/api/cleaner/pay-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSavingPayRequest(false);
    if (!res.ok) {
      toast({ title: "Request failed", description: body.error ?? "Could not submit request.", variant: "destructive" });
      return;
    }

    setTitle("");
    setPayNote("");
    setPayAmount("");
    setPayHours("1");
    setPayRate("");
    setAttachments([]);
    setExtraPaymentRequired(false);
    setPropertyId(properties[0]?.id ?? "");
    toast({ title: "Extra payment request submitted" });
    await loadPayRequests();
  }

  const mediaItems = useMemo(
    () =>
      attachments.map((item) => ({
        id: item.key,
        url: item.url,
        label: item.label,
        mediaType: "PHOTO" as const,
      })),
    [attachments]
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Extra Payment Requests</h1>
        <p className="text-sm text-muted-foreground">
          Submit job-linked, property-based, or standalone extra payment requests with notes and image evidence.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Submit Request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
            <Checkbox
              checked={extraPaymentRequired}
              onCheckedChange={(checked) => setExtraPaymentRequired(checked === true)}
            />
            Extra payment required
          </label>

          {!extraPaymentRequired ? (
            <p className="text-xs text-muted-foreground">
              Select the option above to reveal and submit a request.
            </p>
          ) : (
            <>
              <div>
                <Label className="text-xs text-muted-foreground">Request scope</Label>
                <Select value={scope} onValueChange={(value) => setScope(value as "JOB" | "PROPERTY" | "STANDALONE")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="JOB">Related to a completed job</SelectItem>
                    <SelectItem value="PROPERTY">Related to a property only</SelectItem>
                    <SelectItem value="STANDALONE">Standalone request</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {scope === "JOB" ? (
                <div>
                  <Label className="text-xs text-muted-foreground">Job</Label>
                  <Select value={payJobId} onValueChange={setPayJobId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select job" />
                    </SelectTrigger>
                    <SelectContent>
                      {jobs.map((job) => (
                        <SelectItem key={job.id} value={job.id}>
                          {job.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {scope === "PROPERTY" ? (
                <div>
                  <Label className="text-xs text-muted-foreground">Property</Label>
                  <Select value={propertyId} onValueChange={setPropertyId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select property" />
                    </SelectTrigger>
                    <SelectContent>
                      {properties.map((property) => (
                        <SelectItem key={property.id} value={property.id}>
                          {property.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {scope === "STANDALONE" && properties.length > 0 ? (
                <div>
                  <Label className="text-xs text-muted-foreground">Link to property (optional)</Label>
                  <Select value={propertyId || "__none__"} onValueChange={(v) => setPropertyId(v === "__none__" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="No property linked" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No property</SelectItem>
                      {properties.map((property) => (
                        <SelectItem key={property.id} value={property.id}>
                          {property.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div>
                <Label className="text-xs text-muted-foreground">Request title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this request for?" />
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Request type</Label>
                <Select value={payType} onValueChange={(value) => setPayType(value as "HOURLY" | "FIXED")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="HOURLY">Hourly</SelectItem>
                    <SelectItem value="FIXED">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {payType === "HOURLY" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" min="0" step="0.25" value={payHours} onChange={(e) => setPayHours(e.target.value)} placeholder="Extra hours" />
                  <Input type="number" min="0" step="0.01" value={payRate} onChange={(e) => setPayRate(e.target.value)} placeholder="Rate (optional if job linked)" />
                </div>
              ) : (
                <Input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="Amount" />
              )}

              <Textarea placeholder="Describe why this payment is requested" value={payNote} onChange={(e) => setPayNote(e.target.value)} />

              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Image evidence</p>
                    <p className="text-xs text-muted-foreground">Upload receipts or proof images if relevant.</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted">
                    <Upload className="h-3.5 w-3.5" />
                    {uploading ? "Uploading..." : "Upload images"}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        void handleAttachmentSelection(e.target.files);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                {mediaItems.length > 0 ? (
                  <MediaGallery items={mediaItems} title="Pay request evidence" className="grid grid-cols-2 gap-2 md:grid-cols-3" />
                ) : (
                  <p className="text-xs text-muted-foreground">No images added yet.</p>
                )}
              </div>

              <Button onClick={submitPayRequest} disabled={savingPayRequest || uploading} className="w-full">
                {savingPayRequest ? "Submitting..." : "Submit Extra Payment Request"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">My Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingPayRequests ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : payRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <div className="space-y-3">
              {payRequests.map((row: any) => {
                const scopeLabel =
                  row.scope === "JOB"
                    ? row.job?.property?.name ?? "Related job"
                    : row.scope === "PROPERTY"
                    ? row.property?.name ?? "Property"
                    : "Standalone request";
                const galleryItems = Array.isArray(row.attachmentUrls)
                  ? row.attachmentUrls.map((item: any) => ({
                      id: item.key,
                      url: item.url,
                      label: item.key,
                      mediaType: "PHOTO" as const,
                    }))
                  : [];
                return (
                  <div key={row.id} className="rounded border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{row.title || row.job?.property?.name || "Pay request"}</p>
                        <p className="text-xs text-muted-foreground">
                          {scopeLabel} | {row.type}
                        </p>
                      </div>
                      <Badge
                        variant={
                          row.status === "PENDING"
                            ? ("warning" as any)
                            : row.status === "APPROVED"
                            ? "success"
                            : "destructive"
                        }
                      >
                        {row.status}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Requested: {money(row.requestedAmount)}
                      {row.status === "APPROVED" ? ` | Approved: ${money(row.approvedAmount)}` : ""}
                    </p>
                    {row.cleanerNote ? <p className="mt-1 text-xs text-muted-foreground">Note: {row.cleanerNote}</p> : null}
                    {row.adminNote ? <p className="mt-1 text-xs text-muted-foreground">Admin note: {row.adminNote}</p> : null}
                    {galleryItems.length > 0 ? (
                      <div className="mt-3">
                        <MediaGallery items={galleryItems} title="Pay request evidence" className="grid grid-cols-2 gap-2 md:grid-cols-3" />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
