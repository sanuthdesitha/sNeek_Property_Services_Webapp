"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FilePlus2,
  FileText,
  FileWarning,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import {
  EAlert,
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EStatCard,
} from "@/components/v2/ui/primitives";
import { EAvatar, EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { docExpiryStatus, docStatusTone, prettify } from "@/components/v2/admin/workforce/utils";

export type ComplianceDoc = {
  id: string;
  title: string;
  category: string;
  status: string;
  fileName: string;
  url: string;
  notes: string | null;
  expiresAt: string | null;
  createdAt: string;
  requiresSignature: boolean;
  user: { id: string; name: string; role: string; image: string | null };
  verifiedByName: string | null;
};

export type ComplianceRequest = {
  id: string;
  title: string;
  category: string;
  notes: string | null;
  dueAt: string | null;
  createdAt: string;
  user: { id: string; name: string };
  requestedByName: string | null;
};

export type ComplianceStaff = { id: string; name: string; role: string };

/**
 * One document, as it appears in both the attention list and the library.
 * Shared rather than copied: two renderings of the same row drift apart the
 * first time either gains a field, and the one nobody is looking at is the
 * one that goes stale.
 */
function ComplianceDocRow({
  doc,
  now,
  onReview,
}: {
  doc: ComplianceDoc;
  now: number;
  onReview: (doc: ComplianceDoc) => void;
}) {
  const st = docExpiryStatus(doc.expiresAt, now);
  return (
    <div className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
      <EAvatar name={doc.user.name} image={doc.user.image} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.875rem] font-medium">
          {doc.title}
          <span className="ml-2 text-[0.75rem] font-normal text-[hsl(var(--e-muted-foreground))]">
            {doc.user.name}
          </span>
        </p>
        <p className="truncate text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
          {prettify(doc.category)}
          {doc.expiresAt ? ` · expires ${new Date(doc.expiresAt).toLocaleDateString("en-AU")}` : ""}
          {doc.fileName ? ` · ${doc.fileName}` : ""}
        </p>
      </div>
      {st === "EXPIRED" ? (
        <EBadge tone="danger" soft>
          Expired
        </EBadge>
      ) : null}
      {st === "EXPIRING_SOON" ? (
        <EBadge tone="warning" soft>
          Expiring
        </EBadge>
      ) : null}
      <EBadge tone={docStatusTone(doc.status)} soft>
        {prettify(doc.status)}
      </EBadge>
      <div className="flex items-center gap-1.5">
        <a
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
          aria-label={`Open ${doc.title}`}
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <EButton variant="outline" size="sm" onClick={() => onReview(doc)}>
          Review
        </EButton>
      </div>
    </div>
  );
}

const CATEGORY_OPTIONS = [
  "POLICE_CHECK",
  "DRIVER_LICENCE",
  "COMPLIANCE",
  "TRAINING",
  "INSURANCE",
  "WORKING_RIGHTS",
  "OTHER",
];

async function postAction(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/admin/workforce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error ?? "Action failed." };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Network error." };
  }
}

export function ComplianceBoard({
  documents,
  requests,
  staff,
}: {
  documents: ComplianceDoc[];
  requests: ComplianceRequest[];
  staff: ComplianceStaff[];
}) {
  const router = useRouter();
  const [reviewDoc, setReviewDoc] = React.useState<ComplianceDoc | null>(null);
  const [requestOpen, setRequestOpen] = React.useState(false);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const now = Date.now();
  const expired = documents.filter((d) => docExpiryStatus(d.expiresAt, now) === "EXPIRED");
  const expiring = documents.filter((d) => docExpiryStatus(d.expiresAt, now) === "EXPIRING_SOON");
  const pending = documents.filter((d) => d.status === "PENDING");
  const attention = [...expired, ...expiring, ...pending.filter((d) => !expired.includes(d) && !expiring.includes(d))];

  // THE LIBRARY. Only `attention` was ever rendered, so a police check that
  // was uploaded, verified and still current — exactly the document an owner
  // opens this page to find — appeared nowhere at all. Everything needing
  // action still leads; this is the rest of the filing cabinet under it.
  const [query, setQuery] = React.useState("");
  const [categoryFilter, setCategoryFilter] = React.useState("ALL");
  const [statusFilter, setStatusFilter] = React.useState("ALL");

  const library = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents
      .filter((d) => (categoryFilter === "ALL" ? true : d.category === categoryFilter))
      .filter((d) => {
        if (statusFilter === "ALL") return true;
        if (statusFilter === "EXPIRED") return docExpiryStatus(d.expiresAt, now) === "EXPIRED";
        if (statusFilter === "EXPIRING_SOON")
          return docExpiryStatus(d.expiresAt, now) === "EXPIRING_SOON";
        return d.status === statusFilter;
      })
      .filter((d) =>
        needle
          ? [d.title, d.user.name, d.category, d.fileName]
              .join(" ")
              .toLowerCase()
              .includes(needle)
          : true
      )
      // Newest first: the question is almost always "what came in recently".
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [documents, query, categoryFilter, statusFilter, now]);

  // Review form state
  const [reviewStatus, setReviewStatus] = React.useState("VERIFIED");
  const [reviewExpiry, setReviewExpiry] = React.useState("");
  const [reviewNotes, setReviewNotes] = React.useState("");

  React.useEffect(() => {
    if (reviewDoc) {
      setReviewStatus(reviewDoc.status === "PENDING" ? "VERIFIED" : reviewDoc.status);
      setReviewExpiry(reviewDoc.expiresAt ? reviewDoc.expiresAt.slice(0, 10) : "");
      setReviewNotes(reviewDoc.notes ?? "");
      setError(null);
    }
  }, [reviewDoc]);

  // Request form state
  const [reqUser, setReqUser] = React.useState("");
  const [reqCategory, setReqCategory] = React.useState("POLICE_CHECK");
  const [reqTitle, setReqTitle] = React.useState("");
  const [reqNotes, setReqNotes] = React.useState("");
  const [reqDue, setReqDue] = React.useState("");

  // Filing a document the office was handed directly — a certificate brought in
  // on paper, or emailed. v1 could do this and v2 could not, so the only way to
  // get such a document on file was to ask the staff member to upload something
  // they had already given you.
  const [upUser, setUpUser] = React.useState("");
  const [upCategory, setUpCategory] = React.useState("POLICE_CHECK");
  const [upTitle, setUpTitle] = React.useState("");
  const [upNotes, setUpNotes] = React.useState("");
  const [upExpiry, setUpExpiry] = React.useState("");
  const [upRequestId, setUpRequestId] = React.useState("");
  const [upSignature, setUpSignature] = React.useState(false);
  const [upFile, setUpFile] = React.useState<File | null>(null);

  // Only the chosen person's outstanding asks. Offering the whole queue would
  // let an admin close somebody else's request with this document.
  const outstandingForUser = React.useMemo(
    () => requests.filter((r) => r.user.id === upUser),
    [requests, upUser]
  );

  React.useEffect(() => {
    if (uploadOpen) {
      setUpUser(staff[0]?.id ?? "");
      setUpCategory("POLICE_CHECK");
      setUpTitle("");
      setUpNotes("");
      setUpExpiry("");
      setUpRequestId("");
      setUpSignature(false);
      setUpFile(null);
      setError(null);
    }
  }, [uploadOpen, staff]);

  // Changing who it is for invalidates a request picked for the previous
  // person; without this the id survives the switch and closes their request.
  React.useEffect(() => {
    setUpRequestId("");
  }, [upUser]);

  React.useEffect(() => {
    if (requestOpen) {
      setReqUser(staff[0]?.id ?? "");
      setReqCategory("POLICE_CHECK");
      setReqTitle("");
      setReqNotes("");
      setReqDue("");
      setError(null);
    }
  }, [requestOpen, staff]);

  async function submitReview() {
    if (!reviewDoc) return;
    setBusy(true);
    setError(null);
    const res = await postAction({
      action: "REVIEW_DOCUMENT",
      documentId: reviewDoc.id,
      status: reviewStatus,
      notes: reviewNotes || null,
      expiresAt: reviewExpiry || null,
      requiresSignature: reviewDoc.requiresSignature,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not save review.");
      return;
    }
    setReviewDoc(null);
    router.refresh();
  }

  async function submitUpload() {
    if (!upUser || !upFile || !upTitle.trim()) {
      setError("Pick a team member, give it a title, and choose a file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Upload FIRST. Creating the row before the file exists would put a
      // document in the library whose link goes nowhere, and a broken link in a
      // compliance list reads as a lost certificate rather than a failed upload.
      const form = new FormData();
      form.append("file", upFile);
      form.append("folder", "staff-documents");
      const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const uploaded = await uploadRes.json().catch(() => ({}));
      if (!uploadRes.ok || !uploaded?.key) {
        setError(uploaded?.error ?? "Could not upload that file.");
        return;
      }

      const res = await postAction({
        action: "UPLOAD_DOCUMENT",
        userId: upUser,
        category: upCategory,
        title: upTitle.trim(),
        notes: upNotes || null,
        expiresAt: upExpiry || null,
        // Linking closes the outstanding ask. Without it the request sits on
        // the chase list forever, beside the document that answered it.
        requestId: upRequestId || null,
        requiresSignature: upSignature,
        fileName: upFile.name,
        s3Key: uploaded.key,
        url: uploaded.url,
        mimeType: uploaded.mimeType ?? upFile.type,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not save the document.");
        return;
      }
      setUploadOpen(false);
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not upload that file.");
    } finally {
      setBusy(false);
    }
  }

  async function submitRequest() {
    if (!reqUser || !reqTitle.trim()) {
      setError("Pick a team member and give the document a title.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await postAction({
      action: "REQUEST_DOCUMENT",
      userId: reqUser,
      category: reqCategory,
      title: reqTitle.trim(),
      notes: reqNotes || null,
      dueAt: reqDue || null,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Could not send request.");
      return;
    }
    setRequestOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <EStatCard label="Expired" value={String(expired.length)} icon={<ShieldAlert className="h-4 w-4" />} deltaTone="danger" delta={expired.length ? "Action needed" : "Clear"} />
        <EStatCard label="Expiring ≤14d" value={String(expiring.length)} icon={<Clock className="h-4 w-4" />} />
        <EStatCard label="Pending review" value={String(pending.length)} icon={<FileWarning className="h-4 w-4" />} />
        <EStatCard label="Outstanding requests" value={String(requests.length)} icon={<FilePlus2 className="h-4 w-4" />} />
      </section>

      <div className="flex justify-end gap-2">
        <EButton variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
          <UploadCloud className="h-4 w-4" />
          Upload for someone
        </EButton>
        <EButton variant="gold" size="sm" onClick={() => setRequestOpen(true)}>
          <FilePlus2 className="h-4 w-4" />
          Request a document
        </EButton>
      </div>

      {/* Attention list */}
      <ECard>
        <ECardHeader>
          <ECardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
            Documents needing action
          </ECardTitle>
        </ECardHeader>
        <ECardBody className="pt-0">
          {attention.length === 0 ? (
            <EEmptyState eyebrow="All clear" title="Every document is current" description="No expired, expiring or unreviewed uploads." />
          ) : (
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {attention.map((d) => (
                <ComplianceDocRow key={d.id} doc={d} now={now} onReview={setReviewDoc} />
              ))}
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* Every document on file — see the note beside `library` above. */}
      <ECard>
        <ECardHeader>
          <ECardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
            All documents on file
            <span className="text-[0.75rem] font-normal text-[hsl(var(--e-muted-foreground))]">
              {library.length} of {documents.length}
            </span>
          </ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-3 pt-0">
          <div className="flex flex-wrap gap-2">
            <EInput
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              placeholder="Search person, title or file…"
              className="min-w-[200px] flex-1"
            />
            <ESelect
              value={categoryFilter}
              onChange={(ev) => setCategoryFilter(ev.target.value)}
              className="w-auto"
            >
              <option value="ALL">All categories</option>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {prettify(c)}
                </option>
              ))}
            </ESelect>
            <ESelect
              value={statusFilter}
              onChange={(ev) => setStatusFilter(ev.target.value)}
              className="w-auto"
            >
              <option value="ALL">Any status</option>
              <option value="VERIFIED">Verified</option>
              <option value="PENDING">Pending review</option>
              <option value="REJECTED">Rejected</option>
              <option value="EXPIRING_SOON">Expiring soon</option>
              <option value="EXPIRED">Expired</option>
            </ESelect>
          </div>

          {library.length === 0 ? (
            <EEmptyState
              title="Nothing matches"
              description="No document on file matches those filters."
            />
          ) : (
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {library.map((d) => (
                <ComplianceDocRow key={d.id} doc={d} now={now} onReview={setReviewDoc} />
              ))}
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* Outstanding requests */}
      <ECard>
        <ECardHeader>
          <ECardTitle className="flex items-center gap-2">
            <FilePlus2 className="h-4 w-4 text-[hsl(var(--e-accent-portal))]" />
            Awaiting upload
          </ECardTitle>
        </ECardHeader>
        <ECardBody className="pt-0">
          {requests.length === 0 ? (
            <EEmptyState title="Nothing outstanding" description="Every requested document has been supplied." />
          ) : (
            <div className="divide-y divide-[hsl(var(--e-border))]">
              {requests.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <FileWarning className="h-4 w-4 text-[hsl(var(--e-warning))]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.875rem] font-medium">
                      {r.title}
                      <span className="ml-2 text-[0.75rem] font-normal text-[hsl(var(--e-muted-foreground))]">
                        {r.user.name}
                      </span>
                    </p>
                    <p className="truncate text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                      {prettify(r.category)}
                      {r.dueAt ? ` · due ${new Date(r.dueAt).toLocaleDateString("en-AU")}` : ""}
                      {r.requestedByName ? ` · by ${r.requestedByName}` : ""}
                    </p>
                  </div>
                  <EBadge tone="warning" soft>Requested</EBadge>
                </div>
              ))}
            </div>
          )}
        </ECardBody>
      </ECard>

      {/* Review modal */}
      <EModal open={Boolean(reviewDoc)} onClose={() => setReviewDoc(null)} title={reviewDoc?.title ?? "Review document"} eyebrow={reviewDoc?.user.name}>
        {reviewDoc ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
              <span className="truncate">{reviewDoc.fileName}</span>
              <a href={reviewDoc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[hsl(var(--e-gold-ink))]">
                Open <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
            <EField label="Decision">
              <ESelect value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)}>
                <option value="VERIFIED">Verify</option>
                <option value="REJECTED">Reject</option>
                <option value="PENDING">Keep pending</option>
                <option value="EXPIRED">Mark expired</option>
              </ESelect>
            </EField>
            <EField label="Expiry date" hint="Leave blank if the document does not expire.">
              <EInput type="date" value={reviewExpiry} onChange={(e) => setReviewExpiry(e.target.value)} />
            </EField>
            <EField label="Notes">
              <ETextarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} placeholder="Optional note for the record" />
            </EField>
            {error ? <EAlert tone="danger">{error}</EAlert> : null}
            <div className="flex justify-end gap-2">
              <EButton variant="outline" size="sm" onClick={() => setReviewDoc(null)} disabled={busy}>
                Cancel
              </EButton>
              <EButton variant="primary" size="sm" onClick={submitReview} disabled={busy}>
                <CheckCircle2 className="h-4 w-4" />
                {busy ? "Saving…" : "Save review"}
              </EButton>
            </div>
          </div>
        ) : null}
      </EModal>

      {/* Request modal */}
      <EModal open={requestOpen} onClose={() => setRequestOpen(false)} title="Request a document" eyebrow="Compliance">
        <div className="space-y-4">
          <EField label="Team member">
            <ESelect value={reqUser} onChange={(e) => setReqUser(e.target.value)}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {prettify(s.role)}
                </option>
              ))}
            </ESelect>
          </EField>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Category">
              <ESelect value={reqCategory} onChange={(e) => setReqCategory(e.target.value)}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {prettify(c)}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Due date">
              <EInput type="date" value={reqDue} onChange={(e) => setReqDue(e.target.value)} />
            </EField>
          </div>
          <EField label="Document title">
            <EInput value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} placeholder="e.g. Police check" />
          </EField>
          <EField label="Note to staff">
            <ETextarea value={reqNotes} onChange={(e) => setReqNotes(e.target.value)} placeholder="Optional instructions" />
          </EField>
          {error ? <EAlert tone="danger">{error}</EAlert> : null}
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setRequestOpen(false)} disabled={busy}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={submitRequest} disabled={busy}>
              {busy ? "Sending…" : "Send request"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Upload-on-behalf modal */}
      <EModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload a document for someone"
        eyebrow="Compliance"
      >
        <div className="space-y-4">
          <EField label="Team member">
            <ESelect value={upUser} onChange={(e) => setUpUser(e.target.value)}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {prettify(s.role)}
                </option>
              ))}
            </ESelect>
          </EField>
          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Category">
              <ESelect value={upCategory} onChange={(e) => setUpCategory(e.target.value)}>
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {prettify(c)}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField
              label="Expiry date"
              hint="Leave blank if it never expires — the expiry is what drives the reminders."
            >
              <EInput type="date" value={upExpiry} onChange={(e) => setUpExpiry(e.target.value)} />
            </EField>
          </div>
          <EField label="Document title">
            <EInput
              value={upTitle}
              onChange={(e) => setUpTitle(e.target.value)}
              placeholder="e.g. Police check"
            />
          </EField>
          {outstandingForUser.length > 0 ? (
            <EField
              label="Answers an outstanding request"
              hint="Linking it closes that request instead of leaving it on the chase list."
            >
              <ESelect value={upRequestId} onChange={(e) => setUpRequestId(e.target.value)}>
                <option value="">None</option>
                {outstandingForUser.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </ESelect>
            </EField>
          ) : null}
          <EField label="Notes">
            <ETextarea
              value={upNotes}
              onChange={(e) => setUpNotes(e.target.value)}
              placeholder="Where it came from, anything worth recording"
            />
          </EField>
          <label className="flex items-center gap-2 text-[0.8125rem]">
            <input
              type="checkbox"
              checked={upSignature}
              onChange={(e) => setUpSignature(e.target.checked)}
              className="h-3.5 w-3.5 accent-[hsl(var(--e-primary))]"
            />
            They must sign it once it is verified
          </label>
          <EField label="File">
            <input
              type="file"
              onChange={(e) => setUpFile(e.target.files?.[0] ?? null)}
              className="block w-full text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] file:mr-3 file:rounded-[var(--e-radius-sm,0.5rem)] file:border-0 file:bg-[hsl(var(--e-surface-raised))] file:px-3 file:py-1.5 file:text-[0.8125rem] file:text-[hsl(var(--e-foreground))]"
            />
          </EField>
          {error ? <EAlert tone="danger">{error}</EAlert> : null}
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setUploadOpen(false)} disabled={busy}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={submitUpload} disabled={busy}>
              {busy ? "Uploading…" : "Upload document"}
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
