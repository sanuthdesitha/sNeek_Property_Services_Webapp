"use client";

import * as React from "react";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { TRANSPORT_LABEL } from "@/lib/notifications/catalog-types";
import { outcomeLabel, type RecipientOutcomeView } from "./office-outcome";
import { sendJson } from "./use-notification-read";

type TestTransport = "INBOX" | "PUSH" | "EMAIL" | "SMS";

const TRANSPORT_CHOICES: Array<{ key: TestTransport; label: string }> = [
  { key: "SMS", label: "SMS" },
  { key: "EMAIL", label: "Email" },
  { key: "PUSH", label: "Push" },
  { key: "INBOX", label: "Inbox only" },
];

export const TEST_SEND_SECTION_ID = "notification-test-send";

/** Which test transports a type can use (from its catalog transports). */
export function testTransports(catalogTransports: readonly string[]): TestTransport[] {
  return TRANSPORT_CHOICES.map((choice) => choice.key).filter((key) => {
    if (key === "PUSH") return catalogTransports.some((item) => item === "MOBILE_PUSH" || item === "WEB_PUSH");
    return catalogTransports.includes(key);
  });
}

/**
 * "Send test to me": only to the signed-in user, marked [Test], by the same
 * path as the real notification, with the saved wording and sample data. Each
 * transport is chosen explicitly; the result says what each transport did.
 */
export function WordingTestSend({ typeKey, transports, disabledReason }: { typeKey: string; transports: TestTransport[]; disabledReason: string | null }) {
  const [chosen, setChosen] = React.useState<TestTransport[]>(transports.slice(0, 1));
  const [sending, setSending] = React.useState(false);
  const [outcomes, setOutcomes] = React.useState<RecipientOutcomeView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const disabled = Boolean(disabledReason) || transports.length === 0;

  async function send() {
    if (sending || chosen.length === 0) return;
    setSending(true);
    setError(null);
    setOutcomes(null);
    const result = await sendJson("/api/admin/notifications/catalog/test", "POST", { typeKey, transports: chosen });
    setSending(false);
    if (!result.ok) setError(result.error);
    else setOutcomes(((result.body as { outcomes?: RecipientOutcomeView[] }).outcomes) ?? []);
  }

  return (
    <section id={TEST_SEND_SECTION_ID} tabIndex={-1} aria-labelledby="wording-test-heading" className="space-y-2">
      <h3 id="wording-test-heading" className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">Test send</h3>
      <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Goes only to you, marked [Test], by the same path as the real one, with the saved wording and sample data. Never to a cleaner, client or guest. Disabled while testing as someone else.</p>
      {transports.length === 0 ? <p className="text-xs">This notification has no transport a test can use.</p> : (
        <fieldset className="flex flex-wrap gap-x-4" disabled={sending || disabled}>
          <legend className="sr-only">Test transports</legend>
          {TRANSPORT_CHOICES.filter((choice) => transports.includes(choice.key)).map((choice) => (
            <label key={choice.key} className="inline-flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={chosen.includes(choice.key)} onChange={(event) => setChosen((list) => (event.target.checked ? [...list, choice.key] : list.filter((item) => item !== choice.key)))} />
              {choice.label}
            </label>
          ))}
        </fieldset>
      )}
      <EButton size="sm" variant="outline" onClick={() => void send()} disabled={sending || disabled || chosen.length === 0}>{sending ? "Sending test…" : "Send test to me"}</EButton>
      {disabledReason ? <p className="text-xs">{disabledReason}</p> : null}
      {error ? <EAlert tone="danger" title="Test not sent">{error}</EAlert> : null}
      {outcomes ? (
        <ul role="status" className="space-y-1 text-xs">
          {outcomes.length === 0 ? <li>Nothing was sent.</li> : null}
          {outcomes.map((outcome, index) => (
            <li key={`${outcome.transport}-${index}`}>{TRANSPORT_LABEL[outcome.transport]} ({outcome.path === "pipeline" ? "pipeline" : "direct path"}): {outcomeLabel(outcome)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
