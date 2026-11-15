"use client";

/**
 * ESTATE — biometric / passkey sign-in devices. Native v2 port of the WebAuthn
 * section from the v1 `components/profile/profile-settings.tsx`, against the
 * SAME endpoints:
 *
 *   GET    /api/auth/webauthn/credentials          → { devices: [...] }
 *   POST   /api/auth/webauthn/register/options     → PublicKeyCredentialCreationOptions
 *   POST   /api/auth/webauthn/register/verify      → { verified }
 *   DELETE /api/auth/webauthn/credentials/[id]
 *
 * Renders nothing when the browser has no platform authenticator (same
 * behaviour as v1). Estate v2 kit only — zero v1 UI imports.
 */
import * as React from "react";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startRegistration,
  WebAuthnError,
} from "@simplewebauthn/browser";
import { Fingerprint, Loader2, Trash2 } from "lucide-react";
import { EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { EConfirmModal } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";

type BiometricDevice = {
  id: string;
  deviceName: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export type EPasskeySectionProps = {
  /**
   * "profile" (Your profile, administrators and operations managers): always
   * shown, lists the passkeys already added even where this browser cannot add
   * one, and uses the card headings of that page. Default: the portal card,
   * hidden without a platform authenticator, as before.
   */
  variant?: "default" | "profile";
  /** Organisation timezone for "last used" times (profile variant). */
  timeZone?: string;
  /** While testing as someone else: list only, no add or remove. */
  readOnlyReason?: string | null;
};

function shortWhen(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleDateString("en-AU");
  }
}

export function EPasskeySection({ variant = "default", timeZone = "Australia/Sydney", readOnlyReason = null }: EPasskeySectionProps = {}) {
  const profile = variant === "profile";
  const [supported, setSupported] = React.useState(false);
  const [checked, setChecked] = React.useState(false);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [devices, setDevices] = React.useState<BiometricDevice[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [enrolling, setEnrolling] = React.useState(false);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  // Modal tier: a passkey can only be re-created from the physical device it
  // lives on. Remove the wrong one on a phone you no longer hold and biometric
  // sign-in is gone for good. No PIN — this panel is shared with non-admins.
  const [removeTarget, setRemoveTarget] = React.useState<BiometricDevice | null>(null);

  const loadDevices = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/webauthn/credentials", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body?.devices)) {
        setDevices(body.devices as BiometricDevice[]);
        setLoadFailed(false);
      } else setLoadFailed(true);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (typeof window === "undefined" || !window.PublicKeyCredential || !browserSupportsWebAuthn()) return;
        const hasPlatform = await platformAuthenticatorIsAvailable().catch(() => false);
        if (!active || !hasPlatform) return;
        setSupported(true);
        if (!profile) await loadDevices();
      } catch {
        /* unsupported */
      } finally {
        if (active) setChecked(true);
      }
    })();
    // The profile card lists passkeys already added whatever this browser supports.
    if (profile) void loadDevices();
    return () => {
      active = false;
    };
  }, [loadDevices, profile]);

  async function enroll() {
    setEnrolling(true);
    try {
      const optionsRes = await fetch("/api/auth/webauthn/register/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (!optionsRes.ok) {
        const body = await optionsRes.json().catch(() => ({}));
        throw new Error(body?.error ?? "Could not start enrolment.");
      }
      const options = await optionsRes.json();

      let attestation;
      try {
        attestation = await startRegistration(options);
      } catch (err) {
        if (err instanceof WebAuthnError && /already registered/i.test(err.message)) {
          toast({ title: "This device is already enrolled." });
        } else {
          toast({
            title: "Enrolment cancelled",
            description: "Biometric enrolment was cancelled on this device.",
            variant: "destructive",
          });
        }
        return;
      }

      const verifyRes = await fetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attestation),
      });
      const verifyBody = await verifyRes.json().catch(() => ({}));
      if (!verifyRes.ok || !verifyBody?.verified) {
        toast({
          title: "Enrolment failed",
          description: verifyBody?.error ?? "Could not register this device.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Device enrolled", description: "You can now sign in with biometrics on this device." });
      await loadDevices();
    } catch (err: any) {
      toast({ title: "Enrolment failed", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setEnrolling(false);
    }
  }

  if (profile) {
    return (
      <ECard id="passkeys" className="scroll-mt-24">
        <ECardBody className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-[1rem] font-semibold">Passkeys and devices</h2>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Sign in with your fingerprint or face. A passkey sign-in does not ask for two-step.</p>
            </div>
            <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{loading ? "–" : loadFailed ? "Not loaded" : `${devices.length} added`}</span>
          </div>
          {loading ? (
            <p role="status" className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading passkeys…
            </p>
          ) : loadFailed ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-[0.875rem]">
              Your passkeys could not be loaded.
              <EButton variant="outline" size="sm" onClick={() => void loadDevices()}>Try again</EButton>
            </div>
          ) : devices.length === 0 ? (
            <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No passkeys yet.</p>
          ) : (
            <ul className="divide-y divide-[hsl(var(--e-border))]">
              {devices.map((device) => (
                <li key={device.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex min-w-0 items-start gap-2.5">
                    <Fingerprint aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-muted-foreground))]" />
                    <span className="min-w-0">
                      <span className="block truncate text-[0.875rem] font-[550]">{device.deviceName || "Passkey"}</span>
                      <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
                        added {shortWhen(device.createdAt, timeZone)}
                        {device.lastUsedAt ? ` · last used ${shortWhen(device.lastUsedAt, timeZone)}` : " · not used yet"}
                        {device.backedUp ? " · backed up" : ""}
                      </span>
                    </span>
                  </span>
                  <EButton variant="ghost" size="sm" className="shrink-0" disabled={Boolean(readOnlyReason) || removingId === device.id} onClick={() => setRemoveTarget(device)}>
                    {removingId === device.id ? "Removing…" : "Remove…"}
                  </EButton>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <EButton variant="outline" size="sm" onClick={() => void enroll()} disabled={!supported || enrolling || Boolean(readOnlyReason)}>
              <Fingerprint className="h-4 w-4" />
              {enrolling ? "Waiting for device…" : "Add this device"}
            </EButton>
            <span className="min-w-0 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              {readOnlyReason ?? (checked && !supported ? "This browser has no fingerprint or face sign-in, so it cannot be added here." : "Uses this device's fingerprint, face or passcode.")}
            </span>
          </div>
        </ECardBody>
        <EConfirmModal
          open={Boolean(removeTarget)}
          onClose={() => setRemoveTarget(null)}
          tier="destructive"
          title={`Remove ${removeTarget?.deviceName || "this passkey"}?`}
          description="This device will need your password next time. This cannot be undone."
          confirmLabel="Remove passkey"
          loading={Boolean(removingId)}
          onConfirm={removeDevice}
        />
      </ECard>
    );
  }

  async function removeDevice() {
    const id = removeTarget?.id;
    if (!id) return;
    setRemoveTarget(null);
    setRemovingId(id);
    try {
      const res = await fetch(`/api/auth/webauthn/credentials/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Could not remove device.");
      setDevices((prev) => prev.filter((d) => d.id !== id));
      toast({ title: "Device removed" });
    } catch (err: any) {
      toast({ title: "Could not remove device", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setRemovingId(null);
    }
  }

  if (!supported) return null;

  return (
    <ECard>
      <ECardHeader>
        <ECardTitle className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4" /> Biometric sign-in
        </ECardTitle>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Sign in with Face ID, fingerprint or your device passcode.
        </p>
      </ECardHeader>
      <ECardBody className="space-y-3">
        {loading ? (
          <p className="flex items-center gap-2 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading devices…
          </p>
        ) : devices.length === 0 ? (
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            No devices enrolled yet.
          </p>
        ) : (
          devices.map((device) => (
            <div
              key={device.id}
              className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[0.875rem] font-medium">{device.deviceName || "Enrolled device"}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Added {new Date(device.createdAt).toLocaleDateString("en-AU")}
                  {device.lastUsedAt
                    ? ` · Last used ${new Date(device.lastUsedAt).toLocaleDateString("en-AU")}`
                    : ""}
                </p>
              </div>
              <EButton
                variant="ghost"
                size="sm"
                className="text-[hsl(var(--e-danger))]"
                disabled={removingId === device.id}
                onClick={() => setRemoveTarget(device)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {removingId === device.id ? "Removing…" : "Remove"}
              </EButton>
            </div>
          ))
        )}

        <div className="flex justify-end">
          <EButton onClick={() => void enroll()} disabled={enrolling}>
            <Fingerprint className="h-4 w-4" />
            {enrolling ? "Waiting for device…" : "Add this device"}
          </EButton>
        </div>
      </ECardBody>

      <EConfirmModal
        open={Boolean(removeTarget)}
        onClose={() => setRemoveTarget(null)}
        title="Remove this device"
        description={
          removeTarget
            ? `${removeTarget.deviceName || "This device"} will no longer sign you in with Face ID, fingerprint or its passcode. Adding it back has to be done on the device itself.`
            : undefined
        }
        confirmLabel="Remove device"
        loading={Boolean(removingId)}
        onConfirm={removeDevice}
      />
    </ECard>
  );
}
