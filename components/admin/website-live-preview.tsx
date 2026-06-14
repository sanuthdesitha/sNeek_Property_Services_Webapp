"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Monitor, RefreshCw, Smartphone, Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WebsiteContent } from "@/lib/public-site/content";

const WEBSITE_PREVIEW_MESSAGE = "sneek:website-preview-content";
const PREVIEW_SRC = "/admin/website/preview";

type DeviceKey = "desktop" | "tablet" | "mobile";

const DEVICES: { key: DeviceKey; label: string; icon: typeof Monitor; width: number | null }[] = [
  { key: "desktop", label: "Desktop", icon: Monitor, width: null },
  { key: "tablet", label: "Tablet", icon: Tablet, width: 834 },
  { key: "mobile", label: "Mobile", icon: Smartphone, width: 390 },
];

/**
 * Wix-style live preview. Embeds the real public home page (rendered by
 * /admin/website/preview) inside an iframe and streams the current editor
 * draft into it via postMessage, so every keystroke and image swap is
 * reflected instantly — before the admin ever clicks "Save".
 */
export function WebsiteLivePreview({
  content,
  companyName,
  logoUrl,
}: {
  content: WebsiteContent;
  companyName: string;
  logoUrl: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [device, setDevice] = useState<DeviceKey>("desktop");
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Push the latest draft into the preview iframe (debounced) whenever the
  // editor content changes or the iframe signals it is ready.
  useEffect(() => {
    function send() {
      const frame = iframeRef.current;
      if (!frame?.contentWindow) return;
      frame.contentWindow.postMessage(
        { type: WEBSITE_PREVIEW_MESSAGE, content, companyName, logoUrl },
        window.location.origin
      );
    }
    if (!ready) return;
    const timer = window.setTimeout(send, 120);
    return () => window.clearTimeout(timer);
  }, [content, companyName, logoUrl, ready, reloadKey]);

  // Wait for the preview frame to announce readiness before streaming drafts.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "sneek:website-preview-ready") {
        setReady(true);
        // Immediately seed the freshly-loaded frame with current draft.
        const frame = iframeRef.current;
        frame?.contentWindow?.postMessage(
          { type: WEBSITE_PREVIEW_MESSAGE, content, companyName, logoUrl },
          window.location.origin
        );
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeDevice = DEVICES.find((d) => d.key === device) ?? DEVICES[0];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-muted/30 shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-white/80 px-3 py-2 dark:bg-white/5">
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Live preview
          </span>
          {DEVICES.map((d) => {
            const Icon = d.icon;
            return (
              <button
                key={d.key}
                type="button"
                title={d.label}
                onClick={() => setDevice(d.key)}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
                  device === d.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            title="Reload preview"
            onClick={() => {
              setReady(false);
              setReloadKey((k) => k + 1);
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            title="Open live site in new tab"
            asChild
          >
            <a href="/" target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
      <div className="flex flex-1 items-start justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(25,67,74,0.06),_transparent_60%)] p-3">
        <div
          className="h-full overflow-hidden rounded-[1.1rem] border border-border/60 bg-white shadow-[0_24px_60px_-32px_rgba(25,67,74,0.4)] transition-[width] duration-300"
          style={{ width: activeDevice.width ? `${activeDevice.width}px` : "100%", maxWidth: "100%" }}
        >
          <iframe
            key={reloadKey}
            ref={iframeRef}
            src={PREVIEW_SRC}
            title="Public website live preview"
            className="h-full w-full border-0"
          />
        </div>
      </div>
    </div>
  );
}
