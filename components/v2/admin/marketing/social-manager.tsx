"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("friendly");
  const [callToAction, setCallToAction] = useState("Contact us to book your next clean");
  const [generating, setGenerating] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [aiError, setAiError] = useState("");
  const aiRequest = useRef<AbortController | null>(null);
  useEffect(() => () => aiRequest.current?.abort(), []);

  function closeDraft() {
    if (saving) return;
    aiRequest.current?.abort();
    aiRequest.current = null;
    setGenerating(false);
    setOpen(false);
  }

  async function generateCaption() {
    if (generating || saving || topic.trim().length < 3) return;
    const controller = new AbortController();
    aiRequest.current = controller;
    setGenerating(true); setAiError(""); setSuggestion("");
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch("/api/admin/marketing/ai-compose", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ platform: channel, topic: topic.trim(), tone, callToAction }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "AI composition failed. Please try again.");
      if (typeof body.caption !== "string" || !body.caption.trim() || !Array.isArray(body.hashtags) || !body.hashtags.every((tag: unknown) => typeof tag === "string")) throw new Error("AI returned an invalid draft. Please try again.");
      if (!controller.signal.aborted) setSuggestion(body.caption + (body.hashtags.length ? `\n\n${body.hashtags.join(" ")}` : ""));
    } catch (error) {
      if (aiRequest.current === controller) setAiError(controller.signal.aborted ? "Generation timed out. Your caption is unchanged. Try again when the model is ready." : error instanceof Error ? error.message : "AI composition failed.");
    } finally {
      clearTimeout(timeout);
      if (aiRequest.current === controller) { aiRequest.current = null; setGenerating(false); }
    }
  }

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
      setSuggestion(""); setTopic(""); setAiError("");
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

      <EModal open={open} onClose={closeDraft} title="New social draft" eyebrow="Social" wide>
        <div className="space-y-4">
          <EField label="Channel">
            <ESelect aria-label="Channel" disabled={generating || saving} value={channel} onChange={(e) => { setChannel(e.target.value as SocialPost["channel"]); setSuggestion(""); }}>
              {CHANNELS.map((ch) => (
                <option key={ch.key} value={ch.key}>{ch.label}</option>
              ))}
            </ESelect>
          </EField>
          <section className="space-y-3 rounded-lg border p-3" aria-label="AI caption composer">
            <p className="text-sm">Generate a caption using your provider in <a className="underline" href="/v2/admin/ai">AI configuration</a>. Review it before using it. Nothing is published.</p>
            <EField label="Topic"><EInput aria-label="Topic" maxLength={500} disabled={generating || saving} value={topic} onChange={e => setTopic(e.target.value)} placeholder="Airbnb turnover cleaning in Sydney" /></EField>
            <EField label="Tone"><ESelect aria-label="Tone" disabled={generating || saving} value={tone} onChange={e => setTone(e.target.value)}><option value="friendly">Friendly</option><option value="professional">Professional</option><option value="playful">Playful</option><option value="urgent">Urgent</option></ESelect></EField>
            <EField label="Call to action"><EInput aria-label="Call to action" maxLength={200} disabled={generating || saving} value={callToAction} onChange={e => setCallToAction(e.target.value)} /></EField>
            <EButton size="sm" onClick={generateCaption} disabled={generating || saving || topic.trim().length < 3}>{generating ? "Generating…" : "Generate with AI"}</EButton>
            {aiError && <p role="alert" className="text-sm">{aiError}</p>}
            <div aria-live="polite">{suggestion && <div className="space-y-2"><p className="text-sm font-medium">Generated suggestion</p><p className="whitespace-pre-wrap break-words text-sm">{suggestion}</p><EButton size="sm" variant="outline" disabled={saving} onClick={() => { setCaption(suggestion); setSuggestion(""); }}>Use generated caption</EButton></div>}</div>
          </section>
          <EField label="Caption">
            <ETextarea aria-label="Caption" disabled={saving} rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write the post caption…" />
          </EField>
          <EField label="Schedule for" hint="Leave blank to keep as a draft.">
            <EInput type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
          </EField>
          <div className="flex justify-end gap-2 pt-1">
            <EButton variant="outline" size="sm" onClick={closeDraft} disabled={saving}>Cancel</EButton>
            <EButton size="sm" onClick={createDraft} disabled={saving || generating}>{saving ? "Saving…" : "Create draft"}</EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
