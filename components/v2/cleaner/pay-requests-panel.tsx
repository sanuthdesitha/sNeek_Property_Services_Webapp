"use client";

/**
 * Estate cleaner extra-pay requests. Same endpoints + payloads as the live
 * workspace (components/cleaner/pay-requests-page.tsx):
 *   GET    /api/cleaner/pay-adjustments                → PayRequest[]
 *   POST   /api/cleaner/pay-adjustments  { scope, title, type, cleanerNote?,
 *            attachmentKeys[], jobId? | propertyId?, requestedHours?,
 *            requestedRate?, requestedAmount? }
 *   DELETE /api/cleaner/pay-adjustments?id=…           (withdraw pending)
 *   POST   /api/uploads/direct  (multipart file, folder=pay-adjustments)
 *
 * List renders status as an EBadge and the requested amount in the serif numeral
 * scale; the new-request form lives in an EModal. Evidence thumbnails open in
 * the shared MediaGallery overlay (in-page lightbox, never a new tab).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, HandCoins, Plus, Upload, X } from "lucide-react";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EModal } from "@/components/v2/admin/estate-kit";
import { EChip, EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { toast } from "@/hooks/use-toast";
import { MediaGallery } from "@/components/shared/media-gallery";

type Tone = "neutral" | "success" | "warning" | "danger";
interface JobOption {
  id: string;
  label: string;
}
interface PropertyOption {
  id: string;
  label: string;
}
type Attachment = { key: string; url: string; label: string };

function money(value: number | null | undefined) {
  return `$${Number(value ?? 0).toFixed(2)}`;
}
function formatDate(date: string | Date | null | undefined) {
  if (!date) return "";
  return format(toZonedTime(new Date(date), "Australia/Sydney"), "dd MMM yyyy");
}
function formatDateTime(date: string | Date | null | undefined) {
  if (!date) return "";
  return format(toZonedTime(new Date(date), "Australia/Sydney"), "dd MMM yyyy h:mm a");
}
const STATUS_TONE: Record<string, Tone> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

async function uploadPayRequestFile(file: File): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "pay-adjustments");
  const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Could not upload image.");
  return { key: String(body.key), url: String(body.url), label: file.name };
}

export function PayRequestsPanel({
  jobs,
  properties,
}: {
  jobs: JobOption[];
  properties: PropertyOption[];
}) {
  const [payRequests, setPayRequests] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "APPROVED" | "PENDING" | "REJECTED">("ALL");
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  // Form state
  const [scope, setScope] = useState<"JOB" | "PROPERTY" | "STANDALONE">("JOB");
  const [payJobId, setPayJobId] = useState<string>(jobs[0]?.id ?? "");
  const [propertyId, setPropertyId] = useState<string>(properties[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [payType, setPayType] = useState<"HOURLY" | "FIXED">("HOURLY");
  const [payHours, setPayHours] = useState("1");
  const [payRate, setPayRate] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  async function loadPayRequests() {
    setLoading(true);
    const res = await fetch("/api/cleaner/pay-adjustments", { cache: "no-store" });
    const body = await res.json().catch(() => []);
    setLoading(false);
    setPayRequests(Array.isArray(body) ? body : []);
  }

  useEffect(() => {
    void loadPayRequests();
  }, []);

  function resetForm() {
    setScope("JOB");
    setPayJobId(jobs[0]?.id ?? "");
    setPropertyId(properties[0]?.id ?? "");
    setTitle("");
    setPayType("HOURLY");
    setPayHours("1");
    setPayRate("");
    setPayAmount("");
    setPayNote("");
    setAttachments([]);
  }

  async function handleAttachmentSelection(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded: Attachment[] = [];
      for (const file of Array.from(files)) uploaded.push(await uploadPayRequestFile(file));
      setAttachments((prev) => [...prev, ...uploaded]);
      toast({ title: `${uploaded.length} image(s) uploaded` });
    } catch (error: any) {
      toast({ title: "Upload failed", description: error?.message ?? "Could not upload image.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function withdrawPayRequest(id: string) {
    if (!window.confirm("Withdraw this pending pay request? This cannot be undone.")) return;
    setWithdrawingId(id);
    const res = await fetch(`/api/cleaner/pay-adjustments?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const body = await res.json().catch(() => ({}));
    setWithdrawingId(null);
    if (!res.ok) {
      toast({ title: "Could not withdraw", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    toast({ title: "Request withdrawn" });
    await loadPayRequests();
  }

  async function submitPayRequest() {
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
      if (Number.isFinite(rate) && rate > 0) payload.requestedRate = rate;
    } else {
      const amount = Number(payAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast({ title: "Enter a valid fixed amount.", variant: "destructive" });
        return;
      }
      payload.requestedAmount = amount;
    }

    setSaving(true);
    const res = await fetch("/api/cleaner/pay-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Request failed", description: body.error ?? "Could not submit request.", variant: "destructive" });
      return;
    }
    toast({
      title: "Extra payment request submitted",
      description: "It is now Pending admin review and appears in the list.",
    });
    resetForm();
    setModalOpen(false);
    await loadPayRequests();
  }

  const filtered = useMemo(
    () => payRequests.filter((r: any) => statusFilter === "ALL" || r.status === statusFilter),
    [payRequests, statusFilter]
  );

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(["ALL", "APPROVED", "PENDING", "REJECTED"] as const).map((f) => {
            const count = f === "ALL" ? payRequests.length : payRequests.filter((r: any) => r.status === f).length;
            return (
              <EChip key={f} active={statusFilter === f} onClick={() => setStatusFilter(f)}>
                {(f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()) + ` (${count})`}
              </EChip>
            );
          })}
        </div>
        <EButton variant="gold" size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" /> New request
        </EButton>
      </div>

      {/* List */}
      {loading ? (
        <ECard>
          <ECardBody className="py-8 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Loading…
          </ECardBody>
        </ECard>
      ) : filtered.length === 0 ? (
        <EEmptyState
          eyebrow="Earnings"
          title={payRequests.length === 0 ? "No requests yet" : `No ${statusFilter.toLowerCase()} requests`}
          description="Submit job-linked, property, or standalone extra payment requests with evidence."
          action={
            <EButton variant="gold" size="sm" onClick={() => setModalOpen(true)}>
              <HandCoins className="h-4 w-4" /> New request
            </EButton>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((row: any) => {
            const scopeLabel =
              row.scope === "JOB"
                ? row.job?.property?.name ?? "Related job"
                : row.scope === "PROPERTY"
                ? row.property?.name ?? "Property"
                : "Standalone request";
            const gallery: Attachment[] = Array.isArray(row.attachmentUrls)
              ? row.attachmentUrls.map((item: any) => ({ key: item.key, url: item.url, label: item.key }))
              : [];
            return (
              <ECard key={row.id}>
                <ECardBody className="space-y-2.5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[0.9375rem] font-[550]">
                        {row.title || row.job?.property?.name || "Pay request"}
                      </p>
                      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {scopeLabel} · {row.type}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <EBadge tone={STATUS_TONE[row.status] ?? "neutral"} soft>
                        {row.status}
                      </EBadge>
                      <p className="e-numeral text-[1.25rem] leading-none">{money(row.requestedAmount)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {row.status === "APPROVED" ? <span>Approved: {money(row.approvedAmount)}</span> : null}
                    {row.job?.scheduledDate ? <span>Job date: {formatDate(row.job.scheduledDate)}</span> : null}
                    <span>Created: {formatDateTime(row.createdAt)}</span>
                  </div>

                  {row.cleanerNote ? (
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Note: {row.cleanerNote}</p>
                  ) : null}
                  {row.adminNote ? (
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Admin note: {row.adminNote}</p>
                  ) : null}

                  {row.job?.id ? (
                    <Link
                      href={`/v2/cleaner/jobs/${row.job.id}`}
                      className="inline-flex items-center gap-1 text-[0.75rem] font-[550] text-[hsl(var(--e-gold-ink))] hover:underline"
                    >
                      View related job{row.job.jobNumber ? ` #${row.job.jobNumber}` : ""}
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : row.scope === "STANDALONE" ? (
                    <p className="text-[0.75rem] italic text-[hsl(var(--e-text-faint))]">
                      Not linked to a job — shown as a separate line on your invoice.
                    </p>
                  ) : null}

                  {gallery.length > 0 ? (
                    <div className="pt-1">
                      <MediaGallery
                        items={gallery.map((g) => ({ id: g.key, url: g.url }))}
                        title="Pay request evidence"
                        className="grid grid-cols-4 gap-2 sm:grid-cols-6"
                      />
                    </div>
                  ) : null}

                  {row.status === "PENDING" ? (
                    <div className="flex justify-end pt-1">
                      <EButton
                        variant="outline"
                        size="sm"
                        className="text-[hsl(var(--e-danger))]"
                        disabled={withdrawingId === row.id}
                        onClick={() => void withdrawPayRequest(row.id)}
                      >
                        {withdrawingId === row.id ? "Withdrawing…" : "Withdraw request"}
                      </EButton>
                    </div>
                  ) : null}
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}

      {/* New request modal */}
      <EModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Extra payment request"
        eyebrow="New request"
        wide
      >
        <div className="space-y-4">
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Sent to admin straight away and shown as Pending until reviewed.
          </p>

          <EField label="Request scope">
            <ESelect value={scope} onChange={(e) => setScope(e.target.value as any)}>
              <option value="JOB">Related to a completed job</option>
              <option value="PROPERTY">Related to a property only</option>
              <option value="STANDALONE">Standalone request</option>
            </ESelect>
          </EField>

          {scope === "JOB" ? (
            <EField label="Job">
              <ESelect value={payJobId} onChange={(e) => setPayJobId(e.target.value)}>
                {jobs.length === 0 ? <option value="">No eligible jobs</option> : null}
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.label}
                  </option>
                ))}
              </ESelect>
            </EField>
          ) : null}

          {scope === "PROPERTY" ? (
            <EField label="Property">
              <ESelect value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.label}
                  </option>
                ))}
              </ESelect>
            </EField>
          ) : null}

          {scope === "STANDALONE" && properties.length > 0 ? (
            <EField label="Link to property (optional)">
              <ESelect
                value={propertyId || "__none__"}
                onChange={(e) => setPropertyId(e.target.value === "__none__" ? "" : e.target.value)}
              >
                <option value="__none__">No property</option>
                {properties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.label}
                  </option>
                ))}
              </ESelect>
            </EField>
          ) : null}

          <EField label="Request title">
            <EInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this request for?" />
          </EField>

          <EField label="Request type">
            <ESelect value={payType} onChange={(e) => setPayType(e.target.value as any)}>
              <option value="HOURLY">Hourly</option>
              <option value="FIXED">Fixed amount</option>
            </ESelect>
          </EField>

          {payType === "HOURLY" ? (
            <div className="grid grid-cols-2 gap-3">
              <EField label="Extra hours">
                <EInput
                  type="number"
                  min="0"
                  step="0.25"
                  value={payHours}
                  onChange={(e) => setPayHours(e.target.value)}
                />
              </EField>
              <EField label="Rate (optional if job linked)">
                <EInput
                  type="number"
                  min="0"
                  step="0.01"
                  value={payRate}
                  onChange={(e) => setPayRate(e.target.value)}
                />
              </EField>
            </div>
          ) : (
            <EField label="Amount">
              <EInput
                type="number"
                min="0"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </EField>
          )}

          <EField label="Reason">
            <ETextarea
              placeholder="Describe why this payment is requested"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
            />
          </EField>

          {/* Evidence */}
          <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[0.875rem] font-[550]">Image evidence</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Upload receipts or proof images if relevant.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] px-3 py-2 text-[0.75rem] font-[550] hover:bg-[hsl(var(--e-muted))]">
                <Upload className="h-3.5 w-3.5" />
                {uploading ? "Uploading…" : "Upload images"}
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
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <div
                    key={a.key}
                    className="relative h-16 w-16 overflow-hidden rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.url} alt={a.label} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label="Remove image"
                      onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                      className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center bg-[hsl(var(--e-danger))] text-[hsl(var(--e-danger-foreground))]"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No images added yet.</p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <EButton variant="outline" size="sm" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </EButton>
            <EButton
              variant="gold"
              size="sm"
              onClick={() => void submitPayRequest()}
              disabled={saving || uploading}
            >
              {saving ? "Submitting…" : "Submit request"}
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
