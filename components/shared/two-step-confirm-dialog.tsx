"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ConfirmationActionKey } from "@/lib/security/confirmation-policy";
import { useEffect, useId, useState } from "react";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import type { SensitiveCredentialsInput } from "@/lib/security/pin-rules";
import { EMPTY_REASON, OTHER_REASON_ID, composeReason, type ReasonChoice, type ReasonValue } from "@/lib/confirmations/reasons";

interface TwoStepConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** @deprecated Kept for older callers; no longer changes the dialog. */
  actionKey?: ConfirmationActionKey;
  /** @deprecated Ignored since 2026-11-14 ("simpler confirmations"): nobody types a word. */
  confirmPhrase?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  requireSecurityVerification?: boolean;
  securityDescription?: string;
  /** A required quick-pick reason (choices from lib/confirmations/reasons.ts; no minimum length). */
  reasonChoices?: readonly ReasonChoice[];
  onConfirm: (credentials?: SensitiveCredentialsInput, reason?: string) => void | Promise<void>;
}

export function TwoStepConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Yes",
  cancelLabel = "No",
  loading = false,
  requireSecurityVerification = false,
  securityDescription,
  reasonChoices,
  onConfirm,
}: TwoStepConfirmDialogProps) {
  const reasonId = useId();
  const [reasonValue, setReasonValue] = useState<ReasonValue>(EMPTY_REASON);
  useEffect(() => {
    if (!open) setReasonValue(EMPTY_REASON);
  }, [open]);
  const reasonText = reasonChoices ? composeReason(reasonChoices, reasonValue) : null;
  // Classic pages' confirmation (2026-11-14, board "Confirmations and deletes"):
  // one line and the button, plus the person's own credential when the action
  // is sensitive. The typed phrase is gone; no route ever checked it.
  const ownPin = useOwnPinPrompt(open && requireSecurityVerification);
  const hasSecurityInput = !requireSecurityVerification || ownPin.credentials !== null;
  const canConfirm = hasSecurityInput && (!reasonChoices || reasonText !== null) && !loading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {description ?? "This action is permanent and cannot be undone."}
          </p>

          {reasonChoices ? (
            <fieldset className="space-y-2" disabled={loading}>
              <legend className="text-sm font-medium">Reason, required</legend>
              <div className="flex flex-wrap gap-2">
                {reasonChoices.map((choice) => (
                  <label key={choice.id} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm sm:min-h-9">
                    <input
                      type="radio"
                      name={`${reasonId}-reason`}
                      checked={reasonValue.choice === choice.id}
                      onChange={() => setReasonValue({ ...reasonValue, choice: choice.id })}
                    />
                    {choice.label}
                  </label>
                ))}
              </div>
              {reasonValue.choice === OTHER_REASON_ID ? (
                <label className="block text-sm">
                  Say why
                  <input
                    className="mt-1 h-11 w-full rounded-md border bg-transparent px-3 text-[16px] sm:text-sm"
                    value={reasonValue.note}
                    maxLength={2000}
                    onChange={(event) => setReasonValue({ ...reasonValue, note: event.target.value })}
                  />
                </label>
              ) : null}
            </fieldset>
          ) : null}

          {requireSecurityVerification ? (
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <div>
                <p className="text-sm font-medium">Security verification</p>
                <p className="text-xs text-muted-foreground">
                  {securityDescription ?? "Enter your PIN to confirm this action."}
                </p>
              </div>
              <OwnPinFields {...ownPin.fieldProps} disabled={loading} />
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => onConfirm(requireSecurityVerification ? ownPin.credentials ?? undefined : undefined, reasonText ?? undefined)}
              disabled={!canConfirm}
            >
              {loading ? "Processing..." : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
