/**
 * "Ask an administrator" (board "Access denied"): the answer the route gives
 * and the words the page shows for it. Plain module, shared by the route, the
 * button and the tests. Queued is not delivered, and asking grants nothing.
 */
import type { ETone } from "@/components/v2/ui/tone-band";

export type AccessRequestOutcome = {
  state: "sent" | "already_asked";
  /** When the request (this one, or today's earlier one) was made, in the organisation timezone. */
  askedAtLabel: string;
  /** Administrators the message was addressed to. */
  recipients: number;
  /** Inbox rows already in their inbox. */
  inInbox: number;
  /** Inbox rows still waiting for the worker. */
  queued: number;
};

export function askOutcomeText(outcome: AccessRequestOutcome): { tone: ETone; title: string; body: string } {
  if (outcome.state === "already_asked") {
    return {
      tone: "info",
      title: "Already asked today",
      body: `You asked for this area at ${outcome.askedAtLabel}. One request per area each day; you can ask again tomorrow. Your access has not changed.`,
    };
  }
  const people = outcome.recipients === 1 ? "1 administrator" : `${outcome.recipients} administrators`;
  const where = outcome.queued > 0 && outcome.inInbox === 0
    ? "The inbox message is queued and not delivered yet."
    : outcome.queued > 0
      ? `${outcome.inInbox} in their inbox, ${outcome.queued} queued and not delivered yet.`
      : "It is in their inbox.";
  return {
    tone: "good",
    title: "Asked",
    body: `Sent to ${people} at ${outcome.askedAtLabel}. ${where} Nothing changes until one of them updates your access.`,
  };
}
