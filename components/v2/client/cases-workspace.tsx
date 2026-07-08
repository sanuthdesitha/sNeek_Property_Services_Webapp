"use client";

/**
 * Estate cases & disputes workspace — same endpoints as the legacy client
 * cases page:
 *   GET   /api/client/cases[?status=]        → CaseView[]
 *   POST  /api/client/cases                   { title?, description, caseType, severity, jobId?, propertyId?, attachments }
 *   GET   /api/client/cases/[id]              → CaseView (with comments + attachments)
 *   PATCH /api/client/cases/[id]              { comment } | { s3Key, url, mimeType, label }
 *   POST  /api/uploads/direct                  FormData { file, folder: "cases" }
 * Styled purely with `--e-*` tokens. No v1 UI imports.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ArrowLeft,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Plus,
  RotateCw,
  Send,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  EEmptyState,
  EEyebrow,
  EThread,
} from "@/components/v2/ui/primitives";
import { ESelect, ETextarea, EInput } from "@/components/v2/admin/estate-kit";
import { EInlineNotice, ELabel } from "@/components/v2/client/fields";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "primary" | "gold" | "success" | "warning" | "danger" | "info";

type CaseComment = {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: { name: string | null; role?: string | null } | null;
};

type CaseAttachment = {
  id: string;
  url: string;
  label: string | null;
  mimeType: string | null;
  createdAt: string;
};

type CaseView = {
  id: string;
  title: string;
  description: string;
  status: string;
  caseType: string;
  severity: string;
  clientCanReply: boolean;
  createdAt: string;
  updatedAt: string;
  property: { name: string | null } | null;
  job: { id: string; jobType: string; scheduledDate: string } | null;
  comments?: CaseComment[];
  attachments?: CaseAttachment[];
};

type RecentJob = {
  id: string;
  jobNumber?: string | null;
  jobType: string;
  scheduledDate: string;
  property: { id: string; name: string; suburb: string | null };
};

/** Same case-type → default severity/title mapping the legacy workspace used. */
const CASE_TYPES: { value: string; label: string; severity: string; defaultTitle: string }[] = [
  { value: "CLIENT_DISPUTE", label: "Service issue / dispute", severity: "MEDIUM", defaultTitle: "Client complaint" },
  { value: "DAMAGE", label: "Damage", severity: "HIGH", defaultTitle: "Damage reported" },
  { value: "LOST_FOUND", label: "Lost or found item", severity: "MEDIUM", defaultTitle: "Lost or found item" },
  { value: "OTHER", label: "Something else", severity: "MEDIUM", defaultTitle: "Service issue" },
];

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

function statusTone(status: string): Tone {
  switch (status) {
    case "RESOLVED":
    case "CLOSED":
      return "success";
    case "IN_PROGRESS":
    case "IN_REVIEW":
      return "info";
    case "OPEN":
      return "warning";
    default:
      return "neutral";
  }
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ClientCasesWorkspace() {
  const [cases, setCases] = useState<CaseView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/client/cases", { cache: "no-store" });
      const body = await res.json().catch(() => []);
      if (!res.ok) throw new Error((body as any)?.error ?? "Could not load your cases.");
      setCases(Array.isArray(body) ? (body as CaseView[]) : []);
    } catch (err: any) {
      setLoadError(err?.message ?? "Could not load your cases.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (statusFilter === "ALL") return cases;
    if (statusFilter === "OPEN")
      return cases.filter((c) => !["RESOLVED", "CLOSED"].includes(c.status));
    return cases.filter((c) => ["RESOLVED", "CLOSED"].includes(c.status));
  }, [cases, statusFilter]);

  if (selectedId) {
    return (
      <CaseDetail
        caseId={selectedId}
        onBack={() => {
          setSelectedId(null);
          load();
        }}
      />
    );
  }

  if (creating) {
    return (
      <CaseCreate
        onCancel={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          load();
          if (id) setSelectedId(id);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ESelect
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-auto min-w-[160px]"
        >
          <option value="ALL">All cases</option>
          <option value="OPEN">Open</option>
          <option value="CLOSED">Resolved</option>
        </ESelect>
        <div className="flex items-center gap-2">
          {loadError ? (
            <EButton variant="outline" size="sm" onClick={load}>
              <RotateCw className="h-3.5 w-3.5" /> Retry
            </EButton>
          ) : null}
          <EButton variant="gold" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> Raise an issue
          </EButton>
        </div>
      </div>

      {loadError ? <EInlineNotice tone="danger">{loadError}</EInlineNotice> : null}

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your cases…
        </div>
      ) : filtered.length === 0 ? (
        <EEmptyState
          eyebrow="All clear"
          title="No cases to show"
          description="Raise an issue if something needs attention — damage, a dispute, or a lost item — and we'll track it here."
          action={
            <EButton variant="gold" size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> Raise an issue
            </EButton>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedId(c.id)}
              className="block w-full text-left"
            >
              <ECard className="transition-colors hover:border-[hsl(var(--e-border-strong))]">
                <ECardBody className="pt-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.9375rem] font-semibold truncate">{c.title}</p>
                      <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))] line-clamp-2">
                        {c.description || "No description provided."}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        <span>{titleCase(c.caseType)}</span>
                        {c.property?.name ? <span>· {c.property.name}</span> : null}
                        <span>· Opened {format(new Date(c.createdAt), "d MMM yyyy")}</span>
                      </div>
                    </div>
                    <EBadge tone={statusTone(c.status)} soft>
                      {titleCase(c.status)}
                    </EBadge>
                  </div>
                </ECardBody>
              </ECard>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CaseCreate({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string | null) => void;
}) {
  const [caseType, setCaseType] = useState("CLIENT_DISPUTE");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [jobId, setJobId] = useState("");
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/client/jobs", { cache: "no-store" });
        const body = await res.json().catch(() => []);
        if (!res.ok || !Array.isArray(body)) return;
        if (cancelled) return;
        setRecentJobs(
          body
            .slice()
            .sort(
              (left: any, right: any) =>
                new Date(right.scheduledDate).getTime() - new Date(left.scheduledDate).getTime()
            )
            .slice(0, 10)
        );
      } catch {
        // job linking stays optional if the list fails
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const typeMeta = CASE_TYPES.find((t) => t.value === caseType) ?? CASE_TYPES[0];
  const selectedJob = recentJobs.find((job) => job.id === jobId) ?? null;

  async function submit() {
    if (!description.trim()) {
      setError("Please describe the issue.");
      return;
    }
    if (files.length > 3) {
      setError("Upload up to 3 photos.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const attachments = files.length > 0 ? await uploadCaseFiles(files) : [];
      const res = await fetch("/api/client/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          caseType,
          title: title.trim() || typeMeta.defaultTitle,
          description: description.trim(),
          severity: typeMeta.severity,
          jobId: jobId || null,
          propertyId: selectedJob?.property.id ?? null,
          attachments,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not raise the case.");
      onCreated(body?.id ?? null);
    } catch (err: any) {
      setError(err?.message ?? "Could not raise the case.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ECard variant="ceremony">
      <ECardBody className="space-y-4 pt-5">
        <div className="flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
          <EEyebrow>Raise an issue</EEyebrow>
        </div>

        <div className="space-y-1.5">
          <ELabel>Type</ELabel>
          <ESelect value={caseType} onChange={(e) => setCaseType(e.target.value)}>
            {CASE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </ESelect>
        </div>

        <div className="space-y-1.5">
          <ELabel htmlFor="case-title">Title (optional)</ELabel>
          <EInput
            id="case-title"
            value={title}
            maxLength={180}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary"
          />
        </div>

        <div className="space-y-1.5">
          <ELabel htmlFor="case-desc">What happened?</ELabel>
          <ETextarea
            id="case-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            placeholder="Describe the issue with as much detail as you can — property, dates, and what you'd like us to do."
          />
        </div>

        <div className="space-y-1.5">
          <ELabel htmlFor="case-job">Link a recent job (optional)</ELabel>
          <ESelect id="case-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">No specific job</option>
            {recentJobs.map((job) => (
              <option key={job.id} value={job.id}>
                {(job.jobNumber ? `Job ${job.jobNumber}` : titleCase(job.jobType))} — {job.property.name} —{" "}
                {new Date(job.scheduledDate).toLocaleDateString("en-AU")}
              </option>
            ))}
          </ESelect>
          {selectedJob ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {selectedJob.property.name}
              {selectedJob.property.suburb ? ` · ${selectedJob.property.suburb}` : ""} ·{" "}
              {titleCase(selectedJob.jobType)}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <ELabel htmlFor="case-photos">Optional photos (up to 3)</ELabel>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] transition-colors hover:border-[hsl(var(--e-gold))]">
            <Paperclip className="h-4 w-4" />
            Choose photos
            <input
              id="case-photos"
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                setFiles(Array.from(event.currentTarget.files ?? []).slice(0, 3));
                event.currentTarget.value = "";
              }}
            />
          </label>
          {files.length > 0 ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {files.map((file) => file.name).join(", ")}
            </p>
          ) : null}
        </div>

        {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}

        <div className="flex justify-end gap-2">
          <EButton variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </EButton>
          <EButton variant="gold" size="sm" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {busy ? "Submitting…" : "Submit case"}
          </EButton>
        </div>
      </ECardBody>
    </ECard>
  );
}

function CaseDetail({ caseId, onBack }: { caseId: string; onBack: () => void }) {
  const [item, setItem] = useState<CaseView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/cases/${caseId}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as any)?.error ?? "Could not load this case.");
      setItem(body as CaseView);
    } catch (err: any) {
      setError(err?.message ?? "Could not load this case.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/cases/${caseId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: reply.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not send your reply.");
      setReply("");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not send your reply.");
    } finally {
      setSending(false);
    }
  }

  async function attachEvidence(file: File) {
    setUploading(true);
    setError(null);
    try {
      const [uploaded] = await uploadCaseFiles([file]);
      const res = await fetch(`/api/client/cases/${caseId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(uploaded),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not attach the file.");
      setItem(body as CaseView);
    } catch (err: any) {
      setError(err?.message ?? "Could not attach the file.");
    } finally {
      setUploading(false);
    }
  }

  const comments = Array.isArray(item?.comments) ? item!.comments : [];
  const attachments = Array.isArray(item?.attachments) ? item!.attachments : [];

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))] hover:underline"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All cases
      </button>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading case…
        </div>
      ) : !item ? (
        <EInlineNotice tone="danger">{error ?? "Case not found."}</EInlineNotice>
      ) : (
        <>
          <ECard variant="ceremony">
            <ECardBody className="space-y-3 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <EEyebrow>{titleCase(item.caseType)}</EEyebrow>
                  <p className="e-display-sm mt-1">{item.title}</p>
                </div>
                <EBadge tone={statusTone(item.status)} soft>
                  {titleCase(item.status)}
                </EBadge>
              </div>
              <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
                {item.description || "No description provided."}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                {item.property?.name ? <span>{item.property.name}</span> : null}
                <span>Opened {format(new Date(item.createdAt), "d MMM yyyy HH:mm")}</span>
              </div>
            </ECardBody>
          </ECard>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <EEyebrow>Evidence</EEyebrow>
              {item.clientCanReply !== false ? (
                <label
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-1.5 text-[0.8125rem] font-medium text-[hsl(var(--e-gold-ink))] hover:underline",
                    uploading && "pointer-events-none opacity-60"
                  )}
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  {uploading ? "Uploading…" : "Attach evidence"}
                  <input
                    type="file"
                    accept="image/*,video/*,application/pdf"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void attachEvidence(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              ) : null}
            </div>
            {attachments.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                No files attached yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {attachments.map((att) => {
                  const isImage = (att.mimeType ?? "").startsWith("image/");
                  return (
                    <a
                      key={att.id}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-1.5 pr-3 text-[0.75rem] transition-colors hover:border-[hsl(var(--e-border-strong))]"
                    >
                      {isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={att.url}
                          alt={att.label ?? "Attachment"}
                          className="h-12 w-12 rounded-[var(--e-radius-sm)] object-cover"
                        />
                      ) : (
                        <span className="flex h-12 w-12 items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-muted))]">
                          <Paperclip className="h-4 w-4 text-[hsl(var(--e-muted-foreground))]" />
                        </span>
                      )}
                      <span className="max-w-[10rem] truncate text-[hsl(var(--e-text-secondary))] group-hover:text-[hsl(var(--e-foreground))]">
                        {att.label ?? "Attachment"}
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <EEyebrow>Conversation</EEyebrow>
            {comments.length === 0 ? (
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                No messages yet. Add a note below and the team will follow up.
              </p>
            ) : (
              <div className="space-y-2.5">
                {comments.map((c) => {
                  const fromTeam = (c.author?.role ?? "").toUpperCase() !== "CLIENT";
                  return (
                    <div
                      key={c.id}
                      className={cn(
                        "rounded-[var(--e-radius)] border p-3",
                        fromTeam
                          ? "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]"
                          : "border-[hsl(var(--e-gold)/0.4)] bg-[hsl(var(--e-gold-soft))]"
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                        <span className="font-semibold uppercase tracking-[0.1em]">
                          {fromTeam ? c.author?.name ?? "Ops team" : "You"}
                        </span>
                        <span>{format(new Date(c.createdAt), "d MMM HH:mm")}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-[0.875rem]">{c.body}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {item.clientCanReply !== false ? (
            <ECard>
              <ECardBody className="space-y-2 pt-5">
                <ELabel htmlFor="case-reply">Add a reply</ELabel>
                <ETextarea
                  id="case-reply"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                  placeholder="Write a message to the ops team…"
                />
                {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}
                <div className="flex justify-end">
                  <EButton variant="gold" size="sm" onClick={sendReply} disabled={sending || !reply.trim()}>
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {sending ? "Sending…" : "Send reply"}
                  </EButton>
                </div>
              </ECardBody>
            </ECard>
          ) : (
            <EThread />
          )}
        </>
      )}
    </div>
  );
}
