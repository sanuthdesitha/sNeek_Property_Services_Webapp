"use client";

import { useEffect, useState } from "react";
import { Fingerprint, Trash2 } from "lucide-react";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startRegistration,
  WebAuthnError,
} from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";

type BiometricDevice = {
  id: string;
  deviceName: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

/**
 * Self-contained passkey / platform-biometric enrolment card. Renders nothing
 * unless the current device has a platform authenticator (Face ID / Touch ID /
 * fingerprint / Windows Hello). Used on every role's profile/settings page so
 * any signed-in user can add this device for password-free sign-in.
 */
export function BiometricDevicesSection() {
  const [supported, setSupported] = useState(false);
  const [checking, setChecking] = useState(true);
  const [devices, setDevices] = useState<BiometricDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (typeof window === "undefined" || !window.PublicKeyCredential || !browserSupportsWebAuthn()) {
          if (active) setSupported(false);
          return;
        }
        const hasPlatform = await platformAuthenticatorIsAvailable().catch(() => false);
        if (active) setSupported(hasPlatform);
        if (hasPlatform) await loadDevices();
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadDevices() {
    setLoadingDevices(true);
    try {
      const res = await fetch("/api/auth/webauthn/credentials", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(body?.devices)) setDevices(body.devices as BiometricDevice[]);
    } catch {
      /* non-fatal */
    } finally {
      setLoadingDevices(false);
    }
  }

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
        setEnrolling(false);
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
        setEnrolling(false);
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

  async function remove(id: string) {
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

  if (checking || !supported) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Fingerprint className="h-4 w-4 text-primary" />
          Biometric sign-in
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Add this device to sign in with Face ID, Touch ID, fingerprint, or Windows Hello — no
          password needed. Your biometrics never leave the device.
        </p>

        <div className="space-y-2">
          {loadingDevices ? (
            <p className="text-sm text-muted-foreground">Loading enrolled devices...</p>
          ) : devices.length === 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              No devices enrolled yet.
            </p>
          ) : (
            devices.map((device) => (
              <div key={device.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{device.deviceName}</p>
                  <p className="text-xs text-muted-foreground">
                    Added {new Date(device.createdAt).toLocaleDateString("en-AU")}
                    {device.lastUsedAt
                      ? ` · Last used ${new Date(device.lastUsedAt).toLocaleDateString("en-AU")}`
                      : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 shrink-0 gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => remove(device.id)}
                  disabled={removingId === device.id}
                >
                  <Trash2 className="h-4 w-4" />
                  {removingId === device.id ? "Removing..." : "Remove"}
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" className="h-11 gap-2 rounded-lg" onClick={enroll} disabled={enrolling}>
            <Fingerprint className="h-4 w-4" />
            {enrolling ? "Waiting for device..." : "Add this device for biometric sign-in"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
