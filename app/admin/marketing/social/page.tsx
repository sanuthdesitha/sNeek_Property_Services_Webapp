import Link from "next/link";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const CHANNELS: Array<{ key: "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "TIKTOK"; label: string }> = [
  { key: "FACEBOOK", label: "Facebook" },
  { key: "INSTAGRAM", label: "Instagram" },
  { key: "YOUTUBE", label: "YouTube" },
  { key: "TIKTOK", label: "TikTok" },
];

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-muted text-foreground",
  SCHEDULED: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  PUBLISHED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100",
  FAILED: "bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
  CANCELLED: "bg-muted text-muted-foreground",
};

export default async function AdminSocialPostsPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const posts = await (db as any).socialPost.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    include: {
      assets: { include: { asset: true }, orderBy: { order: "asc" } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });

  const byChannel = new Map<string, any[]>();
  for (const ch of CHANNELS) byChannel.set(ch.key, []);
  for (const p of posts) {
    const list = byChannel.get(p.channel);
    if (list) list.push(p);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Social posts</h1>
          <p className="text-sm text-muted-foreground">
            Draft, schedule, and track social posts across channels. Full OAuth publishing is rolled out per channel — drafts can be manually published and the URL pasted back.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/admin/marketing/social/compose">Compose with AI</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/admin/marketing">Back to marketing</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {CHANNELS.map((ch) => {
          const list = byChannel.get(ch.key) ?? [];
          return (
            <Card key={ch.key} className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold">{ch.label}</h2>
                <span className="text-xs text-muted-foreground">{list.length} posts</span>
              </div>
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">No posts yet.</p>
              ) : (
                <ul className="space-y-3">
                  {list.slice(0, 6).map((p) => (
                    <li key={p.id} className="rounded-md border border-border bg-surface p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[p.status] ?? "bg-muted"}`}>
                          {p.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {p.publishedAt
                            ? `Published ${new Date(p.publishedAt).toLocaleDateString()}`
                            : p.scheduledFor
                            ? `Scheduled ${new Date(p.scheduledFor).toLocaleDateString()}`
                            : `Created ${new Date(p.createdAt).toLocaleDateString()}`}
                        </span>
                      </div>
                      <p className="text-sm text-foreground line-clamp-3">{p.caption}</p>
                      {p.externalUrl ? (
                        <a
                          href={p.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-block text-xs text-primary hover:underline"
                        >
                          View live →
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
