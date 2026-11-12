"use client";

/**
 * Documents tab: visa / licence / rego dates, the staff documents on file
 * (each opens in a new tab), documents requested and not yet uploaded, and an
 * upload through the existing workforce flow (file to /api/uploads/direct
 * first, then UPLOAD_DOCUMENT on /api/admin/workforce), shown only to a viewer
 * the workforce endpoint accepts. Review and requests stay in Compliance.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import type { PersonCapabilities, PersonProfile } from "@/lib/accounts/person-types";
import { formatDate } from "../hub/account-display";
import { STAFF_DOCUMENT_CATEGORIES } from "@/lib/accounts/required-documents";

// The same categories the Compliance board offers.
const CATEGORIES = STAFF_DOCUMENT_CATEGORIES;

type UploadDraft = { title: string; category: string; expiresAt: string; requestId: string; file: File | null };
const EMPTY_UPLOAD: UploadDraft = { title: "", category: "COMPLIANCE", expiresAt: "", requestId: "", file: null };

function prettify(value: string): string {
  return value.replace(/_/g, " ").toLowerCase();
}

function UploadForm({ profile, onDone }: { profile: PersonProfile; onDone: () => void }) {
  const [draft, setDraft] = useState<UploadDraft>(EMPTY_UPLOAD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(EMPTY_UPLOAD);
    setError(null);
  }, [profile.id]);

  async function submit() {
    if (!draft.file || !draft.title.trim()) return setError("Give it a title and choose a file.");
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", draft.file);
      form.append("folder", "staff-documents");
      const uploadRes = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const uploaded = (await uploadRes.json().catch(() => ({}))) as { key?: string; url?: string; mimeType?: string; error?: string };
      if (!uploadRes.ok || !uploaded.key) throw new Error(uploaded.error ?? "Could not upload that file.");
      const res = await fetch("/api/admin/workforce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPLOAD_DOCUMENT",
          userId: profile.id,
          category: draft.category,
          title: draft.title.trim(),
          expiresAt: draft.expiresAt || null,
          requestId: draft.requestId || null,
          fileName: draft.file.name,
          s3Key: uploaded.key,
          url: uploaded.url,
          mimeType: uploaded.mimeType ?? draft.file.type,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "The file uploaded but the document could not be saved. Try again.");
      setDraft(EMPTY_UPLOAD);
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not upload that file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2">
      <summary className="cursor-pointer text-[0.8125rem] font-[550]">Upload a document</summary>
      <fieldset disabled={busy} className="mt-2 grid gap-2.5 sm:grid-cols-2">
        <EField label="Title"><EInput value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></EField>
        <EField label="Category">
          <ESelect value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{prettify(c)}</option>)}
          </ESelect>
        </EField>
        <EField label="Expires" hint="Optional."><EInput type="date" value={draft.expiresAt} onChange={(e) => setDraft({ ...draft, expiresAt: e.target.value })} /></EField>
        {profile.missingDocuments.length > 0 ? (
          <EField label="Answers request">
            <ESelect value={draft.requestId} onChange={(e) => setDraft({ ...draft, requestId: e.target.value })}>
              <option value="">None</option>
              {profile.missingDocuments.map((request) => <option key={request.id} value={request.id}>{request.title}</option>)}
            </ESelect>
          </EField>
        ) : null}
        <EField label="File" className="sm:col-span-2"><EInput type="file" onChange={(e) => setDraft({ ...draft, file: e.target.files?.[0] ?? null })} /></EField>
        {error ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))] sm:col-span-2">{error}</p> : null}
        <div className="sm:col-span-2"><EButton size="sm" variant="primary" onClick={submit}>{busy ? "Uploading…" : "Upload"}</EButton></div>
      </fieldset>
    </details>
  );
}

/** Each required type for this person's roles: present / expiring / expired / missing. */
function RequiredDocuments({ profile }: { profile: PersonProfile }) {
  if (!profile.requiredDocumentsReadable) {
    return <p role="alert" className="text-[hsl(var(--e-danger))]">The required documents setting could not be read, so nothing here is checked against it. Fix it in Settings → Required documents.</p>;
  }
  if (profile.requiredDocuments.length === 0) return null;
  return (
    <ul aria-label="Required documents" className="space-y-1.5 border-b border-[hsl(var(--e-border))] pb-2.5">
      {profile.requiredDocuments.map((item) => (
        <li key={item.category} className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{item.label} <span className="text-[hsl(var(--e-muted-foreground))]">· required</span></span>
          {item.expiresOn ? <span className="text-[hsl(var(--e-muted-foreground))]">{formatDate(item.expiresOn)}</span> : null}
          {item.state === "MISSING" ? <EPill tone="bad">Missing</EPill>
            : item.state === "EXPIRED" ? <EPill tone="bad">Expired</EPill>
            : item.state === "EXPIRING" ? <EPill tone="warn">{item.daysRemaining === 0 ? "Expires today" : `${item.daysRemaining} d left`}</EPill>
            : <EPill tone="ok">On file</EPill>}
        </li>
      ))}
    </ul>
  );
}

export function DocumentsSection({ profile, caps, onChanged }: { profile: PersonProfile; caps: PersonCapabilities; onChanged: () => void }) {
  return (
    <section aria-label="Documents and compliance" className="flex flex-col gap-2.5 rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-2.5 text-[0.8125rem]">
      <h3 className="text-[0.65625rem] font-[600] uppercase tracking-[0.1em] text-[hsl(var(--e-gold-ink))]">Documents &amp; compliance</h3>
      <RequiredDocuments profile={profile} />
      {profile.credentials.length > 0 ? (
        <ul aria-label="Credentials" className="space-y-1.5 border-b border-[hsl(var(--e-border))] pb-2.5">
          {profile.credentials.map((c) => (
            <li key={c.kind} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              <span className="text-[hsl(var(--e-muted-foreground))]">{formatDate(c.expiresAt)}</span>
              {c.state === "EXPIRED" ? <EPill tone="bad">Expired</EPill> : c.state === "EXPIRING_SOON" ? <EPill tone="warn">{c.daysRemaining === 0 ? "Expires today" : `${c.daysRemaining} d left`}</EPill> : <EPill tone="ok">Current</EPill>}
            </li>
          ))}
        </ul>
      ) : null}
      {profile.missingDocuments.length > 0 ? (
        <ul aria-label="Requested, not uploaded" className="space-y-1">
          {profile.missingDocuments.map((request) => (
            <li key={request.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{request.title}</span>
              <EPill tone="bad">{request.dueAt ? `Missing, due ${formatDate(request.dueAt)}` : "Missing"}</EPill>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-[hsl(var(--e-muted-foreground))]">
        {profile.summary.documentsTotal} on file · {profile.summary.documentsCurrent} current · {profile.summary.documentsExpired} expired
      </p>
      {profile.documents.length === 0 ? (
        <p className="text-[hsl(var(--e-muted-foreground))]">Nothing on file for this person yet.</p>
      ) : (
        <ul aria-label="Documents on file" className="divide-y divide-[hsl(var(--e-border))]">
          {profile.documents.map((doc) => {
            const expired = doc.expiresAt ? new Date(doc.expiresAt).getTime() < Date.now() : false;
            return (
              <li key={doc.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-[550]">{doc.title}</p>
                  <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {prettify(doc.category)} · {doc.expiresAt ? `${expired ? "expired" : "expires"} ${formatDate(doc.expiresAt)}` : "no expiry"}
                  </p>
                </div>
                {expired ? <EPill tone="bad">Expired</EPill> : null}
                <EPill tone={doc.status === "VERIFIED" ? "ok" : doc.status === "REJECTED" ? "bad" : "warn"}>{prettify(doc.status)}</EPill>
                <a href={doc.url} target="_blank" rel="noreferrer" className="shrink-0 font-[550] text-[hsl(var(--e-primary))] underline underline-offset-2">Open</a>
              </li>
            );
          })}
        </ul>
      )}
      {caps.canUploadDocuments && profile.role !== "CLIENT" && profile.role !== "VA" ? <UploadForm profile={profile} onDone={onChanged} /> : null}
      <Link href="/v2/admin/workforce/compliance" className="text-[0.75rem] font-[550] text-[hsl(var(--e-primary))] hover:underline">Manage compliance →</Link>
    </section>
  );
}
