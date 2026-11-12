/**
 * Checks for composing a message with a template (board "Messages"). Plain
 * module, no server code. Email, SMS and Both are explicit transports: each
 * is offered only when the recipient has the contact it needs, with the
 * reason when not. Variables are checked for a source (client, cleaner, job,
 * property, quote) before sending; the send route resolves them and leaves an
 * unsourced variable blank.
 */

export type Transport = "EMAIL" | "SMS" | "BOTH";
export type Channel = "EMAIL" | "SMS";

export const TRANSPORT_LABEL: Record<Transport, string> = { EMAIL: "Email", SMS: "SMS", BOTH: "Both" };

export type ComposeRecipient = {
  id: string;
  kind: "client" | "user";
  name: string;
  email: string | null;
  phone: string | null;
  role?: string;
};

export type TransportOption = { transport: Transport; enabled: boolean; reason: string | null };

export function transportOptions(recipient: ComposeRecipient | null): TransportOption[] {
  const noRecipient = "Choose a recipient first.";
  const email = recipient ? (recipient.email?.trim() ? null : `${recipient.name} has no email on file.`) : noRecipient;
  const sms = recipient ? (recipient.phone?.trim() ? null : `${recipient.name} has no phone on file, so SMS would not send.`) : noRecipient;
  return [
    { transport: "EMAIL", enabled: !email, reason: email },
    { transport: "SMS", enabled: !sms, reason: sms },
    { transport: "BOTH", enabled: !email && !sms, reason: email ?? sms },
  ];
}

/** The channels one send uses, in order (the send route takes one channel per request). */
export function channelsFor(transport: Transport): Channel[] {
  return transport === "BOTH" ? ["EMAIL", "SMS"] : [transport];
}

/** Keep the chosen transport when it is still possible; otherwise the first possible one, or null. */
export function reconcileTransport(current: Transport | null, recipient: ComposeRecipient | null): Transport | null {
  const options = transportOptions(recipient);
  if (current && options.find((o) => o.transport === current)?.enabled) return current;
  return options.find((o) => o.enabled && o.transport !== "BOTH")?.transport ?? null;
}

export type VariableSources = { clientId?: string; cleanerId?: string; jobId?: string; propertyId?: string; quoteId?: string };

const SOURCE_FOR_ROOT: Record<string, { key: keyof VariableSources; label: string }> = {
  client: { key: "clientId", label: "a client" },
  cleaner: { key: "cleanerId", label: "a cleaner" },
  job: { key: "jobId", label: "a job" },
  property: { key: "propertyId", label: "a property" },
  quote: { key: "quoteId", label: "a quote" },
};

export function variableRoots(...texts: string[]): string[] {
  const roots = new Set<string>();
  for (const text of texts) {
    for (const match of Array.from(text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g))) {
      const root = match[1].split("|")[0].trim().split(".")[0];
      if (root) roots.add(root);
    }
  }
  return Array.from(roots);
}

export type VariableCheck =
  | { state: "none" }
  | { state: "sourced"; roots: string[] }
  | { state: "missing"; missing: Array<{ root: string; needs: string }> };

export function checkVariables(subject: string, body: string, sources: VariableSources): VariableCheck {
  const roots = variableRoots(subject, body);
  if (roots.length === 0) return { state: "none" };
  const missing = roots
    .map((root) => {
      const source = SOURCE_FOR_ROOT[root];
      if (!source) return { root, needs: "a source this composer does not have" };
      return sources[source.key]?.trim() ? null : { root, needs: source.label };
    })
    .filter((entry): entry is { root: string; needs: string } => entry !== null);
  return missing.length ? { state: "missing", missing } : { state: "sourced", roots };
}

export type SendBlock = { blocked: boolean; reason: string | null };

export function sendBlock(input: { canSend: boolean; recipient: ComposeRecipient | null; transport: Transport | null; body: string; sending: boolean }): SendBlock {
  if (!input.canSend) return { blocked: true, reason: "Your access does not include sending from the composer." };
  if (!input.recipient) return { blocked: true, reason: "Choose a recipient." };
  if (!input.transport) return { blocked: true, reason: "This recipient has no email or phone on file." };
  const option = transportOptions(input.recipient).find((o) => o.transport === input.transport);
  if (!option?.enabled) return { blocked: true, reason: option?.reason ?? "This transport is not available." };
  if (!input.body.trim()) return { blocked: true, reason: "Write the message first." };
  if (input.sending) return { blocked: true, reason: "Sending…" };
  return { blocked: false, reason: null };
}

export function sendButtonLabel(transport: Transport | null): string {
  if (transport === "SMS") return "Send SMS";
  if (transport === "BOTH") return "Send email and SMS";
  return "Send email";
}

/** One channel's outcome from the send route, in words. Skipped and failed are never "sent". */
export type ChannelOutcome = { channel: Channel; state: "sent" | "failed" | "skipped"; detail: string };

export function channelOutcome(channel: Channel, httpOk: boolean, data: { ok?: boolean; skipped?: boolean; status?: string; error?: string; provider?: string }): ChannelOutcome {
  const name = channel === "EMAIL" ? "Email" : "SMS";
  if (data.status === "not_configured") return { channel, state: "skipped", detail: `${name} not sent: the provider is not configured.` };
  if (data.skipped) return { channel, state: "skipped", detail: `${name} not sent: ${data.error ?? "the provider skipped it"}.` };
  if (httpOk && data.ok) return { channel, state: "sent", detail: `${name} handed to ${data.provider ?? "the provider"}. Delivery is not confirmed yet.` };
  return { channel, state: "failed", detail: `${name} failed: ${data.error ?? data.status ?? "unknown error"}.` };
}
