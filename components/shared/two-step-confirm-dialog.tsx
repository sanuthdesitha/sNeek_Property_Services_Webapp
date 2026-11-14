"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ConfirmationActionKey } from "@/lib/security/confirmation-policy";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import type { SensitiveCredentialsInput } from "@/lib/security/pin-rules";

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
  onConfirm: (credentials?: SensitiveCredentialsInput) => void | Promise<void>;
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
  onConfirm,
}: TwoStepConfirmDialogProps) {
  // Classic pages' confirmation (2026-11-14, board "Confirmations and deletes"):
  // one line and the button, plus the person's own credential when the action
  // is sensitive. The typed phrase is gone; no route ever checked it.
  const ownPin = useOwnPinPrompt(open && requireSecurityVerification);
  const hasSecurityInput = !requireSecurityVerification || ownPin.credentials !== null;
  const canConfirm = hasSecurityInput && !loading;

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
              onClick={() => onConfirm(requireSecurityVerification ? ownPin.credentials ?? undefined : undefined)}
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
