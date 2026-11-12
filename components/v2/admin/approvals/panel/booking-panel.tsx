"use client";

/**
 * Approve or decline one booking request, with team availability for its day.
 * Decline needs a written reason (emailed to the client); approve may move the
 * date. POST /api/admin/booking-requests as before the redesign.
 */
import * as React from "react";
import { CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import type { BookingAvailability } from "@/lib/admin/approvals/rows";
import { ConfirmButton, ContextLinks, DetailList, PanelSection, formatDay, type QueuePanelProps } from "./panel-kit";

const FIELD =
  "w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-2.5 text-[16px] sm:text-[0.8125rem] " +
  "focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]";

export function BookingPanel({ row, busy, decide, availability }: QueuePanelProps & { availability: BookingAvailability | null }) {
  const record = row.record;
  const [mode, setMode] = React.useState<"idle" | "move" | "decline">("idle");
  const [date, setDate] = React.useState(record.scheduledDate ?? "");
  const [reason, setReason] = React.useState("");
  const ids = React.useId();
  const tight = availability ? availability.freeCleaners <= 0 : false;

  function approve(scheduledDate?: string) {
    void decide({
      url: "/api/admin/booking-requests",
      method: "POST",
      body: { requestId: record.id, action: "approve", ...(scheduledDate ? { scheduledDate } : {}) },
      successMsg: "Booking approved — job created",
    });
  }

  return (
    <>
      <PanelSection title="What was asked">
        <DetailList
          items={[
            ["Client", record.clientName ?? "—"],
            ["Service", row.type.label],
            ["Date", record.scheduledDate ? formatDay(record.scheduledDate) : "No date on this request"],
            availability
              ? ["Team", <span key="t" className={tight ? "text-[hsl(var(--e-danger))]" : undefined}>{availability.freeCleaners} of {availability.activeCleaners} cleaners free · {availability.jobsScheduled} job{availability.jobsScheduled === 1 ? "" : "s"} that day{availability.unassignedJobs > 0 ? ` · ${availability.unassignedJobs} still unassigned` : ""}</span>]
              : null,
            record.notes ? ["Notes", record.notes] : null,
          ]}
        />
        <ContextLinks links={[record.property?.id ? { href: `/v2/admin/properties/${record.property.id}`, label: "View property" } : null]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy} className="flex flex-col gap-2">
          {mode === "decline" ? (
            <>
              <label htmlFor={`${ids}-reason`} className="text-[0.75rem] font-[550]">Reason (emailed to the client)</label>
              <textarea id={`${ids}-reason`} autoFocus rows={3} maxLength={500} className={FIELD + " py-2"} value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="flex gap-2">
                <EButton
                  size="sm"
                  variant="danger"
                  disabled={reason.trim().length === 0}
                  onClick={() => void decide({ url: "/api/admin/booking-requests", method: "POST", body: { requestId: record.id, action: "decline", reason: reason.trim() }, successMsg: "Booking declined — client notified" })}
                >
                  Send decline
                </EButton>
                <EButton size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</EButton>
              </div>
            </>
          ) : mode === "move" ? (
            <>
              <label htmlFor={`${ids}-date`} className="text-[0.75rem] font-[550]">Approve on a different date</label>
              <input id={`${ids}-date`} type="date" className={FIELD + " h-10"} value={date} onChange={(e) => setDate(e.target.value)} />
              <div className="flex gap-2">
                <EButton size="sm" variant="gold" disabled={!date} onClick={() => approve(date)}>Approve on this date</EButton>
                <EButton size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</EButton>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <ConfirmButton
                label={<><CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Approve</>}
                confirmLabel={tight ? "Nobody free — approve anyway" : "Confirm — create the job"}
                variant="gold"
                onConfirm={() => approve()}
              />
              <EButton size="sm" variant="outline" onClick={() => setMode("move")}>
                <CalendarClock aria-hidden className="h-3.5 w-3.5" /> Different date
              </EButton>
              <EButton size="sm" variant="outline" onClick={() => setMode("decline")}>
                <XCircle aria-hidden className="h-3.5 w-3.5" /> Decline
              </EButton>
            </div>
          )}
        </fieldset>
      </PanelSection>
    </>
  );
}
