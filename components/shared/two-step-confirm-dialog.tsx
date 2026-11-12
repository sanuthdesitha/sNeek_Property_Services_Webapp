"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getConfirmationPolicy,
  type ConfirmationActionKey,
} from "@/lib/security/confirmation-policy";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import type { SensitiveCredentialsInput } from "@/lib/security/pin-rules";

interface TwoStepConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  actionKey?: ConfirmationActionKey;
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
  actionKey,
  confirmPhrase,
  confirmLabel = "Yes",
  cancelLabel = "No",
  loading = false,
  requireSecurityVerification = false,
  securityDescription,
  onConfirm,
}: TwoStepConfirmDialogProps) {
  const [typedPhrase, setTypedPhrase] = useState("");
  const ownPin = useOwnPinPrompt(open && requireSecurityVerification);

  useEffect(() => {
    if (!open) setTypedPhrase("");
  }, [open]);

  const policy = getConfirmationPolicy(actionKey);
  const resolvedConfirmPhrase = confirmPhrase?.trim() || policy?.confirmPhrase || "";
  const phraseRequired = Boolean(resolvedConfirmPhrase);
  const phraseMatches = !phraseRequired || typedPhrase.trim() === resolvedConfirmPhrase;
  const hasSecurityInput = !requireSecurityVerification || ownPin.credentials !== null;
  const canConfirm = phraseMatches && hasSecurityInput && !loading;

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

          {phraseRequired ? (
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <Label htmlFor="confirm-phrase">Type `{resolvedConfirmPhrase}` to continue</Label>
              <Input
                id="confirm-phrase"
                value={typedPhrase}
                onChange={(event) => setTypedPhrase(event.target.value)}
                placeholder={resolvedConfirmPhrase}
                autoComplete="off"
              />
            </div>
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
