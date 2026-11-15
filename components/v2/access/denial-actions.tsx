"use client";

/**
 * The interactive parts of the access-denied pages: the history step back,
 * Try again (for "could not be checked"), sign out, and "Ask an
 * administrator…" (tier A confirmation, inbox only, grants nothing).
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import type { OpsFeature } from "@/lib/rbac/ops-catalog";
import { askOutcomeText, type AccessRequestOutcome } from "@/lib/access/access-request-text";

/**
 * "Back to where you were": the browser's own previous page. The page that
 * refused is not in history (middleware redirected it), so this returns to
 * the page before it. With no history (a link opened in a new tab) it goes to
 * the portal's home. It never navigates to `from`.
 */
export function DenialHistoryBack({ fallbackHref, label = "Back to where you were" }: { fallbackHref: string; label?: string }) {
  return (
    <EButton asChild variant="primary">
      <a
        href={fallbackHref}
        onClick={(event) => {
          if (window.history.length > 1) {
            event.preventDefault();
            window.history.back();
          }
        }}
      >
        {label}
      </a>
    </EButton>
  );
}

/** Try again after "could not be checked": reloads the same page. */
export function DenialRetry() {
  return (
    <EButton type="button" variant="primary" onClick={() => window.location.reload()}>
      Try again
    </EButton>
  );
}

export function DenialSignOut() {
  return (
    <a
      href="/api/auth/local-signout"
      onClick={(event) => {
        event.preventDefault();
        window.location.assign(`/api/auth/local-signout?callbackUrl=${encodeURIComponent(`${window.location.origin}/v2/login`)}`);
      }}
      className="flex min-h-11 items-center justify-center text-[0.9375rem] font-[500] text-[hsl(var(--e-text-secondary))] underline-offset-2 hover:underline"
    >
      Sign in as someone else
    </a>
  );
}

type AskState =
  | { kind: "idle" }
  | { kind: "done"; outcome: AccessRequestOutcome }
  | { kind: "failed"; message: string };

/**
 * "Ask an administrator…": one inbox message to the administrators, at most
 * once per person per area per day (the server decides). It changes nothing
 * about access. A failed request keeps the dialog open with the reason.
 */
export function AskAdministrator({
  area,
  areaLabel,
  fromLabel,
  fromPath,
  administrators,
}: {
  area: OpsFeature;
  areaLabel: string;
  fromLabel: string;
  fromPath: string | null;
  administrators: readonly string[];
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [state, setState] = React.useState<AskState>({ kind: "idle" });
  const [error, setError] = React.useState<string | null>(null);
  const who = administrators.length > 0 ? administrators.join(administrators.length === 2 ? " and " : ", ") : "The administrators";

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/access-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, from: fromPath }),
      });
      const body = (await response.json().catch(() => null)) as { outcome?: AccessRequestOutcome; error?: string } | null;
      if (!response.ok || !body?.outcome) {
        setError(`It was not sent: ${body?.error ?? "the server did not answer. Try again."}`);
        return;
      }
      setState({ kind: "done", outcome: body.outcome });
      setOpen(false);
    } catch {
      setError("It was not sent: the network failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "done") {
    const text = askOutcomeText(state.outcome);
    return (
      <EToneNotice tone={text.tone} title={text.title} role="status" className="w-full">
        {text.body}
      </EToneNotice>
    );
  }

  return (
    <>
      <EButton type="button" variant="outline" onClick={() => setOpen(true)}>
        Ask an administrator…
      </EButton>
      <EConfirmDialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        tier="ordinary"
        title={`Ask for ${areaLabel}?`}
        description={`${who} get an inbox message: you asked for ${areaLabel}, from ${fromLabel}. It does not change your access.`}
        confirmLabel="Send request"
        busy={busy}
        error={error}
        onConfirm={send}
      />
    </>
  );
}
