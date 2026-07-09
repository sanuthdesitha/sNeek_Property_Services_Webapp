"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FilePlus2,
  FileWarning,
  ShieldAlert,
  ShieldCheck,
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
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const now = Date.now();
  const expired = documents.filter((d) => docExpiryStatus(d.expiresAt, now) === "EXPIRED");
  const expiring = documents.filter((d) => docExpiryStatus(d.expiresAt, now) === "EXPIRING_SOON");
  const pending = documents.filter((d) => d.status === "PENDING");
  const attention = [...expired, ...expiring, ...pending.filter((d) => !expired.includes(d) && !expiring.includes(d))];

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

      <div className="flex justify-end">
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
              {attention.map((d) => {
                const st = docExpiryStatus(d.expiresAt, now);
                return (
                  <div key={d.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <EAvatar name={d.user.name} image={d.user.image} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.875rem] font-medium">
                        {d.title}
                        <span className="ml-2 text-[0.75rem] font-normal text-[hsl(var(--e-muted-foreground))]">
                          {d.user.name}
                        </span>
                      </p>
                      <p className="truncate text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                        {prettify(d.category)}
                        {d.expiresAt ? ` · expires ${new Date(d.expiresAt).toLocaleDateString("en-AU")}` : ""}
                      </p>
                    </div>
                    {st === "EXPIRED" ? <EBadge tone="danger" soft>Expired</EBadge> : null}
                    {st === "EXPIRING_SOON" ? <EBadge tone="warning" soft>Expiring</EBadge> : null}
                    <EBadge tone={docStatusTone(d.status)} soft>{prettify(d.status)}</EBadge>
                    <div className="flex items-center gap-1.5">
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
                        aria-label="Open document"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <EButton variant="outline" size="sm" onClick={() => setReviewDoc(d)}>
                        Review
                      </EButton>
                    </div>
                  </div>
                );
              })}
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
    </div>
  );
}
