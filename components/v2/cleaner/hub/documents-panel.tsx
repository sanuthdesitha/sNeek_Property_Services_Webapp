"use client";

/**
 * Native Estate DOCUMENTS panel for the v2 cleaner team hub.
 *
 * Wires the SAME endpoints the v1 `staff-workforce-hub` documents tab uses:
 *   - Documents + requests: `GET /api/me/workforce` → `data.documents` / `data.documentRequests`
 *   - View: open `doc.url` in a new tab
 *   - Sign / acknowledge: `POST /api/me/workforce` { action: "SIGN_DOCUMENT", documentId }
 *
 * Sign is only offered when `doc.requiresSignature && doc.status === "VERIFIED"`
 * (matches v1 + the service guard). A confirm checkbox gates the action.
 *
 * Upload parity with v1: multipart POST /api/uploads/direct (file + folder
 * "staff-documents") → POST /api/me/workforce { action: "UPLOAD_DOCUMENT",
 * category, title, notes, expiresAt, requestId, requiresSignature, fileName,
 * s3Key, url, mimeType } — the exact payload the v1 hub sends.
 *
 * All UI is native Estate. No v1 UI imports.
 */
import * as React from "react";
import { FileCheck2, AlertTriangle, ExternalLink, PenLine, ShieldCheck, UploadCloud, Loader2 } from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState, EAlert } from "@/components/v2/ui/primitives";
import { ECheckbox, EField, EInput, ESelect, ETextarea, EFileButton } from "@/components/v2/cleaner/fields";
import { EModal } from "@/components/v2/admin/estate-kit";
import type { WorkforceAction } from "@/components/v2/cleaner/hub/learning-panel";

const DOC_CATEGORIES = ["POLICE_CHECK", "DRIVERS_LICENCE", "WHITE_CARD", "CV", "INSURANCE", "OTHER"];

async function uploadPrivateFile(file: File, folder: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.key) throw new Error(body.error ?? "Upload failed.");
  return body as { key: string; url: string; mimeType?: string | null };
}

interface StaffDocument {
  id: string;
  title: string;
  category: string;
  status: string; // PENDING | VERIFIED | SIGNED | REJECTED | EXPIRED
  fileName?: string | null;
  url: string;
  notes?: string | null;
  expiresAt?: string | null;
  requiresSignature?: boolean;
  signedAt?: string | null;
  expiryStatus?: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | string | null;
}
interface DocumentRequest {
  id: string;
  title: string;
  status: string; // REQUESTED | FULFILLED
  category?: string | null;
  notes?: string | null;
  fulfilledDocument?: { id: string; title: string } | null;
}

function statusTone(status: string): "success" | "danger" | "warning" | "neutral" {
  if (status === "VERIFIED" || status === "SIGNED") return "success";
  if (status === "REJECTED" || status === "EXPIRED") return "danger";
  if (status === "PENDING") return "warning";
  return "neutral";
}

export function DocumentsPanel({
  documents,
  documentRequests,
  runAction,
  reload,
}: {
  documents: StaffDocument[];
  documentRequests: DocumentRequest[];
  runAction: WorkforceAction;
  reload: () => Promise<void>;
}) {
  const [signingDoc, setSigningDoc] = React.useState<StaffDocument | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Upload form — same fields + UPLOAD_DOCUMENT payload as v1.
  const [docFile, setDocFile] = React.useState<File | null>(null);
  const [docForm, setDocForm] = React.useState({
    category: "POLICE_CHECK",
    title: "",
    notes: "",
    expiresAt: "",
    requestId: "",
    requiresSignature: false,
  });
  const [uploading, setUploading] = React.useState(false);
  const [uploadNotice, setUploadNotice] = React.useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const expiring = documents.filter((d) => d.expiryStatus === "EXPIRING_SOON" || d.expiryStatus === "EXPIRED");

  async function uploadDocument() {
    if (!docFile || !docForm.title.trim() || uploading) return;
    setUploading(true);
    setUploadNotice(null);
    try {
      const upload = await uploadPrivateFile(docFile, "staff-documents");
      await runAction({
        action: "UPLOAD_DOCUMENT",
        ...docForm,
        fileName: docFile.name,
        s3Key: upload.key,
        url: upload.url,
        mimeType: upload.mimeType ?? docFile.type,
      });
      setDocFile(null);
      setDocForm({ category: "POLICE_CHECK", title: "", notes: "", expiresAt: "", requestId: "", requiresSignature: false });
      setUploadNotice({ tone: "success", text: "Document uploaded — admin will review and verify it." });
      await reload();
    } catch (e: any) {
      setUploadNotice({ tone: "danger", text: e?.message || "Could not upload document." });
    } finally {
      setUploading(false);
    }
  }

  function selectRequest(requestId: string) {
    if (!requestId) {
      setDocForm((current) => ({ ...current, requestId: "" }));
      return;
    }
    const request = documentRequests.find((item) => item.id === requestId);
    setDocForm((current) => ({
      ...current,
      requestId,
      category: request?.category ?? current.category,
      title: request?.title ?? current.title,
      notes: request?.notes ?? current.notes,
    }));
  }

  async function sign() {
    if (!signingDoc || !confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await runAction({ action: "SIGN_DOCUMENT", documentId: signingDoc.id });
      setSigningDoc(null);
      setConfirmed(false);
      await reload();
    } catch (e: any) {
      setError(e?.message || "Could not sign document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}

      {/* Upload — licences, police checks, CVs, certifications */}
      <ECard>
        <ECardBody className="space-y-3 pt-6">
          <p className="e-eyebrow flex items-center gap-1.5">
            <UploadCloud className="h-3.5 w-3.5" /> Upload document
          </p>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Keep licences, police checks, CVs, and certifications in one place. Admin verifies each upload.
          </p>
          {uploadNotice ? (
            <EAlert tone={uploadNotice.tone}>{uploadNotice.text}</EAlert>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {documentRequests.length > 0 ? (
              <EField label="Requested document" hint="Pick a request to fulfil it directly.">
                <ESelect value={docForm.requestId} onChange={(e) => selectRequest(e.target.value)}>
                  <option value="">None</option>
                  {documentRequests.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </ESelect>
              </EField>
            ) : null}
            <EField label="Category">
              <ESelect
                value={docForm.category}
                onChange={(e) => setDocForm((current) => ({ ...current, category: e.target.value }))}
              >
                {DOC_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Title">
              <EInput
                value={docForm.title}
                placeholder="e.g. Police check 2026"
                onChange={(e) => setDocForm((current) => ({ ...current, title: e.target.value }))}
              />
            </EField>
            <EField label="Expiry date" hint="You'll be reminded before it lapses.">
              <EInput
                type="date"
                value={docForm.expiresAt}
                onChange={(e) => setDocForm((current) => ({ ...current, expiresAt: e.target.value }))}
              />
            </EField>
          </div>
          <EField label="Notes">
            <ETextarea
              value={docForm.notes}
              placeholder="Anything admin should know about this document"
              onChange={(e) => setDocForm((current) => ({ ...current, notes: e.target.value }))}
            />
          </EField>
          <label className="flex cursor-pointer items-center gap-2 text-[0.875rem]">
            <ECheckbox
              checked={docForm.requiresSignature}
              onChange={(e) => setDocForm((current) => ({ ...current, requiresSignature: e.target.checked }))}
            />
            This document requires my signature after admin review
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <EFileButton accept="*/*" disabled={uploading} onFiles={(files) => setDocFile(files?.[0] ?? null)}>
              <UploadCloud className="h-4 w-4" /> {docFile ? "Change file" : "Choose file"}
            </EFileButton>
            {docFile ? (
              <span className="max-w-[16rem] truncate text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                {docFile.name}
              </span>
            ) : null}
            <EButton
              size="sm"
              disabled={!docFile || !docForm.title.trim() || uploading}
              onClick={() => void uploadDocument()}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />} Upload
            </EButton>
          </div>
        </ECardBody>
      </ECard>

      {expiring.length > 0 ? (
        <EAlert tone="warning" title={`${expiring.length} document(s) need attention`}>
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Renew anything marked expiring soon or expired to stay compliant.
          </span>
        </EAlert>
      ) : null}

      {documentRequests.length > 0 ? (
        <ECard>
          <ECardBody className="space-y-3 pt-6">
            <p className="e-eyebrow">Requests from admin</p>
            {documentRequests.map((r) => (
              <div key={r.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[0.875rem] font-[550]">{r.title}</p>
                  <EBadge tone={r.status === "FULFILLED" ? "success" : "warning"} soft>{r.status}</EBadge>
                </div>
                <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                  {r.notes || "Awaiting your upload/verification."}
                </p>
                {r.fulfilledDocument ? (
                  <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-success))]">Fulfilled by: {r.fulfilledDocument.title}</p>
                ) : null}
              </div>
            ))}
          </ECardBody>
        </ECard>
      ) : null}

      {documents.length === 0 ? (
        <EEmptyState eyebrow="Documents" title="No documents on file" description="Your compliance documents will appear here." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {documents.map((doc) => {
            const canSign = doc.requiresSignature && doc.status === "VERIFIED";
            return (
              <ECard key={doc.id} variant={canSign ? "ceremony" : "default"}>
                <ECardBody className="space-y-2 pt-6">
                  <div className="flex items-start gap-2">
                    <FileCheck2 className="mt-0.5 h-4 w-4 text-[hsl(var(--e-muted-foreground))]" />
                    <p className="min-w-0 flex-1 text-[0.9375rem] font-[550]">{doc.title}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <EBadge tone="neutral">{doc.category.replace(/_/g, " ")}</EBadge>
                    <EBadge tone={statusTone(doc.status)} soft>{doc.status}</EBadge>
                    {doc.expiryStatus === "EXPIRING_SOON" ? <EBadge tone="warning" soft>Expiring soon</EBadge> : null}
                    {doc.expiryStatus === "EXPIRED" ? <EBadge tone="danger" soft>Expired</EBadge> : null}
                    {doc.requiresSignature ? (
                      <EBadge tone="info" soft>
                        <span className="inline-flex items-center gap-1"><PenLine className="h-3 w-3" /> Signature</span>
                      </EBadge>
                    ) : null}
                    {doc.status === "SIGNED" ? (
                      <EBadge tone="success" soft>
                        <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Signed</span>
                      </EBadge>
                    ) : null}
                  </div>
                  {doc.fileName ? <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">{doc.fileName}</p> : null}
                  {doc.expiresAt ? (
                    <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Expires {String(doc.expiresAt).slice(0, 10)}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <EButton asChild variant="outline" size="sm">
                      <a href={doc.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" /> View
                      </a>
                    </EButton>
                    {canSign ? (
                      <EButton size="sm" onClick={() => { setSigningDoc(doc); setConfirmed(false); setError(null); }}>
                        <PenLine className="h-4 w-4" /> Sign
                      </EButton>
                    ) : null}
                  </div>
                </ECardBody>
              </ECard>
            );
          })}
        </div>
      )}

      {/* Sign / acknowledge modal */}
      <EModal
        open={!!signingDoc}
        onClose={() => { if (!busy) { setSigningDoc(null); setConfirmed(false); } }}
        eyebrow="Acknowledge & sign"
        title={signingDoc?.title || "Sign document"}
      >
        <div className="space-y-4">
          <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">
            Review the document first, then confirm you have read and understood it. Signing is recorded against your account.
          </p>
          {signingDoc ? (
            <EButton asChild variant="outline" size="sm">
              <a href={signingDoc.url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> Open document
              </a>
            </EButton>
          ) : null}
          <label className="flex cursor-pointer items-center gap-2 text-[0.875rem]">
            <ECheckbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I confirm I have read and understood this document.
          </label>
          {error ? <p className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <EButton variant="ghost" size="sm" disabled={busy} onClick={() => { setSigningDoc(null); setConfirmed(false); }}>
              Cancel
            </EButton>
            <EButton size="sm" disabled={!confirmed || busy} onClick={() => void sign()}>
              <PenLine className="h-4 w-4" /> Confirm signature
            </EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
