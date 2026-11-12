"use client";

/**
 * Side-panel decisions for client-raised requests: client approvals (with the
 * counter-offer), light client requests (ETA reply, publish report, handled,
 * dismiss), reschedules and skips. Same routes and bodies as before.
 */
import * as React from "react";
import { CheckCircle2, Send, XCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { ConfirmButton, ContextLinks, DetailList, PanelNote, PanelSection, formatDay, formatInstant, jobHref, type QueuePanelProps } from "./panel-kit";

export function ClientApprovalPanel({ row, busy, decide, timezone }: QueuePanelProps) {
  const record = row.record;
  const url = `/api/admin/client-approvals/${record.id}`;
  const countered = record.status === "COUNTERED";
  const currency = record.currency ?? "AUD";
  return (
    <>
      <PanelSection title="What was asked">
        <DetailList
          items={[
            ["Client", record.client?.name ?? "Client"],
            record.property?.name ? ["Property", record.property.name] : null,
            ["Amount", `${currency} ${Number(record.amount ?? 0).toFixed(2)}`],
            countered ? ["Counter-offer", <span key="c" className="text-[hsl(var(--e-warning))]">{currency} {Number(record.counterAmount ?? 0).toFixed(2)}{record.counterNote ? ` — “${record.counterNote}”` : ""}</span>] : null,
            record.description ? ["Detail", record.description] : null,
            typeof record.expiresAt === "string" ? ["Expires", formatInstant(record.expiresAt, timezone)] : null,
          ]}
        />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy} className="flex flex-wrap gap-2">
          {countered ? (
            <EButton
              size="sm"
              variant="gold"
              onClick={() => void decide({ url, body: { status: "APPROVED", amount: Number(record.counterAmount ?? record.amount ?? 0) }, successMsg: "Counter-offer accepted" })}
            >
              <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Accept {currency} {Number(record.counterAmount ?? 0).toFixed(2)}
            </EButton>
          ) : null}
          <EButton size="sm" variant={countered ? "outline" : "gold"} onClick={() => void decide({ url, body: { status: "APPROVED" }, successMsg: "Approved" })}>
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> {countered ? "Approve original" : "Approve"}
          </EButton>
          <ConfirmButton
            label={<><XCircle aria-hidden className="h-3.5 w-3.5" /> Decline</>}
            confirmLabel="Confirm decline"
            onConfirm={() => void decide({ url, body: { status: "DECLINED" }, successMsg: "Declined" })}
          />
        </fieldset>
        {countered ? <PanelNote>Accepting the counter-offer records the client's figure as the agreed amount.</PanelNote> : null}
      </PanelSection>
    </>
  );
}

export function ClientRequestPanel({ row, busy, decide }: QueuePanelProps) {
  const record = row.record;
  const kind = String(record.metadata?.requestType ?? "UPDATE");
  const eta = typeof record.job?.enRouteEtaMinutes === "number" ? record.job.enRouteEtaMinutes : null;
  const reportVisible = record.job?.report?.clientVisible === true;
  const taskUrl = `/api/admin/job-tasks/${record.id}`;
  const [preparing, setPreparing] = React.useState(false);

  /** Optional pre-action (chat reply / publish report), then mark the request handled. */
  async function handle(pre?: () => Promise<void>) {
    if (pre) {
      setPreparing(true);
      try {
        await pre();
      } catch (error) {
        toast({ title: "Failed", description: error instanceof Error ? error.message : "Action failed", variant: "destructive" });
        return;
      } finally {
        setPreparing(false);
      }
    }
    await decide({ url: taskUrl, body: { decision: "APPROVE" }, successMsg: "Client request handled" });
  }

  async function post(url: string, method: "POST" | "PATCH", body: object, failure: string) {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? failure);
  }

  const chatHref = record.jobId ? `/v2/admin/jobs/${record.jobId}#chat` : null;
  return (
    <>
      <PanelSection title="What was asked">
        <DetailList
          items={[
            ["Request", `${row.type.label} request`],
            typeof record.metadata?.note === "string" ? ["Note", `“${record.metadata.note}”`] : null,
            ["Requested by", record.requestedBy?.name ?? record.requestedBy?.email ?? "Client"],
            record.job?.status ? ["Job status", String(record.job.status).replace(/_/g, " ").toLowerCase()] : null,
          ]}
        />
        <ContextLinks links={[jobHref(row) ? { href: jobHref(row)!, label: "View job" } : null]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy || preparing} className="flex flex-wrap gap-2">
          {kind === "ETA" && eta != null && record.jobId ? (
            <EButton size="sm" variant="gold" onClick={() => void handle(() => post(`/api/admin/messages/job/${record.jobId}`, "POST", { body: `Your cleaner is about ~${eta} min away.` }, "Could not send the ETA reply."))}>
              <Send aria-hidden className="h-3.5 w-3.5" /> Send ETA reply (~{eta} min)
            </EButton>
          ) : null}
          {kind === "REPORT" && record.jobId && !reportVisible ? (
            <EButton size="sm" variant="gold" onClick={() => void handle(() => post(`/api/admin/reports/${record.jobId}/visibility`, "PATCH", { clientVisible: true }, "Could not publish the report."))}>
              <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Publish report
            </EButton>
          ) : null}
          {chatHref && (kind !== "ETA" || eta == null) && kind !== "REPORT" ? (
            <EButton size="sm" variant="outline-gold" asChild>
              <a href={chatHref}>Reply in chat</a>
            </EButton>
          ) : null}
          <EButton size="sm" variant="outline" onClick={() => void handle()}>
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Mark handled
          </EButton>
          <ConfirmButton
            label={<><XCircle aria-hidden className="h-3.5 w-3.5" /> Dismiss</>}
            confirmLabel="Confirm dismiss"
            onConfirm={() => void decide({ url: taskUrl, body: { decision: "REJECT" }, successMsg: "Client request dismissed" })}
          />
        </fieldset>
      </PanelSection>
    </>
  );
}

export function ReschedulePanel({ row, busy, decide }: QueuePanelProps) {
  const record = row.record;
  const requestedDate = typeof record.metadata?.requestedDate === "string" ? record.metadata.requestedDate : null;
  const requestedTime = typeof record.metadata?.requestedStartTime === "string" ? record.metadata.requestedStartTime : null;
  const url = `/api/admin/job-tasks/${record.id}`;
  return (
    <>
      <PanelSection title="What was asked">
        <DetailList
          items={[
            ["Current", `${formatDay(record.job?.scheduledDate)}${record.job?.startTime ? ` ${record.job.startTime}` : ""}`],
            ["Requested", requestedDate ? `${formatDay(requestedDate)}${requestedTime ? ` at ${requestedTime}` : ""}` : "—"],
            ["Requested by", record.requestedBy?.name ?? record.requestedBy?.email ?? "Client"],
          ]}
        />
        <ContextLinks links={[jobHref(row) ? { href: jobHref(row)!, label: "View job" } : null]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy} className="flex flex-wrap gap-2">
          <EButton size="sm" variant="gold" onClick={() => void decide({ url, body: { decision: "APPROVE" }, successMsg: "Reschedule approved — job date updated" })}>
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Approve
          </EButton>
          <ConfirmButton
            label={<><XCircle aria-hidden className="h-3.5 w-3.5" /> Decline</>}
            confirmLabel="Confirm decline"
            onConfirm={() => void decide({ url, body: { decision: "REJECT" }, successMsg: "Reschedule declined" })}
          />
        </fieldset>
        <PanelNote>Approving moves the job to the requested date.</PanelNote>
      </PanelSection>
    </>
  );
}

export function SkipPanel({ row, busy, decide }: QueuePanelProps) {
  const record = row.record;
  const url = `/api/admin/jobs/${record.id}/skip`;
  return (
    <>
      <PanelSection title="What was asked">
        <DetailList
          items={[
            ["Scheduled", `${formatDay(record.scheduledDate)}${record.startTime ? ` ${record.startTime}` : ""}`],
            record.cleanSkipReason ? ["Reason", record.cleanSkipReason] : null,
            ["Requested by", record.requestedBy?.name ?? record.requestedBy?.email ?? "Client"],
          ]}
        />
        <ContextLinks links={[{ href: `/v2/admin/jobs/${record.id}`, label: "View job" }]} />
      </PanelSection>
      <PanelSection title="Decision" tone="decision">
        <fieldset disabled={busy} className="flex flex-wrap gap-2">
          <ConfirmButton
            label={<><CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Approve skip</>}
            confirmLabel="Confirm — cancel clean"
            variant="gold"
            onConfirm={() => void decide({ url, body: { action: "approve" }, successMsg: "Skip approved — clean cancelled" })}
          />
          <ConfirmButton
            label={<><XCircle aria-hidden className="h-3.5 w-3.5" /> Decline</>}
            confirmLabel="Confirm decline"
            onConfirm={() => void decide({ url, body: { action: "decline" }, successMsg: "Skip declined" })}
          />
        </fieldset>
        <PanelNote>Approving a skip cancels this clean.</PanelNote>
      </PanelSection>
    </>
  );
}
