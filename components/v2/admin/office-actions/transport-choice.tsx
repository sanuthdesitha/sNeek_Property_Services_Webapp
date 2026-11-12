"use client";

/**
 * "Send by" for a document request (Accounts "Request document" and Command
 * "Send reminder"; owner decision 2026-11-12, item B) and, with its own
 * catalog (Inbox, Push, SMS), for "Message team" on a job (owner decision
 * 2026-11-13).
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
  type RequestTransport,
  type TransportOption,
} from "@/lib/workforce/document-request-transports";
import type { SendTransportKind } from "@/lib/notifications/send-transport-kinds";
import { officeRequest } from "./office-outcomes";

/**
 * Which transports a kind of send offers, in display order, with their words.
 * Document requests are the default; Message team (owner decision 2026-11-13)
 * passes its own (Inbox, Push, SMS).
 */
export type TransportCatalog<T extends string> = {
  kind: SendTransportKind;
  order: readonly T[];
  label: Record<T, string>;
  detail: Record<T, string>;
  /** Ticked first when nothing usable is saved (when it is available). */
  first: T;
};

export const DOCUMENT_REQUEST_CATALOG: TransportCatalog<RequestTransport> = {
  kind: "document_request",
  order: REQUEST_TRANSPORTS,
  label: REQUEST_TRANSPORT_LABEL,
  detail: REQUEST_TRANSPORT_DETAIL,
  first: "PUSH",
};

/** What the choice needs to know (DocumentRequestOptions has this shape). */
export type TransportChoiceOptions<T extends string> = {
  transports: Record<T, TransportOption>;
  saved: { transports: readonly string[] } | null;
  savedReadable: boolean;
};

export type TransportChoiceState<T extends string = RequestTransport> = {
  transports: T[];
  remember: boolean;
  /** True while the saved choice is being used without showing the boxes. */
  usingSaved: boolean;
};

function catalogOr<T extends string>(catalog: TransportCatalog<T> | undefined): TransportCatalog<T> {
  return catalog ?? (DOCUMENT_REQUEST_CATALOG as unknown as TransportCatalog<T>);
}

function usableSaved<T extends string>(options: TransportChoiceOptions<T>, catalog: TransportCatalog<T>): T[] {
  if (!options.saved || !options.savedReadable) return [];
  return catalog.order.filter((transport) => options.saved!.transports.includes(transport) && options.transports[transport].available);
}

/** "Inbox, SMS" — the visible "Sending by" line. */
export function catalogTransportList<T extends string>(transports: readonly T[], catalog: TransportCatalog<T>): string {
  return catalog.order.filter((transport) => transports.includes(transport)).map((transport) => catalog.label[transport]).join(", ");
}

/** The first choice: the saved one when it is usable, else the catalog's first transport (when it can be used). */
export function initialTransportChoice<T extends string = RequestTransport>(options: TransportChoiceOptions<T>, catalog?: TransportCatalog<T>): TransportChoiceState<T> {
  const resolved = catalogOr(catalog);
  const saved = usableSaved(options, resolved);
  if (saved.length > 0) return { transports: saved, remember: false, usingSaved: true };
  return { transports: options.transports[resolved.first].available ? [resolved.first] : [], remember: false, usingSaved: false };
}

/** The transports actually sent: only those that can be used here. */
export function chosenTransports<T extends string = RequestTransport>(choice: TransportChoiceState<T>, options: TransportChoiceOptions<T>, catalog?: TransportCatalog<T>): T[] {
  return catalogOr(catalog).order.filter((transport) => choice.transports.includes(transport) && options.transports[transport].available);
}

type ChoiceProps<T extends string> = {
  options: TransportChoiceOptions<T>;
  value: TransportChoiceState<T>;
  onChange: (next: TransportChoiceState<T>) => void;
  disabled?: boolean;
  /** Called after the saved choice was forgotten on the server. */
  onForgotten?: () => void;
  /** The kind of send; document requests when omitted. */
  catalog?: TransportCatalog<T>;
};

function SavedLine<T extends string>({ options, value, disabled, onChange, onForgotten, catalog: given }: ChoiceProps<T>) {
  const catalog = catalogOr(given);
  const [forgetting, setForgetting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const unusable = catalog.order.filter((transport) => (options.saved?.transports ?? []).includes(transport) && !options.transports[transport].available);

  async function forget() {
    setForgetting(true);
    setError(null);
    const result = await officeRequest<unknown>("/api/me/send-transports", { method: "DELETE", body: { kind: catalog.kind } });
    setForgetting(false);
    if (!result.ok) return setError(result.message);
    onChange({ ...value, usingSaved: false, remember: false });
    onForgotten?.();
  }

  return (
    <div className="space-y-1 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>Sending by: <b className="font-[600]">{catalogTransportList(value.transports, catalog)}</b></span>
        <span aria-hidden="true">·</span>
        <EButton size="sm" variant="ghost" disabled={disabled || forgetting} onClick={() => onChange({ ...value, usingSaved: false })}>Change</EButton>
        <EButton size="sm" variant="ghost" disabled={disabled || forgetting} onClick={() => void forget()}>{forgetting ? "Forgetting…" : "Ask me again"}</EButton>
      </p>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Your saved choice (Don&apos;t ask again).</p>
      {unusable.map((transport) => (
        <p key={transport} className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          {catalog.label[transport]} is not used {catalog.kind === "document_request" ? "for this person" : "for this message"}: {options.transports[transport].reason}
        </p>
      ))}
      {error ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </div>
  );
}

export function TransportChoice<T extends string = RequestTransport>(props: ChoiceProps<T>) {
  const { options, value, onChange, disabled = false } = props;
  const catalog = catalogOr(props.catalog);
  if (value.usingSaved) return <SavedLine {...props} />;
  const toggle = (transport: T, on: boolean) => {
    const transports = on ? [...value.transports, transport] : value.transports.filter((item) => item !== transport);
    onChange({ ...value, transports });
  };
  return (
    <fieldset disabled={disabled} className="space-y-1.5">
      <legend className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Send by</legend>
      {catalog.order.map((transport) => {
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
              <b className="font-[550]">{catalog.label[transport]}</b>
              <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{option.available ? catalog.detail[transport] : option.reason}</span>
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
