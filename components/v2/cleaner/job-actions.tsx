"use client";

/**
 * Native Estate per-job cleaner actions — the parity surface that mirrors the v1
 * cleaner job page's in-workspace requests. Each block hits the SAME endpoint the
 * v1 page used:
 *
 *   POST /api/cleaner/jobs/[id]/reschedule-request        → continuation approval
 *   GET  /api/cleaner/jobs/[id]/early-checkout-requests    → view admin-raised
 *                                                            early check-in / late
 *                                                            checkout requests
 *   POST /api/cleaner/jobs/[id]/approval-request           → per-job extra-pay
 *   POST /api/cleaner/jobs/[id]/damage-report              → damage + cost recovery
 *   POST /api/cleaner/jobs/[id]/safety-checkin             → "I'm safe" confirmation
 *   POST /api/cleaner/jobs/[id]/laundry-status             → early laundry update
 *
 * Rendered inside JobWorkspace once the job is live (not while OFFERED / locked).
 * Zero dependency on the v1 component tree — Estate primitives + tokens only.
 */
import * as React from "react";
import {
  AlertTriangle,
  CalendarClock,
  DollarSign,
  Loader2,
  LogOut,
  Shield,
  ShieldCheck,
  Shirt,
  WashingMachine,
} from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EAlert } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";

type Notice = { tone: "success" | "danger" | "info"; text: string } | null;

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function titleCase(v: string) {
  return v.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export function JobActions({
  jobId,
  requiresSafetyCheckin,
  safetyCheckinAt,
  hasStarted,
  onChanged,
}: {
  jobId: string;
  requiresSafetyCheckin?: boolean;
  safetyCheckinAt?: string | null;
  /** Laundry updates + continuation are only meaningful once the job has started. */
  hasStarted?: boolean;
  onChanged?: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="e-eyebrow">Requests &amp; reports</p>

      {requiresSafetyCheckin ? (
        <SafetyCheckin jobId={jobId} safetyCheckinAt={safetyCheckinAt} onChanged={onChanged} />
      ) : null}

      <EarlyCheckoutStatus jobId={jobId} />

      <ContinuationRequest jobId={jobId} hasStarted={hasStarted} onChanged={onChanged} />

      <LaundryUpdate jobId={jobId} hasStarted={hasStarted} onChanged={onChanged} />

      <ExtraPayRequest jobId={jobId} onChanged={onChanged} />

      <DamageReport jobId={jobId} onChanged={onChanged} />
    </div>
  );
}

function LocalNotice({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <EAlert tone={notice.tone === "danger" ? "danger" : notice.tone === "success" ? "success" : "info"}>
      {notice.text}
    </EAlert>
  );
}

/* ── Safety check-in ─────────────────────────────────────────────────────── */
function SafetyCheckin({
  jobId,
  safetyCheckinAt,
  onChanged,
}: {
  jobId: string;
  safetyCheckinAt?: string | null;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(Boolean(safetyCheckinAt));
  const [notice, setNotice] = React.useState<Notice>(null);

  async function confirm() {
    setBusy(true);
    setNotice(null);
    try {
      await postJson(`/api/cleaner/jobs/${jobId}/safety-checkin`, {});
      setDone(true);
      setNotice({ tone: "success", text: "Safety check-in recorded. Admin has your confirmation." });
      onChanged?.();
    } catch (e: any) {
      setNotice({ tone: "danger", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
            {done ? <ShieldCheck className="h-4 w-4 text-[hsl(var(--e-success))]" /> : <Shield className="h-4 w-4" />}
            {done ? "Safety check-in confirmed" : "Safety check-in required"}
          </p>
          {done ? <EBadge tone="success" soft>Confirmed</EBadge> : <EBadge tone="warning" soft>Pending</EBadge>}
        </div>
        {!done ? (
          <>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              This job needs a safety confirmation. Tap once you&apos;re on site and safe.
            </p>
            <EButton variant="primary" size="sm" disabled={busy} onClick={confirm}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              I&apos;m safe
            </EButton>
          </>
        ) : null}
        <LocalNotice notice={notice} />
      </ECardBody>
    </ECard>
  );
}

/* ── Early checkout / check-in requests (read-only view) ─────────────────── */
function EarlyCheckoutStatus({ jobId }: { jobId: string }) {
  const [rows, setRows] = React.useState<any[] | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/cleaner/jobs/${jobId}/early-checkout-requests`, { cache: "no-store" });
        const data = await res.json().catch(() => []);
        if (alive && res.ok) setRows(Array.isArray(data) ? data : []);
      } catch {
        /* soft — the section simply hides */
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobId]);

  if (!rows || rows.length === 0) return null;
  const latest = rows[0];

  return (
    <ECard>
      <ECardBody className="space-y-2 pt-6">
        <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
          <LogOut className="h-4 w-4" /> Timing request
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          <EBadge tone="info" soft>
            {latest.requestType === "LATE_CHECKOUT" ? "Late checkout" : "Early check-in"}
          </EBadge>
          {latest.status ? <EBadge tone="neutral" soft>{titleCase(String(latest.status))}</EBadge> : null}
        </div>
        {latest.reason ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{latest.reason}</p>
        ) : null}
      </ECardBody>
    </ECard>
  );
}

/* ── Continuation / reschedule request ───────────────────────────────────── */
function ContinuationRequest({
  jobId,
  hasStarted,
  onChanged,
}: {
  jobId: string;
  hasStarted?: boolean;
  onChanged?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [preferredDate, setPreferredDate] = React.useState("");
  const [remainingHours, setRemainingHours] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/cleaner/jobs/${jobId}/reschedule-request`, { cache: "no-store" });
        const data = await res.json().catch(() => []);
        if (alive && res.ok && Array.isArray(data)) {
          setPending(data.some((r: any) => r.status === "PENDING"));
        }
      } catch {
        /* soft */
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobId]);

  async function submit() {
    if (reason.trim().length < 5) {
      setNotice({ tone: "danger", text: "Add a reason (at least 5 characters)." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const hours = remainingHours.trim() ? Number(remainingHours) : null;
      await postJson(`/api/cleaner/jobs/${jobId}/reschedule-request`, {
        reason: reason.trim(),
        preferredDate: preferredDate || null,
        estimatedRemainingHours: hours && Number.isFinite(hours) && hours > 0 ? hours : null,
      });
      setNotice({ tone: "success", text: "Continuation request sent for admin approval." });
      setPending(true);
      setOpen(false);
      setReason("");
      setPreferredDate("");
      setRemainingHours("");
      onChanged?.();
    } catch (e: any) {
      setNotice({ tone: "danger", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
          <CalendarClock className="h-4 w-4" /> Can&apos;t finish today?
        </p>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Request continuation approval to finish this job on another visit.
        </p>
        {pending ? (
          <EBadge tone="warning" soft>Waiting for continuation approval</EBadge>
        ) : !open ? (
          <EButton
            variant="outline"
            size="sm"
            disabled={!hasStarted}
            onClick={() => setOpen(true)}
          >
            <CalendarClock className="h-4 w-4" /> Request continuation
          </EButton>
        ) : (
          <div className="space-y-3">
            <EField label="Reason (required)">
              <ETextarea
                placeholder="Why can't the job be completed today?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </EField>
            <EField label="Preferred continuation date (optional)">
              <EInput type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} />
            </EField>
            <EField label="Estimated remaining hours (optional)">
              <EInput
                type="number"
                min="0"
                step="0.5"
                value={remainingHours}
                onChange={(e) => setRemainingHours(e.target.value)}
              />
            </EField>
            <div className="flex gap-2">
              <EButton variant="gold" size="sm" disabled={busy} onClick={submit}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send request
              </EButton>
              <EButton variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </EButton>
            </div>
          </div>
        )}
        {!hasStarted && !pending ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Start the job before requesting continuation.</p>
        ) : null}
        <LocalNotice notice={notice} />
      </ECardBody>
    </ECard>
  );
}

/* ── Early laundry update ────────────────────────────────────────────────── */
type LaundryOutcome = "READY_FOR_PICKUP" | "NOT_READY" | "NO_PICKUP_REQUIRED";
const LAUNDRY_SKIP_REASONS: Array<{ value: string; label: string }> = [
  { value: "LINEN_STILL_WASHING", label: "Linen still washing" },
  { value: "LINEN_STILL_DRYING", label: "Linen still drying" },
  { value: "NO_LINEN_ON_SITE", label: "No linen on site" },
  { value: "NO_PICKUP_REQUIRED", label: "No pickup required" },
  { value: "OTHER", label: "Other" },
];

function LaundryUpdate({
  jobId,
  hasStarted,
  onChanged,
}: {
  jobId: string;
  hasStarted?: boolean;
  onChanged?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [outcome, setOutcome] = React.useState<LaundryOutcome>("READY_FOR_PICKUP");
  const [bagLocation, setBagLocation] = React.useState("");
  const [skipReasonCode, setSkipReasonCode] = React.useState("LINEN_STILL_WASHING");
  const [skipReasonNote, setSkipReasonNote] = React.useState("");
  const [photo, setPhoto] = React.useState<CapturedMedia[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice>(null);

  async function submit() {
    setNotice(null);
    if (outcome === "READY_FOR_PICKUP") {
      if (!bagLocation.trim()) {
        setNotice({ tone: "danger", text: "Bag location is required when laundry is ready." });
        return;
      }
      if (photo.length === 0) {
        setNotice({ tone: "danger", text: "A laundry photo is required when marked ready." });
        return;
      }
    } else if (!skipReasonCode) {
      setNotice({ tone: "danger", text: "Select a reason." });
      return;
    }
    setBusy(true);
    try {
      await postJson(`/api/cleaner/jobs/${jobId}/laundry-status`, {
        laundryOutcome: outcome,
        bagLocation: bagLocation.trim() || undefined,
        laundryPhotoKey: photo[0]?.key,
        laundrySkipReasonCode: outcome === "READY_FOR_PICKUP" ? undefined : skipReasonCode,
        laundrySkipReasonNote: skipReasonNote.trim() || undefined,
      });
      setNotice({ tone: "success", text: "Laundry update sent to the laundry team and admin." });
      setOpen(false);
      onChanged?.();
    } catch (e: any) {
      setNotice({ tone: "danger", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
          <WashingMachine className="h-4 w-4" /> Laundry update
        </p>
        {!open ? (
          <>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Send an early laundry status so the laundry team knows what&apos;s ready.
            </p>
            <EButton variant="outline" size="sm" disabled={!hasStarted} onClick={() => setOpen(true)}>
              <Shirt className="h-4 w-4" /> Send laundry update
            </EButton>
            {!hasStarted ? (
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Start the job before sending laundry updates.</p>
            ) : null}
          </>
        ) : (
          <div className="space-y-3">
            <EField label="Outcome">
              <ESelect value={outcome} onChange={(e) => setOutcome(e.target.value as LaundryOutcome)}>
                <option value="READY_FOR_PICKUP">Ready for pickup</option>
                <option value="NOT_READY">Not ready</option>
                <option value="NO_PICKUP_REQUIRED">No pickup required</option>
              </ESelect>
            </EField>
            {outcome === "READY_FOR_PICKUP" ? (
              <>
                <EField label="Bag location (required)">
                  <EInput
                    placeholder="e.g. Laundry room shelf, labeled bags"
                    value={bagLocation}
                    onChange={(e) => setBagLocation(e.target.value)}
                  />
                </EField>
                <EField label="Laundry photo (required)">
                  <MediaCapture value={photo} onChange={setPhoto} mode="photo" folder="laundry" />
                </EField>
              </>
            ) : (
              <>
                <EField label="Reason (required)">
                  <ESelect value={skipReasonCode} onChange={(e) => setSkipReasonCode(e.target.value)}>
                    {LAUNDRY_SKIP_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </ESelect>
                </EField>
                <EField label="Note (optional)">
                  <ETextarea value={skipReasonNote} onChange={(e) => setSkipReasonNote(e.target.value)} />
                </EField>
              </>
            )}
            <div className="flex gap-2">
              <EButton variant="gold" size="sm" disabled={busy} onClick={submit}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send update
              </EButton>
              <EButton variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </EButton>
            </div>
          </div>
        )}
        <LocalNotice notice={notice} />
      </ECardBody>
    </ECard>
  );
}

/* ── Extra pay request (per-job) ─────────────────────────────────────────── */
function ExtraPayRequest({ jobId, onChanged }: { jobId: string; onChanged?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice>(null);

  async function submit() {
    setNotice(null);
    const amt = Number(amount);
    if (!title.trim()) {
      setNotice({ tone: "danger", text: "Add a title for the request." });
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setNotice({ tone: "danger", text: "Enter an amount greater than 0." });
      return;
    }
    setBusy(true);
    try {
      await postJson(`/api/cleaner/jobs/${jobId}/approval-request`, {
        title: title.trim(),
        description: description.trim(),
        amount: amt,
      });
      setNotice({ tone: "success", text: "Pay request sent to admin for approval." });
      setOpen(false);
      setTitle("");
      setDescription("");
      setAmount("");
      onChanged?.();
    } catch (e: any) {
      setNotice({ tone: "danger", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
          <DollarSign className="h-4 w-4" /> Extra pay request
        </p>
        {!open ? (
          <>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Request additional pay for extra work on this job — routed to admin, never the client.
            </p>
            <EButton variant="outline" size="sm" onClick={() => setOpen(true)}>
              <DollarSign className="h-4 w-4" /> Request extra pay
            </EButton>
          </>
        ) : (
          <div className="space-y-3">
            <EField label="Title (required)">
              <EInput placeholder="e.g. Extra bathroom deep clean" value={title} onChange={(e) => setTitle(e.target.value)} />
            </EField>
            <EField label="Details (optional)">
              <ETextarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </EField>
            <EField label="Amount (AUD, required)">
              <EInput
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </EField>
            <div className="flex gap-2">
              <EButton variant="gold" size="sm" disabled={busy} onClick={submit}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Send request
              </EButton>
              <EButton variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </EButton>
            </div>
          </div>
        )}
        <LocalNotice notice={notice} />
      </ECardBody>
    </ECard>
  );
}

/* ── Damage report ───────────────────────────────────────────────────────── */
const DAMAGE_SEVERITY: Array<{ value: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; label: string }> = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

function DamageReport({ jobId, onChanged }: { jobId: string; onChanged?: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [area, setArea] = React.useState("");
  const [severity, setSeverity] = React.useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("HIGH");
  const [description, setDescription] = React.useState("");
  const [estimatedCost, setEstimatedCost] = React.useState("");
  const [photos, setPhotos] = React.useState<CapturedMedia[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<Notice>(null);

  async function submit() {
    setNotice(null);
    if (!title.trim()) {
      setNotice({ tone: "danger", text: "Add a damage title." });
      return;
    }
    if (photos.length === 0) {
      setNotice({ tone: "danger", text: "At least one evidence photo is required." });
      return;
    }
    setBusy(true);
    try {
      const fullDescription = [area.trim() ? `Area: ${area.trim()}` : null, description.trim()]
        .filter(Boolean)
        .join("\n\n");
      const cost = estimatedCost.trim() ? Number(estimatedCost) : null;
      await postJson(`/api/cleaner/jobs/${jobId}/damage-report`, {
        title: title.trim(),
        description: fullDescription || title.trim(),
        severity,
        estimatedCost: cost && Number.isFinite(cost) ? cost : null,
        mediaKeys: photos.map((p) => p.key),
      });
      setNotice({ tone: "success", text: "Damage report submitted. A case has been opened for admin." });
      setOpen(false);
      setTitle("");
      setArea("");
      setDescription("");
      setEstimatedCost("");
      setPhotos([]);
      onChanged?.();
    } catch (e: any) {
      setNotice({ tone: "danger", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <p className="flex items-center gap-1.5 text-[0.9375rem] font-[600]">
          <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-warning))]" /> Report damage
        </p>
        {!open ? (
          <>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Found damage or something needing cost recovery? Report it with photos.
            </p>
            <EButton variant="outline" size="sm" onClick={() => setOpen(true)}>
              <AlertTriangle className="h-4 w-4" /> Report damage
            </EButton>
          </>
        ) : (
          <div className="space-y-3">
            <EField label="Title (required)">
              <EInput
                placeholder="e.g. Cracked shower screen"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </EField>
            <EField label="Area / room (optional)">
              <EInput value={area} onChange={(e) => setArea(e.target.value)} />
            </EField>
            <EField label="Severity">
              <ESelect value={severity} onChange={(e) => setSeverity(e.target.value as any)}>
                {DAMAGE_SEVERITY.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </ESelect>
            </EField>
            <EField label="Description (optional)">
              <ETextarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </EField>
            <EField label="Estimated cost (AUD, optional)">
              <EInput
                type="number"
                min="0"
                step="0.01"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
              />
            </EField>
            <EField label="Evidence photos (required)">
              <MediaCapture value={photos} onChange={setPhotos} mode="photo" folder="evidence" multiple />
            </EField>
            <div className="flex gap-2">
              <EButton variant="danger" size="sm" disabled={busy} onClick={submit}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit damage report
              </EButton>
              <EButton variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </EButton>
            </div>
          </div>
        )}
        <LocalNotice notice={notice} />
      </ECardBody>
    </ECard>
  );
}
