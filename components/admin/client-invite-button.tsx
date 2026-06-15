"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { toast } from "@/hooks/use-toast";

/**
 * Send (or re-send) the client portal account invitation. Reuses the existing
 * /api/admin/clients/[id]/invite endpoint, which syncs the linked login to the
 * client's CURRENT email and mails a fresh temporary password — so fixing a
 * wrong email then re-inviting "just works". Disabled until the client has an
 * email on file.
 */
export function ClientInviteButton({
  clientId,
  hasEmail,
}: {
  clientId: string;
  hasEmail: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);

  async function send(credentials?: { pin?: string; password?: string }) {
    setSending(true);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ security: credentials }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Failed to send invitation.");
      setOpen(false);
      toast({
        title: payload.emailed ? "Invitation sent" : "Invitation created — email not delivered",
        description: payload.emailed
          ? "A fresh account invitation with a temporary password was emailed to the client."
          : payload.warning ??
            `The email could not be delivered. Temporary password: ${payload.tempPassword ?? "(check logs)"}`,
        variant: payload.emailed ? undefined : "destructive",
      });
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Invitation failed",
        description: err.message ?? "Could not send invitation.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={!hasEmail}
        title={hasEmail ? undefined : "Add a client email first"}
      >
        <Mail className="mr-2 h-4 w-4" />
        {hasEmail ? "Send / resend invite" : "Add email to invite"}
      </Button>
      <TwoStepConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Send account invitation"
        description="Creates or refreshes this client's portal login and emails a temporary password (any existing password is replaced). Confirm the client's email is correct first."
        actionKey="sendClientInvite"
        confirmLabel="Send invitation"
        requireSecurityVerification
        loading={sending}
        onConfirm={send}
      />
    </>
  );
}
