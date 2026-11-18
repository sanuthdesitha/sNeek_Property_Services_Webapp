"use client";

/**
 * FULL DETAILS OF ONE PAY REQUEST, for the office (owner request 2026-11-18).
 *
 * A lazy disclosure: nothing is fetched until it is opened. Opened, it reads
 * GET /api/admin/pay-adjustments/:id and shows what was asked (type, title,
 * hours × rate, requested vs approved, kind, the cleaner's note and receipts),
 * the job it is linked to, who decided and when, the cleaner-facing message and
 * the private note, where the money was settled, what the client is billed and
 * the edit history. Every lock arrives from the server already in words.
 *
 * The secondary tools — edit, link to a job, client billing, mark paid / undo —
 * are their own disclosures. Drafts live in this component, so collapsing keeps
 * them; a different request (a new `requestId`) starts fresh because the parent
 * keys this component by request. Fields freeze while a save runs, and a failed
 * save keeps what was typed. Obsolete reads are cancelled and a late answer for
 * another request is ignored.
 *
 * No money is derived here: amounts arrive from the server and are only
 * formatted. Every write goes through the existing routes (PATCH, mark-paid).
 */
import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EBadge, EButton } from "@/components/v2/ui/primitives";
import { EvidenceThumbs } from "@/components/v2/shared/evidence-thumbs";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";

/* ── The detail payload (GET /api/admin/pay-adjustments/:id) ─────────────── */

export interface PayRequestHistoryItem {
  at: string;
  summary: string;
  details: string[];
  actorName: string | null;
}

export interface PayRequestDetailsData {
  id: string;
  title: string | null;
  type: string;
  category: string;
  taxable: boolean;
  status: string;
  requestedHours: number | null;
  requestedRate: number | null;
  requestedAmount: number;
  approvedAmount: number | null;
  cleanerNote: string | null;
  decisionMessage: string | null;
  adminNote: string | null;
  attachments: Array<{ key: string; url: string }>;
  requestedAt: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
  cleaner: { id: string; name: string };
  job: { id: string; jobNumber: string | null; scheduledDate: string; propertyName: string } | null;
  property: { id: string; name: string } | null;
  settlement: { kind: string | null; sentence: string };
  paidOutside: { date: string | null; method: string | null; reference: string | null; note: string | null } | null;
  editLock: { editable: boolean; reason: string | null };
  markPaid: { allowed: boolean; reason: string | null };
  undoPaid: { allowed: boolean; reason: string | null };
  client: {
    billToClient: boolean;
    clientAmount: number | null;
    clientDescription: string | null;
    consent: string;
    state: "NOT_BILLED" | "ON_DRAFT" | "ON_INVOICE" | "WAITING";
    invoiceId: string | null;
    invoiceNumber: string | null;
    sentence: string;
    lockReason: string | null;
  };
  history: PayRequestHistoryItem[];
  viewer: { canMarkPaid: boolean; markPaidUnavailable: string | null };
}

interface LinkCandidate {
  id: string;
  jobNumber: string | null;
  jobType: string;
  status: string;
  scheduledDate: string;
  propertyName: string;
}

const TIMEZONE = "Australia/Sydney";
const FIELD =
  "h-10 w-full min-w-0 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem] " +
  "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))] disabled:opacity-60";
const LABEL = "block text-[0.75rem] font-[550]";
const MUTED = "text-[0.75rem] text-[hsl(var(--e-muted-foreground))]";

function money(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "not set";
  const sign = amount < 0 ? "−" : "";
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}

/** History and decisions in the organisation's timezone. */
function when(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-AU", { timeZone: TIMEZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A job's calendar day, as scheduled (Sydney), never shifted. */
function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { timeZone: TIMEZONE, weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function words(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: PayRequestDetailsData; stale: boolean };

/** Fetch the details while open; a refresh keeps the last good copy on screen. */
function usePayRequestDetails(requestId: string, open: boolean) {
  const [state, setState] = React.useState<LoadState>({ kind: "idle" });
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState((prev) => (prev.kind === "ready" ? { ...prev, stale: true } : { kind: "loading" }));
    (async () => {
      try {
        const res = await fetch(`/api/admin/pay-adjustments/${requestId}`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json().catch(() => ({}))) as Partial<PayRequestDetailsData> & { error?: string };
        if (controller.signal.aborted) return;
        if (!res.ok || !body.id) {
          setState({ kind: "error", message: body.error ?? "Could not load this request." });
          return;
        }
        if (body.id !== requestId) return;
        setState({ kind: "ready", data: body as PayRequestDetailsData, stale: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: error instanceof Error ? error.message : "Could not load this request." });
      }
    })();
    return () => controller.abort();
  }, [requestId, open, version]);
  const reload = React.useCallback(() => setVersion((v) => v + 1), []);
  return { state, reload };
}

/** One labelled row of the details list. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-1.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className={MUTED}>{label}</dt>
      <dd className="min-w-0 break-words text-[0.8125rem]">{children}</dd>
    </div>
  );
}

/** A lazy, keyboard-reachable disclosure for one secondary tool. */
function Disclosure({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <div className="rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-[0.8125rem] font-[550] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
      >
        {open ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4" />}
        {label}
      </button>
      {/* Hidden, not unmounted: a collapsed form keeps its draft. */}
      <div id={id} hidden={!open} className="space-y-2 border-t border-[hsl(var(--e-border))] p-3">
        {children}
      </div>
    </div>
  );
}

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; status: number; error: string | null }> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, status: res.status, error: res.ok ? null : payload.error ?? "The change was refused." };
}

/* ── Edit the request ─────────────────────────────────────────────────── */

interface EditDraft {
  title: string;
  type: string;
  requestedHours: string;
  requestedRate: string;
  requestedAmount: string;
  approvedAmount: string;
  category: string;
  decisionMessage: string;
  adminNote: string;
  changeReason: string;
}

function draftFrom(data: PayRequestDetailsData): EditDraft {
  return {
    title: data.title ?? "",
    type: data.type,
    requestedHours: data.requestedHours != null ? String(data.requestedHours) : "",
    requestedRate: data.requestedRate != null ? String(data.requestedRate) : "",
    requestedAmount: data.requestedAmount.toFixed(2),
    approvedAmount: data.approvedAmount != null ? data.approvedAmount.toFixed(2) : "",
    category: data.category,
    decisionMessage: data.decisionMessage ?? "",
    adminNote: data.adminNote ?? "",
    changeReason: "",
  };
}

/** Only the fields that changed, so an untouched field is never re-written. */
function editBody(data: PayRequestDetailsData, draft: EditDraft): { body: Record<string, unknown>; problem: string | null } {
  const body: Record<string, unknown> = {};
  const num = (text: string) => (text.trim() === "" ? null : Number(text));
  if (draft.title.trim() !== (data.title ?? "") && draft.title.trim()) body.title = draft.title.trim();
  if (draft.type !== data.type) body.type = draft.type;
  if (draft.category !== data.category) body.category = draft.category;
  const hours = num(draft.requestedHours);
  const rate = num(draft.requestedRate);
  if (draft.type === "HOURLY") {
    if (hours !== data.requestedHours) body.requestedHours = hours;
    if (rate !== data.requestedRate) body.requestedRate = rate;
  }
  const requested = num(draft.requestedAmount);
  if (draft.type !== "HOURLY" && requested !== null && Math.round(requested * 100) !== Math.round(data.requestedAmount * 100)) body.requestedAmount = requested;
  const approved = num(draft.approvedAmount);
  if (data.status === "APPROVED" && approved !== null && Math.round(approved * 100) !== Math.round((data.approvedAmount ?? 0) * 100)) body.approvedAmount = approved;
  if (draft.decisionMessage.trim() !== (data.decisionMessage ?? "")) body.decisionMessage = draft.decisionMessage.trim();
  if (draft.adminNote.trim() !== (data.adminNote ?? "")) body.adminNote = draft.adminNote.trim();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "number" && (!Number.isFinite(value) || value <= 0)) return { body, problem: `Enter a ${key.replace(/([A-Z])/g, " $1").toLowerCase()} greater than zero.` };
  }
  const reducing = typeof body.approvedAmount === "number" && data.approvedAmount != null && body.approvedAmount < data.approvedAmount;
  if (reducing) {
    if (!draft.changeReason.trim()) return { body, problem: "Say why the cleaner gets less. They will see this reason." };
    body.changeReason = draft.changeReason.trim();
  }
  return { body, problem: Object.keys(body).length === 0 ? "Nothing has changed." : null };
}

function EditForm({ data, onSaved }: { data: PayRequestDetailsData; onSaved: () => void }) {
  const [draft, setDraft] = React.useState<EditDraft>(() => draftFrom(data));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ids = React.useId();
  const set = (patch: Partial<EditDraft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const reducing = data.status === "APPROVED" && data.approvedAmount != null && draft.approvedAmount.trim() !== "" && Number(draft.approvedAmount) < data.approvedAmount;

  if (!data.editLock.editable) {
    return <p className={MUTED}>{data.editLock.reason}</p>;
  }

  async function save() {
    const { body, problem } = editBody(data, draft);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await send(`/api/admin/pay-adjustments/${data.id}`, "PATCH", body);
      if (!result.ok) {
        // The draft stays as typed so it can be corrected and saved again.
        setError(result.error);
        return;
      }
      toast({ title: "Pay request updated" });
      setDraft((prev) => ({ ...prev, changeReason: "" }));
      onSaved();
    } catch {
      setError("Could not reach the server. Your changes are still here; try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset disabled={saving} className="space-y-2">
      <legend className="sr-only">Edit this pay request</legend>
      <label className={LABEL} htmlFor={`${ids}-title`}>Title</label>
      <input id={`${ids}-title`} className={FIELD} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor={`${ids}-type`}>Type</label>
          <select id={`${ids}-type`} className={FIELD} value={draft.type} onChange={(e) => set({ type: e.target.value })}>
            <option value="FIXED">Fixed amount</option>
            <option value="HOURLY">Hourly</option>
          </select>
        </div>
        <div>
          <label className={LABEL} htmlFor={`${ids}-cat`}>Kind of money</label>
          <select id={`${ids}-cat`} className={FIELD} value={draft.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="SERVICE">Work (service)</option>
            <option value="PARKING">Parking (money back)</option>
            <option value="REIMBURSEMENT">Reimbursement (money back)</option>
          </select>
        </div>
      </div>
      {draft.type === "HOURLY" ? (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL} htmlFor={`${ids}-h`}>Hours</label>
            <input id={`${ids}-h`} className={FIELD + " e-tnum"} type="number" min="0" step="0.25" value={draft.requestedHours} onChange={(e) => set({ requestedHours: e.target.value })} />
          </div>
          <div>
            <label className={LABEL} htmlFor={`${ids}-r`}>Rate ($/h)</label>
            <input id={`${ids}-r`} className={FIELD + " e-tnum"} type="number" min="0" step="0.01" value={draft.requestedRate} onChange={(e) => set({ requestedRate: e.target.value })} />
          </div>
        </div>
      ) : (
        <>
          <label className={LABEL} htmlFor={`${ids}-req`}>Requested amount ($)</label>
          <input id={`${ids}-req`} className={FIELD + " e-tnum"} type="number" min="0" step="0.01" value={draft.requestedAmount} onChange={(e) => set({ requestedAmount: e.target.value })} />
        </>
      )}
      {data.status === "APPROVED" ? (
        <>
          <label className={LABEL} htmlFor={`${ids}-appr`}>Approved amount ($)</label>
          <input id={`${ids}-appr`} className={FIELD + " e-tnum"} type="number" min="0" step="0.01" value={draft.approvedAmount} onChange={(e) => set({ approvedAmount: e.target.value })} />
        </>
      ) : null}
      {reducing ? (
        <>
          <label className={LABEL} htmlFor={`${ids}-why`}>Why the cleaner gets less (required, they will see it)</label>
          <textarea id={`${ids}-why`} className={FIELD + " h-auto py-2"} rows={2} value={draft.changeReason} onChange={(e) => set({ changeReason: e.target.value })} />
        </>
      ) : null}
      <label className={LABEL} htmlFor={`${ids}-msg`}>Message to the cleaner</label>
      <textarea id={`${ids}-msg`} className={FIELD + " h-auto py-2"} rows={2} value={draft.decisionMessage} onChange={(e) => set({ decisionMessage: e.target.value })} />
      <label className={LABEL} htmlFor={`${ids}-note`}>Private note (office only)</label>
      <textarea id={`${ids}-note`} className={FIELD + " h-auto py-2"} rows={2} value={draft.adminNote} onChange={(e) => set({ adminNote: e.target.value })} />
      {error ? <p role="alert" className="text-[0.75rem] font-[550] text-[hsl(var(--e-danger))]">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <EButton size="sm" variant="gold" onClick={() => void save()}>
          {saving ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null} Save changes
        </EButton>
        <EButton size="sm" variant="ghost" onClick={() => { setDraft(draftFrom(data)); setError(null); }}>Discard</EButton>
      </div>
    </fieldset>
  );
}

/* ── Link to a job ────────────────────────────────────────────────────── */

function LinkForm({ data, open, onSaved }: { data: PayRequestDetailsData; open: boolean; onSaved: () => void }) {
  const [candidates, setCandidates] = React.useState<{ kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; jobs: LinkCandidate[]; scope: string | null; refusal: string | null } | null>(null);
  const [chosen, setChosen] = React.useState<string>("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const name = React.useId();

  React.useEffect(() => {
    if (!open || data.job) return;
    const controller = new AbortController();
    setCandidates({ kind: "loading" });
    (async () => {
      try {
        const res = await fetch(`/api/admin/pay-adjustments/${data.id}/link-candidates`, { cache: "no-store", signal: controller.signal });
        const body = (await res.json().catch(() => ({}))) as { jobs?: LinkCandidate[]; scope?: string; refusal?: string | null; error?: string };
        if (controller.signal.aborted) return;
        if (!res.ok) setCandidates({ kind: "error", message: body.error ?? "Could not load jobs." });
        else setCandidates({ kind: "ready", jobs: body.jobs ?? [], scope: body.scope ?? null, refusal: body.refusal ?? null });
      } catch {
        if (!controller.signal.aborted) setCandidates({ kind: "error", message: "Could not load jobs." });
      }
    })();
    return () => controller.abort();
  }, [open, data.id, data.job]);

  async function link(jobId: string | null) {
    setSaving(true);
    setError(null);
    try {
      const result = await send(`/api/admin/pay-adjustments/${data.id}`, "PATCH", { jobId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: jobId ? "Linked to the job" : "Unlinked from the job" });
      setChosen("");
      onSaved();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!data.editLock.editable) return <p className={MUTED}>{data.editLock.reason}</p>;

  if (data.job) {
    return (
      <div className="space-y-2">
        <p className={MUTED}>Linked to {data.job.jobNumber ?? "a job"} at {data.job.propertyName} on {day(data.job.scheduledDate)}. Unlinking keeps the property.</p>
        {error ? <p role="alert" className="text-[0.75rem] font-[550] text-[hsl(var(--e-danger))]">{error}</p> : null}
        <EButton size="sm" variant="outline" disabled={saving} onClick={() => void link(null)}>
          {saving ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null} Unlink from this job
        </EButton>
      </div>
    );
  }

  if (!candidates || candidates.kind === "loading") return <p className={MUTED}>Loading jobs…</p>;
  if (candidates.kind === "error") return <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{candidates.message}</p>;
  if (candidates.refusal) return <p className={MUTED}>{candidates.refusal}</p>;
  if (candidates.jobs.length === 0) {
    return <p className={MUTED}>No job of {data.cleaner.name} {data.property ? `at ${data.property.name} ` : ""}within two weeks of the request. A request can only be linked to a job its cleaner worked.</p>;
  }
  return (
    <fieldset disabled={saving} className="space-y-2">
      <legend className={MUTED}>{candidates.scope}</legend>
      <div className="max-h-60 space-y-1 overflow-y-auto">
        {candidates.jobs.map((job) => (
          <label key={job.id} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[var(--e-radius-sm)] px-2 text-[0.8125rem] hover:bg-[hsl(var(--e-muted))]">
            <input type="radio" name={name} value={job.id} checked={chosen === job.id} onChange={() => setChosen(job.id)} />
            <span className="min-w-0 break-words">
              {day(job.scheduledDate)} · {job.propertyName} · {words(job.jobType)} {job.jobNumber ? `· ${job.jobNumber}` : ""}
            </span>
          </label>
        ))}
      </div>
      {error ? <p role="alert" className="text-[0.75rem] font-[550] text-[hsl(var(--e-danger))]">{error}</p> : null}
      <EButton size="sm" variant="gold" disabled={!chosen} onClick={() => void link(chosen)}>
        {saving ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null} Link to this job
      </EButton>
    </fieldset>
  );
}

/* ── Client billing ───────────────────────────────────────────────────── */

function ClientBillingForm({ data, onSaved }: { data: PayRequestDetailsData; onSaved: () => void }) {
  const [bill, setBill] = React.useState(data.client.billToClient);
  const [amount, setAmount] = React.useState(data.client.clientAmount != null ? data.client.clientAmount.toFixed(2) : data.approvedAmount != null ? data.approvedAmount.toFixed(2) : "");
  const [wording, setWording] = React.useState(data.client.clientDescription ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ids = React.useId();

  if (data.client.lockReason) return <p className={MUTED}>{data.client.lockReason}</p>;

  async function save() {
    const value = Number(amount);
    if (bill && (!Number.isFinite(value) || value <= 0)) {
      setError("Enter the amount the client is charged, more than $0.00.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await send(`/api/admin/pay-adjustments/${data.id}`, "PATCH", {
        billToClient: bill,
        ...(bill ? { clientAmount: value, clientDescription: wording.trim() || null } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: bill ? "Client billing saved" : "No longer billed to the client" });
      onSaved();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset disabled={saving} className="space-y-2">
      <legend className="sr-only">Client billing</legend>
      <label className="flex min-h-[44px] items-center gap-2 text-[0.8125rem]">
        <input type="checkbox" checked={bill} onChange={(e) => setBill(e.target.checked)} /> Bill this extra to the client
      </label>
      {bill ? (
        <>
          <label className={LABEL} htmlFor={`${ids}-amt`}>Client amount ($, before GST)</label>
          <input id={`${ids}-amt`} className={FIELD + " e-tnum"} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label className={LABEL} htmlFor={`${ids}-txt`}>Wording on the client invoice (optional; the title is used when empty)</label>
          <input id={`${ids}-txt`} className={FIELD} value={wording} maxLength={500} onChange={(e) => setWording(e.target.value)} />
          <p className={MUTED}>
            {data.job
              ? `This will add ${money(Number(amount))} to the client's invoice for this job: on a draft it joins the job's line; an issued invoice is never changed.`
              : `This will add ${money(Number(amount))} to the client's next invoice as its own line.`}
          </p>
        </>
      ) : null}
      {error ? <p role="alert" className="text-[0.75rem] font-[550] text-[hsl(var(--e-danger))]">{error}</p> : null}
      <EButton size="sm" variant="gold" onClick={() => void save()}>
        {saving ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null} Save client billing
      </EButton>
    </fieldset>
  );
}

/* ── Mark paid / undo ─────────────────────────────────────────────────── */

const METHODS = [
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "OTHER", label: "Other" },
];

function todayInSydney(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function MarkPaidForm({ data, open, onSaved }: { data: PayRequestDetailsData; open: boolean; onSaved: () => void }) {
  const undoing = Boolean(data.paidOutside);
  const pin = useOwnPinPrompt(open && data.viewer.canMarkPaid && (undoing ? data.undoPaid.allowed : data.markPaid.allowed));
  const [paidDate, setPaidDate] = React.useState(todayInSydney);
  const [method, setMethod] = React.useState("BANK_TRANSFER");
  const [reference, setReference] = React.useState("");
  const [note, setNote] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ids = React.useId();

  if (!data.viewer.canMarkPaid) return <p className={MUTED}>{data.viewer.markPaidUnavailable}</p>;
  if (!undoing && !data.markPaid.allowed) return <p className={MUTED}>{data.markPaid.reason}</p>;
  if (undoing && !data.undoPaid.allowed) return <p className={MUTED}>{data.undoPaid.reason}</p>;

  async function submit() {
    if (undoing && reason.trim().length < 3) {
      setError("Say why the payment is being undone.");
      return;
    }
    if (!pin.credentials) {
      setError(pin.problem ?? "Enter your PIN.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = undoing
        ? { reason: reason.trim(), security: pin.credentials }
        : { paidDate, method, reference: reference.trim() || null, note: note.trim() || null, security: pin.credentials };
      const result = await send(`/api/admin/pay-adjustments/${data.id}/mark-paid`, undoing ? "DELETE" : "POST", body);
      if (!result.ok) {
        if (result.status === 423) pin.noteRefusal();
        setError(result.error);
        return;
      }
      toast({ title: undoing ? "Payment record undone" : "Marked paid" });
      pin.reset();
      onSaved();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset disabled={saving} className="space-y-2">
      <legend className={MUTED}>
        {undoing
          ? "Undo the record of a payment made outside the system. The request becomes payable again on the next invoice or pay run."
          : `Record that ${money(data.approvedAmount)} was paid to ${data.cleaner.name} outside the system. It will not appear on a cleaner invoice or in a pay run.`}
      </legend>
      {undoing ? (
        <>
          <label className={LABEL} htmlFor={`${ids}-why`}>Why (required)</label>
          <textarea id={`${ids}-why`} className={FIELD + " h-auto py-2"} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor={`${ids}-date`}>Date paid</label>
              <input id={`${ids}-date`} className={FIELD} type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
            </div>
            <div>
              <label className={LABEL} htmlFor={`${ids}-method`}>Method</label>
              <select id={`${ids}-method`} className={FIELD} value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </div>
          </div>
          <label className={LABEL} htmlFor={`${ids}-ref`}>Reference (optional)</label>
          <input id={`${ids}-ref`} className={FIELD} value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} />
          <label className={LABEL} htmlFor={`${ids}-note`}>Note (office only, optional)</label>
          <textarea id={`${ids}-note`} className={FIELD + " h-auto py-2"} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      )}
      <OwnPinFields {...pin.fieldProps} disabled={saving} onSubmit={() => void submit()} />
      {error ? <p role="alert" className="text-[0.75rem] font-[550] text-[hsl(var(--e-danger))]">{error}</p> : null}
      <EButton size="sm" variant={undoing ? "outline" : "gold"} onClick={() => void submit()}>
        {saving ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null} {undoing ? "Undo payment record" : "Mark paid"}
      </EButton>
    </fieldset>
  );
}

/* ── The details view ─────────────────────────────────────────────────── */

function DetailsBody({ data, onChanged }: { data: PayRequestDetailsData; onChanged: () => void }) {
  const [tool, setTool] = React.useState<"edit" | "link" | "client" | "paid" | null>(null);
  const toggle = (next: "edit" | "link" | "client" | "paid") => setTool((current) => (current === next ? null : next));
  const hourly = data.type === "HOURLY" && data.requestedHours != null && data.requestedRate != null;
  // Forms are keyed by the request's decided state so a saved change starts
  // the next edit from what is stored, while a collapsed draft is kept.
  const formKey = `${data.id}:${data.status}:${data.approvedAmount}:${data.settlement.kind}:${data.client.clientAmount}:${data.job?.id ?? "none"}`;

  return (
    <div className="space-y-3">
      <dl className="divide-y divide-[hsl(var(--e-border))]">
        <Row label="What">{data.title || "Untitled request"} · {data.type === "HOURLY" ? "Hourly" : "Fixed amount"}</Row>
        <Row label="Cleaner">{data.cleaner.name}</Row>
        <Row label="Job">
          {data.job ? (
            <Link className="underline-offset-2 hover:underline" href={`/v2/admin/jobs/${data.job.id}`}>
              {data.job.propertyName} · {day(data.job.scheduledDate)}{data.job.jobNumber ? ` · ${data.job.jobNumber}` : ""}
            </Link>
          ) : (
            <span>Not linked to a job{data.property ? ` (property: ${data.property.name})` : ""}</span>
          )}
        </Row>
        <Row label="Worked out as">{hourly ? `${data.requestedHours} h × ${money(data.requestedRate)} = ${money(data.requestedAmount)}` : `Fixed amount ${money(data.requestedAmount)}`}</Row>
        <Row label="Requested / approved">
          <span className="e-tnum">{money(data.requestedAmount)} requested · {data.approvedAmount != null ? `${money(data.approvedAmount)} approved` : "not decided"}</span>
        </Row>
        <Row label="Kind">{words(data.category)} · {data.taxable ? "income (taxable)" : "money back (not income)"}</Row>
        <Row label="Cleaner's note">{data.cleanerNote ? `“${data.cleanerNote}”` : "No note."}</Row>
        <Row label="Receipts">
          {data.attachments.length > 0 ? <EvidenceThumbs items={data.attachments} alt="Pay request evidence" docLabel="Open receipt" /> : "No receipt or photo was attached."}
        </Row>
        <Row label="Decision">
          <EBadge tone={data.status === "APPROVED" ? "success" : data.status === "REJECTED" ? "danger" : "warning"} soft>{words(data.status)}</EBadge>{" "}
          {data.reviewedAt ? `${when(data.reviewedAt)}${data.reviewedByName ? ` by ${data.reviewedByName}` : ""}` : `raised ${when(data.requestedAt)}`}
        </Row>
        <Row label="Message to the cleaner">{data.decisionMessage || "None."}</Row>
        <Row label="Private note">{data.adminNote || "None."}</Row>
        <Row label="Settled">{data.settlement.sentence}{data.paidOutside?.note ? ` Note: ${data.paidOutside.note}` : ""}</Row>
        <Row label="Client">
          {data.client.billToClient && data.client.clientAmount != null ? `${money(data.client.clientAmount)} · ` : ""}
          {data.client.sentence}
          {data.client.invoiceId ? (
            <>
              {" "}
              <Link className="underline-offset-2 hover:underline" href={`/v2/admin/finance/invoices/${encodeURIComponent(data.client.invoiceId)}`}>Open invoice {data.client.invoiceNumber}</Link>
            </>
          ) : null}
        </Row>
      </dl>

      <div className="space-y-2">
        <Disclosure label="Edit this request" open={tool === "edit"} onToggle={() => toggle("edit")}>
          <EditForm key={formKey} data={data} onSaved={onChanged} />
        </Disclosure>
        <Disclosure label={data.job ? "Job link" : "Link to a job"} open={tool === "link"} onToggle={() => toggle("link")}>
          <LinkForm key={formKey} data={data} open={tool === "link"} onSaved={onChanged} />
        </Disclosure>
        <Disclosure label="Client billing" open={tool === "client"} onToggle={() => toggle("client")}>
          <ClientBillingForm key={formKey} data={data} onSaved={onChanged} />
        </Disclosure>
        <Disclosure label={data.paidOutside ? "Paid outside the system" : "Mark paid"} open={tool === "paid"} onToggle={() => toggle("paid")}>
          <MarkPaidForm key={formKey} data={data} open={tool === "paid"} onSaved={onChanged} />
        </Disclosure>
      </div>

      <div>
        <p className="text-[0.75rem] font-[600]">History</p>
        {data.history.length === 0 ? (
          <p className={MUTED}>No recorded changes yet.</p>
        ) : (
          <ol className="mt-1 space-y-1.5">
            {data.history.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="text-[0.75rem]">
                <span className="font-[550]">{entry.summary}</span>
                <span className="text-[hsl(var(--e-muted-foreground))]"> · {when(entry.at)}{entry.actorName ? ` · ${entry.actorName}` : ""}</span>
                {entry.details.map((line) => (
                  <span key={line} className="block break-words text-[hsl(var(--e-muted-foreground))]">{line}</span>
                ))}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/**
 * The disclosure itself. Mount it keyed by request (`key={requestId}`) so a
 * different request never inherits another one's drafts.
 */
export function PayRequestDetails({ requestId, onChanged, defaultOpen = false }: { requestId: string; onChanged?: () => void | Promise<void>; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const { state, reload } = usePayRequestDetails(requestId, open);
  const regionId = React.useId();
  const changed = React.useCallback(() => {
    reload();
    void onChanged?.();
  }, [reload, onChanged]);

  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-[44px] items-center gap-1 text-[0.75rem] font-[550] underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
      >
        {open ? <ChevronDown aria-hidden className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5" />}
        Full details
      </button>
      <div id={regionId} hidden={!open} className="mt-1 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] p-3">
        {state.kind === "loading" || state.kind === "idle" ? (
          <p className={MUTED} role="status">Loading the request…</p>
        ) : state.kind === "error" ? (
          <div role="alert" className="space-y-2">
            <p className="text-[0.75rem] text-[hsl(var(--e-danger))]">{state.message}</p>
            <EButton size="sm" variant="outline" onClick={reload}>Try again</EButton>
          </div>
        ) : (
          <>
            {state.stale ? <p className={MUTED} role="status">Refreshing…</p> : null}
            <DetailsBody data={state.data} onChanged={changed} />
          </>
        )}
      </div>
    </div>
  );
}
