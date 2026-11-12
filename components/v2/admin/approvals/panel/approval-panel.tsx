"use client";

/**
 * The Approvals side panel for one waiting request: what was asked, its
 * context, the queue's own decision controls and its history line. Keyed by
 * the request id by the caller, so drafts never leak between requests.
 */
import * as React from "react";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { APPROVAL_QUEUES } from "@/lib/admin/approvals/queues";
import { money, waitedMs, waitingLong, type ApprovalQueueRow, type BookingAvailability } from "@/lib/admin/approvals/rows";
import { PanelSection, formatDay, formatInstant, type QueuePanelProps } from "./panel-kit";
import { AccountabilityPayPanel, PayRequestPanel } from "./pay-panels";
import { ClockPanel, TimingPanel } from "./time-panels";
import { ClientApprovalPanel, ClientRequestPanel, ReschedulePanel, SkipPanel } from "./client-panels";
import { BookingPanel } from "./booking-panel";
import { FalseConfirmationPanel, ManagementReviewPanel, PayClaimPanel, QaOutcomePanel, QaReworkPanel, ReviewOnlyPanel } from "./quality-panels";

type ApprovalPanelProps = Omit<QueuePanelProps, "row"> & {
  row: ApprovalQueueRow;
  availability: BookingAvailability | null;
  now: number;
  onClose: () => void;
};

function QueueBody(props: QueuePanelProps & { availability: BookingAvailability | null }) {
  switch (props.row.queue) {
    case "payAdjustments":
      return <PayRequestPanel {...props} />;
    case "rectificationAdjustments":
    case "bonusProposals":
      return <AccountabilityPayPanel {...props} />;
    case "timeAdjustments":
      return <ClockPanel {...props} />;
    case "timingRequests":
      return <TimingPanel {...props} />;
    case "clientApprovals":
      return <ClientApprovalPanel {...props} />;
    case "clientRequests":
      return <ClientRequestPanel {...props} />;
    case "rescheduleRequests":
      return <ReschedulePanel {...props} />;
    case "skipRequests":
      return <SkipPanel {...props} />;
    case "bookingRequests":
      return <BookingPanel {...props} />;
    case "qaReworkTransfers":
      return <QaReworkPanel {...props} />;
    case "qaOutcomes":
      return <QaOutcomePanel {...props} />;
    case "falseConfirmations":
      return <FalseConfirmationPanel {...props} />;
    case "managementReviews":
      return <ManagementReviewPanel {...props} />;
    case "cleanerInvoicePayClaims":
      return <PayClaimPanel {...props} />;
    case "continuations":
    case "flaggedLaundry":
      return <ReviewOnlyPanel {...props} />;
  }
}

function panelTitle(row: ApprovalQueueRow): string {
  const asked = row.askedAmount != null ? money(row.askedAmount) : null;
  return asked ? `${row.who}, ${asked}` : row.who !== "—" ? row.who : row.propertyName ?? APPROVAL_QUEUES[row.queue].label;
}

export function ApprovalPanel({ row, availability, now, onClose, ...rest }: ApprovalPanelProps) {
  const queue = APPROVAL_QUEUES[row.queue];
  const waited = waitedMs(row, now);
  const day = row.record.job?.scheduledDate ?? row.record.scheduledDate ?? null;
  const subtitle = [row.jobLabel, row.propertyName, day ? formatDay(day) : null].filter(Boolean).join(" · ");
  return (
    <ESidePanel
      open
      label="Request detail"
      onClose={onClose}
      toolbar={<span className="e-eyebrow">{queue.noun.charAt(0).toUpperCase() + queue.noun.slice(1)} · {waitingLong(waited)} waiting</span>}
      title={panelTitle(row)}
      subtitle={subtitle || undefined}
    >
      <QueueBody {...rest} row={row} availability={availability} />
      <PanelSection title="History">
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {formatInstant(row.waitingSince, rest.timezone)} · {row.queue === "flaggedLaundry" ? "Flagged" : "Requested"}
          {row.record.requestedBy?.name ? ` by ${row.record.requestedBy.name}` : row.record.cleaner?.name ? ` by ${row.record.cleaner.name}` : ""}
        </p>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Decisions are recorded on the Decided tab.</p>
      </PanelSection>
    </ESidePanel>
  );
}
