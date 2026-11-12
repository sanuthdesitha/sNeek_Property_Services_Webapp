import "server-only";
/**
 * Server side of the document request transport choice (owner decision
 * 2026-11-12, item B): what each transport can do for a person, the office
 * user's saved "Don't ask again" choice, and which transports a send uses.
 *
 * Resolution on the server (`resolveRequestTransports`):
 * 1. transports named in the request (the dialogs always name them);
 * 2. otherwise the sender's saved choice for document requests;
 * 3. otherwise the in-app inbox only. (Before this change a request with no
 *    transports sent the inbox notice, email when an address existed and SMS
 *    when a phone existed. Automatic onboarding requests keep that set; they
 *    do not come through here.)
 */
import { db } from "@/lib/db";
import { externalTransportAvailability } from "@/lib/notifications/external-recipient";
import { getNotificationTypeControls } from "@/lib/notifications/type-controls";
import { readSendTransportPreferences, saveTransportChoice, type SendTransportPreferences } from "@/lib/notifications/send-transport-preference";
import { DOCUMENT_REQUEST_TYPE } from "./document-request-send";
import {
  REQUEST_TRANSPORTS,
  documentRequestTransportOptions,
  type DocumentRequestOptions,
  type DocumentRequestPerson,
  type RequestTransport,
  type TransportOptions,
} from "./document-request-transports";

export type RequestTransportSource = "request" | "saved" | "default";
export type ResolvedRequestTransports = { transports: RequestTransport[]; source: RequestTransportSource };

/** A saved choice may name transports of other kinds of send; only document request transports are used here. */
function requestTransportsOnly(transports: readonly string[]): RequestTransport[] {
  return REQUEST_TRANSPORTS.filter((transport) => transports.includes(transport));
}

function savedDocumentChoice(preferences: SendTransportPreferences): DocumentRequestOptions["saved"] {
  const saved = preferences.kinds.document_request;
  if (!saved) return null;
  const transports = requestTransportsOnly(saved.transports);
  return transports.length ? { transports, savedAt: saved.savedAt } : null;
}

type PersonRow = { id: string; name: string | null; email: string | null; phone: string | null; isActive: boolean };

export function documentRequestPerson(user: PersonRow): DocumentRequestPerson {
  return {
    id: user.id,
    name: user.name ?? user.email ?? "This person",
    hasEmail: Boolean(user.email?.trim()),
    hasPhone: Boolean(user.phone?.trim()),
    active: user.isActive,
  };
}

/** Per-transport availability for this person (contacts, switches, providers). */
export async function transportOptionsFor(person: DocumentRequestPerson): Promise<TransportOptions> {
  const [controls, providers] = await Promise.all([getNotificationTypeControls(), externalTransportAvailability()]);
  return documentRequestTransportOptions({
    hasEmail: person.hasEmail,
    hasPhone: person.hasPhone,
    active: person.active,
    switchedOff: controls.disabledTransports[DOCUMENT_REQUEST_TYPE] ?? [],
    providers,
  });
}

/**
 * Options for the dialog. `senderId` is the real signed-in office user whose
 * saved choice is shown; while impersonating nothing saved is read or used.
 */
export async function loadDocumentRequestOptions(
  personId: string,
  sender: { id: string; impersonating: boolean },
): Promise<DocumentRequestOptions | null> {
  const user = await db.user.findUnique({
    where: { id: personId },
    select: { id: true, name: true, email: true, phone: true, isActive: true },
  });
  if (!user) return null;
  return optionsForPerson(documentRequestPerson(user), sender);
}

export async function optionsForPerson(
  person: DocumentRequestPerson,
  sender: { id: string; impersonating: boolean },
): Promise<DocumentRequestOptions> {
  const none: SendTransportPreferences = { readable: true, kinds: {} };
  const [transports, preferences] = await Promise.all([
    transportOptionsFor(person),
    sender.impersonating ? Promise.resolve(none) : readSendTransportPreferences(sender.id),
  ]);
  return {
    person,
    transports,
    saved: savedDocumentChoice(preferences),
    savedReadable: preferences.readable,
    impersonating: sender.impersonating,
  };
}

/** Which transports a send uses (see the module comment for the order). */
export async function resolveRequestTransports(
  senderId: string,
  requested: readonly RequestTransport[] | undefined,
): Promise<ResolvedRequestTransports> {
  if (requested && requested.length > 0) return { transports: Array.from(new Set(requested)), source: "request" };
  const preferences = await readSendTransportPreferences(senderId);
  const saved = savedDocumentChoice(preferences);
  if (saved) return { transports: [...saved.transports], source: "saved" };
  return { transports: ["PUSH"], source: "default" };
}

/** "Don't ask again": remembers the sender's explicit choice for document requests. */
export async function rememberRequestTransports(senderId: string, transports: readonly RequestTransport[]): Promise<void> {
  await saveTransportChoice(senderId, "document_request", transports);
}
