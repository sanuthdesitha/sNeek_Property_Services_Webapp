"use client";

/**
 * Client approvals state: the same endpoints and safeguards the approvals board
 * has always used, extracted so the Approvals screen and the desktop dashboard
 * share one copy.
 *
 *   GET  /api/client/approvals                    → ApprovalRow[]
 *   POST /api/client/approvals/[id]/respond       { decision, expectedVersion, responseNote? }
 *   POST /api/client/approvals/[id]/counter       { amount, expectedVersion, note? }
 *
 * Safeguards kept as they were: abortable reads with a cancellation check after
 * parsing; strict parsing (a malformed answer is "unavailable", never "none");
 * a synchronous lock against double submits and cross-row actions; a stale
 * version stops every action until a fresh snapshot; 401/403 clears rows and
 * drafts. Drafts (note, counter amount) survive failed and stale refreshes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

export type ApprovalStatus = "PENDING" | "APPROVED" | "DECLINED" | "CANCELLED" | "EXPIRED" | "COUNTERED";

export interface ApprovalRow {
  id: string;
  version: string;
  title: string;
  description: string;
  amount: number;
  currency: string;
  status: ApprovalStatus;
  requestedAt: string;
  expiresAt: string | null;
  responseNote: string | null;
  counterAmount?: number | null;
  counterNote?: string | null;
  counterAt?: string | null;
  property: { name: string; suburb: string } | null;
  job: { id: string; jobType: string; scheduledDate: string; property: { name: string } } | null;
}

const validDate = z.string().min(1).refine((value) => Number.isFinite(new Date(value).getTime()));
const approvalSchema = z.object({
  version: z.string().regex(/^[a-f0-9]{64}$/),
  id: z.string().min(1), title: z.string(), description: z.string(),
  amount: z.number().finite().nonnegative(), currency: z.string().min(1),
  status: z.enum(["PENDING", "APPROVED", "DECLINED", "CANCELLED", "EXPIRED", "COUNTERED"]),
  requestedAt: validDate, expiresAt: validDate.nullable(), responseNote: z.string().nullable(),
  counterAmount: z.number().finite().nonnegative().nullish(),
  counterNote: z.string().nullish(), counterAt: validDate.nullish(),
  property: z.object({ name: z.string(), suburb: z.string() }).nullable(),
  job: z.object({ id: z.string(), jobType: z.string(), scheduledDate: validDate,
    property: z.object({ name: z.string() }) }).nullable(),
}).refine((row) => row.status !== "COUNTERED" || row.counterAmount != null);
const approvalsSchema = z.array(approvalSchema).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length);

export type DraftMap = Record<string, string>;

export interface ClientApprovalsState {
  rows: ApprovalRow[];
  hasSnapshot: boolean;
  loading: boolean;
  loadError: string | null;
  stale: boolean;
  savingId: string | null;
  notes: DraftMap;
  counters: DraftMap;
  errors: DraftMap;
  setNote: (id: string, value: string) => void;
  setCounter: (id: string, value: string) => void;
  reload: () => Promise<void>;
  respond: (id: string, decision: "APPROVE" | "DECLINE") => Promise<void>;
  counter: (id: string) => Promise<void>;
  /** Any action is blocked: saving, loading, a failed read or a stale snapshot. */
  actionsDisabled: boolean;
}

const UNAVAILABLE = "Approvals unavailable. Please retry.";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useClientApprovals(): ClientApprovalsState {
  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [stale, setStale] = useState(false);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<DraftMap>({});
  const [counters, setCounters] = useState<DraftMap>({});
  const [errors, setErrors] = useState<DraftMap>({});

  const clearDenied = useCallback(() => {
    if (!active.current) return;
    setRows([]);
    setHasSnapshot(false);
    setNotes({});
    setCounters({});
    setErrors({});
    setLoadError(UNAVAILABLE);
  }, []);

  const reload = useCallback(async () => {
    if (!active.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const res = await fetch("/api/client/approvals", { cache: "no-store", signal: controller.signal });
      if ((res.status === 401 || res.status === 403) && !controller.signal.aborted && active.current) clearDenied();
      if (!res.ok) throw new Error("Could not load approvals.");
      const parsed = approvalsSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("Invalid approvals response.");
      if (controller.signal.aborted || !active.current) return;
      setRows(parsed.data);
      setStale(false);
      setHasSnapshot(true);
      setLoadError(null);
    } catch {
      if (!controller.signal.aborted && active.current) setLoadError(UNAVAILABLE);
    } finally {
      if (!controller.signal.aborted && active.current) setLoading(false);
    }
  }, [clearDenied]);

  useEffect(() => {
    active.current = true;
    void reload();
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, [reload]);

  const canAct = (row: ApprovalRow | undefined): row is ApprovalRow =>
    active.current && !saving.current && !loading && !loadError && !stale && row?.status === "PENDING";

  async function submit(id: string, path: "respond" | "counter", body: Record<string, unknown>, fallback: string, onSaved?: () => void) {
    saving.current = true;
    setSavingId(id);
    setErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/client/approvals/${encodeURIComponent(id)}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401 || res.status === 403) { clearDenied(); return; }
      const payload = await res.json().catch(() => ({}));
      if (res.status === 409 && payload.code === "STALE_APPROVAL") {
        if (active.current) setStale(true);
        return;
      }
      if (!res.ok) throw new Error(payload.error ?? fallback);
      if (!active.current) return;
      onSaved?.();
      await reload();
    } catch (error) {
      if (active.current) setErrors((prev) => ({ ...prev, [id]: errorMessage(error, fallback) }));
    } finally {
      saving.current = false;
      if (active.current) setSavingId(null);
    }
  }

  async function respond(id: string, decision: "APPROVE" | "DECLINE") {
    const row = rows.find((item) => item.id === id);
    if (!canAct(row)) return;
    await submit(id, "respond", {
      decision,
      expectedVersion: row.version,
      responseNote: notes[id]?.trim() || undefined,
    }, "Could not submit your response.");
  }

  /** Propose a different amount; the request's own amount is untouched server-side. */
  async function counter(id: string) {
    const row = rows.find((item) => item.id === id);
    if (!canAct(row)) return;
    const raw = counters[id]?.trim();
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || amount < 0) {
      setErrors((prev) => ({ ...prev, [id]: "Enter the amount you want to propose." }));
      return;
    }
    await submit(id, "counter", { amount, expectedVersion: row.version, note: notes[id]?.trim() || undefined },
      "Could not send your counter-offer.", () => setCounters((prev) => ({ ...prev, [id]: "" })));
  }

  return {
    rows, hasSnapshot, loading, loadError, stale, savingId, notes, counters, errors,
    setNote: (id, value) => setNotes((prev) => ({ ...prev, [id]: value })),
    setCounter: (id, value) => setCounters((prev) => ({ ...prev, [id]: value })),
    reload, respond, counter,
    actionsDisabled: savingId !== null || loading || !!loadError || stale,
  };
}
