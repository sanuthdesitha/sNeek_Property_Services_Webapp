"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const VISIT_THRESHOLD = 3;

function storageKeyForPortal(portal: string, suffix: string) {
  return `sneek-install:${portal}:${suffix}`;
}

function getPortalFromPath(pathname: string) {
  if (pathname.startsWith("/cleaner")) return "cleaner";
  if (pathname.startsWith("/laundry")) return "laundry";
  return null;
}

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function AppInstallPrompt() {
  const pathname = usePathname();
  const portal = useMemo(() => getPortalFromPath(pathname), [pathname]);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [canShow, setCanShow] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    if (!portal || typeof window === "undefined") {
      setCanShow(false);
      return;
    }

    if (isStandaloneMode()) {
      setCanShow(false);
      return;
    }

    const visitKey = storageKeyForPortal(portal, "visits");
    const dismissedKey = storageKeyForPortal(portal, "dismissed");
    const visits = Number(window.localStorage.getItem(visitKey) ?? "0") + 1;
    window.localStorage.setItem(visitKey, String(visits));

    const dismissed = window.localStorage.getItem(dismissedKey) === "1";
    setCanShow(visits >= VISIT_THRESHOLD && !dismissed);
  }, [portal, pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = window.navigator.userAgent.toLowerCase();
    const isAppleMobile = /iphone|ipad|ipod/.test(ua);
    const isSafari = /safari/.test(ua) && !/crios|fxios|edgios/.test(ua);
    setIsIos(isAppleMobile && isSafari);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  if (!portal || !canShow || isStandaloneMode()) return null;
  if (!installEvent && !isIos) return null;

  function dismiss() {
    if (typeof window !== "undefined" && portal) {
      window.localStorage.setItem(storageKeyForPortal(portal, "dismissed"), "1");
    }
    setCanShow(false);
  }

  async function handleInstall() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") {
      dismiss();
      return;
    }
    setInstallEvent(null);
  }

  return (
    <div className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-md rounded-2xl border border-primary/20 bg-white/95 p-4 shadow-xl backdrop-blur sm:bottom-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold">Install sNeek on this device</p>
          <p className="text-xs text-muted-foreground">
            Keep faster access to {portal === "cleaner" ? "jobs" : "laundry updates"} and mobile notifications from your home screen.
          </p>
        </div>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 rounded-full" onClick={dismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {installEvent ? (
          <Button type="button" size="sm" onClick={handleInstall}>
            <Download className="mr-2 h-4 w-4" />
            Add to home screen
          </Button>
        ) : null}
        {isIos ? (
          <p className="text-xs text-muted-foreground">
            On iPhone/iPad: tap the Share button, then choose <span className="font-medium">Add to Home Screen</span>.
          </p>
        ) : null}
      </div>
    </div>
  );
}
