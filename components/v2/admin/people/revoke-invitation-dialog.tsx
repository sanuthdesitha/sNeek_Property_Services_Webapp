"use client";

/**
 * Confirm "Revoke invitation" (owner decision 2026-11-13) for one or several
 * people: People › Invitations rows, the detail panel, bulk, and the
 * Assistants rows. Each person goes through the server's own rules (same as
 * Resend invitation); the answer lists who was revoked and who was refused
 * with the reason. Frozen while the request is in flight.
 */
import { useState } from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";

export type RevokeTarget = { userId: string; label: string };
export type RevokeOutcome = { ok: boolean; message: string };

type BulkRow = { userId: string; outcome: "revoked" | "refused"; error: string | null };

async function revokeOne(userId: string): Promise<string | null> {
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/account-emails/revoke-invitation`, { method: "POST" });
  if (response.ok) return null;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Could not revoke (${response.status}).`;
}

async function revokeMany(targets: RevokeTarget[]): Promise<RevokeOutcome> {
  const response = await fetch("/api/admin/users/account-emails/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: targets.map((target) => target.userId) }),
  });
  const body = (await response.json().catch(() => null)) as { results?: BulkRow[]; error?: string } | null;
  if (!response.ok || !body?.results) return { ok: false, message: body?.error ?? `Could not revoke (${response.status}).` };
  const names = new Map(targets.map((target) => [target.userId, target.label]));
  const refused = body.results.filter((row) => row.outcome === "refused");
  const revoked = body.results.length - refused.length;
  const refusedText = refused.map((row) => `${names.get(row.userId) ?? row.userId}: ${row.error ?? "refused"}`).join("; ");
  return { ok: refused.length === 0, message: `Revoked ${revoked} of ${body.results.length}.${refusedText ? ` Not revoked: ${refusedText}` : ""}` };
}

export function RevokeInvitationDialog({ targets, onClose, onDone }: { targets: RevokeTarget[]; onClose: () => void; onDone: (outcome: RevokeOutcome) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const single = targets.length === 1 ? targets[0] : null;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      if (single) {
        const refusal = await revokeOne(single.userId);
        if (refusal) {
          setError(refusal);
          return;
        }
        onDone({ ok: true, message: `Invitation for ${single.label} withdrawn. The link no longer works; Resend invitation issues a new one.` });
      } else {
        onDone(await revokeMany(targets));
      }
    } catch {
      setError("Could not reach the server. Nothing was confirmed; reload before trying again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EActionDialog
      open
      title={single ? `Revoke the invitation for ${single.label}?` : `Revoke ${targets.length} invitations?`}
      description="The invitation link stops working at once. Anyone who opens it is told to ask the office for a new one. You can send a fresh invitation later."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <EButton size="sm" variant="outline" disabled={busy} onClick={onClose}>Cancel</EButton>
          <EButton size="sm" variant="danger" disabled={busy} onClick={() => void confirm()}>{busy ? "Revoking…" : single ? "Revoke invitation" : `Revoke ${targets.length}`}</EButton>
        </>
      }
    >
      {single ? null : (
        <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-[0.8125rem]">
          {targets.map((target) => <li key={target.userId}>{target.label}</li>)}
        </ul>
      )}
      {error ? <p role="alert" className="mt-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </EActionDialog>
  );
}
