"use client";

/**
 * Reusable leaf parts shared across the cleaner journey stages — moved verbatim
 * out of `job-workspace.tsx` so multiple stages (Set up / Clean) and the header
 * can render them without duplicating logic. Behaviour is unchanged.
 */
import * as React from "react";
import {
  Clock,
  Play,
  Pause,
  Loader2,
  CheckCircle2,
  MapPin,
  AlertTriangle,
  BookOpen,
  Package,
  ClipboardCheck,
} from "lucide-react";
import { EBadge, ECard, ECardBody, EButton } from "@/components/v2/ui/primitives";
import { MediaGallery } from "@/components/shared/media-gallery";
import { cn } from "@/lib/utils";
import { formatDuration, elapsedSecondsSince } from "@/lib/time/format-duration";

/* ── Live "time on site" chip (header) ───────────────────────────────────── */
export function LiveTimerChip({ timeState }: { timeState: any }) {
  const isRunning: boolean = Boolean(timeState?.isRunning);
  const completedSeconds: number = timeState?.completedSeconds ?? 0;
  const activeStartedAt: string | null = timeState?.activeStartedAt ?? null;
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  const totalSeconds = isRunning ? elapsedSecondsSince(activeStartedAt, completedSeconds) : completedSeconds;
  if (!isRunning && totalSeconds <= 0) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] px-2.5 py-1 text-[0.8125rem] font-[550] tabular-nums",
        isRunning
          ? "bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-success))]"
          : "bg-[hsl(var(--e-muted))] text-[hsl(var(--e-muted-foreground))]"
      )}
    >
      {isRunning ? <span className="h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--e-success))]" /> : <Clock className="h-3.5 w-3.5" />}
      {formatDuration(totalSeconds)}
    </span>
  );
}

/* ── Clock / GPS control ─────────────────────────────────────────────────── */
export function ClockCard({
  status,
  locked,
  hasCheckin,
  isRunning,
  completedSeconds,
  activeStartedAt,
  maxAllowedTotalSeconds,
  busy,
  clockInDisabled,
  onClockIn,
  onPause,
}: {
  status: string;
  locked: boolean;
  hasCheckin: boolean;
  isRunning: boolean;
  completedSeconds: number;
  activeStartedAt: string | null;
  maxAllowedTotalSeconds: number | null;
  busy: string | null;
  clockInDisabled?: boolean;
  onClockIn: () => void;
  onPause: () => void;
}) {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  const totalSeconds = isRunning ? elapsedSecondsSince(activeStartedAt, completedSeconds) : completedSeconds;
  const overrunSeconds =
    isRunning && maxAllowedTotalSeconds != null && totalSeconds > maxAllowedTotalSeconds
      ? totalSeconds - maxAllowedTotalSeconds
      : 0;
  const overPlanned = overrunSeconds > 0;

  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <div className="flex items-center justify-between">
          <p className="e-eyebrow flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Time on site
          </p>
          <span className="inline-flex items-center gap-2 text-[0.875rem] font-[550] tabular-nums">
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 text-[hsl(var(--e-success))]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[hsl(var(--e-success))]" />
                {formatDuration(totalSeconds)}
              </span>
            ) : (
              <span className="text-[hsl(var(--e-muted-foreground))]">{formatDuration(totalSeconds)} logged</span>
            )}
            {overPlanned ? (
              <EBadge tone="warning" soft>
                +{formatDuration(overrunSeconds)} over planned
              </EBadge>
            ) : null}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isRunning ? "bg-[hsl(var(--e-success))]" : "bg-[hsl(var(--e-text-faint))]"
              )}
            />
            {isRunning ? "Clock running" : hasCheckin ? "Clock stopped" : "Not clocked in"}
          </span>
          {hasCheckin ? (
            <span className="inline-flex items-center gap-1 text-[hsl(var(--e-text-faint))]">
              <MapPin className="h-3.5 w-3.5" /> GPS captured at check-in
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {!isRunning && !locked ? (
            <EButton variant="primary" disabled={busy === "clockin" || clockInDisabled} onClick={onClockIn}>
              {busy === "clockin" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {hasCheckin ? "Resume · clock in" : "Clock in (GPS)"}
            </EButton>
          ) : null}
          {isRunning && !locked ? (
            <EButton variant="outline" disabled={busy === "pause"} onClick={onPause}>
              {busy === "pause" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
              Pause clock
            </EButton>
          ) : null}
        </div>
        {clockInDisabled ? (
          <p className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-gold-ink))]">
            <ClipboardCheck className="h-3.5 w-3.5" /> Complete the confirmations above to clock in.
          </p>
        ) : !hasCheckin && !locked ? (
          <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
            Clocking in captures your GPS location at the property.
          </p>
        ) : null}
      </ECardBody>
    </ECard>
  );
}

/* ── Task decision chip ──────────────────────────────────────────────────── */
export function TaskChip({
  active,
  disabled,
  tone = "primary",
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  tone?: "primary" | "warning";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeCls =
    tone === "warning"
      ? "border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] text-[hsl(var(--e-foreground))]"
      : "border-[hsl(var(--e-success))] bg-[hsl(var(--e-success-soft))] text-[hsl(var(--e-foreground))]";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--e-radius-pill)] border px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors disabled:opacity-50",
        active
          ? activeCls
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
      )}
    >
      {children}
    </button>
  );
}

/* ── Pre-start job briefing ──────────────────────────────────────────────── */
export function BriefingCard({ briefing }: { briefing: any }) {
  if (!briefing) return null;
  // Access details (accessCode/alarmCode/keyLocation/accessNotes) are DELIBERATELY
  // not rendered here — access lives in exactly ONE cleaner surface,
  // PropertyAccessGuide. This card keeps only the non-access briefing content.
  const reworkNotes: any[] = Array.isArray(briefing.qaReworkNotes) ? briefing.qaReworkNotes : [];
  const flags: string[] = Array.isArray(briefing.previousFlags) ? briefing.previousFlags : [];
  const lastPhotos: any[] = Array.isArray(briefing.lastPhotos) ? briefing.lastPhotos : [];
  const drop = briefing.previousLaundryDrop;
  const hasContent =
    briefing.priorQaWarning ||
    reworkNotes.length > 0 ||
    drop ||
    lastPhotos.length > 0 ||
    briefing.jobNotes ||
    flags.length > 0 ||
    briefing.laundryInstructions;
  if (!hasContent) return null;

  return (
    <ECard>
      <ECardBody className="space-y-4 pt-6">
        <p className="e-eyebrow flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5" /> Job briefing
        </p>

        {briefing.priorQaWarning ? (
          <div
            className={cn(
              "rounded-[var(--e-radius)] border-l-[3px] p-3",
              briefing.priorQaWarning.band === "FAIL"
                ? "border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))]"
                : "border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))]"
            )}
          >
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Previous QA at this property: {briefing.priorQaWarning.percent}% ({briefing.priorQaWarning.band})
            </p>
            <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              {briefing.priorQaWarning.cleanerFeedback ||
                briefing.priorQaWarning.inspectorNotes ||
                "Take extra care today — review the checklist carefully."}
            </p>
          </div>
        ) : null}

        {reworkNotes.length > 0 ? (
          <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-warning))] bg-[hsl(var(--e-warning-soft))] p-3">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
              <AlertTriangle className="h-4 w-4 shrink-0" /> QA had to redo work on this job
            </p>
            <div className="mt-2 space-y-2">
              {reworkNotes.map((note: any) => (
                <div key={note.id}>
                  <p className="text-[0.75rem] font-[550]">
                    {String(note.severity ?? "").charAt(0) + String(note.severity ?? "").slice(1).toLowerCase()}
                    {note.qaUser?.name ? ` · ${note.qaUser.name}` : " · QA inspector"}
                    {note.minutesFromCleaner > 0 ? ` · ${note.minutesFromCleaner} min` : ""}
                  </p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{note.reason}</p>
                  {Array.isArray(note.areas) && note.areas.length > 0 ? (
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Areas: {note.areas.join(", ")}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {drop ? (
          <div className="rounded-[var(--e-radius)] border-l-[3px] border-[hsl(var(--e-info))] bg-[hsl(var(--e-info-soft))] p-3">
            <p className="flex items-center gap-1.5 text-[0.8125rem] font-[550]">
              <Package className="h-4 w-4 shrink-0" /> Linen drop — where to find it
            </p>
            <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
              Fresh linen from the last drop-off
              {drop.droppedAt
                ? ` on ${new Date(drop.droppedAt).toLocaleString("en-AU", {
                    weekday: "short",
                    day: "2-digit",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}`
                : ""}
              . Use this to locate the bags before you start.
            </p>
            {drop.notes ? (
              <p className="mt-2 whitespace-pre-wrap rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface))] px-2 py-1.5 text-[0.75rem]">
                {drop.notes}
              </p>
            ) : null}
            {drop.photo?.url ? (
              <div className="mt-2 max-w-[10rem]">
                <MediaGallery
                  items={[
                    {
                      id: drop.photo.url,
                      url: drop.photo.url,
                      label: drop.photo.label || "Linen drop-off",
                      mediaType: (drop.photo as any).mediaType,
                    },
                  ]}
                  title={drop.photo.label || "Linen drop-off"}
                  className="grid grid-cols-1"
                />
              </div>
            ) : (
              <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                No drop-off photo was captured — check the usual linen storage spot.
              </p>
            )}
          </div>
        ) : null}

        {lastPhotos.length > 0 ? (
          <div>
            <p className="text-[0.8125rem] font-[550]">Recent property photos</p>
            <MediaGallery
              items={lastPhotos.slice(0, 6).map((photo: any) => ({
                id: photo.id ?? photo.url,
                url: photo.url,
                label: photo.label || undefined,
                mediaType: photo.mediaType,
              }))}
              title="Recent property photos"
              className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6"
            />
          </div>
        ) : null}

        {briefing.jobNotes || flags.length > 0 || briefing.laundryInstructions ? (
          <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
            <p className="text-[0.8125rem] font-[550]">Operational notes</p>
            {briefing.jobNotes ? (
              <div>
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Job notes</p>
                <p className="whitespace-pre-wrap text-[0.8125rem]">{briefing.jobNotes}</p>
              </div>
            ) : null}
            {flags.length > 0 ? (
              <div>
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Previous QA flags</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {flags.map((flag) => (
                    <EBadge key={flag} tone="warning" soft>
                      {flag}
                    </EBadge>
                  ))}
                </div>
              </div>
            ) : null}
            {briefing.laundryInstructions ? (
              <div>
                <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">Laundry</p>
                <p className="text-[0.8125rem]">{String(briefing.laundryInstructions.status ?? "").replace(/_/g, " ")}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </ECardBody>
    </ECard>
  );
}
