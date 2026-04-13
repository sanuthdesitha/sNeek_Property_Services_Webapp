"use client";

import { useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getConfirmationPolicy, type ConfirmationActionKey } from "@/lib/security/confirmation-policy";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  actionKey?: ConfirmationActionKey;
};

type PendingConfirm = ConfirmOptions & {
  open: boolean;
};

export function useBasicConfirmDialog() {
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  function closeWith(value: boolean) {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setPending(null);
  }

  function confirm(options: ConfirmOptions) {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPending({ ...options, open: true });
    });
  }

  const dialog = useMemo(() => {
    const policy = getConfirmationPolicy(pending?.actionKey);
    const confirmVariant = policy?.tier === "highRisk" ? "destructive" : "default";
    return (
      <Dialog
        open={pending?.open ?? false}
        onOpenChange={(open) => {
          if (!open) closeWith(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pending?.title ?? "Confirm action"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {pending?.description ?? "Please confirm you want to continue."}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => closeWith(false)}>
              {pending?.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={confirmVariant} onClick={() => closeWith(true)}>
              {pending?.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }, [pending]);

  return { confirm, dialog };
}
