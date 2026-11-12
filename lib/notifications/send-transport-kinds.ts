/**
 * The kinds of office send that offer "Don't ask again", and every transport
 * a saved choice may name. Plain module: the dialogs, the preference store
 * (`send-transport-preference.ts`, server only) and the routes share it.
 */
export const SEND_TRANSPORT_KINDS = ["document_request", "job_office_message"] as const;
export type SendTransportKind = (typeof SEND_TRANSPORT_KINDS)[number];

export const SEND_TRANSPORT_KIND_LABEL: Record<SendTransportKind, string> = {
  document_request: "Request document and expiring-document reminders",
  job_office_message: "Message team on a job",
};

/** Every transport a saved choice can hold (each kind checks its own subset). */
export const SAVED_CHOICE_TRANSPORTS = ["INBOX", "PUSH", "EMAIL", "SMS"] as const;
export type SavedChoiceTransport = (typeof SAVED_CHOICE_TRANSPORTS)[number];
