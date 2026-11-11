/**
 * Calls to the existing case endpoints. Each returns the server's answer or
 * throws with the server's own error text; nothing here decides a rule.
 */
import type { CaseBulkOutcome } from "@/lib/cases/bulk";
import { readJson, type CaseDetail, type CaseStatus, type CaseTypeKey, type Severity } from "./case-types";

export type CasePatch = Partial<{
  title: string;
  description: string | null;
  severity: Severity;
  status: CaseStatus;
  caseType: CaseTypeKey;
  assignedToUserId: string | null;
  clientVisible: boolean;
  clientCanReply: boolean;
  resolutionNote: string | null;
}>;

async function send<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = await readJson<T>(response);
  if (!response.ok) throw new Error(body.error || fallback);
  return body;
}

export function patchCase(caseId: string, patch: CasePatch, statusChangeNote?: string): Promise<CaseDetail> {
  const payload = statusChangeNote ? { ...patch, statusChangeNote } : patch;
  return send<CaseDetail>(`/api/admin/cases/${encodeURIComponent(caseId)}`, { method: "PATCH", body: JSON.stringify(payload) }, "Could not save the case.");
}

export function postCaseComment(caseId: string, body: string, isInternal: boolean): Promise<CaseDetail> {
  return send<CaseDetail>(
    `/api/admin/cases/${encodeURIComponent(caseId)}/comments`,
    { method: "POST", body: JSON.stringify({ body, isInternal }) },
    "Could not send the message.",
  );
}

/** Existing upload (owned by the uploader) then the existing attach call. */
export async function attachCaseFile(caseId: string, file: File): Promise<CaseDetail> {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "cases");
  const uploadResponse = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const upload = await readJson<{ key?: string; url?: string; mimeType?: string }>(uploadResponse);
  if (!uploadResponse.ok || !upload.key) throw new Error(upload.error || "Could not upload the file.");
  return send<CaseDetail>(
    `/api/admin/cases/${encodeURIComponent(caseId)}/attachments`,
    {
      method: "POST",
      body: JSON.stringify({ s3Key: upload.key, url: upload.url ?? null, mimeType: upload.mimeType ?? file.type ?? null, label: file.name }),
    },
    "Could not attach the file.",
  );
}

export function deleteCaseRequest(caseId: string, security?: { pin?: string; password?: string }): Promise<{ ok: boolean }> {
  return send<{ ok: boolean }>(`/api/admin/cases/${encodeURIComponent(caseId)}`, { method: "DELETE", body: JSON.stringify({ security }) }, "Could not delete the case.");
}

export type NewCaseInput = {
  title: string;
  description: string | null;
  caseType: CaseTypeKey;
  severity: Severity;
  clientVisible: boolean;
  clientCanReply: boolean;
  jobId: string | null;
  propertyId: string | null;
  clientId: string | null;
};

export function createCaseRequest(input: NewCaseInput): Promise<CaseDetail> {
  return send<CaseDetail>("/api/admin/cases", { method: "POST", body: JSON.stringify(input) }, "Could not create the case.");
}

export type CaseBulkRequest =
  | { action: "assign"; ids: string[]; assignedToUserId: string | null }
  | { action: "status"; ids: string[]; status: CaseStatus; note: string }
  | { action: "close"; ids: string[]; note: string };

export async function runCaseBulkRequest(input: CaseBulkRequest): Promise<CaseBulkOutcome[]> {
  const body = await send<{ results?: CaseBulkOutcome[] }>("/api/admin/cases/bulk", { method: "POST", body: JSON.stringify(input) }, "Could not run the bulk action.");
  return Array.isArray(body.results) ? body.results : [];
}
