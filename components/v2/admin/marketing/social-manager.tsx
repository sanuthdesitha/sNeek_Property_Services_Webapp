"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Plus } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EField, EModal, ESelect, ETextarea, EInput } from "@/components/v2/admin/estate-kit";

type SocialPost = {
  id: string;
  channel: "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "TIKTOK";
  caption: string;
  status: string;
  scheduledFor: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  createdAt: string;
};

type Toast = { title: string; description?: string; tone: "success" | "danger" };

const CHANNELS: Array<{ key: SocialPost["channel"]; label: string }> = [
  { key: "FACEBOOK", label: "Facebook" },
  { key: "INSTAGRAM", label: "Instagram" },
  { key: "YOUTUBE", label: "YouTube" },
  { key: "TIKTOK", label: "TikTok" },
];

function statusTone(status: string): "neutral" | "warning" | "success" | "danger" {
  switch (status) {
    case "PUBLISHED":
      return "success";
    case "SCHEDULED":
      return "warning";
    case "FAILED":
      return "danger";
    default:
      return "neutral";
  }
}

export function SocialManager({
  initialPosts,
  onToast,
}: {
  initialPosts: SocialPost[];
  onToast: (t: Toast) => void;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [channel, setChannel] = useState<SocialPost["channel"]>("INSTAGRAM");
  const [caption, setCaption] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");

  const byChannel = useMemo(() => {
    const map = new Map<string, SocialPost[]>();
    for (const ch of CHANNELS) map.set(ch.key, []);
    for (const p of posts) map.get(p.channel)?.push(p);
    return map;
  }, [posts]);

  async function createDraft() {
    if (!caption.trim()) return onToast({ title: "Caption is required", tone: "danger" });
    setSaving(true);
    try {
      const res = await fetch("/api/admin/marketing/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel,
          caption,
          scheduledFor: scheduledFor ? new Date(scheduledFor).toISOString() : null,
          assetIds: [],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save draft.");
      const post: SocialPost = body.post ?? body;
      setPosts((cur) => [post, ...cur]);
      onToast({ title: "Draft created", description: `${channel} · ${scheduledFor ? "scheduled" : "draft"}`, tone: "success" });
      setOpen(false);
      setCaption("");
      setScheduledFor("");
    } catch (error: any) {
      onToast({ title: "Save failed", description: error?.message ?? "Could not save draft.", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Draft, schedule, and track posts across channels. Publish manually and paste the live URL back to the record.
        </p>
        <EButton size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New draft</EButton>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {CHANNELS.map((ch) => {
          const list = byChannel.get(ch.key) ?? [];
          return (
            <ECard key={ch.key}>
              <ECardHeader className="flex-row items-center justify-between pb-2">
                <ECardTitle className="text-[0.95rem]">{ch.label}</ECardTitle>
                <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{list.length} posts</span>
              </ECardHeader>
              <ECardBody className="pt-0">
                {list.length === 0 ? (
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No posts yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {list.slice(0, 6).map((p) => (
                      <li key={p.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <EBadge tone={statusTone(p.status)} soft>{p.status}</EBadge>
                          <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            {p.publishedAt
                              ? `Published ${new Date(p.publishedAt).toLocaleDateString("en-AU")}`
                              : p.scheduledFor
                                ? `Scheduled ${new Date(p.scheduledFor).toLocaleDateString("en-AU")}`
                                : `Created ${new Date(p.createdAt).toLocaleDateString("en-AU")}`}
                          </span>
                        </div>
                        <p className="line-clamp-3 text-[0.8125rem] text-[hsl(var(--e-foreground))]">{p.caption}</p>
                        {p.externalUrl ? (
                          <a
                            href={p.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-flex items-center gap-1 text-[0.75rem] text-[hsl(var(--e-gold-ink))] hover:underline"
                          >
                            View live <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </ECardBody>
            </ECard>
          );
        })}
      </div>

      {posts.length === 0 ? (
        <EEmptyState eyebrow="Social" title="No social posts yet" description="Create your first draft to start tracking posts across channels." />
      ) : null}

      <EModal open={open} onClose={() => setOpen(false)} title="New social draft" eyebrow="Social" wide>
        <div className="space-y-4">
          <EField label="Channel">
            <ESelect value={channel} onChange={(e) => setChannel(e.target.value as SocialPost["channel"])}>
              {CHANNELS.map((ch) => (
                <option key={ch.key} value={ch.key}>{ch.label}</option>
              ))}
            </ESelect>
          </EField>
          <EField label="Caption">
            <ETextarea rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write the post caption…" />
          </EField>
          <EField label="Schedule for" hint="Leave blank to keep as a draft.">
            <EInput type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
          </EField>
          <div className="flex justify-end gap-2 pt-1">
            <EButton variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>Cancel</EButton>
            <EButton size="sm" onClick={createDraft} disabled={saving}>{saving ? "Saving…" : "Create draft"}</EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
