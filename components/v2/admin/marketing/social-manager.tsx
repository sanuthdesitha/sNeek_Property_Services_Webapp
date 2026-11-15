"use client";

/**
 * Social posts tab (board "Marketing", 2026-11-16). Told honestly: sNeek does
 * NOT post to Instagram, Facebook, TikTok or YouTube, and does not send
 * reminders (owner default, pending owner confirmation: no direct social
 * posting). A post is a draft with an optional planned time; you post it in
 * the app yourself, then paste the link here, which marks it Posted.
 * Caption help uses the provider in AI configuration and saves nothing until
 * you use the suggestion and save the post.
 */
import * as React from "react";
import { ExternalLink, Plus } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { EField, EInput, EModal, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";
import { formatOrgDateTime, formatOrgDay, zonedInputToIso } from "@/lib/public-site/zoned-time";
import type { SocialPostRow } from "@/lib/marketing/workspace-types";
import { cn } from "@/lib/utils";

type Toast = { title: string; description?: string; tone: "success" | "danger" };
type Channel = SocialPostRow["channel"];
type Tone = "friendly" | "professional" | "playful" | "urgent";

const CHANNELS: Array<{ key: Channel; label: string }> = [
  { key: "INSTAGRAM", label: "Instagram" },
  { key: "FACEBOOK", label: "Facebook" },
  { key: "TIKTOK", label: "TikTok" },
  { key: "YOUTUBE", label: "YouTube" },
];

const TONES: Array<{ key: Tone; label: string }> = [
  { key: "friendly", label: "Friendly" },
  { key: "professional", label: "Professional" },
  { key: "playful", label: "Playful" },
  { key: "urgent", label: "Urgent" },
];

const channelLabel = (channel: string) => CHANNELS.find((item) => item.key === channel)?.label ?? channel;

/** What a post's stored status means, in words that never claim sNeek posted it. */
export function socialPostPresentation(post: SocialPostRow, timeZone: string): { pill: string; tone: EPillTone; line: string } {
  if (post.status === "PUBLISHED") {
    return { pill: "Posted by you", tone: "ok", line: `${channelLabel(post.channel)} · link added ${formatOrgDay(post.publishedAt, timeZone)}` };
  }
  if (post.status === "CANCELLED") return { pill: "Cancelled", tone: "neutral", line: channelLabel(post.channel) };
  if (post.status === "FAILED") return { pill: "Needs attention", tone: "bad", line: channelLabel(post.channel) };
  if (post.scheduledFor) {
    return { pill: "Waiting for your link", tone: "warn", line: `${channelLabel(post.channel)} · planned for ${formatOrgDateTime(post.scheduledFor, timeZone)}` };
  }
  return { pill: "Draft", tone: "neutral", line: `${channelLabel(post.channel)} · not planned yet` };
}

export function SocialManager({
  initialPosts,
  onToast,
  timeZone = "Australia/Sydney",
}: {
  initialPosts: SocialPostRow[];
  onToast: (t: Toast) => void;
  timeZone?: string;
}) {
  const [posts, setPosts] = React.useState(initialPosts);
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [channel, setChannel] = React.useState<Channel>("INSTAGRAM");
  const [caption, setCaption] = React.useState("");
  const [plannedFor, setPlannedFor] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);

  const [topic, setTopic] = React.useState("");
  const [tone, setTone] = React.useState<Tone>("friendly");
  const [helpChannel, setHelpChannel] = React.useState<Channel>("INSTAGRAM");
  const [callToAction, setCallToAction] = React.useState("Contact us to book your next clean");
  const [generating, setGenerating] = React.useState(false);
  const [suggestion, setSuggestion] = React.useState("");
  const [aiError, setAiError] = React.useState("");
  const aiRequest = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => aiRequest.current?.abort(), []);

  const [linkPost, setLinkPost] = React.useState<SocialPostRow | null>(null);
  const [link, setLink] = React.useState("");
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const [cancelPost, setCancelPost] = React.useState<SocialPostRow | null>(null);
  const [rowBusy, setRowBusy] = React.useState(false);

  function startPost(prefill = "") {
    setCaption(prefill);
    setChannel(helpChannel);
    setPlannedFor("");
    setFormError(null);
    setOpen(true);
  }

  async function generateCaption() {
    if (generating || topic.trim().length < 3) return;
    const controller = new AbortController();
    aiRequest.current?.abort();
    aiRequest.current = controller;
    setGenerating(true);
    setAiError("");
    setSuggestion("");
    const timeout = window.setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch("/api/admin/marketing/ai-compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ platform: helpChannel, topic: topic.trim(), tone, callToAction }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const notConfigured = res.status === 503 && typeof body?.error === "string" && /not configured/i.test(body.error);
        throw new Error(notConfigured ? "Caption help is off. Write your own, or turn it on in AI configuration." : body?.error || "Caption help failed. Write your own or try again.");
      }
      if (typeof body.caption !== "string" || !body.caption.trim() || !Array.isArray(body.hashtags) || !body.hashtags.every((tag: unknown) => typeof tag === "string")) {
        throw new Error("Caption help returned something unusable. Try again.");
      }
      if (!controller.signal.aborted) setSuggestion(body.caption + (body.hashtags.length ? `\n\n${body.hashtags.join(" ")}` : ""));
    } catch (error) {
      if (aiRequest.current === controller) {
        setAiError(controller.signal.aborted ? "Caption help took too long. Nothing changed; try again." : error instanceof Error ? error.message : "Caption help failed.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (aiRequest.current === controller) {
        aiRequest.current = null;
        setGenerating(false);
      }
    }
  }

  async function createPost() {
    if (!caption.trim()) {
      setFormError("Write a caption first.");
      return;
    }
    const planned = plannedFor ? zonedInputToIso(plannedFor, timeZone) : null;
    if (plannedFor && !planned) {
      setFormError("Check the planned time.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/admin/marketing/social", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, caption, scheduledFor: planned, assetIds: [] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "The post was not saved.");
      const saved = body.post ?? body;
      const row: SocialPostRow = {
        id: saved.id,
        channel: saved.channel,
        caption: saved.caption,
        status: saved.status,
        scheduledFor: saved.scheduledFor ?? null,
        publishedAt: saved.publishedAt ?? null,
        externalUrl: saved.externalUrl ?? null,
        createdAt: saved.createdAt ?? new Date().toISOString(),
      };
      setPosts((current) => [row, ...current]);
      onToast({ title: "Post saved", description: "It is not posted anywhere. Post it in the app, then paste the link here.", tone: "success" });
      setOpen(false);
      setCaption("");
      setPlannedFor("");
    } catch (error) {
      setFormError(`${error instanceof Error ? error.message : "The post was not saved."} Your caption is kept.`);
    } finally {
      setSaving(false);
    }
  }

  async function saveLink() {
    if (!linkPost || rowBusy) return;
    let valid = false;
    try {
      valid = /^https?:$/.test(new URL(link.trim()).protocol);
    } catch {
      valid = false;
    }
    if (!valid) {
      setLinkError("Paste the full link to the post, starting with https://");
      return;
    }
    setRowBusy(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/admin/marketing/social/${linkPost.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark-published", externalUrl: link.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "The link was not saved.");
      const id = linkPost.id;
      setPosts((current) => current.map((post) => (post.id === id ? { ...post, status: "PUBLISHED", publishedAt: new Date().toISOString(), externalUrl: link.trim() } : post)));
      onToast({ title: "Link saved", description: "Marked as posted by you.", tone: "success" });
      setLinkPost(null);
      setLink("");
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : "The link was not saved.");
    } finally {
      setRowBusy(false);
    }
  }

  async function confirmCancel() {
    if (!cancelPost || rowBusy) return;
    setRowBusy(true);
    try {
      const res = await fetch(`/api/admin/marketing/social/${cancelPost.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "The post was not cancelled.");
      const id = cancelPost.id;
      setPosts((current) => current.map((post) => (post.id === id ? { ...post, status: "CANCELLED" } : post)));
      setCancelPost(null);
    } catch (error) {
      onToast({ title: "Not cancelled", description: error instanceof Error ? error.message : undefined, tone: "danger" });
    } finally {
      setRowBusy(false);
    }
  }

  const visible = posts.filter((post) => post.status !== "CANCELLED");

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <ECard className="min-w-0 space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[0.9375rem] font-[600]">Social posts</h2>
          <EButton variant="outline" size="sm" onClick={() => startPost()}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New post
          </EButton>
        </div>
        <ol aria-label="How a social post works" className="grid grid-cols-2 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] text-[0.75rem] sm:grid-cols-4">
          <li className="p-2">Write<span className="block text-[hsl(var(--e-muted-foreground))]">caption, AI help</span></li>
          <li className="border-l border-[hsl(var(--e-border))] p-2">Plan<span className="block text-[hsl(var(--e-muted-foreground))]">a time, shown here</span></li>
          <li className="border-[hsl(var(--e-border))] bg-[hsl(var(--e-gold-soft))] p-2 max-sm:border-t sm:border-l">You post it<span className="block text-[hsl(var(--e-muted-foreground))]">in the app</span></li>
          <li className="border-l border-[hsl(var(--e-border))] p-2 max-sm:border-t">Paste link<span className="block text-[hsl(var(--e-muted-foreground))]">marks it posted</span></li>
        </ol>
        {visible.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No social posts yet.</p>
        ) : (
          <ul className="space-y-3">
            {visible.map((post) => {
              const view = socialPostPresentation(post, timeZone);
              const open = post.status === "DRAFT" || post.status === "SCHEDULED";
              return (
                <li key={post.id} className="flex gap-2.5 text-[0.8125rem]">
                  <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-sunken))] text-[0.625rem] text-[hsl(var(--e-muted-foreground))]">
                    {channelLabel(post.channel).slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="line-clamp-2 font-[600] [overflow-wrap:anywhere]">{post.caption.split("\n")[0]}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{view.line}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <EPill tone={view.tone}>{view.pill}</EPill>
                      {post.externalUrl ? (
                        <a href={post.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-[0.75rem] text-[hsl(var(--e-primary))] underline">
                          View post <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      ) : null}
                      {open ? (
                        <>
                          <EButton variant="outline" size="sm" onClick={() => { setLinkPost(post); setLink(""); setLinkError(null); }}>
                            Paste the link…
                          </EButton>
                          <EButton variant="ghost" size="sm" onClick={() => setCancelPost(post)}>
                            Cancel post…
                          </EButton>
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          sNeek does not post to Instagram, Facebook, TikTok or YouTube, and does not send reminders. The planned time is shown here so you know when to post it yourself.
        </p>
      </ECard>

      <ECard className="min-w-0 space-y-3 p-4">
        <h2 className="text-[0.9375rem] font-[600]">Caption help</h2>
        <div role="group" aria-label="Tone" className="flex flex-wrap gap-1.5">
          {TONES.map((item) => (
            <button key={item.key} type="button" aria-pressed={tone === item.key} disabled={generating} onClick={() => setTone(item.key)} className={cn(E_CHIP_CLASS, tone === item.key && E_CHIP_ON_CLASS)}>
              {item.label}
            </button>
          ))}
        </div>
        <EField label="Topic">
          <EInput aria-label="Topic" maxLength={500} disabled={generating} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Airbnb turnover cleaning in Sydney" className="max-sm:text-[1rem]" />
        </EField>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EField label="Channel">
            <ESelect aria-label="Channel" disabled={generating} value={helpChannel} onChange={(e) => { setHelpChannel(e.target.value as Channel); setSuggestion(""); }}>
              {CHANNELS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </ESelect>
          </EField>
          <EField label="Call to action">
            <EInput aria-label="Call to action" maxLength={200} disabled={generating} value={callToAction} onChange={(e) => setCallToAction(e.target.value)} className="max-sm:text-[1rem]" />
          </EField>
        </div>
        <EButton size="sm" onClick={() => void generateCaption()} disabled={generating || topic.trim().length < 3}>
          {generating ? "Writing a suggestion…" : "Suggest a caption"}
        </EButton>
        {aiError ? <p role="alert" className={`rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass("problem")}`}>{aiError}</p> : null}
        <div aria-live="polite">
          {suggestion ? (
            <div className="space-y-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <p className="e-eyebrow text-[0.625rem]">Suggestion, not saved</p>
              <p className="whitespace-pre-wrap text-[0.8125rem] [overflow-wrap:anywhere]">{suggestion}</p>
              <div className="flex flex-wrap gap-2">
                <EButton size="sm" variant="outline" onClick={() => startPost(suggestion)}>Use this caption</EButton>
                <EButton size="sm" variant="ghost" onClick={() => void generateCaption()} disabled={generating}>Try again</EButton>
              </div>
            </div>
          ) : null}
        </div>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Uses the provider in <a className="underline" href="/v2/admin/ai">AI configuration</a>. Review it before using it; nothing is posted.
        </p>
      </ECard>

      <EModal open={open} onClose={() => (saving ? undefined : setOpen(false))} title="New social post" eyebrow="Social">
        <fieldset disabled={saving} className="space-y-4">
          <legend className="sr-only">Social post</legend>
          <EField label="Channel">
            <ESelect value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </ESelect>
          </EField>
          <EField label="Caption">
            <ETextarea aria-label="Caption" rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Write the post caption…" />
          </EField>
          <EField label="Planned for (organisation time, optional)" hint="Shown in the list so you know when to post it. sNeek does not post or remind.">
            <EInput type="datetime-local" value={plannedFor} onChange={(e) => setPlannedFor(e.target.value)} />
          </EField>
          {formError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{formError}</p> : null}
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</EButton>
            <EButton size="sm" onClick={() => void createPost()}>{saving ? "Saving…" : "Save post"}</EButton>
          </div>
        </fieldset>
      </EModal>

      <EModal open={Boolean(linkPost)} onClose={() => (rowBusy ? undefined : setLinkPost(null))} title="Paste the link to the post" eyebrow="Social">
        <fieldset disabled={rowBusy} className="space-y-3">
          <legend className="sr-only">Post link</legend>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">After you post it in the app, paste its link. That marks it as posted by you.</p>
          <EField label="Link to the post">
            <EInput type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.instagram.com/p/…" />
          </EField>
          {linkError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{linkError}</p> : null}
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setLinkPost(null)}>Cancel</EButton>
            <EButton size="sm" onClick={() => void saveLink()}>{rowBusy ? "Saving…" : "Save link"}</EButton>
          </div>
        </fieldset>
      </EModal>

      <EConfirmDialog
        open={Boolean(cancelPost)}
        onClose={() => setCancelPost(null)}
        tier="ordinary"
        title="Cancel this post?"
        description="It leaves this list. Nothing is removed from any social network, because sNeek never posted it."
        confirmLabel="Cancel post"
        busy={rowBusy}
        onConfirm={() => confirmCancel()}
      />
    </div>
  );
}
