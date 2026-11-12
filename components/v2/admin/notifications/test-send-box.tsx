"use client";

import * as React from "react";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { TRANSPORT_LABEL } from "@/lib/notifications/catalog-types";
import type { RecipientOutcomeView } from "./office-outcome";
import { outcomeLabel } from "./office-outcome";
import { sendJson } from "./use-notification-read";

/** "Send test to me": always to the signed-in user only, through the type's real path. */
export function TestSendBox({ typeKey, readOnly }: { typeKey: string; readOnly: boolean }) {
  const [push, setPush] = React.useState(true);
  const [email, setEmail] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [outcomes, setOutcomes] = React.useState<RecipientOutcomeView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function send() {
    if (sending || (!push && !email)) return;
    setSending(true);
    setError(null);
    setOutcomes(null);
    const result = await sendJson("/api/admin/notifications/catalog/test", "POST", { typeKey, transports: [...(push ? ["PUSH"] : []), ...(email ? ["EMAIL"] : [])] });
    setSending(false);
    if (!result.ok) setError(result.error);
    else setOutcomes(((result.body as { outcomes?: RecipientOutcomeView[] }).outcomes) ?? []);
  }

  return (
    <section aria-labelledby="type-test" className="space-y-2 rounded border border-[hsl(var(--e-border))] p-3">
      <h3 id="type-test" className="font-semibold">Send test to me</h3>
      <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Goes only to you, marked [Test], using the same path as the real notification. Never to a client, cleaner or guest.</p>
      <fieldset className="flex flex-wrap gap-4" disabled={sending || readOnly}>
        <legend className="sr-only">Test transports</legend>
        <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={push} onChange={(event) => setPush(event.target.checked)} /> Push (inbox, phone, browser)</label>
        <label className="inline-flex min-h-11 items-center gap-2"><input type="checkbox" checked={email} onChange={(event) => setEmail(event.target.checked)} /> Email</label>
      </fieldset>
      <EButton size="sm" variant="outline" onClick={() => void send()} disabled={sending || readOnly || (!push && !email)}>{sending ? "Sending test…" : "Send test to me"}</EButton>
      {readOnly ? <p className="text-xs">Test sends are disabled while impersonating.</p> : null}
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
