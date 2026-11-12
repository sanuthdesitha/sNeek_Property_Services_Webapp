"use client";

/**
 * Accounts "Request document" (Compliance board and a person's Documents
 * section; owner decision 2026-11-12, item B). The office fills in the request
 * and chooses how the person is told with the shared "Send by" choice:
 * Inbox / Email / SMS (each disabled with the reason), several at once, and
 * "Don't ask again" for this office user, shown afterwards as a visible
 * "Sending by: … · Change" line. The request always names its transports.
 *
 * - The person's options are read for the chosen person; an older answer for
 *   another person is ignored and the transport choice resets when the person
 *   changes (the rest of the draft is kept).
 * - Fields are frozen while the request runs; a refusal keeps the draft and
 *   shows the server's message.
 * - The result shows each transport's recorded state, never "sent".
 */
import * as React from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { STAFF_DOCUMENT_CATEGORIES } from "@/lib/accounts/required-documents";
import type { DocumentRequestDelivery } from "@/lib/workforce/document-request-send";
import type { DocumentRequestOptions } from "@/lib/workforce/document-request-transports";
import { officeRequest } from "../office-actions/office-outcomes";
import { DocumentRequestDeliveryView } from "../office-actions/document-request-delivery";
import { TransportChoice, chosenTransports, initialTransportChoice, type TransportChoiceState } from "../office-actions/transport-choice";

export type DocumentRequestPersonOption = { id: string; name: string; role?: string };

type Draft = { userId: string; category: string; title: string; notes: string; dueAt: string };
type Load = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; options: DocumentRequestOptions };
type Send = { status: "idle" } | { status: "sending" } | { status: "failed"; message: string } | { status: "done"; delivery: DocumentRequestDelivery };
type RequestAnswer = { ok: true; result: { id: string; delivery: DocumentRequestDelivery } };

function prettify(value: string): string {
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function emptyDraft(userId: string): Draft {
  return { userId, category: "POLICE_CHECK", title: "", notes: "", dueAt: "" };
}

/** Reads the chosen person's transport options; ignores answers for an earlier person. */
function usePersonOptions(userId: string, reloadKey: number): Load {
  const [load, setLoad] = React.useState<Load>({ status: "idle" });
  React.useEffect(() => {
    if (!userId) {
      setLoad({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setLoad({ status: "loading" });
    void officeRequest<DocumentRequestOptions>(`/api/admin/workforce/document-request?userId=${encodeURIComponent(userId)}`, { method: "GET", signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || (!result.ok && result.aborted)) return;
      if (!result.ok) return setLoad({ status: "error", message: result.message });
      if (result.body.person.id !== userId) return;
      setLoad({ status: "ready", options: result.body });
    });
    return () => controller.abort();
  }, [userId, reloadKey]);
  return load;
}

export function DocumentRequestDialog({ open, people, initialUserId, onClose, onSent }: {
  open: boolean;
  people: DocumentRequestPersonOption[];
  initialUserId?: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const firstId = initialUserId ?? people[0]?.id ?? "";
  const [draft, setDraft] = React.useState<Draft>(() => emptyDraft(firstId));
  const [choice, setChoice] = React.useState<TransportChoiceState | null>(null);
  const [send, setSend] = React.useState<Send>({ status: "idle" });
  const [reloadKey, setReloadKey] = React.useState(0);
  const load = usePersonOptions(open ? draft.userId : "", reloadKey);
  const options = load.status === "ready" ? load.options : null;

  // A new opening starts a new request; the scope (person) of the panel resets it too.
  React.useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft(firstId));
    setSend({ status: "idle" });
  }, [open, firstId]);

  // The transport choice belongs to one person: reset it with the options.
  React.useEffect(() => {
    setChoice(options ? initialTransportChoice(options) : null);
  }, [options]);

  const sending = send.status === "sending";
  const done = send.status === "done";
  const transports = options && choice ? chosenTransports(choice, options) : [];
  const canSend = Boolean(options && choice && draft.userId && draft.title.trim()) && transports.length > 0 && !options?.impersonating && !sending && !done;

  async function submit() {
    if (!choice || !canSend) return;
    setSend({ status: "sending" });
    const result = await officeRequest<RequestAnswer>("/api/admin/workforce", {
      body: {
        action: "REQUEST_DOCUMENT",
        userId: draft.userId,
        category: draft.category,
        title: draft.title.trim(),
        notes: draft.notes.trim() || null,
        dueAt: draft.dueAt || null,
        transports,
        rememberTransports: choice.remember && !choice.usingSaved,
      },
    });
    if (!result.ok) return setSend({ status: "failed", message: result.message });
    setSend({ status: "done", delivery: result.body.result.delivery });
    onSent();
  }

  return (
    <EActionDialog
      open={open}
      busy={sending}
      onClose={onClose}
      eyebrow="Compliance"
      title="Request a document"
      footer={done ? <EButton size="sm" onClick={onClose}>Done</EButton> : (
        <>
          <EButton size="sm" variant="outline" disabled={sending} onClick={onClose}>Cancel</EButton>
          <EButton size="sm" disabled={!canSend} onClick={() => void submit()}>{sending ? "Sending…" : "Send request"}</EButton>
        </>
      )}
    >
      <div className="space-y-3">
        <fieldset disabled={sending || done} className="space-y-3">
          {people.length > 1 || !initialUserId ? (
            <EField label="Team member">
              <ESelect value={draft.userId} onChange={(event) => setDraft({ ...draft, userId: event.target.value })}>
                {people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.role ? ` · ${prettify(person.role)}` : ""}</option>)}
              </ESelect>
            </EField>
          ) : <p>To: <b className="font-[600]">{people[0]?.name ?? "This person"}</b></p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <EField label="Category">
              <ESelect value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                {STAFF_DOCUMENT_CATEGORIES.map((category) => <option key={category} value={category}>{prettify(category)}</option>)}
              </ESelect>
            </EField>
            <EField label="Due date"><EInput type="date" value={draft.dueAt} onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })} /></EField>
          </div>
          <EField label="Document title"><EInput value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="e.g. Police check" /></EField>
          <EField label="Note to staff"><ETextarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Optional instructions" /></EField>
        </fieldset>
        {load.status === "loading" ? <p role="status">Checking how this person can be told…</p> : null}
        {load.status === "error" ? (
          <p role="alert" className="text-[hsl(var(--e-danger))]">
            {load.message} <EButton size="sm" variant="ghost" onClick={() => setReloadKey((key) => key + 1)}>Try again</EButton>
          </p>
        ) : null}
        {options?.impersonating ? <p role="note" className="text-[hsl(var(--e-danger))]">Document requests cannot be sent while impersonating.</p> : null}
        {options && choice && !done ? <TransportChoice options={options} value={choice} onChange={setChoice} disabled={sending} /> : null}
        {send.status === "failed" ? <p role="alert" className="text-[hsl(var(--e-danger))]">{send.message}</p> : null}
        {send.status === "done" ? <DocumentRequestDeliveryView delivery={send.delivery} noun="request" /> : null}
      </div>
    </EActionDialog>
  );
}
