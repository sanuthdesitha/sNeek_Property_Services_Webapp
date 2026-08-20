"use client";

/**
 * "Manage this clean" — the client job page's action hub. One card gathering
 * every self-serve action:
 *   · Reschedule        → POST /api/client/jobs/[id]/reschedule-request
 *   · Request an add-on → POST /api/client/jobs/[id]/task-requests (visibility-gated)
 *   · Skip              → existing JobSkipAction (relocated here)
 *   · Ask for an update / Ask for ETA / Request the report
 *                       → POST /api/client/jobs/[id]/requests {type, note?}
 *   · Message us        → per-job chat sheet (ClientMessage with jobId)
 * Each action confirms before sending and shows its pending state afterwards.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  FileText,
  Info,
  ListPlus,
  Loader2,
  MapPin,
  MessageCircle,
  X,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { EInlineNotice, EInput, ELabel, ETextarea } from "@/components/v2/client/fields";
import { JobSkipAction } from "@/components/v2/client/job-skip-action";
import { JobChatSheet } from "@/components/v2/client/job-chat";
import type { JobStatus } from "@prisma/client";
import { isClientSchedulable } from "@/lib/jobs/client-request-rules";

type LightType = "UPDATE" | "ETA" | "REPORT";

type LightRequestRow = {
  id: string;
  requestType: LightType;
  open: boolean;
};

const LIGHT_LABEL: Record<LightType, string> = {
  UPDATE: "Ask for an update",
  ETA: "Ask for ETA",
  REPORT: "Request the report",
};

const LIGHT_PENDING: Record<LightType, string> = {
  UPDATE: "Update requested — we'll reply shortly",
  ETA: "ETA requested — we'll reply shortly",
  REPORT: "Report requested — awaiting the team",
};

/** Small modal shell (Estate-styled, mobile-first bottom sheet). */
function HubModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
      />
      <div className="relative w-full max-w-md rounded-t-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-5 shadow-xl sm:rounded-[var(--e-radius-lg)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-[0.9375rem] font-semibold">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function JobActionHub({
  jobId,
  jobLabel,
  status,
  skipStatus,
  canSkip,
  showClientTaskRequests,
  reportAvailable,
  initialReschedulePending,
  initialAddonPending,
}: {
  jobId: string;
  jobLabel: string;
  status: string;
  skipStatus: string;
  canSkip: boolean;
  showClientTaskRequests: boolean;
  reportAvailable: boolean;
  /** Server-derived: an undecided RESCHEDULE_REQUEST JobTask exists. */
  initialReschedulePending: boolean;
  /** Server-derived: count of undecided add-on task requests. */
  initialAddonPending: number;
}) {
  const router = useRouter();
  // A FOURTH copy of this rule used to live here as
  // `status === "COMPLETED" || status === "INVOICED"`, so the portal happily
  // offered Cancel and Reschedule while a cleaner was mid-clean. The server
  // now refuses those, but offering a button that bounces is a bug of its own.
  const schedulable = isClientSchedulable(status as JobStatus);
  const finished = !schedulable;

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // ── Reschedule ────────────────────────────────────────────────────────────
  const [reschedOpen, setReschedOpen] = useState(false);
  const [reschedDate, setReschedDate] = useState("");
  const [reschedTime, setReschedTime] = useState("");
  const [reschedBusy, setReschedBusy] = useState(false);
  const [reschedPending, setReschedPending] = useState(initialReschedulePending);

  // ── Add-on ────────────────────────────────────────────────────────────────
  const [addonOpen, setAddonOpen] = useState(false);
  const [addonTitle, setAddonTitle] = useState("");
  const [addonDescription, setAddonDescription] = useState("");
  const [addonBusy, setAddonBusy] = useState(false);
  const [addonPending, setAddonPending] = useState(initialAddonPending);

  // ── Light requests ───────────────────────────────────────────────────────
  const [lightBusy, setLightBusy] = useState<LightType | null>(null);
  const [lightConfirm, setLightConfirm] = useState<LightType | null>(null);
  const [openLights, setOpenLights] = useState<Set<LightType>>(new Set());

  // ── Chat ─────────────────────────────────────────────────────────────────
  const [chatOpen, setChatOpen] = useState(false);

  const loadLightRequests = useCallback(async () => {
    try {
      const res = await fetch(`/api/client/jobs/${jobId}/requests`, { cache: "no-store" });
      if (!res.ok) return;
      const payload = await res.json().catch(() => null);
      const rows: LightRequestRow[] = Array.isArray(payload?.requests) ? payload.requests : [];
      setOpenLights(new Set(rows.filter((row) => row.open).map((row) => row.requestType)));
    } catch {
      // Non-fatal — pending chips simply stay hidden.
    }
  }, [jobId]);

  useEffect(() => {
    loadLightRequests();
  }, [loadLightRequests]);

  async function submitReschedule() {
    if (!reschedDate) {
      setError("Pick the new date first.");
      return;
    }
    setReschedBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/jobs/${jobId}/reschedule-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedDate: reschedDate,
          ...(reschedTime ? { startTime: reschedTime } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send the reschedule request.");
      setReschedPending(true);
      setReschedOpen(false);
      setNotice("Reschedule requested — awaiting approval.");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not send the reschedule request.");
    } finally {
      setReschedBusy(false);
    }
  }

  async function submitAddon() {
    if (!addonTitle.trim()) {
      setError("Give the request a short title.");
      return;
    }
    setAddonBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/client/jobs/${jobId}/task-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: addonTitle.trim(),
          description: addonDescription.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not send the add-on request.");
      setAddonPending((count) => count + 1);
      setAddonOpen(false);
      setAddonTitle("");
      setAddonDescription("");
      setNotice("Add-on requested — awaiting approval.");
      router.refresh();
    } catch (err: any) {
      setError(err?.message ?? "Could not send the add-on request.");
    } finally {
      setAddonBusy(false);
    }
  }

  async function submitLight(type: LightType) {
    setLightBusy(type);
    setLightConfirm(null);
    setError(null);
    try {
      const res = await fetch(`/api/client/jobs/${jobId}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setOpenLights((prev) => new Set(prev).add(type));
        setNotice(body.error ?? "You already have an open request of this type.");
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Could not send the request.");
      if (body.alreadyAvailable) {
        // Report is already published — take the client to it instead.
        document.getElementById("job-report")?.scrollIntoView({ behavior: "smooth", block: "center" });
        setNotice("Your report is already available below.");
        return;
      }
      setOpenLights((prev) => new Set(prev).add(type));
      setNotice(LIGHT_PENDING[type]);
    } catch (err: any) {
      setError(err?.message ?? "Could not send the request.");
    } finally {
      setLightBusy(null);
    }
  }

  const lightActions = useMemo(() => {
    const actions: Array<{ type: LightType; icon: React.ReactNode; visible: boolean }> = [
      { type: "UPDATE", icon: <Info className="h-3.5 w-3.5" />, visible: !finished },
      {
        type: "ETA",
        icon: <MapPin className="h-3.5 w-3.5" />,
        visible: ["ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "PAUSED"].includes(status),
      },
      { type: "REPORT", icon: <FileText className="h-3.5 w-3.5" />, visible: !reportAvailable },
    ];
    return actions.filter((action) => action.visible);
  }, [finished, status, reportAvailable]);

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle className="text-[1rem]">Manage this clean</ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-4">
        {notice ? <EInlineNotice tone="success">{notice}</EInlineNotice> : null}
        {error ? <EInlineNotice tone="danger">{error}</EInlineNotice> : null}

        {/* Primary actions */}
        <div className="grid gap-2 sm:grid-cols-2">
          {!finished ? (
            reschedPending ? (
              <div className="flex items-center gap-2 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] px-3 py-2.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                <CalendarClock className="h-4 w-4 shrink-0" />
                Reschedule requested — awaiting approval
              </div>
            ) : (
              <EButton variant="outline" onClick={() => setReschedOpen(true)} className="justify-start">
                <CalendarClock className="h-4 w-4" /> Reschedule
              </EButton>
            )
          ) : null}

          {showClientTaskRequests && !finished ? (
            <EButton variant="outline" onClick={() => setAddonOpen(true)} className="justify-start">
              <ListPlus className="h-4 w-4" /> Request an add-on
              {addonPending > 0 ? (
                <EBadge tone="warning" soft>
                  {addonPending} pending
                </EBadge>
              ) : null}
            </EButton>
          ) : null}

          <EButton variant="outline" onClick={() => setChatOpen(true)} className="justify-start">
            <MessageCircle className="h-4 w-4" /> Message us
          </EButton>
        </div>

        {/* Light requests */}
        {lightActions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--e-border))] pt-3">
            {lightActions.map(({ type, icon }) => {
              const pending = openLights.has(type);
              if (pending) {
                return (
                  <EBadge key={type} tone="warning" soft>
                    {LIGHT_PENDING[type]}
                  </EBadge>
                );
              }
              const confirming = lightConfirm === type;
              return (
                <EButton
                  key={type}
                  size="sm"
                  variant={confirming ? "primary" : "ghost"}
                  disabled={lightBusy !== null}
                  onClick={() => (confirming ? submitLight(type) : setLightConfirm(type))}
                >
                  {lightBusy === type ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
                  {confirming ? `Confirm — ${LIGHT_LABEL[type].toLowerCase()}?` : LIGHT_LABEL[type]}
                </EButton>
              );
            })}
          </div>
        ) : null}

        {/* Skip */}
        {canSkip || skipStatus === "REQUESTED" ? (
          <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--e-border))] pt-3">
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {skipStatus === "REQUESTED"
                ? "Skip request pending admin review."
                : "Don't need this clean?"}
            </p>
            <JobSkipAction jobId={jobId} skipStatus={skipStatus} />
          </div>
        ) : null}
      </ECardBody>

      {/* ── Reschedule modal ── */}
      <HubModal open={reschedOpen} title="Request a new date" onClose={() => setReschedOpen(false)}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <ELabel htmlFor="hub-resched-date">New date</ELabel>
              <EInput
                id="hub-resched-date"
                type="date"
                value={reschedDate}
                onChange={(e) => setReschedDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <ELabel htmlFor="hub-resched-time">Preferred time (optional)</ELabel>
              <EInput
                id="hub-resched-time"
                type="time"
                value={reschedTime}
                onChange={(e) => setReschedTime(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            The team reviews every reschedule — nothing changes until it's approved.
          </p>
          <div className="flex justify-end gap-2">
            <EButton variant="ghost" size="sm" onClick={() => setReschedOpen(false)} disabled={reschedBusy}>
              Cancel
            </EButton>
            <EButton size="sm" onClick={submitReschedule} disabled={reschedBusy || !reschedDate}>
              {reschedBusy ? "Sending…" : "Send request"}
            </EButton>
          </div>
        </div>
      </HubModal>

      {/* ── Add-on modal ── */}
      <HubModal open={addonOpen} title="Request an add-on" onClose={() => setAddonOpen(false)}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <ELabel htmlFor="hub-addon-title">What would you like done?</ELabel>
            <EInput
              id="hub-addon-title"
              value={addonTitle}
              onChange={(e) => setAddonTitle(e.target.value)}
              placeholder="e.g. Clean the oven"
              maxLength={160}
            />
          </div>
          <div className="space-y-1.5">
            <ELabel htmlFor="hub-addon-description">Details (optional)</ELabel>
            <ETextarea
              id="hub-addon-description"
              rows={3}
              value={addonDescription}
              onChange={(e) => setAddonDescription(e.target.value)}
              placeholder="Anything the cleaner should know"
            />
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Add-ons go to the team for approval before they reach the cleaner.
          </p>
          <div className="flex justify-end gap-2">
            <EButton variant="ghost" size="sm" onClick={() => setAddonOpen(false)} disabled={addonBusy}>
              Cancel
            </EButton>
            <EButton size="sm" onClick={submitAddon} disabled={addonBusy || !addonTitle.trim()}>
              {addonBusy ? "Sending…" : "Send request"}
            </EButton>
          </div>
        </div>
      </HubModal>

      {/* ── Per-job chat ── */}
      <JobChatSheet jobId={jobId} jobLabel={jobLabel} open={chatOpen} onClose={() => setChatOpen(false)} />
    </ECard>
  );
}
