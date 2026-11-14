"use client";

/**
 * Framed Estate preview client. Renders the saved `websiteContent` natively
 * (WebsitePreviewRender) and listens for `postMessage` draft updates from the
 * editor, so unsaved edits show live. The editor embeds this route in its
 * preview pane, and "Open full preview" opens it in a tab that keeps following
 * the editor (it announces itself to its opener as well as its parent).
 * Nothing here saves anything.
 */
import * as React from "react";
import { sanitizeWebsiteContent, type WebsiteContent } from "@/lib/public-site/content";
import type { PreviewBlock } from "@/lib/public-site/website-draft";
import { EstateSkin } from "@/components/v2/ui/primitives";
import { WebsitePreviewRender } from "./preview-render";
import { PREVIEW_MESSAGE, READY_MESSAGE } from "./preview-protocol";

const BLOCKS: PreviewBlock[] = ["announcement", "hero", "stats", "benefits", "hosting", "why", "testimonials", "gallery", "faq", "final", "footer"];

function readHighlight(value: unknown): PreviewBlock[] {
  return Array.isArray(value) ? value.filter((item): item is PreviewBlock => BLOCKS.includes(item as PreviewBlock)) : [];
}

export function WebsitePreviewClient({ initialContent }: { initialContent: WebsiteContent }) {
  const [content, setContent] = React.useState<WebsiteContent>(initialContent);
  const [highlight, setHighlight] = React.useState<PreviewBlock[]>([]);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.type !== PREVIEW_MESSAGE) return;
      try {
        setContent(sanitizeWebsiteContent(data.content, initialContent));
        setHighlight(readHighlight(data.highlight));
      } catch {
        /* keep last good preview */
      }
    }
    window.addEventListener("message", handleMessage);
    // Announce readiness so an embedding editor (or the editor that opened
    // this tab) sends the current draft.
    for (const target of [window.parent !== window ? window.parent : null, window.opener as Window | null]) {
      try {
        target?.postMessage({ type: READY_MESSAGE }, window.location.origin);
      } catch {
        /* no-op */
      }
    }
    return () => window.removeEventListener("message", handleMessage);
  }, [initialContent]);

  // Bring the first changed block into view when the highlight changes.
  const highlightKey = highlight.join(",");
  React.useEffect(() => {
    if (!highlightKey) return;
    const first = rootRef.current?.querySelector<HTMLElement>("[data-preview-changed='true']");
    first?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [highlightKey]);

  return (
    // Fixed full-viewport overlay so the preview escapes the admin sidebar /
    // header chrome and renders clean when embedded in the editor's iframe.
    <div ref={rootRef} className="fixed inset-0 z-[60] overflow-y-auto bg-[hsl(var(--e-background))]">
      <EstateSkin accent="public" className="min-h-full">
        <WebsitePreviewRender content={content} highlight={highlight} />
      </EstateSkin>
    </div>
  );
}
