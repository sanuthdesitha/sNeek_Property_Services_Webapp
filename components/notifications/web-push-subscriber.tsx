"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const DISMISS_KEY = "sneek-web-push-prompt-dismissed";

/** Convert a base64url VAPID public key into the ArrayBuffer push expects. */
function urlBase64ToBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    view[i] = rawData.charCodeAt(i);
  }
  return buffer;
}

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const isAppleMobile = /iphone|ipad|ipod/.test(ua);
  // iPadOS reports as Mac; detect touch-capable Mac too.
  const isiPadOS =
    navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1;
  return isAppleMobile || isiPadOS;
}

export function WebPushSubscriber() {
  const { status } = useSession();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  // iOS only allows Web Push when installed to the home screen (iOS 16.4+).
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const handledRef = useRef(false);

  const subscribe = useCallback(async () => {
    if (!VAPID_PUBLIC_KEY) {
      toast({
        title: "Notifications unavailable",
        description: "Push is not configured on the server yet.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setVisible(false);
        window.localStorage.setItem(DISMISS_KEY, "1");
        if (permission === "denied") {
          toast({
            title: "Notifications blocked",
            description:
              "You can re-enable them in your browser's site settings if you change your mind.",
          });
        }
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBuffer(VAPID_PUBLIC_KEY),
        });
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (!res.ok) throw new Error("Failed to register subscription");

      setVisible(false);
      window.localStorage.setItem(DISMISS_KEY, "1");
      toast({
        title: "Notifications enabled",
        description: "You'll now get push alerts on this device, even when the app is closed.",
      });
    } catch (err) {
      toast({
        title: "Could not enable notifications",
        description: "Please try again, or check your browser settings.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (typeof window === "undefined") return;
    if (handledRef.current) return;
    handledRef.current = true;

    if (!pushSupported()) {
      // iOS < 16.4 / non-installed PWA: surface the install guidance once,
      // but only if they could plausibly enable it via install.
      if (isIosSafari() && !isStandalone()) {
        if (window.localStorage.getItem(DISMISS_KEY) !== "1") {
          setIosNeedsInstall(true);
          setVisible(true);
        }
      }
      return;
    }

    // Already dismissed or already subscribed → stay quiet.
    if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
    if (Notification.permission === "denied") return;

    let cancelled = false;

    (async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (cancelled) return;

        if (existing) {
          // Make sure the server knows about it (idempotent), then stay quiet.
          fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(existing.toJSON()),
          }).catch(() => undefined);
          return;
        }

        if (Notification.permission === "granted") {
          // Permission already there but no subscription → resubscribe silently.
          await subscribe();
          return;
        }

        // Permission is "default": show the unobtrusive prompt.
        setIosNeedsInstall(false);
        setVisible(true);
      } catch {
        // Service worker not ready (e.g. disabled in dev) — do nothing.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, subscribe]);

  function dismiss() {
    setVisible(false);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISMISS_KEY, "1");
    }
  }

  if (status !== "authenticated" || !visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-md rounded-2xl border border-primary/20 bg-white/95 p-4 shadow-xl backdrop-blur dark:bg-white/5 sm:bottom-6 sm:left-auto sm:right-6 sm:mx-0">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bell className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold">Turn on push notifications</p>
          {iosNeedsInstall ? (
            <p className="text-xs text-muted-foreground">
              On iPhone/iPad, add sNeek to your Home Screen first (Share button →{" "}
              <span className="font-medium">Add to Home Screen</span>), then open it from
              there to enable push notifications.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Get job updates and alerts on this device instantly — even when the app is
              closed.
            </p>
          )}
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0 rounded-full"
          onClick={dismiss}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {!iosNeedsInstall ? (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={dismiss}>
            Not now
          </Button>
          <Button type="button" size="sm" onClick={subscribe} disabled={busy}>
            <Bell className="mr-2 h-4 w-4" />
            {busy ? "Enabling…" : "Enable"}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={dismiss}>
            Got it
          </Button>
        </div>
      )}
    </div>
  );
}
