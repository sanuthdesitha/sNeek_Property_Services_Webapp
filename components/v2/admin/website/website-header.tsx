/**
 * Website page heading and tabs (board "Website and blog", 2026-11-16).
 *
 * One page with two tabs, Pages (/v2/admin/website) and Blog
 * (/v2/admin/website/blog); each tab keeps its own URL so old links still
 * work. Plain component (no client state): rendered by both server pages.
 */
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";

export type WebsiteTab = "pages" | "blog";

export function WebsiteHeader({
  active,
  publishedLine,
  blogCount,
}: {
  active: WebsiteTab;
  /** "Last published Mon 2 Nov by Ravi Mehta." or an honest unknown. */
  publishedLine: string;
  /** Number of blog posts; null when it could not be counted. */
  blogCount: number | null;
}) {
  const tabClass = (on: boolean) =>
    `inline-flex min-h-11 items-center whitespace-nowrap px-3 text-[0.875rem] ${
      on
        ? "border-b-2 border-[hsl(var(--e-primary))] font-[600] text-[hsl(var(--e-foreground))]"
        : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
    }`;
  return (
    <div className="space-y-4">
      <EPageHeader
        eyebrow="Money · Growth"
        title="Website"
        description={`The public website: page wording, images, contact details and the blog. ${publishedLine} Changes show in the preview before anyone else sees them.`}
        actions={
          <EButton asChild variant="outline" size="sm">
            <a href="/" target="_blank" rel="noreferrer">
              Open live site <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </EButton>
        }
      />
      <nav aria-label="Website tabs" className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--e-border))]">
        <Link href="/v2/admin/website" aria-current={active === "pages" ? "page" : undefined} className={tabClass(active === "pages")}>
          Pages
        </Link>
        <Link href="/v2/admin/website/blog" aria-current={active === "blog" ? "page" : undefined} className={tabClass(active === "blog")}>
          Blog{blogCount !== null ? <span className="ml-1.5 e-tnum">{blogCount}</span> : null}
        </Link>
      </nav>
    </div>
  );
}
