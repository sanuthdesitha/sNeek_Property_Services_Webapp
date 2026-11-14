/**
 * The damage report record page's data and requests. Plain module: the
 * shapes mirror what GET/PATCH /api/admin/damage/[reportId] return (dates
 * arrive as ISO strings).
 */
import type { DamageInvestigation, DamageInvestigationItem, DamageInvestigationPhoto } from "@/lib/damage/investigation";
import type { DamageRecordContext } from "@/lib/damage/record-model";
import type { DamageReleaseNoticePreview, DamageReleaseOutcome, DamageReleaseTransport } from "@/lib/damage/release-notice-types";

type Jsonified<T> = T extends Date ? string : T extends Array<infer U> ? Array<Jsonified<U>> : T extends object ? { [K in keyof T]: Jsonified<T[K]> } : T;

export type RecordReport = Jsonified<DamageInvestigation>;
export type RecordItem = Jsonified<DamageInvestigationItem>;
export type RecordPhoto = Jsonified<DamageInvestigationPhoto>;
export type DamageRecordData = { report: RecordReport; context: DamageRecordContext };

export type ReleaseNoticeResult = { outcomes: DamageReleaseOutcome[]; taken: boolean; replayed: boolean; error?: string };

export class RecordRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  return (await response.json().catch(() => ({}))) as T & { error?: string };
}

function failureText(status: number, error: string | undefined, fallback: string): string {
  if (status === 404) return "This damage report is not available to you.";
  if (status === 403) return error && error !== "Forbidden" ? error : "Your access does not allow this.";
  if (status === 401) return "Your sign-in has ended. Sign in again.";
  return error || fallback;
}

export async function readDamageRecord(reportId: string, signal: AbortSignal): Promise<DamageRecordData> {
  const response = await fetch(`/api/admin/damage/${encodeURIComponent(reportId)}`, { cache: "no-store", signal });
  const body = await readJson<Partial<DamageRecordData>>(response);
  if (!response.ok || !body.report || !body.context) throw new RecordRequestError(response.status, failureText(response.status, body.error, "The damage report could not be loaded."));
  return { report: body.report, context: body.context };
}

export async function readClientPreview(reportId: string, signal: AbortSignal): Promise<RecordReport> {
  const response = await fetch(`/api/admin/damage/${encodeURIComponent(reportId)}?view=client`, { cache: "no-store", signal });
  const body = await readJson<{ report?: RecordReport }>(response);
  if (!response.ok || !body.report) throw new RecordRequestError(response.status, failureText(response.status, body.error, "The client preview could not be loaded."));
  return body.report;
}

export async function readReleaseNotice(reportId: string, signal: AbortSignal): Promise<DamageReleaseNoticePreview> {
  const response = await fetch(`/api/admin/damage/${encodeURIComponent(reportId)}?view=release-notice`, { cache: "no-store", signal });
  const body = await readJson<{ notice?: DamageReleaseNoticePreview }>(response);
  if (!response.ok || !body.notice) throw new RecordRequestError(response.status, failureText(response.status, body.error, "The client message could not be prepared."));
  return body.notice;
}

export type DamagePatch =
  | { action: "SET_COST"; itemId: string; estimatedCost: number | null }
  | { action: "REVIEW"; release: boolean; close?: boolean; notice?: { transports: DamageReleaseTransport[]; idempotencyKey: string } }
  | { action: "VOID"; mode: "KEEP_AND_REOPEN" | "CLEAR_AND_REDO"; reason: string; security: Record<string, unknown> };

/** Sends one change; resolves with the release message's outcome when there was one. */
export async function patchDamageRecord(reportId: string, patch: DamagePatch): Promise<{ notice: ReleaseNoticeResult | null }> {
  const response = await fetch(`/api/admin/damage/${encodeURIComponent(reportId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await readJson<{ notice?: ReleaseNoticeResult }>(response);
  if (!response.ok) throw new RecordRequestError(response.status, failureText(response.status, body.error, "It was not recorded."));
  return { notice: body.notice ?? null };
}
