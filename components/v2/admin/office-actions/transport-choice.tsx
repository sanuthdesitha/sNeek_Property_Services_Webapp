"use client";

/**
 * "Send by" for a document request (Accounts "Request document" and Command
 * "Send reminder"; owner decision 2026-11-12, item B).
 *
 * - Inbox, Email and SMS are explicit choices; any combination may be ticked.
 *   Each is disabled with its reason when the person has no contact, the type
 *   is switched off in Notifications or the provider is not configured.
 * - "Don't ask again" remembers the ticked transports for the signed-in office
 *   user (stored on the server). Next time the choice is used silently, but a
 *   visible "Sending by: … · Change" line always says what will be used; a
 *   saved transport that cannot be used for this person is named with why.
 * - "Change" shows the choices again; "Ask me again" also forgets the saved
 *   choice (the same reset is in Notifications → Preferences).
 * The request always names its transports, so the server never guesses.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import {
  REQUEST_TRANSPORTS,
  REQUEST_TRANSPORT_DETAIL,
  REQUEST_TRANSPORT_LABEL,
  transportList,
  usableSavedTransports,
  type DocumentRequestOptions,
  type RequestTransport,
} from "@/lib/workforce/document-request-transports";
import { officeRequest } from "./office-outcomes";

export type TransportChoiceState = {
  transports: RequestTransport[];
  remember: boolean;
  /** True while the saved choice is being used without showing the boxes. */
  usingSaved: boolean;
};

/** The first choice for a person: the saved one when it is usable, else the inbox (when it can be used). */
export function initialTransportChoice(options: DocumentRequestOptions): TransportChoiceState {
  const saved = options.savedReadable ? usableSavedTransports(options.saved, options.transports) : [];
  if (saved.length > 0) return { transports: saved, remember: false, usingSaved: true };
  return { transports: options.transports.PUSH.available ? ["PUSH"] : [], remember: false, usingSaved: false };
}

/** The transports actually sent: only those that can be used for this person. */
export function chosenTransports(choice: TransportChoiceState, options: DocumentRequestOptions): RequestTransport[] {
  return REQUEST_TRANSPORTS.filter((transport) => choice.transports.includes(transport) && options.transports[transport].available);
}

type ChoiceProps = {
  options: DocumentRequestOptions;
  value: TransportChoiceState;
  onChange: (next: TransportChoiceState) => void;
  disabled?: boolean;
  /** Called after the saved choice was forgotten on the server. */
  onForgotten?: () => void;
};

function SavedLine({ options, value, disabled, onChange, onForgotten }: ChoiceProps) {
  const [forgetting, setForgetting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const unusable = (options.saved?.transports ?? []).filter((transport) => !options.transports[transport].available);

  async function forget() {
    setForgetting(true);
    setError(null);
    const result = await officeRequest<unknown>("/api/me/send-transports", { method: "DELETE", body: { kind: "document_request" } });
    setForgetting(false);
    if (!result.ok) return setError(result.message);
    onChange({ ...value, usingSaved: false, remember: false });
    onForgotten?.();
  }

  return (
    <div className="space-y-1 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>Sending by: <b className="font-[600]">{transportList(value.transports)}</b></span>
        <span aria-hidden="true">·</span>
        <EButton size="sm" variant="ghost" disabled={disabled || forgetting} onClick={() => onChange({ ...value, usingSaved: false })}>Change</EButton>
        <EButton size="sm" variant="ghost" disabled={disabled || forgetting} onClick={() => void forget()}>{forgetting ? "Forgetting…" : "Ask me again"}</EButton>
      </p>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Your saved choice (Don&apos;t ask again).</p>
      {unusable.map((transport) => (
        <p key={transport} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {REQUEST_TRANSPORT_LABEL[transport]} is not used for this person: {options.transports[transport].reason}
        </p>
      ))}
      {error ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </div>
  );
}

export function TransportChoice(props: ChoiceProps) {
  const { options, value, onChange, disabled = false } = props;
  if (value.usingSaved) return <SavedLine {...props} />;
  const toggle = (transport: RequestTransport, on: boolean) => {
    const transports = on ? [...value.transports, transport] : value.transports.filter((item) => item !== transport);
    onChange({ ...value, transports });
  };
  return (
    <fieldset disabled={disabled} className="space-y-1.5">
      <legend className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Send by</legend>
      {REQUEST_TRANSPORTS.map((transport) => {
        const option = options.transports[transport];
        return (
          <label key={transport} className="flex items-start gap-2 text-[0.8125rem]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              disabled={!option.available}
              checked={option.available && value.transports.includes(transport)}
              onChange={(event) => toggle(transport, event.target.checked)}
            />
            <span>
              <b className="font-[550]">{REQUEST_TRANSPORT_LABEL[transport]}</b>
              <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{option.available ? REQUEST_TRANSPORT_DETAIL[transport] : option.reason}</span>
            </span>
          </label>
        );
      })}
      {!options.savedReadable ? <p role="note" className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">Your saved choice could not be read, so it is not used. Choose again.</p> : null}
      <label className="flex items-start gap-2 pt-1 text-[0.8125rem]">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={value.remember} onChange={(event) => onChange({ ...value, remember: event.target.checked })} />
        <span>
          Don&apos;t ask again
          <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Use these next time for you only. You can change it here or in Notifications → Preferences.</span>
        </span>
      </label>
    </fieldset>
  );
}
