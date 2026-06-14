"use client";

import { useEffect, useMemo, useState } from "react";
import { PublicSiteShell } from "@/components/public/public-site-shell";
import { HomePage } from "@/components/public/home-page";
import { MaintenancePage } from "@/components/public/maintenance-page";
import { PublicThemeProvider } from "@/components/public/public-theme";
import { isWebsiteInMaintenance } from "@/lib/public-site/routing";
import { sanitizeWebsiteContent, type WebsiteContent } from "@/lib/public-site/content";
import type { PublicWidgetFlags } from "@/lib/public-site/widgets-types";

type PreviewBlogPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  publishedAt: string | null;
  authorName: string | null;
};

export const WEBSITE_PREVIEW_MESSAGE = "sneek:website-preview-content";

/**
 * Client-side replica of the public home page used inside the editor's live
 * preview iframe. It renders with the currently saved content, then listens
 * for `postMessage` draft updates from the editor and re-renders instantly so
 * admins see their unsaved edits exactly as visitors would.
 */
export function WebsitePreviewClient({
  initialContent,
  companyName: initialCompanyName,
  logoUrl: initialLogoUrl,
  latestBlogPosts,
  widgetFlags,
}: {
  initialContent: WebsiteContent;
  companyName: string;
  logoUrl: string;
  latestBlogPosts: PreviewBlogPost[];
  widgetFlags: PublicWidgetFlags;
}) {
  const [content, setContent] = useState<WebsiteContent>(initialContent);
  const [companyName, setCompanyName] = useState(initialCompanyName);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Same-origin only: the editor and preview share the app origin.
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== "object" || data.type !== WEBSITE_PREVIEW_MESSAGE) return;
      try {
        // Sanitize against the live defaults so partial/in-progress drafts
        // never crash the preview (missing keys fall back to current copy).
        setContent(sanitizeWebsiteContent(data.content, initialContent));
        if (typeof data.companyName === "string") setCompanyName(data.companyName || "sNeek Property Services");
        if (typeof data.logoUrl === "string") setLogoUrl(data.logoUrl);
      } catch {
        // Ignore malformed drafts; keep last good preview.
      }
    }
    window.addEventListener("message", handleMessage);
    // Tell the editor we're ready to receive the first draft snapshot.
    try {
      window.parent?.postMessage({ type: "sneek:website-preview-ready" }, window.location.origin);
    } catch {
      /* no-op */
    }
    return () => window.removeEventListener("message", handleMessage);
  }, [initialContent]);

  const posts = useMemo(
    () =>
      latestBlogPosts.map((post) => ({
        ...post,
        publishedAt: post.publishedAt,
      })),
    [latestBlogPosts]
  );

  return (
    // Fixed full-viewport overlay so the preview escapes the admin sidebar/header
    // chrome and renders as a pixel-accurate replica of the live public site
    // (the page is loaded inside the editor's iframe).
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-white">
      <PublicThemeProvider>
        <div className="marketing-only" data-portal-theme="public">
          <PublicSiteShell companyName={companyName} logoUrl={logoUrl} content={content}>
            {isWebsiteInMaintenance(content) ? (
              <MaintenancePage content={content} />
            ) : (
              <HomePage content={content} latestBlogPosts={posts} widgetFlags={widgetFlags} />
            )}
          </PublicSiteShell>
        </div>
      </PublicThemeProvider>
    </div>
  );
}
