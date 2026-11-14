"use client";

/**
 * Add, replace or remove one provider key (board "AI: keys, failures and
 * tests"). A tier C confirmation on the shared `EConfirmDialog` (tier
 * "sensitive"): what changes in one or two lines, the key box, the person's
 * own PIN (their password while they have no PIN yet), one button.
 *
 * Request: POST /api/admin/ai/credentials with
 *   { provider, apiKey, credentials }        to add or replace
 *   { provider, clear: true, credentials }   to remove
 * where `credentials` is the `ConfirmResult.credentials` the shared dialog
 * hands every sensitive action: `{ pin }`, or `{ password }` while the person
 * has no PIN yet. The key is never shown again; a failed save keeps the typed
 * key in the box, and the dialog clears the credential and re-reads the tries
 * left.
 */
import * as React from "react";
import { EConfirmDialog, type ConfirmResult } from "@/components/v2/ui/confirm-dialog";
import { EToneNotice } from "@/components/v2/ui/tone-band";
import type { CredentialState, SecretProvider } from "./ai-config-model";

export type KeyDialogMode = "add" | "replace" | "remove";
/** `choose`: the first-run "Add a cloud key" lets the person pick the provider in the dialog. */
export type KeyDialogRequest = { provider: SecretProvider; mode: KeyDialogMode; choose?: boolean };

const FIELD = "mt-1 h-11 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 text-[16px] sm:text-[0.8125rem] disabled:opacity-60";
const LABEL = "block text-[0.75rem] font-semibold text-[hsl(var(--e-text-secondary))]";
const COMPANY: Readonly<Record<SecretProvider, string>> = { anthropic: "Anthropic in the United States", openai: "OpenAI in the United States", openai_compatible: "your OpenAI-compatible endpoint" };
const NAME: Readonly<Record<SecretProvider, string>> = { anthropic: "Anthropic", openai: "OpenAI", openai_compatible: "OpenAI-compatible" };

function article(name: string): string {
  return /^[AEIOU]/i.test(name) ? "an" : "a";
}

type CredentialsBody = { credentials?: CredentialState[]; error?: string };

export function AiKeyDialog({ request, credential, usedBy, encryptionReady, onClose, onSaved, onChooseProvider }: {
  request: KeyDialogRequest | null;
  credential: CredentialState | null;
  /** Feature names that use this provider now. */
  usedBy: string[];
  encryptionReady: boolean;
  onClose: () => void;
  onSaved: (credentials: CredentialState[], mode: KeyDialogMode) => void;
  onChooseProvider?: (provider: SecretProvider) => void;
}) {
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Choosing another provider in the first-run dialog keeps the typed key.
  const requestKey = request ? `${request.choose ? "choose" : request.provider}:${request.mode}` : "";
  React.useEffect(() => {
    setApiKey("");
    setError(null);
  }, [requestKey]);

  const provider = request?.provider ?? "anthropic";
  const mode = request?.mode ?? "add";
  const name = NAME[provider];
  const removing = mode === "remove";
  const blocked = !removing && !encryptionReady;
  const lastFour = apiKey.trim().length >= 4 ? apiKey.trim().slice(-4) : null;
  const usedByText = usedBy.length ? usedBy.join(", ") : null;
  const title = mode === "add" ? `Add ${article(name)} ${name} key` : mode === "replace" ? `Replace the ${name} key${credential?.hint ? ` ${credential.hint}` : ""}?` : `Remove the ${name} key?`;
  const description = removing
    ? usedByText ? `${usedByText} will say "AI unavailable, continue manually" until you choose another provider for them.` : "No feature uses this key now. Features pointed at it later will say \"AI unavailable, continue manually\"."
    : mode === "replace"
      ? `The new key is used from the next request.${usedByText ? ` ${usedByText} use ${name}.` : ""}`
      : `Features you point at ${name} will send their requests to ${COMPANY[provider]}, and ${provider === "openai_compatible" ? "that provider" : name} bills your account.`;

  async function confirm(result: ConfirmResult) {
    if (!request || !result.credentials) return;
    setBusy(true);
    setError(null);
    try {
      const body = removing
        ? { provider: request.provider, clear: true, credentials: result.credentials }
        : { provider: request.provider, apiKey: apiKey.trim(), credentials: result.credentials };
      const response = await fetch("/api/admin/ai/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const answer = (await response.json().catch(() => ({}))) as CredentialsBody;
      if (!response.ok || !Array.isArray(answer.credentials)) throw new Error(answer.error || "The key was not changed.");
      setApiKey("");
      onSaved(answer.credentials, request.mode);
    } catch (cause) {
      // The typed key stays in the box; the shared dialog clears the credential.
      setError(`Not saved. ${cause instanceof Error ? cause.message : "The key was not changed."}${!removing && apiKey ? " Your new key is still in the box." : ""}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <EConfirmDialog
      open={request !== null}
      onClose={onClose}
      tier="sensitive"
      title={title}
      description={description}
      confirmLabel={mode === "add" ? "Save key" : mode === "replace" ? "Replace key" : "Remove key"}
      busy={busy}
      confirmDisabled={blocked || (!removing && !apiKey.trim())}
      error={error}
      onConfirm={confirm}
    >
      {request?.choose && onChooseProvider ? (
        <label className="block">
          <span className={LABEL}>Provider</span>
          <select className={FIELD} value={provider} disabled={busy} onChange={(event) => onChooseProvider(event.target.value as SecretProvider)}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="openai_compatible">OpenAI-compatible endpoint (address set in Section 1)</option>
          </select>
        </label>
      ) : null}
      {blocked ? (
        <EToneNotice tone="attention" title="Keys cannot be saved yet">
          <p>The server has no ENCRYPTION_KEY, so keys cannot be stored safely. Keys set in the hosting environment keep working. Ask whoever hosts sNeek to add it and restart.</p>
        </EToneNotice>
      ) : null}
      {!removing && !blocked ? (
        <div>
          <label className={LABEL} htmlFor="ai-key-value">{mode === "replace" ? "New API key" : "API key"}</label>
          <input id="ai-key-value" type="password" autoComplete="off" spellCheck={false} data-autofocus className={`${FIELD} font-mono`} value={apiKey} disabled={busy} onChange={(event) => setApiKey(event.target.value)} aria-describedby="ai-key-note" />
          <p id="ai-key-note" className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            Stored encrypted. You will only ever see the last four characters{lastFour ? `: ${lastFour}` : ""}. Saving does not test it; use Test connection next.
          </p>
        </div>
      ) : null}
    </EConfirmDialog>
  );
}
