"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { EAlert } from "@/components/v2/ui/primitives";
import { WORDING_STATUS_LABEL, WORDING_TRANSPORT_LABEL, type WordingFields, type WordingTransport } from "@/lib/notifications/wording/types";
import type { TypeWordingResponse } from "@/lib/notifications/wording/view-types";
import { sendJson, useNotificationRead } from "./use-notification-read";
import { WordingEditor, type EditorMessage } from "./wording-editor";
import { WordingHistory } from "./wording-history";
import { WordingPreview } from "./wording-preview";
import { WordingTestSend, testTransports } from "./wording-test-send";
import { draftKey, firstTab, partsForTab, sameFields, tabStates } from "./wording-model";
import { NotificationsPhoneBack } from "./phone-back";

/** Phones only: which stacked screen of a type is showing. */
export type WordingPhoneScreen = "type" | "editor";

type Props = {
  typeKey: string;
  catalogTransports: string[];
  details: React.ReactNode;
  timeZone: string;
  companyName: string;
  testBlockedReason: string | null;
  /** The catalog marks a test for types without editable wording (office messages). */
  testable: boolean;
  onSaved: () => void;
  /** Phones only (below 640px): the type screen or the wording editor screen. Omitted from 640px up. */
  phoneScreen?: WordingPhoneScreen;
  onPhoneScreen?: (screen: WordingPhoneScreen) => void;
};

function parseView(body: unknown): TypeWordingResponse {
  const value = body as Partial<TypeWordingResponse> | null;
  if (!value || !Array.isArray(value.parts) || typeof value.status !== "string") throw new Error("bad wording");
  return value as TypeWordingResponse;
}

/**
 * One type's wording: editor, history, preview and test send. Mounted with
 * key = type, so drafts, selections and proposals reset when the type
 * changes; within a type a draft survives switching transport or part.
 * Fields and selectors are frozen while a save runs; a failed save keeps the
 * draft; a stale write (409) asks to load the current version explicitly.
 */
export function WordingWorkspace({ typeKey, catalogTransports, details, timeZone, companyName, testBlockedReason, testable, onSaved, phoneScreen, onPhoneScreen }: Props) {
  const read = useNotificationRead(`/api/admin/notifications/wording/${encodeURIComponent(typeKey)}`, parseView, "Could not load this notification's wording.");
  const [saved, setSaved] = React.useState<TypeWordingResponse | null>(null);
  const view = saved ?? read.data;
  React.useEffect(() => setSaved(null), [read.data]);
  const [tab, setTab] = React.useState<WordingTransport | null>(null);
  const [partKey, setPartKey] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, WordingFields>>({});
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<EditorMessage | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const [proposal, setProposal] = React.useState<{ key: string; fields: WordingFields } | null>(null);
  const [regenerating, setRegenerating] = React.useState(false);

  const parts = view?.parts ?? [];
  const activeTab = tab && partsForTab(parts, tab).length ? tab : firstTab(parts);
  const tabParts = activeTab ? partsForTab(parts, activeTab) : [];
  const part = tabParts.find((item) => draftKey(item) === partKey) ?? tabParts[0] ?? null;
  const key = part ? draftKey(part) : "";
  const draft = part ? drafts[key] ?? part.live : {};

  function setDraft(fields: WordingFields) {
    setDrafts((current) => ({ ...current, [key]: fields }));
    setMessage(null);
  }

  async function put(body: Record<string, unknown>, success: string, clearDraft: boolean) {
    if (!part || saving) return;
    setSaving(true);
    setMessage(null);
    const result = await sendJson(`/api/admin/notifications/wording/${encodeURIComponent(typeKey)}`, "PUT", { partId: part.id, transport: part.transport, expectedHash: part.liveHash, ...body });
    setSaving(false);
    if (!result.ok) {
      if (result.status === 409) setConflict(true);
      else setMessage({ tone: "danger", text: result.error });
      return;
    }
    const response = result.body as { saved: { version: number }; view: TypeWordingResponse | null };
    if (response.view) setSaved(response.view);
    setConflict(false);
    if (clearDraft) setDrafts((current) => { const next = { ...current }; delete next[key]; return next; });
    setMessage({ tone: "success", text: success.replace("{v}", String(response.saved.version)) });
    onSaved();
  }

  async function regenerate() {
    if (!part || regenerating) return;
    setRegenerating(true);
    setMessage(null);
    const result = await sendJson("/api/admin/notifications/wording/regenerate", "POST", { typeKey, partId: part.id, transport: part.transport, fields: draft });
    setRegenerating(false);
    if (!result.ok) {
      setMessage({ tone: result.status === 409 ? "warning" : "danger", text: result.error });
      return;
    }
    setProposal({ key, fields: (result.body as { proposal: WordingFields }).proposal });
  }

  if (read.loading && !view) return <><div className="flex min-w-0 flex-1 flex-col gap-3">{details}<p role="status" className="text-sm">Loading wording…</p></div></>;
  if (!view) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {details}
        <EAlert tone="danger" title="Wording not loaded">{read.error ?? "Could not load this notification's wording."} <button type="button" className="underline" onClick={read.reload}>Retry</button></EAlert>
      </div>
    );
  }

  const preview = (
    <aside aria-label="Preview" className="flex min-w-0 flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 lg:w-[276px] lg:flex-none">
      <div className="flex items-center justify-between">
        <h3 className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">Preview</h3>
        <span className="text-xs text-[hsl(var(--e-muted-foreground))]">Sample data</span>
      </div>
      <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Sample job J-1061 · Jane · Manly Loft (invented, never a real person).</p>
      <WordingPreview parts={parts} drafts={drafts} companyName={companyName} />
      <hr className="border-[hsl(var(--e-border))]" />
      <WordingTestSend typeKey={typeKey} transports={parts.length || testable ? testTransports(catalogTransports) : []} disabledReason={testBlockedReason ?? (view.canEdit ? null : view.editReason)} />
    </aside>
  );

  const statusCard = (
    <section aria-labelledby="wording-status-heading" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 text-sm">
      <h3 id="wording-status-heading" className="font-semibold">Wording: {WORDING_STATUS_LABEL[view.status]}</h3>
      {view.reason ? <p className="mt-1">{view.reason}</p> : null}
      {view.href ? <a className="mt-2 inline-block underline" href={view.href}>{view.status === "COMPOSED" ? "Message templates in Forms" : "Open its editor"}</a> : null}
    </section>
  );

  const editor = part && activeTab ? (
    <WordingEditor
      view={view} tabs={tabStates(parts, catalogTransports)} tab={activeTab} part={part} draft={draft}
      saving={saving} message={message} conflict={conflict} proposal={proposal?.key === key ? proposal.fields : null} regenerating={regenerating}
      onTab={(next) => { setTab(next); setPartKey(null); setProposal(null); }}
      onPart={(next) => { setPartKey(next); setProposal(null); }}
      onDraft={setDraft}
      onSave={() => void put({ kind: "EDIT", fields: draft }, "Saved as v{v}. New sends use it.", true)}
      onCancel={() => setDrafts((current) => { const next = { ...current }; delete next[key]; return next; })}
      onReset={() => void put({ kind: "RESET" }, "Back to the default wording (saved as v{v}).", true)}
      onRegenerate={() => void regenerate()}
      onUseProposal={() => { if (proposal) setDraft(proposal.fields); setProposal(null); }}
      onDiscardProposal={() => setProposal(null)}
      onReload={() => { setConflict(false); read.reload(); }}
    />
  ) : null;
  const history = part ? (
    <WordingHistory key={key} part={part} timeZone={timeZone} canRestore={view.canEdit} busy={saving} onRestore={(version) => void put({ kind: "RESTORE", restoreVersion: version }, `Restored v${version} (saved as v{v}).`, true)} />
  ) : null;

  // Phones: the type screen lists each transport's wording; the editor screen
  // holds the text, the preview straight underneath, then the versions.
  if (phoneScreen === "type") {
    const tabs = tabStates(parts, catalogTransports).filter((item) => item.enabled);
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {details}
        {read.error ? <EAlert tone="warning" title="Showing the last loaded wording">{read.error}</EAlert> : null}
        {tabs.length > 0 ? (
          <section aria-labelledby="wording-phone-list" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2">
            <h3 id="wording-phone-list" className="px-2 pb-1 pt-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">Wording</h3>
            <ul className="divide-y divide-[hsl(var(--e-border))]">
              {tabs.map((item) => {
                const tabParts = partsForTab(parts, item.transport);
                const edited = tabParts.some((tabPart) => tabPart.liveSource !== "default");
                const unsaved = tabParts.some((tabPart) => drafts[draftKey(tabPart)] && !sameFields(drafts[draftKey(tabPart)], tabPart.live));
                return (
                  <li key={item.transport}>
                    <button
                      type="button"
                      onClick={() => { setTab(item.transport); setPartKey(null); setProposal(null); onPhoneScreen?.("editor"); }}
                      className="flex min-h-14 w-full items-center justify-between gap-2 px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{WORDING_TRANSPORT_LABEL[item.transport]} wording</span>
                        <span className="block text-xs text-[hsl(var(--e-muted-foreground))]">
                          {edited ? "Edited" : "Default wording"}{tabParts.length > 1 ? ` · ${tabParts.length} audiences` : ""}{unsaved ? " · unsaved changes" : ""}
                        </span>
                      </span>
                      <ChevronRight aria-hidden className="h-4 w-4 shrink-0" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <>
            {statusCard}
            {preview}
          </>
        )}
      </div>
    );
  }
  if (phoneScreen === "editor") {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <NotificationsPhoneBack
          title={activeTab ? `${WORDING_TRANSPORT_LABEL[activeTab]} wording` : "Wording"}
          subtitle={part ? part.label : undefined}
          backLabel="Back to this notification"
          onBack={() => onPhoneScreen?.("type")}
        />
        {read.error ? <EAlert tone="warning" title="Showing the last loaded wording">{read.error}</EAlert> : null}
        {editor ? (
          <>
            {editor}
            {preview}
            {history}
          </>
        ) : (
          <>
            {statusCard}
            {preview}
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {details}
        {read.error ? <EAlert tone="warning" title="Showing the last loaded wording">{read.error}</EAlert> : null}
        {editor ? (
          <>
            {editor}
            {history}
          </>
        ) : statusCard}
      </div>
      {preview}
    </>
  );
}
