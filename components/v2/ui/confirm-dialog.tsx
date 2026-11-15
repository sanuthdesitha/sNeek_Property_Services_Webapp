"use client";

/**
 * THE CONFIRMATION DIALOG: three tiers, no typing
 * (board "Confirmations and deletes", approved 2026-11-14).
 *
 *   ordinary     (A) one sentence + Confirm. Enter confirms (focus starts on
 *                    the confirm button), Escape cancels.
 *   destructive  (B) one line saying what is removed + one red button. Focus
 *                    starts on Cancel so Enter never deletes by accident. The
 *                    caller offers Undo (undoToast) only where the removal has
 *                    not left the screen yet; otherwise its line says "This
 *                    cannot be undone".
 *   sensitive    (C) one or two plain lines + ONE credential field (the
 *                    signed-in person's own PIN; their password while they
 *                    have none) + confirm. The server verifies it.
 *
 * Nobody types DELETE, VOID, REMOVE or DISCARD. A reason is asked only where
 * the record keeps a history (`reason`): quick picks plus "Other…" with no
 * minimum length. Extra optional fields go under an "Add details" disclosure
 * (`details`), collapsed by default and kept open once opened.
 *
 * Fields, reason and credential lock while `busy`. A failed save keeps the
 * reason and details; the credential is cleared and the field reads the
 * person's PIN state again, so it can say "3 tries left" or "Locked".
 *
 * Built on EActionDialog: labelled and focus-trapped, rendered in the Estate
 * portal, a bottom sheet below 640px with the confirm button full width at the
 * bottom and Cancel above it as a text button.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { EActionDialog } from "./action-dialog";
import { EButton } from "./primitives";
import { EReasonPicker } from "./reason-picker";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import { EMPTY_REASON, composeReason, type ReasonChoice, type ReasonValue } from "@/lib/confirmations/reasons";
import type { SensitiveCredentialsInput } from "@/lib/security/pin-rules";

export type ConfirmTier = "ordinary" | "destructive" | "sensitive";

export type ConfirmReasonConfig = {
  /** The question above the choices, e.g. "Reason" or "What happened in Xero?". */
  label?: string;
  choices: readonly ReasonChoice[];
  /** Required unless false. A required reason has no minimum length. */
  required?: boolean;
  /** Appended to the composed reason as " · detail" (a note under Add details). */
  detail?: string;
};

export type ConfirmDetailsConfig = {
  /** The disclosure's label, e.g. "Add details: Xero reference, note". */
  label: string;
  content: React.ReactNode;
};

export type ConfirmResult = {
  /** Only for the sensitive tier. */
  credentials?: SensitiveCredentialsInput;
  /** Only when `reason` is configured: the composed reason text, or undefined when optional and empty. */
  reason?: string;
};

export type EConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  tier: ConfirmTier;
  title: React.ReactNode;
  /** One or two plain lines. May hold the caller's own fields when it has a form. */
  description?: React.ReactNode;
  /** Extra content after the description and reason (a form the action needs). */
  children?: React.ReactNode;
  /** A choice the action needs, drawn after the description and BEFORE the reason (e.g. a mode). */
  lead?: React.ReactNode;
  reason?: ConfirmReasonConfig;
  details?: ConfirmDetailsConfig;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  /** The caller's own validation (its form is incomplete). */
  confirmDisabled?: boolean;
  /** Shown above the buttons when the last attempt failed ("It was not recorded: …"). */
  error?: React.ReactNode;
  onConfirm: (result: ConfirmResult) => void | Promise<unknown>;
};

const TIER_LETTER: Record<ConfirmTier, string> = { ordinary: "A", destructive: "B", sensitive: "C" };

function tierEyebrow(tier: ConfirmTier, passwordMode: boolean): string {
  if (tier === "ordinary") return "Please confirm";
  if (tier === "destructive") return "Removes something";
  return passwordMode ? "Sensitive · your password" : "Sensitive · your PIN";
}

const LETTER_CLASS: Record<ConfirmTier, string> = {
  ordinary: "bg-[hsl(var(--e-primary)/0.14)] text-[hsl(var(--e-primary))]",
  destructive: "bg-[hsl(var(--e-danger)/0.14)] text-[hsl(var(--e-danger))]",
  sensitive: "bg-[hsl(var(--e-danger)/0.14)] text-[hsl(var(--e-danger))]",
};

export function EConfirmDialog({
  open,
  onClose,
  tier,
  title,
  description,
  children,
  lead,
  reason,
  details,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy = false,
  confirmDisabled = false,
  error,
  onConfirm,
}: EConfirmDialogProps) {
  const sensitive = tier === "sensitive";
  const ownPin = useOwnPinPrompt(open && sensitive);
  const [reasonValue, setReasonValue] = React.useState<ReasonValue>(EMPTY_REASON);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const detailsId = React.useId();

  // A new opening starts clean; while open, values survive failed attempts.
  React.useEffect(() => {
    if (!open) {
      setReasonValue(EMPTY_REASON);
      setDetailsOpen(false);
      setSubmitting(false);
    }
  }, [open]);

  const working = busy || submitting;
  const reasonRequired = reason ? reason.required !== false : false;
  const reasonText = reason ? composeReason(reason.choices, reasonValue, reason.detail) : null;
  const reasonOk = !reasonRequired || reasonText !== null;
  const credentialOk = !sensitive || ownPin.credentials !== null;
  const canConfirm = reasonOk && credentialOk && !confirmDisabled && !working;
  const passwordMode = sensitive && ownPin.fieldProps.status !== "testing" && (ownPin.fieldProps.settingUp ?? ownPin.fieldProps.status === "needs-setup");

  // After an attempt: when the dialog is still open once the caller finished,
  // the attempt failed. Clear the credential and read the PIN state again.
  const awaitingOutcome = React.useRef(false);
  const openRef = React.useRef(open);
  openRef.current = open;
  const noteFailure = ownPin.noteFailure;
  const settle = React.useCallback(() => {
    if (!awaitingOutcome.current) return;
    awaitingOutcome.current = false;
    if (openRef.current && sensitive) noteFailure();
  }, [noteFailure, sensitive]);
  const wasBusy = React.useRef(busy);
  React.useEffect(() => {
    if (wasBusy.current && !busy) settle();
    wasBusy.current = busy;
  }, [busy, settle]);

  async function submit() {
    if (!canConfirm) return;
    const result: ConfirmResult = {};
    if (sensitive && ownPin.credentials) result.credentials = ownPin.credentials;
    if (reason && reasonText !== null) result.reason = reasonText;
    awaitingOutcome.current = true;
    setSubmitting(true);
    try {
      await onConfirm(result);
    } finally {
      setSubmitting(false);
      // Callers that do not pass `busy` are judged once their updates render.
      window.setTimeout(() => {
        if (!wasBusy.current) settle();
      }, 60);
    }
  }

  const eyebrow = (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("inline-flex h-4 w-4 items-center justify-center rounded-[4px] text-[0.625rem] font-[700] normal-case", LETTER_CLASS[tier])}>
        {TIER_LETTER[tier]}
      </span>
      {tierEyebrow(tier, passwordMode)}
    </span>
  );

  const footer = (
    <>
      <EButton
        type="button"
        variant="outline"
        size="sm"
        onClick={onClose}
        disabled={working}
        data-autofocus={tier === "destructive" ? true : undefined}
        className="max-sm:order-1 max-sm:h-11 max-sm:w-full max-sm:border-transparent max-sm:bg-transparent"
      >
        {cancelLabel}
      </EButton>
      <EButton
        type="button"
        variant={tier === "ordinary" ? "primary" : "danger"}
        size="sm"
        disabled={!canConfirm}
        aria-disabled={!canConfirm}
        data-autofocus={tier === "ordinary" ? true : undefined}
        onClick={() => void submit()}
        className="max-sm:order-2 max-sm:h-12 max-sm:w-full"
      >
        {working ? "Working…" : confirmLabel}
      </EButton>
    </>
  );

  return (
    <EActionDialog
      open={open}
      title={title}
      eyebrow={eyebrow}
      description={description}
      busy={working}
      onClose={onClose}
      footer={footer}
      footerClassName="flex justify-end gap-2 max-sm:flex-col max-sm:gap-1"
    >
      {lead}
      {reason ? (
        <EReasonPicker
          label={reason.label ?? "Reason"}
          choices={reason.choices}
          value={reasonValue}
          onChange={setReasonValue}
          required={reasonRequired}
          disabled={working}
          onSubmit={() => void submit()}
        />
      ) : null}
      {children}
      {details ? (
        <div>
          <button
            type="button"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            disabled={working}
            onClick={() => setDetailsOpen((value) => !value)}
            className="flex min-h-9 w-full items-center justify-between gap-2 text-left text-[0.8125rem] font-[600] text-[hsl(var(--e-text-secondary))] max-sm:min-h-11"
          >
            {details.label}
            <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 transition-transform", detailsOpen && "rotate-180")} />
          </button>
          {/* Kept mounted while collapsed so typed details survive. */}
          <fieldset id={detailsId} hidden={!detailsOpen} disabled={working} className="mt-2 space-y-3">
            {details.content}
          </fieldset>
        </div>
      ) : null}
      {sensitive ? (
        <OwnPinFields
          {...ownPin.fieldProps}
          disabled={working}
          autoFocus={!reason && !children && !lead}
          onSubmit={() => void submit()}
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))] [overflow-wrap:anywhere]">
          {error}
        </p>
      ) : null}
    </EActionDialog>
  );
}
