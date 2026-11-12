"use client";

/**
 * "Tell client" sent from the app (administrators): explicit transports, one
 * idempotency key per draft and transport choice (kept until the server
 * answers, so a retry is not a second message), and the per-recipient states
 * the pipeline reported. The item's timeline records the same states.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import type { HydratedLostFoundItem } from "@/lib/lost-found/service";
import type { MessageDraft } from "@/lib/lost-found/message";
import { TRANSPORT_CHOICE_LABELS, newRequestKey, officeRequest, type OfficeActionResult, type OfficeTransportChoice } from "../office-actions/office-outcomes";
import { OfficeOutcomeList, TransportChoices } from "../office-actions/outcome-list";

const CHOICES: readonly OfficeTransportChoice[] = ["PUSH", "EMAIL"];
const SEND_LIMIT = 1000;

type SendResponse = { result: OfficeActionResult & { taken: boolean }; item: HydratedLostFoundItem };
type State = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; result: SendResponse["result"] };

export function ItemClientSend({ itemId, draft, onSending, onSent }: {
  itemId: string;
  draft: MessageDraft;
  onSending: (busy: boolean) => void;
  onSent: (item: HydratedLostFoundItem) => void;
}) {
  const [transports, setTransports] = React.useState<OfficeTransportChoice[]>(["PUSH"]);
  const [state, setState] = React.useState<State>({ status: "idle" });
  const keys = React.useRef(new Map<string, string>());
  const tooLong = draft.body.length > SEND_LIMIT;
  const sending = state.status === "sending";

  async function send() {
    const fingerprint = JSON.stringify([transports.slice().sort(), draft.subject, draft.body]);
    const idempotencyKey = keys.current.get(fingerprint) ?? newRequestKey("lfc");
    keys.current.set(fingerprint, idempotencyKey);
    setState({ status: "sending" });
    onSending(true);
    const response = await officeRequest<SendResponse>(`/api/admin/lost-found/${encodeURIComponent(itemId)}/send-client-notice`, {
      body: { transports, subject: draft.subject, body: draft.body, idempotencyKey },
    });
    onSending(false);
    if (!response.ok) {
      setState({ status: "failed", message: response.message });
      return;
    }
    keys.current.delete(fingerprint);
    setState({ status: "done", result: response.body.result });
    onSent(response.body.item);
  }

  return (
    <div className="space-y-2">
      <TransportChoices choices={CHOICES} value={transports} labels={TRANSPORT_CHOICE_LABELS} disabled={sending} onChange={setTransports} />
      <EButton type="button" size="sm" disabled={sending || transports.length === 0 || tooLong} onClick={() => void send()}>
        {sending ? "Sending…" : "Send to client"}
      </EButton>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        {tooLong ? `Shorten the message to ${SEND_LIMIT} characters to send it from the app (now ${draft.body.length}).` : `Up to ${SEND_LIMIT} characters. The status does not change.`}
      </p>
      {state.status === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{state.message}</p> : null}
      {state.status === "done" ? (
        <div className="space-y-1.5">
          <p role="status" className="text-[0.8125rem]">
            {state.result.taken ? "Requested and recorded on the timeline. Each line is what that transport reported; none confirms the client has read it." : "Not sent; recorded on the timeline with the reasons."}
          </p>
          <OfficeOutcomeList outcomes={state.result.outcomes} refused={state.result.refused} />
        </div>
      ) : null}
    </div>
  );
}
