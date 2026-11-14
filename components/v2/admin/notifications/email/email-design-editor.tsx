"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Check, Lock, Plus, X } from "lucide-react";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EConfirmDialog, type ConfirmResult } from "@/components/v2/ui/confirm-dialog";
import { EBottomSheet } from "@/components/v2/ui/bottom-sheet";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { useIsPhone } from "@/components/v2/ui/use-phone";
import { checkDocument, documentKey, blockingChecks, SUBJECT_LIMIT, PREHEADER_LIMIT } from "@/lib/email-design/checks";
import { EMAIL_GROUP_ORDER } from "@/lib/email-design/registry";
import { allEmailDesigns, findEmailDesign as emailDesign } from "@/lib/email-design/all-designs";
import { BLOCK_LABEL, EMAIL_GROUP_LABEL, type EmailBlock, type EmailBlockType, type EmailDocument } from "@/lib/email-design/types";
import type { DesignViewResponse } from "@/lib/email-design/view-types";
import { sendJson, useNotificationRead } from "../use-notification-read";
import { BlockFields } from "./block-fields";
import { addableBlocks, blockSummary, canMove, insertBlock, moveBlock, newBlock, newIdempotencyKey, removeBlock, replaceBlock } from "./design-model";
import { EmailPreview } from "./email-preview";
import { InlineEditor, type InlineEditorHandle } from "./inline-editor";

type Props = {
  designKey: string;
  timeZone: string;
  /** Back to the type this email belongs to. */
  onBack: () => void;
  /** Choose another email (the type picker). */
  onChoose: (key: string) => void;
  /** Name of the notification type ("24-hour and 2-hour job reminders"), for the breadcrumb. */
  typeName: string | null;
};

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "failed"; message: string } | { kind: "conflict" };

function parseView(body: unknown): DesignViewResponse {
  const value = body as Partial<DesignViewResponse> | null;
  if (!value || typeof value.key !== "string" || !value.row || !value.theme) throw new Error("bad view");
  return value as DesignViewResponse;
}

function liveDocument(view: DesignViewResponse, fallback: EmailDocument): EmailDocument {
  return view.row.versions.find((item) => item.version === view.row.publishedVersion)?.doc ?? fallback;
}

function formatTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** A plain list of what a draft changes compared with the live version (for the publish dialog). */
function changeSummary(live: EmailDocument, draft: EmailDocument, label: (name: string) => string): string[] {
  const lines: string[] = [];
  const text = (value: EmailDocument["subject"]) => value.map((segment) => (segment.kind === "text" ? segment.text : `[${label(segment.name)}]`)).join("");
  if (text(live.subject) !== text(draft.subject)) lines.push(`Subject: "${text(live.subject)}" → "${text(draft.subject)}"`);
  if (text(live.preheader) !== text(draft.preheader)) lines.push("Preheader changed");
  const liveIds = new Map(live.blocks.map((block) => [block.id, block]));
  const draftIds = new Set(draft.blocks.map((block) => block.id));
  for (const block of draft.blocks) {
    const before = liveIds.get(block.id);
    if (!before) lines.push(`+ ${BLOCK_LABEL[block.type]} "${blockSummary(block, label).slice(0, 60)}"`);
    else if (documentKey({ subject: [], preheader: [], blocks: [before] }) !== documentKey({ subject: [], preheader: [], blocks: [block] })) lines.push(`~ ${BLOCK_LABEL[block.type]} changed`);
  }
  for (const block of live.blocks) if (!draftIds.has(block.id)) lines.push(`− ${BLOCK_LABEL[block.type]} removed`);
  if (lines.length === 0 && live.blocks.map((block) => block.id).join() !== draft.blocks.map((block) => block.id).join()) lines.push("Blocks moved");
  return lines.length ? lines : ["No changes to the words or blocks."];
}

/**
 * The email editor (approved board "Email editor", 2026-11), inside
 * Notifications › Types and wording. Blocks with value chips, only the blocks
 * this type allows, the checks list that blocks publishing, preview (desktop,
 * phone, dark, plain text) with a sample picker and a missing-values switch,
 * a test to myself through the real send path, versions with restore and
 * reset, draft vs published.
 *
 * The draft saves itself (a retry keeps its idempotency key, so "Try again"
 * never makes a second save; a stale write stops autosave and asks). Restore,
 * reset, discard and publish freeze the editor while they run. Publishing is
 * an administrator's, with their own PIN (tier C, checked on the server).
 * Mounted with key = email, so state resets when the email changes.
 */
export function EmailDesignEditor({ designKey, timeZone, onBack, onChoose, typeName }: Props) {
  const definition = emailDesign(designKey);
  const read = useNotificationRead(definition ? `/api/admin/notifications/email-designs/${encodeURIComponent(designKey)}` : null, parseView, "Could not load this email.");
  const [view, setView] = React.useState<DesignViewResponse | null>(null);
  React.useEffect(() => { if (read.data) setView(read.data); }, [read.data]);
  const [doc, setDoc] = React.useState<EmailDocument | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [save, setSave] = React.useState<SaveState>({ kind: "idle" });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<null | "publish" | "reset" | "discard" | { restore: number }>(null);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [testState, setTestState] = React.useState<{ busy: boolean; message: string | null; tone: "success" | "danger" | "warning" }>({ busy: false, message: null, tone: "success" });
  const idempotency = React.useRef<string>(newIdempotencyKey());
  const publishKey = React.useRef<string>(newIdempotencyKey());
  const focusedField = React.useRef<InlineEditorHandle | null>(null);
  const subjectRef = React.useRef<InlineEditorHandle | null>(null);
  const preRef = React.useRef<InlineEditorHandle | null>(null);
  const phone = useIsPhone();
  const previewRef = React.useRef<HTMLDivElement>(null);
  const headingId = React.useId();

  // Load the draft (or the live version) once per loaded view revision, never over unsaved typing.
  React.useEffect(() => {
    if (!view || !definition || dirty) return;
    setDoc(view.row.draft?.doc ?? liveDocument(view, definition.defaults));
  }, [view, definition, dirty]);

  const valueLabel = React.useCallback((name: string) => definition?.variables.find((variable) => variable.name === name)?.label ?? name, [definition]);

  const canDraft = Boolean(view?.access.canDraft) && !definition?.security;
  const frozen = !canDraft || busy !== null;

  // Autosave the draft 1.2 s after the last change; one request at a time.
  React.useEffect(() => {
    if (!dirty || !doc || !view || !canDraft || save.kind === "conflict" || save.kind === "saving" || busy) return;
    const timer = window.setTimeout(async () => {
      setSave({ kind: "saving" });
      const sent = doc;
      const result = await sendJson(`/api/admin/notifications/email-designs/${encodeURIComponent(designKey)}`, "PUT", { action: "DRAFT", doc: sent, expectedRevision: view.row.revision, idempotencyKey: idempotency.current });
      if (!result.ok) {
        setSave(result.status === 409 ? { kind: "conflict" } : { kind: "failed", message: result.error });
        return;
      }
      const next = result.body as DesignViewResponse;
      setView(next);
      idempotency.current = newIdempotencyKey();
      setSave({ kind: "saved", at: next.row.draft?.savedAt ?? new Date().toISOString() });
      // Typing that happened during the save stays dirty and saves next.
      setDoc((current) => {
        if (current && documentKey(current) === documentKey(sent)) setDirty(false);
        return current;
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, doc, view, canDraft, save.kind, busy, designKey]);

  if (!definition) return <EAlert tone="danger" title="Unknown email">This email is not on the block layout.</EAlert>;
  if (read.loading && !view) return <p role="status" className="text-sm">Loading the email…</p>;
  if (!view || !doc) {
    return <EAlert tone="danger" title="Email not loaded">{read.error ?? "Could not load this email."} <button type="button" className="underline" onClick={read.reload}>Retry</button></EAlert>;
  }

  const live = liveDocument(view, definition.defaults);
  const checks = checkDocument(definition, doc, view.theme);
  const blocking = blockingChecks(checks);
  const hasDraft = Boolean(view.row.draft) || dirty;
  const nextVersion = Math.max(1, ...view.row.versions.map((item) => item.version)) + 1;
  const addable = addableBlocks(definition, doc);

  function change(next: EmailDocument) {
    setDoc(next);
    setDirty(true);
    setNotice(null);
    if (save.kind === "failed") setSave({ kind: "idle" });
  }

  async function rowAction(body: Record<string, unknown>, success: string) {
    if (!view) return;
    setBusy(String(body.action));
    setActionError(null);
    const result = await sendJson(`/api/admin/notifications/email-designs/${encodeURIComponent(designKey)}`, "PUT", { ...body, expectedRevision: view.row.revision });
    setBusy(null);
    if (!result.ok) {
      if (result.status === 409) setSave({ kind: "conflict" });
      setActionError(result.error);
      return false;
    }
    const next = result.body as DesignViewResponse;
    setView(next);
    setDirty(false);
    setDoc(next.row.draft?.doc ?? liveDocument(next, definition!.defaults));
    setSave({ kind: "idle" });
    setNotice(success);
    setDialog(null);
    return true;
  }

  async function publish(result: ConfirmResult) {
    if (!view) return;
    setBusy("publish");
    setPublishError(null);
    const response = await sendJson(`/api/admin/notifications/email-designs/${encodeURIComponent(designKey)}/publish`, "POST", {
      expectedRevision: view.row.revision, idempotencyKey: publishKey.current, change: changeSummary(live, doc!, valueLabel).join("; ").slice(0, 200), security: result.credentials,
    });
    setBusy(null);
    if (!response.ok) {
      setPublishError(`It was not published: ${response.error}`);
      if (response.status === 409) setSave({ kind: "conflict" });
      return;
    }
    const body = response.body as { version: number; view: DesignViewResponse };
    publishKey.current = newIdempotencyKey();
    setView(body.view);
    setDirty(false);
    setDoc(liveDocument(body.view, definition!.defaults));
    setDialog(null);
    setNotice(`Published as v${body.version}. The next emails use it; emails already sent don't change.`);
  }

  async function sendTest() {
    setTestState({ busy: true, message: null, tone: "success" });
    const result = await sendJson(`/api/admin/notifications/email-designs/${encodeURIComponent(designKey)}/test`, "POST", { doc: hasDraft ? doc : null, sampleId: definition!.samples[0]?.id ?? null });
    if (!result.ok) {
      setTestState({ busy: false, message: result.error, tone: "danger" });
      return;
    }
    const outcome = result.body as { state: string; message: string };
    setTestState({ busy: false, message: outcome.message, tone: outcome.state === "provider_accepted" ? "success" : outcome.state === "uncertain" ? "warning" : "danger" });
  }

  const statusLine = (
    <span className="text-xs text-[hsl(var(--e-muted-foreground))]" role="status" aria-live="polite">
      {save.kind === "saving" ? "Saving draft…" : save.kind === "saved" ? `Draft saved ${formatTime(save.at, timeZone)}` : save.kind === "failed" ? null : dirty ? "Unsaved changes" : view.row.draft ? `Draft saved ${formatTime(view.row.draft.savedAt, timeZone)} by ${view.row.draft.actor.name ?? "someone"}` : ""}
    </span>
  );

  const selectedBlock = doc.blocks.find((block) => block.id === selected) ?? null;
  const blockEditor = selectedBlock ? (
    <BlockFields block={selectedBlock} definition={definition} disabled={frozen} valueLabel={valueLabel} onChange={(block) => change(replaceBlock(doc, block))} onFocusField={(handle) => { focusedField.current = handle; }} />
  ) : null;

  const valueChips = (
    <section aria-label="Insert value" className="flex flex-col gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">Insert value</h4>
        <span className="text-xs text-[hsl(var(--e-muted-foreground))]">{definition.variables.filter((variable) => !["rows", "photos", "built"].includes(variable.format ?? "text")).length} values allowed for this email</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {definition.variables.filter((variable) => !["rows", "photos", "built"].includes(variable.format ?? "text")).map((variable) => (
          <button
            key={variable.name}
            type="button"
            disabled={frozen}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => focusedField.current?.insertValue(variable.name)}
            title={variable.sample ? `Sample: ${variable.sample}` : undefined}
            className="inline-flex min-h-[36px] items-center rounded-full bg-[hsl(var(--e-primary)/0.12)] px-3 text-[0.8125rem] font-medium text-[hsl(var(--e-primary))] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
          >
            {variable.label}{variable.required ? " · required" : ""}
          </button>
        ))}
      </div>
      <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Click into a field, then a value. Values go in as chips you can move or delete whole. Typing {"{{"} or {"<"} is plain text; there is no HTML mode.</p>
    </section>
  );

  const blockRow = (block: EmailBlock, index: number) => {
    const isSelected = block.id === selected;
    const lockLabel = block.lock === "fixed" || definition.security ? "Fixed" : block.lock === "required" ? "Required" : null;
    return (
      <li key={block.id} className={`rounded-[var(--e-radius)] border ${isSelected ? "border-[hsl(var(--e-primary)/0.5)] bg-[hsl(var(--e-primary-soft))]" : "border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]"}`}>
        <div className="flex min-w-0 items-start gap-2 p-2">
          <button
            type="button"
            onClick={() => setSelected(isSelected ? null : block.id)}
            onKeyDown={(event) => {
              if (!event.altKey || frozen) return;
              if (event.key === "ArrowUp" && canMove(doc, block.id, -1, definition.security)) { event.preventDefault(); change(moveBlock(doc, block.id, -1)); }
              if (event.key === "ArrowDown" && canMove(doc, block.id, 1, definition.security)) { event.preventDefault(); change(moveBlock(doc, block.id, 1)); }
            }}
            aria-expanded={isSelected}
            aria-label={`${BLOCK_LABEL[block.type]}${index === 0 ? " (title)" : ""}: ${blockSummary(block, valueLabel)}. Alt plus arrow keys move it.`}
            className="min-h-[44px] min-w-0 flex-1 rounded-[var(--e-radius-sm)] px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
          >
            <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">
              {BLOCK_LABEL[block.type]}{index === 0 ? " · title" : ""}{block.showIf ? ` · only when ${valueLabel(block.showIf)} is known` : ""}
              {lockLabel ? <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--e-surface-sunken))] px-2 py-px normal-case tracking-normal"><Lock aria-hidden className="h-3 w-3" />{lockLabel}</span> : null}
            </span>
            <span className="mt-0.5 block truncate text-sm">{blockSummary(block, valueLabel)}</span>
          </button>
          {!definition.security ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <button type="button" aria-label={`Move ${BLOCK_LABEL[block.type]} up`} disabled={frozen || !canMove(doc, block.id, -1, definition.security)} onClick={() => change(moveBlock(doc, block.id, -1))} className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--e-radius-sm)] disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"><ArrowUp aria-hidden className="h-4 w-4" /></button>
              <button type="button" aria-label={`Move ${BLOCK_LABEL[block.type]} down`} disabled={frozen || !canMove(doc, block.id, 1, definition.security)} onClick={() => change(moveBlock(doc, block.id, 1))} className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--e-radius-sm)] disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"><ArrowDown aria-hidden className="h-4 w-4" /></button>
              <button type="button" aria-label={`Remove ${BLOCK_LABEL[block.type]}`} disabled={frozen || Boolean(block.lock) || index === 0} onClick={() => { change(removeBlock(doc, block.id)); if (selected === block.id) setSelected(null); }} className="inline-flex h-11 w-11 items-center justify-center rounded-[var(--e-radius-sm)] disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"><X aria-hidden className="h-4 w-4" /></button>
            </div>
          ) : null}
        </div>
        {isSelected && !phone ? <div className="border-t border-[hsl(var(--e-border))] p-3">{blockEditor}</div> : null}
      </li>
    );
  };

  const fixedRow = (title: string, text: string) => (
    <li className="flex min-h-[52px] items-center justify-between gap-2 rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border))] px-3 py-2">
      <span className="min-w-0"><span className="block text-xs font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">{title}</span><span className="block truncate text-sm">{text}</span></span>
      <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--e-surface-sunken))] px-2 py-px text-xs"><Lock aria-hidden className="h-3 w-3" />Fixed</span>
    </li>
  );

  const versionRows = [...view.row.versions].sort((a, b) => b.version - a.version);
  const groupLabel = EMAIL_GROUP_LABEL[definition.group];

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-[hsl(var(--e-muted-foreground))]">
        <button type="button" onClick={onBack} className="min-h-[44px] underline underline-offset-2">Types and wording</button>
        <span aria-hidden> › </span>{groupLabel}<span aria-hidden> › </span>{typeName ?? definition.typeKey}
      </nav>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id={headingId} className="font-[family-name:var(--e-font-serif)] text-2xl leading-tight">Email: {definition.label}</h2>
          <p className="mt-1 text-sm text-[hsl(var(--e-muted-foreground))]">Edit the words and blocks of this email. The look comes from Email look; nothing here can change the layout.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-[hsl(var(--e-band-good-bg))] px-2 py-0.5 font-semibold text-[hsl(var(--e-band-good-fg))]">{view.row.publishedVersion ? `Published v${view.row.publishedVersion} · live` : "Standard v1 · live"}</span>
            {hasDraft ? <span className="rounded-full bg-[hsl(var(--e-band-attention-bg))] px-2 py-0.5 font-semibold text-[hsl(var(--e-band-attention-fg))]">Draft (next v{nextVersion})</span> : null}
            {definition.security ? <span className="rounded-full bg-[hsl(var(--e-surface-sunken))] px-2 py-0.5 font-semibold">Core content fixed</span> : null}
            {statusLine}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 max-sm:hidden">
          <EButton variant="outline" className="min-h-[44px]" disabled={testState.busy || view.impersonating || !view.access.canDraft} onClick={() => void sendTest()}>{testState.busy ? "Sending…" : "Send test to me"}</EButton>
          {!definition.security ? (
            <EButton className="min-h-[44px]" disabled={!view.access.canPublish || !hasDraft || dirty || blocking.length > 0 || busy !== null} onClick={() => { setPublishError(null); setDialog("publish"); }}>Publish…</EButton>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${headingId}-pick`} className="text-sm font-medium">Email</label>
        <select id={`${headingId}-pick`} value={designKey} disabled={busy !== null || save.kind === "saving"} onChange={(event) => onChoose(event.target.value)} className="min-h-[44px] max-w-xl rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-base sm:text-sm">
          {EMAIL_GROUP_ORDER.map((group) => {
            const items = allEmailDesigns().filter((item) => item.group === group);
            return items.length ? <optgroup key={group} label={EMAIL_GROUP_LABEL[group]}>{items.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</optgroup> : null;
          })}
        </select>
      </div>

      {view.impersonating ? <EAlert tone="info" title="Read-only while testing as someone else">Nobody edits, publishes or sends tests while impersonating.</EAlert> : null}
      {!view.access.canDraft && !view.impersonating && view.access.draftReason ? <EAlert tone="info" title="View only">{view.access.draftReason}</EAlert> : null}
      {view.access.canDraft && !view.access.canPublish && !definition.security ? <EAlert tone="info" title="Drafts and tests only">{view.access.publishReason}</EAlert> : null}
      {view.customHtml ? <EAlert tone="warning" title="Still sent with the HTML edited in Forms">An administrator edited this template as raw HTML before the block editor existed. That HTML keeps going out (on the new layout) until a block version is published here.</EAlert> : null}
      {definition.security ? (
        <EAlert tone="info" title="Security email: core content fixed">Security emails keep their words fixed so a fake email is easier to spot and nobody can remove the code, link, expiry or warning by mistake. The Email look (logo, colour, button shape) still applies. To change these words, ask sNeek support; it is a code change with review.</EAlert>
      ) : null}
      {save.kind === "conflict" ? (
        <EAlert tone="warning" title="This email changed somewhere else">Autosave stopped so nothing is overwritten. Your draft is still on this screen. <button type="button" className="underline" onClick={() => { setDirty(false); setSave({ kind: "idle" }); read.reload(); }}>Load the current version</button> (your unsaved changes here are dropped).</EAlert>
      ) : null}
      {save.kind === "failed" ? <EAlert tone="danger" title="Draft not saved">{save.message} Your changes are kept. <button type="button" className="underline" onClick={() => setSave({ kind: "idle" })}>Try again</button></EAlert> : null}
      {actionError ? <EAlert tone="danger" title="Not changed">{actionError}</EAlert> : null}
      {notice ? <p role="status" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-band-good-line))] bg-[hsl(var(--e-band-good-bg))] px-3 py-2 text-sm text-[hsl(var(--e-band-good-fg))]">{notice}</p> : null}

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <section aria-label="Subject and preheader" className="flex flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${headingId}-subject`} className="text-sm font-medium">Subject · up to {SUBJECT_LIMIT} characters</label>
              <InlineEditor id={`${headingId}-subject`} label="Subject" value={doc.subject} onChange={(subject) => change({ ...doc, subject })} valueLabel={valueLabel} disabled={frozen} onFocusField={() => { focusedField.current = subjectRef.current; }} ref={subjectRef} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${headingId}-pre`} className="text-sm font-medium">Preheader · shown after the subject in the inbox · up to {PREHEADER_LIMIT}</label>
              <InlineEditor id={`${headingId}-pre`} label="Preheader" value={doc.preheader} onChange={(preheader) => change({ ...doc, preheader })} valueLabel={valueLabel} disabled={frozen} onFocusField={() => { focusedField.current = preRef.current; }} ref={preRef} />
            </div>
          </section>

          <section aria-labelledby={`${headingId}-blocks`} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h3 id={`${headingId}-blocks`} className="text-sm font-semibold">Blocks</h3>
              <span className="text-xs text-[hsl(var(--e-muted-foreground))]">Use the arrows or Alt + ↑ ↓ to move</span>
            </div>
            <ul className="flex flex-col gap-2">
              {fixedRow("Header", "Logo and reference, from Email look")}
              {doc.blocks.map(blockRow)}
              {fixedRow("Footer", `Business details, "${definition.security ? "Security emails can't be turned off." : definition.whyLine}"${definition.preferences !== "none" && !definition.security ? ", Email preferences" : ""}`)}
            </ul>
            {!definition.security ? (
              <div className="relative">
                <EButton variant="outline" className="min-h-[44px]" disabled={frozen} aria-expanded={addOpen} onClick={() => setAddOpen((value) => !value)}><Plus aria-hidden className="mr-1 h-4 w-4" />Add block</EButton>
                {addOpen ? (
                  <ul aria-label="Add block: only blocks this email type allows" className="mt-2 grid grid-cols-1 gap-1 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2 sm:grid-cols-2">
                    {addable.map((item) => (
                      <li key={item.type}>
                        <button
                          type="button"
                          disabled={!item.available || frozen}
                          onClick={() => {
                            const block = newBlock(item.type as EmailBlockType, definition, doc);
                            change(insertBlock(doc, block, selected ?? doc.blocks[doc.blocks.length - 1]?.id ?? null));
                            setSelected(block.id);
                            setAddOpen(false);
                          }}
                          className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[var(--e-radius)] px-2 text-left text-sm disabled:opacity-60 enabled:hover:bg-[hsl(var(--e-surface-sunken))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
                        >
                          <span className="font-medium">{item.available ? "+ " : ""}{item.label}</span>
                          {item.reason ? <span className="text-xs text-[hsl(var(--e-muted-foreground))]">{item.reason}</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          {!definition.security ? valueChips : null}

          <section aria-labelledby={`${headingId}-checks`} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
            <h3 id={`${headingId}-checks`} className="text-sm font-semibold">Checks before publishing {blocking.length ? <span className="ml-1 rounded-full bg-[hsl(var(--e-band-problem-bg))] px-2 py-px text-xs text-[hsl(var(--e-band-problem-fg))]">{blocking.length} to fix</span> : <span className="ml-1 rounded-full bg-[hsl(var(--e-band-good-bg))] px-2 py-px text-xs text-[hsl(var(--e-band-good-fg))]">All clear</span>}</h3>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2">
                  <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${check.ok ? "bg-[hsl(var(--e-band-good-bg))] text-[hsl(var(--e-band-good-fg))]" : check.level === "error" ? "bg-[hsl(var(--e-band-problem-bg))] text-[hsl(var(--e-band-problem-fg))]" : "bg-[hsl(var(--e-band-info-bg))] text-[hsl(var(--e-band-info-fg))]"}`}>{check.ok ? <Check className="h-3 w-3" /> : check.level === "error" ? "✕" : "i"}</span>
                  <span><span className="sr-only">{check.ok ? "Passed: " : check.level === "error" ? "Blocks publishing: " : "Note: "}</span>{check.message}</span>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby={`${headingId}-versions`} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`${headingId}-versions`} className="text-sm font-semibold">Versions</h3>
              {!definition.security ? (
                <div className="flex flex-wrap gap-2">
                  {view.row.draft ? <EButton variant="ghost" size="sm" disabled={frozen} onClick={() => setDialog("discard")}>Discard draft</EButton> : null}
                  <EButton variant="ghost" size="sm" disabled={frozen} onClick={() => setDialog("reset")}>Reset to standard…</EButton>
                </div>
              ) : null}
            </div>
            <div role="region" aria-label="Version history" tabIndex={0} className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead><tr className="text-xs text-[hsl(var(--e-muted-foreground))]"><th className="py-1 pr-2 font-medium">Version</th><th className="py-1 pr-2 font-medium">Saved</th><th className="py-1 pr-2 font-medium">By</th><th className="py-1 pr-2 font-medium">Change</th><th className="py-1 font-medium"><span className="sr-only">Action</span></th></tr></thead>
                <tbody>
                  {view.row.draft ? (
                    <tr className="border-t border-[hsl(var(--e-border))]"><td className="py-2 pr-2">Draft</td><td className="py-2 pr-2">{formatTime(view.row.draft.savedAt, timeZone)}</td><td className="py-2 pr-2">{view.row.draft.actor.name ?? "Someone"}</td><td className="py-2 pr-2">Based on v{view.row.draft.basedOn}</td><td className="py-2" /></tr>
                  ) : null}
                  {versionRows.map((version) => (
                    <tr key={version.version} className="border-t border-[hsl(var(--e-border))]">
                      <td className="py-2 pr-2">v{version.version}{version.version === view.row.publishedVersion ? " · published" : ""}</td>
                      <td className="py-2 pr-2">{formatTime(version.savedAt, timeZone)}</td>
                      <td className="py-2 pr-2">{version.actor.name ?? "Someone"}</td>
                      <td className="py-2 pr-2">{version.change || (version.restoredFrom ? `Restored v${version.restoredFrom}` : "—")}</td>
                      <td className="py-2 text-right">{!definition.security && version.version !== view.row.publishedVersion ? <EButton variant="ghost" size="sm" disabled={frozen} onClick={() => setDialog({ restore: version.version })}>Restore as draft</EButton> : null}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[hsl(var(--e-border))]">
                    <td className="py-2 pr-2">v1 · standard{view.row.publishedVersion ? "" : " · live"}</td>
                    <td className="py-2 pr-2">Migrated</td>
                    <td className="py-2 pr-2">sNeek</td>
                    <td className="py-2 pr-2">Words from {definition.source}</td>
                    <td className="py-2 text-right">{!definition.security && view.row.publishedVersion ? <EButton variant="ghost" size="sm" disabled={frozen} onClick={() => setDialog({ restore: 1 })}>Restore as draft</EButton> : null}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-[hsl(var(--e-muted-foreground))]">Restoring makes a new draft from that version; nothing goes live until it is published. The last 60 versions are kept.</p>
          </section>
        </div>

        <aside ref={previewRef} aria-label="Preview and test" className="flex min-w-0 flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3 lg:w-[min(46%,690px)] lg:flex-none">
          <h3 className="text-sm font-semibold">Preview · {hasDraft ? "draft" : "live"} <span className="font-normal text-[hsl(var(--e-muted-foreground))]">updates as you type</span></h3>
          <EmailPreview definition={definition} doc={doc} theme={view.theme} business={view.business} appUrl={view.appUrl} label="Email preview" />
          <section aria-label="Send a test to myself" className="flex flex-col gap-2 border-t border-[hsl(var(--e-border))] pt-3">
            <h4 className="text-sm font-semibold">Send a test to myself</h4>
            <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Goes only to your own account address, marked [Test], by the real sending path and its safeguards, with invented sample values. Never to a recipient. Not available while testing as someone else.</p>
            <EButton variant="outline" className="min-h-[44px] self-start" disabled={testState.busy || view.impersonating || !view.access.canDraft} onClick={() => void sendTest()}>{testState.busy ? "Sending…" : hasDraft ? "Send test of draft" : "Send test of live version"}</EButton>
            {testState.message ? <p role={testState.tone === "danger" ? "alert" : "status"} className="text-sm">{testState.message}</p> : null}
          </section>
        </aside>
      </div>

      {phone && selectedBlock ? (
        <EBottomSheet open onOpenChange={(open) => { if (!open) setSelected(null); }} title={BLOCK_LABEL[selectedBlock.type]} footer={<EButton className="min-h-[44px] w-full" onClick={() => setSelected(null)}>Done</EButton>}>
          <div className="flex flex-col gap-3">
            {blockEditor}
            {!definition.security ? valueChips : null}
          </div>
        </EBottomSheet>
      ) : null}

      <EPhoneActionBar
        label="Email actions"
        secondary={<EButton variant="outline" className="min-h-[44px]" onClick={() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>Preview</EButton>}
        primary={definition.security ? (
          <EButton className="min-h-[44px]" disabled={testState.busy || view.impersonating || !view.access.canDraft} onClick={() => void sendTest()}>Send test</EButton>
        ) : (
          <EButton className="min-h-[44px]" disabled={!view.access.canPublish || !hasDraft || dirty || blocking.length > 0 || busy !== null} onClick={() => { setPublishError(null); setDialog("publish"); }}>
            {blocking.length ? `Publish · ${blocking.length} to fix` : "Publish…"}
          </EButton>
        )}
      />

      <EConfirmDialog
        open={dialog === "publish"}
        onClose={() => { if (busy !== "publish") setDialog(null); }}
        tier="sensitive"
        title="Publish email changes?"
        description={<>{definition.label}. The next emails use v{nextVersion}. Emails already sent don't change.</>}
        confirmLabel={`Publish v${nextVersion}`}
        busy={busy === "publish"}
        error={publishError}
        onConfirm={publish}
      >
        <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-2 text-sm">
          <p className="font-medium">What changed since {view.row.publishedVersion ? `v${view.row.publishedVersion}` : "the standard"}</p>
          <ul className="mt-1 list-disc pl-5">{changeSummary(live, doc, valueLabel).map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      </EConfirmDialog>
      <EConfirmDialog
        open={dialog === "reset"}
        onClose={() => { if (!busy) setDialog(null); }}
        tier="destructive"
        title="Reset to standard?"
        description={`Makes a draft with sNeek's standard words (v1) for ${definition.label}, replacing the current draft. Your published versions stay in the history. You still publish it.`}
        confirmLabel="Make standard draft"
        busy={busy === "RESET"}
        onConfirm={() => rowAction({ action: "RESET" }, "The standard words are now the draft. Publish it when ready.")}
      />
      <EConfirmDialog
        open={dialog === "discard"}
        onClose={() => { if (!busy) setDialog(null); }}
        tier="destructive"
        title="Discard the draft?"
        description="The draft's changes are removed. The live version is not affected. This cannot be undone."
        confirmLabel="Discard draft"
        busy={busy === "DISCARD"}
        onConfirm={() => rowAction({ action: "DISCARD" }, "Draft discarded. The live version is unchanged.")}
      />
      <EConfirmDialog
        open={typeof dialog === "object" && dialog !== null}
        onClose={() => { if (!busy) setDialog(null); }}
        tier="ordinary"
        title="Restore as draft?"
        description={typeof dialog === "object" && dialog ? `Makes a draft from v${dialog.restore}, replacing the current draft. Nothing goes live until it is published.` : ""}
        confirmLabel="Restore as draft"
        busy={busy === "RESTORE"}
        onConfirm={() => (typeof dialog === "object" && dialog ? rowAction({ action: "RESTORE", version: dialog.restore }, `v${dialog.restore} is now the draft. Publish it when ready.`) : undefined)}
      />
    </section>
  );
}

