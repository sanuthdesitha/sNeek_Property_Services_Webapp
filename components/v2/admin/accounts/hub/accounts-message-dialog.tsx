"use client";

/**
 * Accounts bulk "Message": subject, body and explicit transports, sent to the
 * selected staff through the existing staff message route (ADMIN and
 * OPS_MANAGER). Before sending it lists who will be skipped and why (clients,
 * disabled accounts) by the route's own rules; afterwards it shows each
 * recipient's real delivery states and anyone the server refused. The draft
 * is kept, with the server's message, when the request fails; one idempotency
 * key per draft makes a retry the same request.
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import { planStaffMessage } from "@/lib/accounts/message-recipients";
import type { AccountRow } from "@/lib/accounts/list/types";
import { TRANSPORT_CHOICE_LABELS, newRequestKey, officeRequest, type OfficeActionResult, type OfficeTransportChoice } from "../../office-actions/office-outcomes";
import { OfficeOutcomeList, TransportChoices } from "../../office-actions/outcome-list";

export const STAFF_MESSAGE_ENDPOINT = "/api/admin/notifications/actions/staff-message";
const CHOICES: readonly OfficeTransportChoice[] = ["PUSH", "EMAIL"];
const LABEL = "text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]";

type SendState = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; result: OfficeActionResult };

type Props = { open: boolean; rows: AccountRow[]; onClose: () => void; onRunningChange: (running: boolean) => void };

export function AccountsMessageDialog({ open, rows, onClose, onRunningChange }: Props) {
  const subjectId = React.useId();
  const bodyId = React.useId();
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [transports, setTransports] = React.useState<OfficeTransportChoice[]>(["PUSH"]);
  const [send, setSend] = React.useState<SendState>({ status: "idle" });
  const [key, setKey] = React.useState(() => newRequestKey("staff-msg"));
  const plan = React.useMemo(() => planStaffMessage(rows), [rows]);
  const names = React.useMemo(() => new Map(rows.map((row) => [row.id, row.name ?? row.email])), [rows]);
  const sending = send.status === "sending";
  const done = send.status === "done";
  const canSend = plan.recipients.length > 0 && subject.trim().length > 0 && body.trim().length > 0 && transports.length > 0 && !sending && !done;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    setSend({ status: "sending" });
    onRunningChange(true);
    const result = await officeRequest<OfficeActionResult>(STAFF_MESSAGE_ENDPOINT, {
      body: { recipientIds: plan.recipients.map((row) => row.id), subject: subject.trim(), body: body.trim(), transports, idempotencyKey: key },
    });
    onRunningChange(false);
    setSend(result.ok ? { status: "done", result: result.body } : { status: "failed", message: result.message });
  }

  function close() {
    if (sending) return;
    if (done) {
      // The message went out: the next one starts empty with a new key.
      setSubject("");
      setBody("");
      setKey(newRequestKey("staff-msg"));
      setSend({ status: "idle" });
    }
    onClose();
  }

  const formId = `${bodyId}-form`;
  return (
    <EActionDialog
      open={open}
      busy={sending}
      onClose={close}
      eyebrow="Accounts"
      title="Message selected staff"
      footer={done ? <EButton size="sm" onClick={close}>Close</EButton> : (
        <>
          <EButton size="sm" variant="outline" disabled={sending} onClick={close}>Cancel</EButton>
          <EButton type="submit" form={formId} size="sm" disabled={!canSend}>{sending ? "Sending request…" : `Message ${plan.recipients.length}`}</EButton>
        </>
      )}
    >
      <p>{plan.recipients.length} of {rows.length} selected will be messaged.</p>
      {plan.skipped.length > 0 && !done ? (
        <div className="space-y-1">
          <p className="e-eyebrow">Skipped</p>
          <ul aria-label="Skipped" className="max-h-32 divide-y divide-[hsl(var(--e-border))] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
            {plan.skipped.map(({ row, reason }) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 px-3 py-1.5 text-[0.8125rem]">
                <span className="min-w-0 font-[550] [overflow-wrap:anywhere]">{row.name ?? row.email}</span>
                <span className="text-[hsl(var(--e-muted-foreground))]">{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {done ? null : (
        <form id={formId} onSubmit={(event) => void submit(event)}>
          <fieldset disabled={sending} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor={subjectId} className={LABEL}>Subject</label>
              <EInput id={subjectId} data-autofocus maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} />
            </div>
            <div className="space-y-1">
              <label htmlFor={bodyId} className={LABEL}>Message</label>
              <ETextarea id={bodyId} rows={4} maxLength={1000} value={body} onChange={(event) => setBody(event.target.value)} />
            </div>
            <TransportChoices choices={CHOICES} value={transports} labels={TRANSPORT_CHOICE_LABELS} onChange={setTransports} />
          </fieldset>
        </form>
      )}
      {send.status === "failed" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.message}</p> : null}
      {send.status === "done" ? (
        <div className="space-y-2">
          <p role="status">Requested. Each line is what that transport reported; none confirms the message was read.</p>
          <OfficeOutcomeList outcomes={send.result.outcomes} refused={send.result.refused} names={names} />
        </div>
      ) : null}
    </EActionDialog>
  );
}
