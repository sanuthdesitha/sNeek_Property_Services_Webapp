"use client";

import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";

const SHOW_DELAY_MS = 350;
const SUCCESS_CLOSE_MS = 900;
const ERROR_CLOSE_MS = 1800;

function ProgressDescription({ message, progress }: { message: string; progress: number }) {
  return (
    <div className="space-y-2">
      <p className="text-xs opacity-90">{message}</p>
      <div className="flex items-center gap-2">
        <Progress value={progress} className="h-1.5 flex-1" />
        <span className="w-9 text-right text-[11px] font-medium tabular-nums opacity-90">
          {Math.round(progress)}%
        </span>
      </div>
    </div>
  );
}

function looksLikeDownloadPath(pathname: string) {
  return /\/(download|export|pdf)(\/|$)/i.test(pathname);
}

function getActionLabel(pathname: string, method: string) {
  if (pathname.includes("/api/uploads/")) return "Uploading files";
  if (pathname.includes("/api/laundry/reports")) return "Preparing laundry report";
  if (pathname.includes("/api/laundry/")) return "Updating laundry";
  if (pathname.includes("/api/reports/")) return looksLikeDownloadPath(pathname) ? "Preparing report PDF" : "Generating report";
  if (pathname.includes("/api/invoices/")) return looksLikeDownloadPath(pathname) ? "Preparing invoice PDF" : "Generating invoice";
  if (pathname.includes("/api/shopping/")) return looksLikeDownloadPath(pathname) ? "Preparing shopping PDF" : "Updating shopping plan";
  if (pathname.includes("/api/quotes/")) return "Processing quote";
  if (pathname.includes("/api/notifications/")) return "Sending notification";
  if (method === "GET") return "Preparing download";
  return "Processing request";
}

function buildRequestInfo(input: RequestInfo | URL, init?: RequestInit) {
  let urlString = "";
  let requestMethod = "GET";
  let baseHeaders = new Headers();

  if (typeof input === "string") {
    urlString = input;
  } else if (input instanceof URL) {
    urlString = input.toString();
  } else {
    urlString = input.url;
    requestMethod = input.method || requestMethod;
    baseHeaders = new Headers(input.headers);
  }

  if (init?.method) {
    requestMethod = init.method;
  }
  if (init?.headers) {
    const overrideHeaders = new Headers(init.headers);
    overrideHeaders.forEach((value, key) => baseHeaders.set(key, value));
  }

  const absoluteUrl = new URL(urlString, window.location.origin);
  return {
    url: absoluteUrl,
    method: requestMethod.toUpperCase(),
    headers: baseHeaders,
  };
}

function shouldTrackRequest(url: URL, method: string, headers: Headers) {
  const explicitMode = headers.get("x-progress-toast")?.toLowerCase();
  if (explicitMode === "off") return false;
  if (explicitMode === "force") return true;

  if (url.origin !== window.location.origin) return false;
  if (!url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/api/auth/")) return false;

  if (method !== "GET" && method !== "HEAD") return true;
  if (looksLikeDownloadPath(url.pathname)) return true;
  if (url.searchParams.get("download") === "1") return true;
  return false;
}

export function GlobalRequestProgress() {
  const { toast } = useToast();

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const pendingTimers = new Set<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>();

    const registerTimer = <T extends ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>(timer: T) => {
      pendingTimers.add(timer);
      return timer;
    };

    const clearTrackedTimer = (timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | null) => {
      if (!timer) return;
      clearTimeout(timer as ReturnType<typeof setTimeout>);
      clearInterval(timer as ReturnType<typeof setInterval>);
      pendingTimers.delete(timer);
    };

    const showPassiveDownloadToast = (title: string) => {
      let progress = 12;
      const handle = toast({
        title,
        description: <ProgressDescription message="Preparing download..." progress={progress} />,
      });
      const interval = registerTimer(
        setInterval(() => {
          progress = Math.min(92, progress + (progress < 60 ? 9 : 4));
          handle.update({
            id: handle.id,
            title,
            description: <ProgressDescription message="Preparing download..." progress={progress} />,
          });
        }, 380)
      );
      const doneTimer = registerTimer(
        setTimeout(() => {
          clearTrackedTimer(interval);
          handle.update({
            id: handle.id,
            title,
            description: <ProgressDescription message="Download started." progress={100} />,
          });
          const dismissTimer = registerTimer(
            setTimeout(() => {
              handle.dismiss();
              clearTrackedTimer(dismissTimer);
            }, SUCCESS_CLOSE_MS)
          );
          clearTrackedTimer(doneTimer);
        }, 2600)
      );
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const { url, method, headers } = buildRequestInfo(input, init);
      if (!shouldTrackRequest(url, method, headers)) {
        return originalFetch(input, init);
      }

      const title = getActionLabel(url.pathname, method);
      let progress = 10;
      let shown = false;
      let progressInterval: ReturnType<typeof setInterval> | null = null;
      let toastHandle: ReturnType<typeof toast> | null = null;

      const updateToast = (message: string, nextProgress: number, variant?: "default" | "destructive") => {
        if (!toastHandle) return;
        toastHandle.update({
          id: toastHandle.id,
          variant,
          title,
          description: <ProgressDescription message={message} progress={nextProgress} />,
        });
      };

      const showTimer = registerTimer(setTimeout(() => {
        shown = true;
        toastHandle = toast({
          title,
          description: <ProgressDescription message="Working on your request..." progress={progress} />,
        });
        progressInterval = registerTimer(setInterval(() => {
          progress = progress < 60 ? progress + 8 : progress + 4;
          if (progress > 90) progress = 90;
          updateToast("Working on your request...", progress);
        }, 450));
        clearTrackedTimer(showTimer);
      }, SHOW_DELAY_MS));

      try {
        const response = await originalFetch(input, init);
        clearTrackedTimer(showTimer);

        if (shown && toastHandle) {
          clearTrackedTimer(progressInterval);
          updateToast("Done.", 100);
          const dismissTimer = registerTimer(
            setTimeout(() => {
              toastHandle?.dismiss();
              clearTrackedTimer(dismissTimer);
            }, SUCCESS_CLOSE_MS)
          );
        }

        return response;
      } catch (error) {
        clearTrackedTimer(showTimer);
        if (shown && toastHandle) {
          clearTrackedTimer(progressInterval);
          updateToast("Request failed. Please retry.", 100, "destructive");
          const dismissTimer = registerTimer(
            setTimeout(() => {
              toastHandle?.dismiss();
              clearTrackedTimer(dismissTimer);
            }, ERROR_CLOSE_MS)
          );
        }
        throw error;
      }
    };

    function onAnchorClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.getAttribute("data-progress-toast") === "off") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.origin);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (!url.pathname.startsWith("/api/")) return;
      if (!looksLikeDownloadPath(url.pathname)) return;

      const title = getActionLabel(url.pathname, "GET");
      showPassiveDownloadToast(title);
    }

    document.addEventListener("click", onAnchorClick, true);

    return () => {
      window.fetch = originalFetch;
      document.removeEventListener("click", onAnchorClick, true);
      pendingTimers.forEach((timer) => {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
        clearInterval(timer as ReturnType<typeof setInterval>);
      });
      pendingTimers.clear();
    };
  }, [toast]);

  return null;
}
