"use client";

/**
 * Your profile › Signed-in sessions. Lists the sign-ins the app recorded
 * (lib/auth/sign-in-records.ts): device only as the browser described it,
 * otherwise "device not recorded"; place is never recorded. "Sign out
 * everywhere else" is tier C (own PIN, or password while there is no PIN),
 * verified by the route in the same request; this browser stays signed in.
 */
import * as React from "react";
import { HelpCircle, Laptop, Smartphone } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { sensitiveVerificationText } from "@/lib/security/pin-rules";
import { PROFILE_HINT, ProfileCard, ProfileMessage } from "./profile-card";

type SignedInSession = {
  id: string;
  device: string | null;
  deviceKind: "desktop" | "phone" | "unknown";
  method: "PASSWORD" | "PASSKEY";
  signedInAt: string;
  lastActiveAt: string;
  current: boolean;
};

type Ready = {
  sessions: SignedInSession[];
  currentUnrecorded: boolean;
  olderSignInsMayExist: boolean;
  sessionsValidFrom: string | null;
};

type Load = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "impersonating" } | { kind: "ready"; data: Ready };

function when(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function DeviceIcon({ kind }: { kind: SignedInSession["deviceKind"] }) {
  const Icon = kind === "phone" ? Smartphone : kind === "desktop" ? Laptop : HelpCircle;
  return (
    <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))]">
      <Icon className="h-4 w-4" />
    </span>
  );
}

export function SessionsCard({ timeZone, readOnlyReason }: { timeZone: string; readOnlyReason: string | null }) {
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    void (async () => {
      try {
        const res = await fetch("/api/me/sessions", { cache: "no-store", signal: controller.signal });
        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !body) return setLoad({ kind: "failed", message: "Your sessions could not be loaded." });
        if (body.impersonating) return setLoad({ kind: "impersonating" });
        setLoad({ kind: "ready", data: body as Ready });
      } catch {
        if (!controller.signal.aborted) setLoad({ kind: "failed", message: "Your sessions could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const data = load.kind === "ready" ? load.data : null;
  const others = data ? data.sessions.filter((session) => !session.current).length : 0;

  return (
    <ProfileCard id="sessions" title="Signed-in sessions" state={{ text: "Sydney time", shape: "none" }}>
      {load.kind === "loading" ? (
        <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
      ) : load.kind === "failed" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[0.875rem]">
          {load.message}
          <EButton variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>Try again</EButton>
        </div>
      ) : load.kind === "impersonating" ? (
        <p className="text-[0.875rem]">{readOnlyReason ?? "Not shown while testing as someone else."}</p>
      ) : data ? (
        <div className="space-y-3">
          <ul className="space-y-2.5">
            {data.currentUnrecorded ? (
              <li className="flex items-start gap-3">
                <DeviceIcon kind="unknown" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.875rem] font-[550]">This browser, device not recorded</span>
                  <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Signed in before sessions were recorded</span>
                </span>
                <span className="inline-flex items-center gap-1 text-[0.75rem] font-[600]"><span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--e-primary))]" />You</span>
              </li>
            ) : null}
            {data.sessions.map((session) => (
              <li key={session.id} className="flex items-start gap-3">
                <DeviceIcon kind={session.deviceKind} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.875rem] font-[550] [overflow-wrap:anywhere]">
                    {session.current ? "This browser" : session.device ?? "Browser, device not recorded"}
                  </span>
                  <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
                    {session.current && session.device ? `${session.device} · ` : ""}
                    signed in {when(session.signedInAt, timeZone)}
                    {session.method === "PASSKEY" ? " with a passkey" : ""} · last active {when(session.lastActiveAt, timeZone)} · place not recorded
                  </span>
                </span>
                {session.current ? (
                  <span className="inline-flex items-center gap-1 text-[0.75rem] font-[600]"><span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--e-primary))]" />You</span>
                ) : null}
              </li>
            ))}
          </ul>
          {data.olderSignInsMayExist ? (
            <p className={PROFILE_HINT}>Sign-ins made before this list existed cannot be listed one by one; &ldquo;Sign out everywhere else&rdquo; ends them too.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <EButton variant="danger" size="sm" disabled={Boolean(readOnlyReason) || data.currentUnrecorded || busy} onClick={() => { setError(null); setConfirming(true); }}>
              Sign out everywhere else…
            </EButton>
            {data.currentUnrecorded ? <span className={PROFILE_HINT}>Sign out and back in first, so this browser is recorded and stays signed in.</span> : null}
          </div>
          <p className={PROFILE_HINT}>Device and place are shown only where the app recorded them; otherwise &ldquo;not recorded&rdquo;, never a guess.</p>
          <ProfileMessage message={message} />
        </div>
      ) : null}

      <EConfirmDialog
        open={confirming}
        tier="sensitive"
        title="Sign out everywhere else?"
        description={`Every other browser and app signed in as you${others ? ` (${others} listed)` : ""} is signed out on its next step, and remembered devices ask for two-step again. This browser stays signed in.`}
        confirmLabel="Sign out everywhere else"
        busy={busy}
        error={error}
        onClose={() => { if (!busy) setConfirming(false); }}
        onConfirm={async ({ credentials }) => {
          if (!credentials) return;
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/me/sessions/sign-out-others", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ security: credentials }),
            });
            const body = await res.json().catch(() => null);
            if (!res.ok) {
              setError(`Nothing was signed out. ${sensitiveVerificationText(body?.error)}`);
              return;
            }
            setConfirming(false);
            setMessage({ tone: "ok", text: `Signed out everywhere else (${Number(body?.revoked ?? 0)} listed session${Number(body?.revoked ?? 0) === 1 ? "" : "s"}).` });
            setAttempt((value) => value + 1);
          } catch {
            setError("Nothing was signed out: the connection failed.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </ProfileCard>
  );
}
