"use client";

/**
 * THE ACCOUNT ACTIONS EVERY LOGIN NEEDS — edit, reset password, reset 2FA,
 * delete.
 *
 * These existed only inside the staff manager, so a virtual assistant — which
 * is a real login, with a real password and a real 2FA secret — could be
 * created and removed from a team but never actually MANAGED. Someone locked
 * out of their authenticator had no route back that did not involve deleting
 * them and starting again.
 *
 * The endpoints were never the problem: `/api/admin/users/[id]/…` are
 * role-agnostic and have always accepted any user id. What was missing was a
 * way to press them from the screen where VAs actually live.
 *
 * Extracted rather than copied into the VA manager, so the next portal that
 * grows a user list does not become a third copy that drifts.
 *
 * DESTRUCTIVE ACTIONS ARE PIN-GATED. Resetting someone's password or 2FA is
 * how an account gets taken over, and deletion is unrecoverable — an icon a
 * stray tap can reach is not enough.
 */

import * as React from "react";
import { KeyRound, MoreHorizontal, Pencil, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  EModal,
  verifyAdminSecurity,
} from "@/components/v2/admin/estate-kit";

export interface ManagedAccount {
  id: string;
  name: string | null;
  email: string;
}

type Dialog = "edit" | "password" | "twofa" | "delete" | null;

export function AccountActionsMenu({
  account,
  disabled,
  onChanged,
}: {
  account: ManagedAccount;
  disabled?: boolean;
  /** Called after anything succeeds so the caller can refetch. */
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState(account.name ?? "");
  const [email, setEmail] = React.useState(account.email);
  const [newPassword, setNewPassword] = React.useState("");

  // Re-sync when the caller refetches: without this, editing one member and
  // then opening another shows the first one's details.
  React.useEffect(() => {
    setName(account.name ?? "");
    setEmail(account.email);
  }, [account.id, account.name, account.email]);

  function close() {
    setDialog(null);
    setOpen(false);
    setNewPassword("");
  }

  async function run(label: string, fn: () => Promise<Response>) {
    setBusy(true);
    try {
      const res = await fn();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `${label} failed.`);
      toast({ title: label });
      close();
      await onChanged();
    } catch (err: any) {
      toast({ title: `${label} failed`, description: err?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="relative">
        <button
          type="button"
          aria-label={`Manage ${account.email}`}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className="rounded-[var(--e-radius-sm)] p-1 text-[hsl(var(--e-text-faint))] transition-colors hover:text-[hsl(var(--e-foreground))] disabled:opacity-40"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>

        {open ? (
          <>
            {/* Click-away. A menu that only closes via its own button strands
                itself open behind whatever the person taps next. */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] py-1 shadow-lg">
              {[
                { key: "edit" as const, label: "Edit details", icon: Pencil, danger: false },
                { key: "password" as const, label: "Reset password", icon: KeyRound, danger: false },
                { key: "twofa" as const, label: "Reset 2FA", icon: ShieldOff, danger: false },
                { key: "delete" as const, label: "Delete account", icon: Trash2, danger: true },
              ].map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setDialog(entry.key);
                  }}
                  className={
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-[0.8125rem] hover:bg-[hsl(var(--e-surface-raised))] " +
                    (entry.danger ? "text-[hsl(var(--e-danger))]" : "")
                  }
                >
                  <entry.icon className="h-3.5 w-3.5" /> {entry.label}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <EModal open={dialog === "edit"} onClose={close} title="Edit account">
        <div className="space-y-3">
          <EField label="Name">
            <EInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </EField>
          <EField label="Email" hint="They sign in with this.">
            <EInput value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
          </EField>
          <div className="flex justify-end gap-2">
            <EButton variant="ghost" onClick={close}>
              Cancel
            </EButton>
            <EButton
              variant="gold"
              disabled={busy || !email.trim()}
              onClick={() =>
                run("Account updated", () =>
                  fetch(`/api/admin/users/${account.id}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ name: name.trim() || null, email: email.trim() }),
                  })
                )
              }
            >
              Save
            </EButton>
          </div>
        </div>
      </EModal>

      <EModal open={dialog === "password"} onClose={close} title="Reset password">
        <div className="space-y-3">
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Sets a new password for {account.email}. Tell them what it is — this is the only time
            it is shown.
          </p>
          <EField label="New password">
            <EInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              type="text"
              autoComplete="off"
            />
          </EField>
          <div className="flex justify-end gap-2">
            <EButton variant="ghost" onClick={close}>
              Cancel
            </EButton>
            <EButton
              variant="gold"
              disabled={busy || newPassword.trim().length < 8}
              onClick={() =>
                run("Password reset", () =>
                  fetch(`/api/admin/users/${account.id}/reset-password`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ password: newPassword }),
                  })
                )
              }
            >
              Reset
            </EButton>
          </div>
        </div>
      </EModal>

      <EConfirmModal
        open={dialog === "twofa"}
        onClose={close}
        title="Reset two-factor?"
        description={`${account.email} will be able to sign in without a code until they set it up again. Enter your PIN or password to continue.`}
        confirmLabel="Reset 2FA"
        requireSecurity
        loading={busy}
        onConfirm={async (credentials) => {
          // The 2FA route takes no security payload of its own, so the PIN is
          // verified here — otherwise the prompt is decoration.
          await verifyAdminSecurity(credentials);
          await run("Two-factor reset", () =>
            fetch(`/api/admin/users/${account.id}/disable-2fa`, { method: "POST" })
          );
        }}
      />

      <EConfirmModal
        open={dialog === "delete"}
        onClose={close}
        title={`Delete ${account.name || account.email}?`}
        description="This permanently removes the login. Their history stays, but they can no longer sign in. Enter your PIN or password to continue."
        confirmLabel="Delete account"
        confirmPhrase="DELETE"
        requireSecurity
        loading={busy}
        onConfirm={async (credentials) => {
          await verifyAdminSecurity(credentials);
          await run("Account deleted", () =>
            fetch(`/api/admin/users/${account.id}`, { method: "DELETE" })
          );
        }}
      />
    </>
  );
}
