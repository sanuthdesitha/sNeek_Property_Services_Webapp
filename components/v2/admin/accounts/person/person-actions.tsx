"use client";

/**
 * Person header actions: "Test as" and the "more" menu (Resend invite, Reset
 * password, Reset 2FA, Disable / Activate, Delete). Each keeps its existing
 * rule, verified on the server as before:
 *  - Reset password and Reset 2FA: PIN or password (sent as `security`).
 *  - Delete: type DELETE plus PIN or password.
 *  - Disable / Activate and Resend invite: no extra step, as before.
 * Only controls the viewer's role can use are shown.
 */
import Link from "next/link";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EButton } from "@/components/v2/ui/primitives";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import type { PersonCapabilities, PersonProfile } from "@/lib/accounts/person-types";

type Dialog = "password" | "twofa" | "delete" | null;
type Credentials = { pin?: string; password?: string };

async function post(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = typeof json.error === "string" ? json.error : "";
    if (error === "INVALID_SECURITY_VERIFICATION") throw new Error("That PIN or password was not accepted.");
    if (error === "PIN_OR_PASSWORD_REQUIRED") throw new Error("Enter your PIN or password.");
    throw new Error(error && error !== "FORBIDDEN" ? error : "That action was refused.");
  }
  return json;
}

export function PersonActions({
  profile,
  caps,
  fullPageHref,
  onChanged,
  onDeleted,
}: {
  profile: PersonProfile;
  caps: PersonCapabilities;
  /** Shown in the panel; omitted on the full page itself. */
  fullPageHref?: string;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const who = profile.name ?? profile.email;
  const base = `/api/admin/users/${profile.id}`;

  async function run(label: string, action: () => Promise<Record<string, unknown>>, after?: (body: Record<string, unknown>) => void) {
    setBusy(true);
    try {
      const body = await action();
      if (after) after(body);
      else toast({ title: label });
      setDialog(null);
      onChanged();
    } catch (error) {
      toast({ title: `${label} failed`, description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  // A pending invitation gets a fresh link; an unverified self-registered login a fresh code (the server decides again).
  const canResend = caps.canResendInvite && profile.isActive && (profile.status === "INVITED" || !profile.emailVerified);
  const items: ERowMenuItem[] = [];
  if (fullPageHref) items.push({ key: "page", label: "Open full page", href: fullPageHref });
  if (canResend) items.push({ key: "resend", label: "Resend invite", onSelect: () => void run("Invite sent", () => post(`${base}/resend-otp`, "POST"), (body) => toast({ title: typeof body.message === "string" ? body.message : "Invite sent" })) });
  if (caps.isAdmin) {
    items.push(
      { key: "password", label: "Reset password", onSelect: () => setDialog("password"), separated: items.length > 0 },
      { key: "twofa", label: "Reset 2FA", onSelect: () => setDialog("twofa") },
      {
        key: "active",
        label: profile.isActive ? "Disable" : "Activate",
        onSelect: () => void run(profile.isActive ? "Account disabled" : "Account activated", () => post(base, "PATCH", { isActive: !profile.isActive })),
      },
      { key: "delete", label: "Delete", danger: true, separated: true, onSelect: () => setDialog("delete") },
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {caps.isAdmin && profile.testable ? (
        <EButton asChild size="sm" variant="outline">
          <Link href={`/v2/admin/system/test-as?user=${encodeURIComponent(profile.id)}`}>Test as</Link>
        </EButton>
      ) : null}
      {items.length > 0 ? <ERowMenu label={`More actions for ${who}`} items={items} disabled={busy} /> : null}

      <EConfirmModal
        open={dialog === "password"}
        onClose={() => setDialog(null)}
        title="Reset password"
        description={`Generate a temporary password for ${who} and email it to them. Enter your PIN or password to continue.`}
        confirmLabel="Reset password"
        requireSecurity
        danger={false}
        loading={busy}
        onConfirm={(credentials?: Credentials) =>
          run("Temporary password sent", () => post(`${base}/reset-password`, "POST", { security: credentials }), (body) => {
            if (body.warning && typeof body.tempPassword === "string") {
              toast({ title: "Password reset, email failed", description: `Temporary password: ${body.tempPassword}`, variant: "destructive" });
            } else {
              toast({ title: "Temporary password sent", description: "They received a reset email." });
            }
          })
        }
      />
      <EConfirmModal
        open={dialog === "twofa"}
        onClose={() => setDialog(null)}
        title="Reset two-step verification"
        description={`${who} will be able to sign in with just their password and set 2FA up again. Enter your PIN or password to continue.`}
        confirmLabel="Reset 2FA"
        requireSecurity
        loading={busy}
        onConfirm={(credentials?: Credentials) => run("Two-step verification reset", () => post(`${base}/disable-2fa`, "POST", { security: credentials }))}
      />
      <EConfirmModal
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        title="Delete account"
        description={`This will permanently delete ${who}. Accounts with job history cannot be deleted; disable them instead.`}
        confirmLabel="Delete account"
        confirmPhrase="DELETE"
        requireSecurity
        loading={busy}
        onConfirm={async (credentials?: Credentials) => {
          setBusy(true);
          try {
            await post(base, "DELETE", { security: credentials });
            toast({ title: "Account deleted" });
            setDialog(null);
            onDeleted();
          } catch (error) {
            toast({ title: "Delete failed", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
