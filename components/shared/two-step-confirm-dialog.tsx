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
  onConfirm: (credentials?: { pin?: string; password?: string }) => void | Promise<void>;
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
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setTypedPhrase("");
      setPin("");
      setPassword("");
    }
  }, [open]);

  const policy = getConfirmationPolicy(actionKey);
  const resolvedConfirmPhrase = confirmPhrase?.trim() || policy?.confirmPhrase || "";
  const phraseRequired = Boolean(resolvedConfirmPhrase);
  const phraseMatches = !phraseRequired || typedPhrase.trim() === resolvedConfirmPhrase;
  const hasSecurityInput = !requireSecurityVerification || Boolean(pin.trim() || password.trim());
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
                  {securityDescription ?? "Enter your admin PIN or your password to confirm this action."}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-pin">Admin PIN</Label>
                  <Input
                    id="confirm-pin"
                    inputMode="numeric"
                    value={pin}
                    onChange={(event) => setPin(event.target.value)}
                    placeholder="4+ digits"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Use password if PIN is unavailable"
                    autoComplete="current-password"
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              {cancelLabel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => onConfirm({ pin, password })}
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
