/**
 * The "After sending" lines of the Ask laundry team dialog, as drawn: one line
 * per transport with what the pipeline reported, and who was skipped and why.
 * PURE and PLAIN. Nothing here says read or delivered to a person: an inbox
 * row is "in the inbox", a push is "requested" or "accepted by the provider".
 */
export type ReceiptOutcome = {
  userId: string;
  name: string;
  transport: "INBOX" | "MOBILE_PUSH" | "WEB_PUSH" | "EMAIL";
  state: string;
  errorCode?: string | null;
};

const GROUPS: Array<{ label: string; transports: ReceiptOutcome["transport"][] }> = [
  { label: "Inbox", transports: ["INBOX"] },
  { label: "Push", transports: ["MOBILE_PUSH", "WEB_PUSH"] },
  { label: "Email", transports: ["EMAIL"] },
];

const REACHED = new Set(["inbox_available", "provider_accepted", "requested", "queued", "already_requested"]);

function reachedWord(transport: string): string {
  if (transport === "INBOX") return "in the inbox of";
  if (transport === "EMAIL") return "accepted for";
  return "sent to";
}

function why(outcome: ReceiptOutcome): string {
  if (outcome.state === "switched_off") return "switched off in Notifications";
  const code = outcome.errorCode?.replace(/_/g, " ").toLowerCase();
  if (outcome.state === "skipped") return code ? code : "skipped";
  if (outcome.state === "uncertain") return "outcome unknown";
  return code ? `failed (${code})` : "failed";
}

/** "Inbox: in the inbox of 3" · "Push: sent to 2 · Dev Patel: no device registered". */
export function teamRequestReceiptLines(outcomes: readonly ReceiptOutcome[]): string[] {
  const lines: string[] = [];
  for (const group of GROUPS) {
    const rows = outcomes.filter((outcome) => group.transports.includes(outcome.transport));
    if (!rows.length) continue;
    // One person counts once per group (phone and browser push are one "Push").
    const reached = new Set(rows.filter((row) => REACHED.has(row.state)).map((row) => row.userId));
    const missed = new Map<string, ReceiptOutcome>();
    for (const row of rows) if (!reached.has(row.userId) && !missed.has(row.userId)) missed.set(row.userId, row);
    const parts = [`${group.label}: ${reached.size ? `${reachedWord(group.transports[0])} ${reached.size}` : "nobody reached"}`];
    for (const row of Array.from(missed.values())) parts.push(`${row.name}: ${why(row)}`);
    lines.push(parts.join(" · "));
  }
  return lines;
}
