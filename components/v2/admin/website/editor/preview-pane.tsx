"use client";

/**
 * The website editor's preview pane (board "Website and blog"): the same
 * renderer as the full-screen preview route, in a frame, fed the UNSAVED draft
 * over postMessage. Nothing here saves; the live site is unchanged until
 * "Save and publish". "Open full preview" opens the route in a tab that keeps
 * following the draft.
 */
import * as React from "react";
import { ExternalLink } from "lucide-react";
import type { WebsiteContent } from "@/lib/public-site/content";
import type { PreviewBlock } from "@/lib/public-site/website-draft";
import { EButton } from "@/components/v2/ui/primitives";
import { PREVIEW_MESSAGE, PREVIEW_PATH, READY_MESSAGE } from "./preview-protocol";

export type PreviewDevice = "desktop" | "phone";

const DEVICE_WIDTH: Record<PreviewDevice, number> = { desktop: 1280, phone: 390 };
const FRAME_HEIGHT = 560;

export function WebsitePreviewPane({
  draft,
  highlight,
  defaultDevice = "desktop",
}: {
  draft: WebsiteContent;
  highlight: PreviewBlock[];
  defaultDevice?: PreviewDevice;
}) {
  const [device, setDevice] = React.useState<PreviewDevice>(defaultDevice);
  const [width, setWidth] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const tabRef = React.useRef<Window | null>(null);
  const latest = React.useRef({ draft, highlight });
  latest.current = { draft, highlight };

  const post = React.useCallback((target: Window | null | undefined) => {
    if (!target) return;
    try {
      target.postMessage({ type: PREVIEW_MESSAGE, content: latest.current.draft, highlight: latest.current.highlight }, window.location.origin);
    } catch {
      /* the frame or tab is gone */
    }
  }, []);

  // Answer every preview that announces itself (the pane frame or the full tab).
  React.useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== READY_MESSAGE) return;
      post(event.source as Window | null);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [post]);

  // Follow the draft (short debounce while typing).
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      post(frameRef.current?.contentWindow);
      if (tabRef.current && !tabRef.current.closed) post(tabRef.current);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [draft, highlight, post]);

  React.useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const virtualWidth = DEVICE_WIDTH[device];
  const scale = width > 0 ? Math.min(1, width / virtualWidth) : 1;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.8125rem] font-[600]">Preview, unsaved</p>
        <div role="group" aria-label="Preview size" className="inline-flex rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-0.5">
          {(["desktop", "phone"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={device === option}
              onClick={() => setDevice(option)}
              className={`min-h-9 rounded-[var(--e-radius-sm)] px-3 text-[0.75rem] max-sm:min-h-11 ${
                device === option
                  ? "bg-[hsl(var(--e-surface))] font-[600] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
                  : "text-[hsl(var(--e-muted-foreground))]"
              }`}
            >
              {option === "desktop" ? "Desktop" : "Phone"}
            </button>
          ))}
        </div>
      </div>
      <div ref={boxRef} className="min-w-0 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))]">
        <div className="flex h-6 items-center gap-1.5 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-2 text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
          <span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--e-border-strong))]" />
          <span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--e-border-strong))]" />
          <span aria-hidden className="h-2 w-2 rounded-full bg-[hsl(var(--e-border-strong))]" />
          <span className="ml-1.5">Public site · Home</span>
        </div>
        <div className="relative mx-auto overflow-hidden" style={{ height: FRAME_HEIGHT, width: Math.min(width || virtualWidth, virtualWidth * scale) }}>
          <iframe
            ref={frameRef}
            title="Website preview with unsaved changes"
            src={PREVIEW_PATH}
            onLoad={() => post(frameRef.current?.contentWindow)}
            className="absolute left-0 top-0 origin-top-left border-0"
            style={{ width: virtualWidth, height: FRAME_HEIGHT / scale, transform: `scale(${scale})` }}
          />
        </div>
      </div>
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Same renderer as the full-screen preview, fed the unsaved draft. Changed blocks have a dashed gold outline. The live site does not change until you save and publish.
      </p>
      <EButton
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => {
          tabRef.current = window.open(PREVIEW_PATH, "sneek-website-preview");
        }}
      >
        Open full preview <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </EButton>
    </div>
  );
}
