"use client";

/**
 * One quote, viewed and edited on one page (board "Quote full page"). Keyed
 * by the outer page on each explicit reload from the server, so the builder
 * seeds from the saved quote.
 *
 * Autosave (owner decision 2026-11-13, `use-quote-autosave.ts`): on a saved
 * quote whose status is Draft, changes save themselves 1.5 s after the last
 * change, one save at a time, with the stale-write token; never while a field
 * is invalid, never sending it or changing its status. Sent, Accepted,
 * Declined and Converted quotes keep the explicit Save (with the token), so
 * nothing reaches the client's online page without a deliberate Save (the
 * status select still saves with Save). Typed text stays usable during a
 * background save; an explicit save freezes the fields. Primary actions save
 * first and wait. Create mode stays explicit (Create draft / Create and send).
 */
import * as React from "react";
import { toast } from "@/hooks/use-toast";
import type { ERowMenuItem } from "@/components/v2/ui/row-menu";
import { asQuoteStatus, convertAvailability, quoteEditLock, quotePrimaryAction, quoteSecondaryActions, quoteStages, repairQuoteHref, QUOTE_STATUS_LABEL, type QuotePageStatus } from "@/lib/quotes/quote-page-actions";
import { shortQuoteRef } from "@/lib/quotes/pipeline-types";
import { notesMetaBlock, type QuoteSnapshot } from "@/lib/quotes/quote-record";
import { quoteIsLiveForClient, quoteSaveStateLabel } from "@/lib/quotes/quote-autosave";
import { useQuoteBuilder, type QuoteBuilderOptions } from "../builder/use-quote-builder";
import { liveMarginCheck, type MarginModel } from "../builder/margin";
import { buildCreatePayload } from "../builder/payload";
import { SectionAddressedTo } from "../builder/section-addressed-to";
import { SectionServicePricing } from "../builder/section-service-pricing";
import { SectionDiscountTotals } from "../builder/section-discount-totals";
import { SectionPresentation } from "../builder/section-presentation";
import { QuoteHeader, QuoteProgress, STATUS_TONE, type HeaderButton } from "./quote-header";
import { quoteFacts } from "./facts";
import { RequestedAddOnsCard } from "./rail-addons";
import { ActivityCard, ConvertCard, ShareCard, StatusCard } from "./quote-rail";
import type { QuoteActions } from "./use-quote-actions";
import { useQuoteAutosave } from "./use-quote-autosave";
import { LiveForClientNote, QuoteSaveBanner, useQuoteNow } from "./quote-save-banner";

const LEAVE_WARNING = "This quote has changes that are not saved yet. Leave anyway?";

export type WorkspaceProps = {
  snapshot: QuoteSnapshot | null;
  builderOptions: Omit<QuoteBuilderOptions, "defaultRecipient">;
  marginModel: MarginModel;
  timezone: string;
  fromCase: { caseId: string; caseTitle: string; href: string } | null;
  actions: QuoteActions;
  notices?: React.ReactNode;
  onReload: () => Promise<void>;
  /** The version token every PATCH on this page sends (owned by the page). */
  tokenRef: React.MutableRefObject<string | null>;
  /** An autosave landed (the page keeps the record; the builder is not re-seeded). */
  onAutosaved: (record: Record<string, unknown>) => void;
  onCreated: (quoteId: string, send: boolean, recipient: string | null) => Promise<void>;
  onConvert: (date: string) => void;
  onDelete: () => void;
};

export function QuoteWorkspace({ snapshot, builderOptions, marginModel, timezone, fromCase, actions, notices, onReload, tokenRef, onAutosaved, onCreated, onConvert, onDelete }: WorkspaceProps) {
  const isNew = !snapshot;
  const builder = useQuoteBuilder({ ...builderOptions, defaultRecipient: snapshot?.client?.email || snapshot?.lead?.email || "" });
  const [statusDraft, setStatusDraft] = React.useState<QuotePageStatus>(asQuoteStatus(snapshot?.status ?? "DRAFT"));
  const [detailsSaving, setDetailsSaving] = React.useState(false);
  const status = asQuoteStatus(snapshot?.status ?? "DRAFT");
  const lockReason = snapshot ? quoteEditLock(status) : null;
  const locked = Boolean(lockReason);
  const totals = builder.pricing.totals;
  const shownTotals = totals.discountAmount > 0 ? totals.net : totals;
  const margin = liveMarginCheck(marginModel, builder.pricing.allLines, shownTotals.subtotal);
  const statusDirty = Boolean(snapshot) && statusDraft !== status;
  const dirty = builder.dirty || statusDirty;
  const autosave = useQuoteAutosave({
    quoteId: snapshot?.id ?? null,
    isNew,
    locked,
    quoteStatus: status,
    dirty: builder.dirty,
    draftKey: builder.saveRequest().key,
    problem: builder.draftProblem,
    busy: Boolean(actions.busy) || detailsSaving || builder.pricing.pricing || builder.checklist.loading || !builder.baselineReady,
    tokenRef,
    saveRequest: builder.saveRequest,
    onSaved: (request, record) => {
      builder.markSaved(request);
      onAutosaved(record);
    },
  });
  // An explicit save freezes the page; a background autosave leaves typing usable.
  const saving = builder.saving || detailsSaving || autosave.structuralSaving;
  const busy = saving || autosave.saving || Boolean(actions.busy);
  const unsaved = !isNew && (dirty || autosave.saving || autosave.status.kind === "conflict");
  const now = useQuoteNow(autosave.lastSavedAt !== null);

  React.useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = LEAVE_WARNING;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  /**
   * Save everything now (Save changes, and before every primary action).
   * Waits for a background save in flight; returns false (and keeps the
   * draft) when anything did not land.
   */
  async function saveAll(): Promise<boolean> {
    if (!snapshot) return false;
    if (locked) {
      if (!dirty) return true;
      setDetailsSaving(true);
      try {
        const notes = [builder.notes.trim(), notesMetaBlock(snapshot.notes)].filter(Boolean).join("\n");
        const validUntil = builder.validUntilDate ? new Date(`${builder.validUntilDate}T23:59:59`).toISOString() : null;
        return await actions.patch(
          snapshot.id,
          { status: statusDraft, notes: notes || null, internalNotes: builder.internalNotes.trim() || null, validUntil, showAddOnPrices: builder.showAddOnPrices },
          "Quote updated",
        );
      } finally {
        setDetailsSaving(false);
      }
    }
    const saved = await autosave.flush("Save changes");
    if (!saved) return false;
    if (statusDirty) return actions.patch(snapshot.id, { status: statusDraft }, "Quote saved");
    return true;
  }

  async function create(send: boolean) {
    const result = await builder.save();
    if (!result.ok) return toast({ title: "Could not create quote", description: result.error, variant: "destructive" });
    if (result.marginWarning) toast({ title: "Margin warning", description: result.marginWarning });
    if (result.discountError) toast({ title: "Discount not applied", description: result.discountError, variant: "destructive" });
    await onCreated(result.quoteId, send, builder.recipientEmail.trim() || null);
  }

  async function runPrimary() {
    if (!snapshot) return;
    const action = quotePrimaryAction({ status, convertedJobId: snapshot.convertedJobId, clientId: snapshot.clientId });
    if (!(await saveAll())) return;
    if (action.kind === "convert") return onConvert("");
    if (action.kind === "review-send") {
      await actions.openEmailPreview(snapshot.id, builder.recipientEmail.trim() || null);
      return;
    }
    if (action.patchStatus) await actions.patch(snapshot.id, { status: action.patchStatus }, action.kind === "mark-won" ? "Quote marked won" : "Quote reopened as a draft");
  }

  function previewPdf() {
    if (snapshot && !builder.dirty) return void actions.previewPdf(snapshot.id);
    const problem = builder.pricingProblem();
    if (problem) return toast({ title: "Add pricing first", description: problem, variant: "destructive" });
    const { clientId: _c, leadId: _l, newLead: _n, fromCaseId: _f, internalNotes: _i, ...payload } = buildCreatePayload(builder.payloadInput);
    void actions.previewDraftPdf(payload);
  }

  const reference = snapshot ? shortQuoteRef(snapshot) : null;
  const partyName = snapshot?.client?.name ?? snapshot?.lead?.name ?? null;
  const address = [builder.serviceAddress, builder.serviceSuburb].filter((part) => part.trim()).join(", ");
  const baseSaveState = quoteSaveStateLabel({ isNew, creating: builder.saving, status: autosave.status, unsaved: dirty, lastSavedAt: autosave.lastSavedAt, now });
  const saveState = !isNew && detailsSaving ? "Saving…" : !isNew && builder.dirty && builder.draftProblem && autosave.status.kind !== "failed" ? `Not saved yet: ${builder.draftProblem}` : baseSaveState;
  const liveForClient = Boolean(snapshot) && !locked && quoteIsLiveForClient(status, snapshot?.publicToken ?? null);
  const subLine = [partyName ?? (isNew ? null : "Direct quote"), address || null, saveState].filter(Boolean).join(" · ");
  const secondaryFlags = quoteSecondaryActions(status);
  const sharedReason = isNew ? "Available once the quote is created." : null;

  const primary: HeaderButton | null = (() => {
    if (isNew) return { key: "create-send", label: saving ? "Working…" : "Create and send", onClick: () => void create(true), disabled: busy };
    const action = quotePrimaryAction({ status, convertedJobId: snapshot!.convertedJobId, clientId: snapshot!.clientId });
    if (action.kind === "none") return null;
    if (action.kind === "open-job" || action.kind === "open-client") return { key: action.kind, label: action.label, href: action.href! };
    return { key: action.kind, label: action.label, onClick: () => void runPrimary(), disabled: busy };
  })();
  const secondary: HeaderButton[] = [
    { key: "pdf", label: actions.busy === "pdf" ? "Rendering…" : "Preview PDF", onClick: previewPdf, disabled: busy },
    ...(snapshot ? [{ key: "link", label: "Copy public link", onClick: () => void actions.copyPublicLink(snapshot.id, snapshot.publicToken), disabled: busy }] : []),
    ...(snapshot && secondaryFlags.resend ? [{ key: "resend", label: "Resend", onClick: () => void actions.openEmailPreview(snapshot.id, builder.recipientEmail.trim() || null), disabled: busy || dirty, title: dirty ? "Save first so the client gets your changes" : undefined }] : []),
  ];
  const save: HeaderButton | null = isNew
    ? { key: "draft", label: "Create draft", onClick: () => void create(false), disabled: busy }
    : dirty || autosave.status.kind === "failed"
      ? { key: "save", label: saving ? "Saving…" : "Save changes", onClick: () => void saveAll(), disabled: busy }
      : null;

  const repair = repairQuoteHref({ fromCaseId: fromCase?.caseId ?? null, clientId: snapshot?.clientId ?? null });
  const moreItems: ERowMenuItem[] = snapshot
    ? [
        { key: "repair", label: repair.label, href: repair.href },
        ...(snapshot.clientId ? [{ key: "client", label: "Open client", href: `/v2/admin/clients/${snapshot.clientId}` }] : []),
        ...(fromCase ? [{ key: "case", label: `Open case: ${fromCase.caseTitle}`, href: fromCase.href }] : []),
        { key: "download", label: "Export PDF", onSelect: () => void actions.downloadPdf(snapshot.id) },
        ...(dirty ? [{ key: "discard", label: "Discard unsaved changes", onSelect: () => void onReload() }] : []),
        { key: "delete", label: "Delete quote", danger: true, separated: true, onSelect: onDelete },
      ]
    : [];

  const convert = snapshot ? convertAvailability(status) : { enabled: false, reason: "Available once the quote is created and won." };
  const addOnBlocked = locked ? "This quote is converted; add-ons can no longer be priced in." : dirty || autosave.saving ? "Save or discard your changes first: adding updates the saved quote." : null;
  const emailPreviewReason = isNew ? "Available once the quote is created." : builder.dirty ? "Save first to preview your changes." : null;

  return (
    <div className="space-y-5">
      <QuoteHeader
        reference={reference}
        title={builder.quoteHeading.trim() || (isNew ? "New quote" : builder.pricing.serviceLabel)}
        statusLabel={QUOTE_STATUS_LABEL[status]}
        statusTone={STATUS_TONE[status] ?? "neutral"}
        subLine={subLine}
        secondary={secondary}
        primary={primary}
        save={save}
        moreItems={moreItems}
      />
      {notices}
      {!isNew ? <QuoteSaveBanner status={autosave.status} onReloadTheirs={() => void onReload()} onKeepMine={autosave.keepMine} onDismiss={autosave.dismiss} /> : null}
      {liveForClient ? <LiveForClientNote /> : null}
      {fromCase && snapshot ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">From case <a className="font-[600] text-[hsl(var(--e-primary))] hover:underline" href={fromCase.href}>{fromCase.caseTitle}</a></p>
      ) : null}
      {builder.casePrefill ? (
        <p role="note" className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
          From case <a className="font-[600] text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/cases?open=${encodeURIComponent(builder.casePrefill.caseId)}`}>{builder.casePrefill.caseTitle}</a>: client, service address, title, description and reference photos filled in where the case had them. Nothing is sent to the client until you choose to send it.
        </p>
      ) : null}
      <QuoteProgress
        stages={quoteStages({ status, shared: Boolean(snapshot?.publicToken), acceptedAt: snapshot?.acceptedAt ?? null, convertedJobId: snapshot?.convertedJobId ?? null })}
        facts={quoteFacts({ totalIncGst: shownTotals.totalAmount, gstEnabled: builderOptions.gstEnabled, validUntilDay: builder.validUntilDate, viewedAt: snapshot?.viewedAt ?? null, isNew, pricingSource: builder.pricing.pricingSource, margin, requestedCount: snapshot?.requestedAddOns.length ?? 0, timezone })}
      />
      {lockReason ? <p role="note" className="rounded-[var(--e-radius)] bg-[hsl(var(--e-warning-soft))] px-3 py-2 text-[0.8125rem]">{lockReason} Status, valid until, notes and add-on price visibility can still be changed.</p> : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Quote builder" className="min-w-0 space-y-4">
          <fieldset disabled={locked || saving} className="min-w-0 space-y-4">
            <SectionAddressedTo builder={builder} clients={builderOptions.clients} leads={builderOptions.leads} leadName={snapshot?.lead?.name ?? null} />
            <SectionServicePricing builder={builder} pricingVariables={builderOptions.pricingVariables} margin={margin} />
            <SectionDiscountTotals builder={builder} gstEnabled={builderOptions.gstEnabled} savedDiscount={!isNew && !builder.dirty} />
          </fieldset>
          <fieldset disabled={saving} className="min-w-0">
            <SectionPresentation builder={builder} locked={locked} emailPreviewReason={emailPreviewReason} onEmailPreview={() => snapshot && void actions.openEmailPreview(snapshot.id, builder.recipientEmail.trim() || null)} />
          </fieldset>
        </section>

        <aside aria-label="Quote status" className="min-w-0 space-y-4">
          {snapshot ? (
            <RequestedAddOnsCard
              items={snapshot.requestedAddOns}
              timezone={timezone}
              busy={busy}
              blockedReason={addOnBlocked}
              onAccept={(items, thenReview) =>
                void actions.requestedAddOns(snapshot.id, "accept", items).then((ok) => (ok && thenReview ? actions.openEmailPreview(snapshot.id, builder.recipientEmail.trim() || null) : undefined))
              }
              onDismiss={(item) => void actions.requestedAddOns(snapshot.id, "dismiss", [{ ...item, price: item.price }])}
            />
          ) : null}
          <StatusCard
            isNew={isNew}
            status={statusDraft}
            onStatusChange={setStatusDraft}
            validUntil={builder.validUntilDate}
            onValidUntil={builder.setValidUntilDate}
            notes={builder.notes}
            onNotes={builder.setNotes}
            internalNotes={builder.internalNotes}
            onInternalNotes={builder.setInternalNotes}
            onRegenerateNotes={locked ? null : builder.regenerateNotes}
            saving={saving}
            saveLabel="Save"
            statusHint={isNew ? "A new quote is saved as a draft." : status === "DRAFT" ? "Status changes save with Save; the other fields save on their own." : "Changes save with Save."}
            onSave={isNew ? null : () => void saveAll()}
            savedLine={saveState}
          />
          <ConvertCard enabled={convert.enabled && !busy} reason={convert.reason} addressLine={address} onConvert={onConvert} />
          <ShareCard
            busy={actions.busy}
            disabledReason={sharedReason}
            onPreview={previewPdf}
            onEmailPreview={() => snapshot && void actions.openEmailPreview(snapshot.id, builder.recipientEmail.trim() || null)}
            onExport={() => snapshot && void actions.downloadPdf(snapshot.id)}
            onCopyLink={() => snapshot && void actions.copyPublicLink(snapshot.id, snapshot.publicToken)}
            onResend={snapshot && secondaryFlags.resend ? () => void actions.openEmailPreview(snapshot.id, builder.recipientEmail.trim() || null) : null}
          />
          {snapshot ? <ActivityCard quoteId={snapshot.id} timezone={timezone} /> : null}
        </aside>
      </div>
    </div>
  );
}
