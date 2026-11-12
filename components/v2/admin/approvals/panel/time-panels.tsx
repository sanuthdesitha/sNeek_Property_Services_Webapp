"use client";

/**
 * Side-panel decisions for time: clock adjustments (recorded against
 * requested, approve with minutes or reject) and timing requests (early
 * check-in / late checkout). Same routes and bodies as before the redesign.
 */
import * as React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { minutesText } from "@/lib/admin/approvals/rows";
import { ConfirmButton, ContextLinks, DetailList, PanelSection, formatDay, formatInstant, jobHref, type QueuePanelProps } from "./panel-kit";

type ClockRecord = {
  timeLog?: { startedAt?: string | null; stoppedAt?: string | null; durationM?: number | null } | null;
  originalStoppedAt?: string | null;
  requestedStoppedAt?: string | null;
};

const FIELD =
  "h-10 w-32 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem] " +
  "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

export function ClockPanel({ row, busy, decide, timezone }: QueuePanelProps) {
  const record = row.record;
  const clock = record as typeof record & ClockRecord;
  const requested = Number(record.requestedDurationM ?? record.requestedTotalDurationM ?? 0);
  const original = record.originalDurationM ?? clock.timeLog?.durationM ?? null;
  const delta = typeof original === "number" ? requested - original : null;
  const [minutes, setMinutes] = React.useState(String(requested));
  const id = React.useId();

  return (
    <>
      <PanelSection title="What was asked">
        <DetailList
          items={[
            ["Recorded", <>{minutesText(original) ?? "—"} <span className="text-[hsl(var(--e-muted-foreground))]">{formatInstant(clock.timeLog?.startedAt, timezone, "HH:mm")} → {formatInstant(clock.originalStoppedAt ?? clock.timeLog?.stoppedAt, timezone, "HH:mm")}</span></>],
            ["Requested", <>{minutesText(requested) ?? "—"}{delta ? <span className="ml-1 font-[600]">({delta > 0 ? "+" : "−"}{minutesText(Math.abs(delta))})</span> : null} <span className="text-[hsl(var(--e-muted-foreground))]">→ {formatInstant(clock.requestedStoppedAt, timezone, "HH:mm")}</span></>],
            record.reason ? ["Reason", `“${record.reason}”`] : null,
          ]}
        />
        <ContextLinks links={[jobHref(row) ? { href: jobHref(row)!, label: "View job" } : null]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy} className="flex flex-col gap-2">
          <label htmlFor={id} className="text-[0.75rem] font-[550]">Approve minutes</label>
          <input id={id} className={FIELD} type="number" min="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <EButton
              size="sm"
              variant="gold"
              onClick={() => {
                const value = Number(minutes);
                if (!Number.isFinite(value) || value < 1) return toast({ title: "Enter a valid duration in minutes.", variant: "destructive" });
                void decide({ url: `/api/admin/time-adjustments/${record.id}`, body: { status: "APPROVED", approvedDurationM: Math.round(value) }, successMsg: "Clock adjustment approved" });
              }}
            >
              <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Approve {minutesText(Number(minutes)) ?? ""}
            </EButton>
            <ConfirmButton
              label={<><XCircle aria-hidden className="h-3.5 w-3.5" /> Reject</>}
              confirmLabel="Confirm reject"
              onConfirm={() => void decide({ url: `/api/admin/time-adjustments/${record.id}`, body: { status: "REJECTED" }, successMsg: "Clock adjustment rejected" })}
            />
          </div>
        </fieldset>
      </PanelSection>
    </>
  );
}

export function TimingPanel({ row, busy, decide }: QueuePanelProps) {
  const record = row.record;
  const url = `/api/admin/job-early-checkouts/${record.id}`;
  return (
    <>
      <PanelSection title="What was asked">
        <DetailList
          items={[
            ["Request", row.type.label],
            ["Job date", formatDay(record.job?.scheduledDate)],
            record.requestedTime ? ["Time", record.requestedTime] : null,
            record.note ? ["Note", record.note] : null,
          ]}
        />
        <ContextLinks links={[jobHref(row) ? { href: jobHref(row)!, label: "View job" } : null]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy} className="flex flex-wrap gap-2">
          <EButton size="sm" variant="gold" onClick={() => void decide({ url, body: { status: "APPROVED" }, successMsg: "Timing request approved" })}>
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Approve
          </EButton>
          <ConfirmButton
            label={<><XCircle aria-hidden className="h-3.5 w-3.5" /> Decline</>}
            confirmLabel="Confirm decline"
            onConfirm={() => void decide({ url, body: { status: "DECLINED" }, successMsg: "Timing request declined" })}
          />
        </fieldset>
      </PanelSection>
    </>
  );
}
