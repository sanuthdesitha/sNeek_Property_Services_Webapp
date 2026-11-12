"use client";

import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import {
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startAuthentication,
  WebAuthnError,
} from "@simplewebauthn/browser";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

type Props = {
  /** Optional email to scope the credential lookup (helps non-discoverable creds). */
  email?: string;
  /** Where to land after a successful biometric sign-in. */
  callbackUrl?: string;
  disabled?: boolean;
  onError?: (message: string) => void;
  /**
   * Layout only. "after-form" (default) keeps the original "or" divider above
   * the button, for pages that list it under the password form. "first" is the
   * passkey-first sign-in (board "Public and sign in", 2026-11): no divider,
   * the board's label and help line. The click handler is identical.
   */
  layout?: "after-form" | "first";
};

export function BiometricSignInButton({ email, callbackUrl, disabled, onError, layout = "after-form" }: Props) {
  const [supported, setSupported] = useState(false);
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        if (typeof window === "undefined" || !window.PublicKeyCredential || !browserSupportsWebAuthn()) {
          if (active) setSupported(false);
          return;
        }
        // Prefer showing the button only when a platform authenticator
        // (Face ID / Touch ID / fingerprint / Windows Hello) is available.
        const hasPlatform = await platformAuthenticatorIsAvailable().catch(() => false);
        if (active) setSupported(hasPlatform);
      } catch {
        if (active) setSupported(false);
      } finally {
        if (active) setChecking(false);
      }
    }
    void check();
    return () => {
      active = false;
    };
  }, []);

  async function handleClick() {
    onError?.("");
    setWorking(true);
    try {
      const optionsRes = await fetch("/api/auth/webauthn/authenticate/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email?.trim() || undefined }),
        cache: "no-store",
      });
      if (!optionsRes.ok) {
        throw new Error("Could not start biometric sign in.");
      }
      const options = await optionsRes.json();

      let assertion;
      try {
        assertion = await startAuthentication(options);
      } catch (err) {
        if (err instanceof WebAuthnError || (err as Error)?.name === "NotAllowedError") {
          // User cancelled or no matching credential on this device.
          onError?.("Biometric sign-in was cancelled or no passkey is set up on this device.");
        } else {
          onError?.("This device could not complete biometric sign in.");
        }
        setWorking(false);
        return;
      }

      const result = await signIn("webauthn", {
        credential: JSON.stringify(assertion),
        email: email?.trim() || undefined,
        redirect: false,
        callbackUrl: callbackUrl || "/",
      });

      if (!result || result.error) {
        onError?.("We couldn't verify that passkey. Try again or use your password.");
        setWorking(false);
        return;
      }

      window.location.assign(result.url || callbackUrl || "/");
    } catch {
      onError?.("Biometric sign-in failed. Please use your password.");
      setWorking(false);
    }
  }

  if (checking || !supported) return null;

  if (layout === "first") {
    return (
      <div className="space-y-1.5">
        <Button
          type="button"
          className="h-12 w-full gap-2 rounded-lg"
          onClick={handleClick}
          disabled={disabled || working}
          aria-describedby="passkey-sign-in-help"
        >
          <Fingerprint className="h-4 w-4" />
          {working ? "Verifying..." : "Sign in with passkey"}
        </Button>
        <p id="passkey-sign-in-help" className="text-center text-xs text-muted-foreground">
          Face ID, fingerprint or your phone&apos;s screen lock
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or</span>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full gap-2 rounded-lg"
        onClick={handleClick}
        disabled={disabled || working}
      >
        <Fingerprint className="h-4 w-4" />
        {working ? "Verifying..." : "Sign in with Face ID / fingerprint"}
      </Button>
    </div>
  );
}
