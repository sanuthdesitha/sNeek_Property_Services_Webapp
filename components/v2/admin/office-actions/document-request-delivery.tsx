"use client";

/**
 * The recorded states of a document request (Accounts "Request document",
 * Command "Send reminder"): the pipeline's per-transport states and the SMS
 * provider's answer. Nothing here says "sent" or "delivered".
 */
import { EPill } from "@/components/v2/ui/pill";
import type { DocumentRequestDelivery } from "@/lib/workforce/document-request-send";
import { OfficeOutcomeList } from "./outcome-list";

const SMS_STATE: Record<string, string> = {
  provider_accepted: "Accepted by the provider",
  already_requested: "Already requested earlier",
  skipped: "Not sent (SMS switched off)",
  failed: "Failed",
};

function smsTone(state: string): "ok" | "bad" | "warn" {
  if (state === "provider_accepted") return "ok";
  if (state === "failed") return "bad";
  return "warn";
}

export function DocumentRequestDeliveryView({ delivery, noun }: { delivery: DocumentRequestDelivery; noun: "request" | "reminder" }) {
  const nothing = delivery.outcomes.length === 0 && !delivery.sms;
  return (
    <div className="space-y-2">
      <p role="status">
        {nothing
          ? `The ${noun} was recorded, but no transport reported an answer.`
          : "Requested. Each line is what that transport reported; none confirms the person has read it."}
      </p>
      {delivery.outcomes.length > 0 ? <OfficeOutcomeList outcomes={delivery.outcomes} /> : null}
      {delivery.sms ? (
        <EPill tone={smsTone(delivery.sms.state)}>
          SMS: {SMS_STATE[delivery.sms.state] ?? delivery.sms.state}{delivery.sms.errorCode && delivery.sms.state === "failed" ? ` (${delivery.sms.errorCode.replace(/_/g, " ")})` : ""}
        </EPill>
      ) : null}
    </div>
  );
}
