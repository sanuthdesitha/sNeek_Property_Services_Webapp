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
import { toast } from "@/hooks/use-toast";

type BiometricDevice = {
  id: string;
  deviceName: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export function EPasskeySection() {
  const [supported, setSupported] = React.useState(false);
  const [devices, setDevices] = React.useState<BiometricDevice[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [enrolling, setEnrolling] = React.useState(false);
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  const loadDevices = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/webauthn/credentials", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body?.devices)) setDevices(body.devices as BiometricDevice[]);
    } catch {
      /* non-fatal */
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
        await loadDevices();
      } catch {
        /* unsupported */
      }
    })();
    return () => {
      active = false;
    };
  }, [loadDevices]);

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

  async function removeDevice(id: string) {
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
                onClick={() => void removeDevice(device.id)}
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
    </ECard>
  );
}
