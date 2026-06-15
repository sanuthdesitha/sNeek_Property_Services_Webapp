"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { toast } from "@/hooks/use-toast";

/**
 * Deactivate (remove) a client from the accounts page. Uses the existing
 * DELETE /api/admin/clients/[id] (soft delete → isActive=false) which hides the
 * client from active lists while preserving historical records. Security-gated.
 */
export function ClientDeleteButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function remove(credentials?: { pin?: string; password?: string }) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Could not remove client.");
      setOpen(false);
      toast({ title: "Client removed", description: `${clientName} has been deactivated.` });
      router.push("/admin/accounts?tab=clients");
      router.refresh();
    } catch (err: any) {
      toast({ title: "Remove failed", description: err.message ?? "Could not remove client.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)} disabled={deleting}>
        <Trash2 className="mr-2 h-4 w-4" />
        Remove client
      </Button>
      <TwoStepConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Remove client"
        description={`This deactivates ${clientName} and hides them from active lists. Existing jobs, invoices, and history are preserved. Confirm with your PIN or password.`}
        actionKey="deactivateClient"
        confirmLabel="Remove client"
        requireSecurityVerification
        loading={deleting}
        onConfirm={remove}
      />
    </>
  );
}
