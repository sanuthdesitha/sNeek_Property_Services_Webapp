"use client";

/**
 * "Your sending choices": the signed-in office user's own "Don't ask again"
 * transport choices (GET / DELETE /api/me/send-transports). Each can be
 * forgotten so the dialog asks again. Only the caller's own choices; nothing
 * is shown or changed while impersonating.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { transportList, type RequestTransport } from "@/lib/workforce/document-request-transports";
import { officeRequest } from "../office-actions/office-outcomes";

type SavedChoice = { transports: RequestTransport[]; savedAt: string };
type Answer = { impersonating: boolean; readable: boolean; kinds: Partial<Record<"document_request", SavedChoice>> };
type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; answer: Answer };

const KIND_LABEL: Record<"document_request", string> = {
  document_request: "Request document and expiring-document reminders",
};

export function SendingChoices({ timeZone }: { timeZone: string }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    void officeRequest<Answer>("/api/me/send-transports", { method: "GET", signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || (!result.ok && result.aborted)) return;
      setLoad(result.ok ? { status: "ready", answer: result.body } : { status: "error", message: result.message });
    });
    return () => controller.abort();
  }, []);

  async function forget(kind: "document_request") {
    setBusy(true);
    setError(null);
    const result = await officeRequest<Answer>("/api/me/send-transports", { method: "DELETE", body: { kind } });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setLoad({ status: "ready", answer: result.body });
  }

  const formatter = new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone });
  const savedOn = (value: string) => {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? "at an unknown time" : formatter.format(at);
  };
  return (
    <section aria-labelledby="sending-choices-heading" className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-4 py-3 text-sm">
      <h3 id="sending-choices-heading" className="font-semibold">Your sending choices</h3>
      <p className="text-[hsl(var(--e-muted-foreground))]">Transports you chose with &ldquo;Don&apos;t ask again&rdquo;. They apply to you only; forget one to be asked again.</p>
      {load.status === "loading" ? <p role="status">Loading your choices…</p> : null}
      {load.status === "error" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{load.message}</p> : null}
      {load.status === "ready" && load.answer.impersonating ? <p role="note">Your own choices are not shown while impersonating.</p> : null}
      {load.status === "ready" && !load.answer.readable ? <p role="alert" className="text-[hsl(var(--e-danger))]">Your saved choices could not be read, so none is used; the dialogs ask each time.</p> : null}
      {load.status === "ready" && !load.answer.impersonating && load.answer.readable ? (
        Object.keys(load.answer.kinds).length === 0 ? <p>No saved choices. The dialogs ask each time.</p> : (
          <ul className="divide-y divide-[hsl(var(--e-border))]">
            {(Object.entries(load.answer.kinds) as Array<["document_request", SavedChoice]>).map(([kind, choice]) => (
              <li key={kind} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <b className="font-[550]">{KIND_LABEL[kind]}</b>
                  <span className="block text-[hsl(var(--e-muted-foreground))]">Sending by: {transportList(choice.transports)} · saved {savedOn(choice.savedAt)}</span>
                </span>
                <EButton size="sm" variant="outline" disabled={busy} onClick={() => void forget(kind)}>Ask me again</EButton>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {error ? <p role="alert" className="text-[hsl(var(--e-danger))]">{error}</p> : null}
    </section>
  );
}
