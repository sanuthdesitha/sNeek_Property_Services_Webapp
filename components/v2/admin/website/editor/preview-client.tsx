"use client";

/**
 * Framed Estate preview client. Renders the current saved `websiteContent`
 * natively (WebsitePreviewRender) and listens for `postMessage` draft updates
 * from the editor — same protocol as the v1 preview — so unsaved edits show
 * live when this route is embedded in an iframe. Standalone (no admin chrome).
 */
import * as React from "react";
import { sanitizeWebsiteContent, type WebsiteContent } from "@/lib/public-site/content";
import { EstateSkin } from "@/components/v2/ui/primitives";
import { WebsitePreviewRender } from "./preview-render";

const PREVIEW_MESSAGE = "sneek:website-preview-content";
const READY_MESSAGE = "sneek:website-preview-ready";

export function WebsitePreviewClient({ initialContent }: { initialContent: WebsiteContent }) {
  const [content, setContent] = React.useState<WebsiteContent>(initialContent);

  React.useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.type !== PREVIEW_MESSAGE) return;
      try {
        setContent(sanitizeWebsiteContent(data.content, initialContent));
      } catch {
        /* keep last good preview */
      }
    }
    window.addEventListener("message", handleMessage);
    // Announce readiness so an embedding editor sends the first draft snapshot.
    try {
      window.parent?.postMessage({ type: READY_MESSAGE }, window.location.origin);
    } catch {
      /* no-op */
    }
    return () => window.removeEventListener("message", handleMessage);
  }, [initialContent]);

  return (
    // Fixed full-viewport overlay so the preview escapes the admin sidebar /
    // header chrome and renders clean when embedded in the editor's iframe.
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-[hsl(var(--e-background))]">
      <EstateSkin accent="public" className="min-h-full">
        <WebsitePreviewRender content={content} />
      </EstateSkin>
    </div>
  );
}
