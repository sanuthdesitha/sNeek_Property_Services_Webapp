"use client";

/**
 * Invitation › set a password (board "Public and sign in", screen 2).
 *
 * Markup only: the same two fields, the same checks (8+ characters, matching),
 * the same `POST /api/auth/accept-invite/[token]` body and the same move to
 * sign in afterwards. Accepting does not sign the person in, so the passkey
 * offer drawn here lives in onboarding, after sign-in, where a session exists
 * for the existing passkey registration (see docs/SYSTEM.md).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import { EButton } from "@/components/v2/ui/primitives";
import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS, AuthFrame } from "@/components/v2/public/auth-frame";

interface AcceptInviteFormProps {
  token: string;
  user: { email: string; name: string | null; role: string };
  expiresAt: string;
}

const TZ = "Australia/Sydney";

function expiryLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? formatInTimeZone(date, TZ, "EEE d MMM, HH:mm") : "soon";
}

export function AcceptInviteForm({ token, user, expiresAt }: AcceptInviteFormProps) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const expiresLabel = React.useMemo(() => expiryLabel(expiresAt), [expiresAt]);
  const roleLabel = user.role.replace(/_/g, " ").toLowerCase();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/auth/accept-invite/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Could not accept invitation.");
      }
      setDone(true);
      // Brief pause so the user sees the success state.
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <AuthFrame
        eyebrow="Done"
        title="Password set"
        intro={<p role="status">Your account is ready. Taking you to sign in… After you sign in you can add a passkey on this phone.</p>}
      >
        <EButton asChild variant="gold" size="lg" className="w-full">
          <Link href="/login">Go to sign in</Link>
        </EButton>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      eyebrow="Invitation"
      title="You're invited"
      intro={
        <p>
          {user.name ? `Hi ${user.name}, ` : "Hi, "}you have been added as a <strong>{roleLabel}</strong>. Set a password to finish.
        </p>
      }
    >
      <dl className="mb-5 space-y-1 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
        <div className="flex justify-between gap-3">
          <dt className="text-[hsl(var(--e-muted-foreground))]">Account</dt>
          <dd className="min-w-0 font-[550] [overflow-wrap:anywhere]">{user.email}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[hsl(var(--e-muted-foreground))]">Invitation expires</dt>
          <dd className="font-[550]">{expiresLabel}</dd>
        </div>
      </dl>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="password" className={AUTH_LABEL_CLASS}>Create a password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            aria-describedby="password-help"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
          <p id="password-help" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">At least 8 characters.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirm" className={AUTH_LABEL_CLASS}>Confirm password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
        </div>
        {error ? (
          <p role="alert" className="rounded-[var(--e-radius)] border-l-2 border-[hsl(var(--e-danger))] bg-[hsl(var(--e-danger-soft))] px-3 py-2 text-[0.8125rem]">
            {error}
          </p>
        ) : null}
        <EButton type="submit" variant="gold" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "Setting password…" : "Set password and continue"}
        </EButton>
      </form>
    </AuthFrame>
  );
}
