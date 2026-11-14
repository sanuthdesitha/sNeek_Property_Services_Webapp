"use client";

/**
 * Add, replace or remove one provider key (board "AI: keys, failures and
 * tests"). A tier C confirmation: what changes in one or two lines, the key
 * box, the person's own PIN (their password once, when they have no PIN yet)
 * through the shared `OwnPinFields`, one button.
 *
 * Request: POST /api/admin/ai/credentials with
 *   { provider, apiKey, credentials }        to add or replace
 *   { provider, clear: true, credentials }   to remove
 * where `credentials` is what the shared `useOwnPinPrompt` hands every other
 * sensitive-action prompt: `{ pin }`, or `{ password }` while the person has
 * no PIN yet. The key is never shown again; a failed save keeps the typed key
 * in the box and clears the PIN (the field re-reads the tries left).
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import type { CredentialState, SecretProvider } from "./ai-config-model";

export type KeyDialogMode = "add" | "replace" | "remove";
/** `choose`: the first-run "Add a cloud key" lets the person pick the provider in the dialog. */
export type KeyDialogRequest = { provider: SecretProvider; mode: KeyDialogMode; choose?: boolean };

const FIELD = "mt-1 h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 font-mono text-[16px] sm:text-[0.8125rem] disabled:opacity-60";
const COMPANY: Readonly<Record<SecretProvider, string>> = { anthropic: "Anthropic", openai: "OpenAI", openai_compatible: "your OpenAI-compatible endpoint" };
const NAME: Readonly<Record<SecretProvider, string>> = { anthropic: "Anthropic", openai: "OpenAI", openai_compatible: "OpenAI-compatible" };

function article(name: string): string {
  return /^[AEIOU]/i.test(name) ? "an" : "a";
}

export function AiKeyDialog({ request, credential, usedBy, encryptionReady, onClose, onSaved, onChooseProvider }: {
  request: KeyDialogRequest | null;
  onChooseProvider?: (provider: SecretProvider) => void;
  credential: CredentialState | null;
  /** Feature names that use this provider now. */
  usedBy: string[];
  encryptionReady: boolean;
  onClose: () => void;
  onSaved: (credentials: CredentialState[], mode: KeyDialogMode) => void;
}) {
  const open = request !== null;
  const pin = useOwnPinPrompt(open);
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Choosing another provider in the first-run dialog keeps the typed key.
  const requestKey = request ? `${request.choose ? "choose" : request.provider}:${request.mode}` : "";

  // A different provider or action starts clean; the same one reopened keeps nothing either.
  React.useEffect(() => {
    setApiKey("");
    setError(null);
  }, [requestKey]);

  if (!request) return null;
  const { provider, mode } = request;
  const name = NAME[provider];
  const removing = mode === "remove";
  const blocked = !removing && !encryptionReady;
  const lastFour = apiKey.trim().length >= 4 ? apiKey.trim().slice(-4) : null;
  const problem = blocked ? "Keys cannot be saved yet." : !removing && !apiKey.trim() ? "Paste the key." : pin.problem;
  const title = mode === "add" ? `Add ${article(name)} ${name} key` : mode === "replace" ? `Replace the ${name} key${credential?.hint ? ` ${credential.hint}` : ""}?` : `Remove the ${name} key?`;
  const usedByText = usedBy.length ? usedBy.join(", ") : null;

  async function submit() {
    if (problem || !pin.credentials || !request) return;
    setBusy(true);
    setError(null);
    try {
      const body = removing
        ? { provider: request.provider, clear: true, credentials: pin.credentials }
        : { provider: request.provider, apiKey: apiKey.trim(), credentials: pin.credentials };
      const response = await fetch("/api/admin/ai/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = (await response.json().catch(() => ({}))) as { credentials?: CredentialState[]; error?: string };
      if (!response.ok || !Array.isArray(result.credentials)) throw new Error(result.error || "The key was not changed.");
      pin.reset();
      setApiKey("");
      onSaved(result.credentials, request.mode);
    } catch (cause) {
      // The typed key stays in the box for another attempt; only the PIN is cleared.
      pin.noteFailure();
      setError(cause instanceof Error ? cause.message : "The key was not changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EActionDialog
      open
      eyebrow="C · Sensitive · your PIN"
      title={title}
      busy={busy}
      onClose={onClose}
      description={
        removing
          ? usedByText ? `${usedByText} will say "AI unavailable, continue manually" until you choose another provider for them.` : "No feature uses this key now. Features you point at it later will say \"AI unavailable, continue manually\"."
          : mode === "replace"
            ? `The new key is used from the next request.${usedByText ? ` ${usedByText} use ${name}.` : ""}`
            : `Features you point at ${name} will send their requests to ${COMPANY[provider]}${provider === "openai_compatible" ? "" : " in the United States"}, and ${provider === "openai_compatible" ? "that provider" : name} bills your account.`
      }
      footer={
        <>
          {!removing ? <span className="mr-auto self-center text-[0.75rem] text-[hsl(var(--e-muted-foreground))] max-sm:hidden">Saving does not test it. Use Test connection next.</span> : null}
          <EButton variant="outline" onClick={onClose} disabled={busy}>Cancel</EButton>
          <EButton variant={removing ? "danger" : "primary"} onClick={() => void submit()} disabled={busy || Boolean(problem)} title={problem ?? undefined}>
            {busy ? "Working…" : mode === "add" ? "Save key" : mode === "replace" ? "Replace key" : "Remove key"}
          </EButton>
        </>
      }
    >
      <fieldset disabled={busy} className="min-w-0 space-y-3">
        {blocked ? (
          <EToneNotice tone="attention" title="Keys cannot be saved yet">
            <p>The server has no ENCRYPTION_KEY, so keys cannot be stored safely. Keys set in the hosting environment keep working. Ask whoever hosts sNeek to add it and restart.</p>
          </EToneNotice>
        ) : null}
        {request.choose && onChooseProvider ? (
          <label className="block">
            <span className="block text-[0.75rem] font-semibold text-[hsl(var(--e-text-secondary))]">Provider</span>
            <select className={FIELD.replace("font-mono", "")} value={provider} onChange={(event) => onChooseProvider(event.target.value as SecretProvider)}>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="openai_compatible">OpenAI-compatible endpoint (address set in Section 1)</option>
            </select>
          </label>
        ) : null}
        {!removing && !blocked ? (
          <div>
            <label className="block text-[0.75rem] font-semibold text-[hsl(var(--e-text-secondary))]" htmlFor="ai-key-value">{mode === "replace" ? "New API key" : "API key"}</label>
            <input id="ai-key-value" type="password" autoComplete="off" spellCheck={false} data-autofocus className={FIELD} value={apiKey} onChange={(event) => setApiKey(event.target.value)} aria-describedby="ai-key-note" />
            <p id="ai-key-note" className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Stored encrypted. You will only ever see the last four characters{lastFour ? `: ${lastFour}` : ""}.
            </p>
          </div>
        ) : null}
        {!blocked ? <OwnPinFields {...pin.fieldProps} disabled={busy} /> : null}
        {error ? (
          <EToneNotice tone="problem" role="alert">
            <p><b>Not saved.</b> {error}{!removing && apiKey ? " Your new key is still in the box." : ""}</p>
          </EToneNotice>
        ) : null}
      </fieldset>
    </EActionDialog>
  );
}
