import "server-only";
import { createHash } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";
import { sanitizeWebsiteContent, type WebsiteContent } from "@/lib/public-site/content";

/**
 * Publishing the website (2026-11-16, board "Website and blog").
 *
 * The editor works on a draft and publishes it whole. The revision is a hash
 * of the published website content: the editor sends the revision it started
 * from, and the settings route refuses (409) when the stored content changed in
 * the meantime, inside the same settings write lock as the save. The person's
 * draft is never touched by the refusal.
 */

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function websiteContentRevision(content: WebsiteContent): string {
  return createHash("sha256").update(stableStringify(content)).digest("hex").slice(0, 32);
}

export class WebsiteChangedError extends Error {
  constructor() {
    super("WEBSITE_CHANGED");
    this.name = "WebsiteChangedError";
  }
}

export type WebsitePublication = {
  /** Who published the content that is live now, when the history says so. */
  publishedByName: string | null;
  publishedAt: string | null;
};

type AuditRow = {
  createdAt: Date;
  before: unknown;
  after: unknown;
  user: { name: string | null; email: string } | null;
};

function contentOf(snapshot: unknown): WebsiteContent | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const website = (snapshot as { websiteContent?: unknown }).websiteContent;
  return website ? sanitizeWebsiteContent(website) : null;
}

/**
 * The most recent settings save or restore that produced the live website
 * content. Unknown (both null) when the history does not reach it; never a guess.
 */
export async function findWebsitePublication(current: WebsiteContent): Promise<WebsitePublication> {
  const revision = websiteContentRevision(current);
  try {
    const rows = (await db.auditLog.findMany({
      where: { entity: "AppSettings", action: { in: ["SETTINGS_UPDATE", "SETTINGS_RESTORE"] } },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { createdAt: true, before: true, after: true, user: { select: { name: true, email: true } } },
    })) as AuditRow[];
    for (const row of rows) {
      const after = contentOf(row.after);
      if (!after || websiteContentRevision(after) !== revision) continue;
      const before = contentOf(row.before);
      if (before && websiteContentRevision(before) === revision) continue;
      return { publishedByName: row.user?.name || row.user?.email || null, publishedAt: row.createdAt.toISOString() };
    }
  } catch {
    /* history unavailable: say nothing rather than guess */
  }
  return { publishedByName: null, publishedAt: null };
}

/** "Last published Mon 2 Nov by Ravi Mehta." in the organisation timezone; honest when unknown. */
export function publishedLine(publication: WebsitePublication, timeZone: string): string {
  if (!publication.publishedAt) return "The publish history does not say who published the live version.";
  const day = formatInTimeZone(new Date(publication.publishedAt), timeZone, "EEE d MMM");
  return publication.publishedByName ? `Last published ${day} by ${publication.publishedByName}.` : `Last published ${day}.`;
}

/** Number of blog posts for the Blog tab; null when it could not be counted. */
export async function countBlogPosts(): Promise<number | null> {
  try {
    return await db.blogPost.count();
  } catch {
    return null;
  }
}
