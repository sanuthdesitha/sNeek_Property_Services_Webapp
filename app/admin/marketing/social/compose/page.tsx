"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

type Platform = "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "TIKTOK";
type Tone = "friendly" | "professional" | "playful" | "urgent";

interface Asset {
  id: string;
  name: string;
  url: string;
  mediaType: string;
}

export default function ComposeSocialPostPage() {
  const router = useRouter();

  const [platform, setPlatform] = useState<Platform>("INSTAGRAM");
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<Tone>("friendly");
  const [cta, setCta] = useState("Book online today");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [hook, setHook] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/admin/marketing/assets")
      .then((r) => r.json())
      .then((d) => setAssets(Array.isArray(d.assets) ? d.assets : []))
      .catch(() => setAssets([]));
  }, []);

  async function handleGenerate() {
    if (topic.trim().length < 3) {
      setError("Topic must be at least 3 characters");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/marketing/ai-compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform, topic, tone, callToAction: cta }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI compose failed");
      setCaption(data.caption || "");
      setHashtags(Array.isArray(data.hashtags) ? data.hashtags : []);
      setHook(data.suggestedHook || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI compose failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveDraft() {
    if (caption.trim().length < 1) {
      setError("Caption is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const fullCaption =
        caption + (hashtags.length ? `\n\n${hashtags.join(" ")}` : "");
      const res = await fetch("/api/admin/marketing/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: platform,
          caption: fullCaption,
          assetIds: selectedAssetIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      router.push("/admin/marketing/social");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggleAsset(id: string) {
    setSelectedAssetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Compose social post</h1>
          <p className="text-sm text-muted-foreground">
            Generate a caption with AI, refine it, attach assets, and save as draft.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/admin/marketing/social">Back</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-base font-semibold">AI brief</h2>
          <div className="space-y-3">
            <div>
              <Label htmlFor="platform">Platform</Label>
              <select
                id="platform"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
              >
                <option value="FACEBOOK">Facebook</option>
                <option value="INSTAGRAM">Instagram</option>
                <option value="YOUTUBE">YouTube</option>
                <option value="TIKTOK">TikTok</option>
              </select>
            </div>
            <div>
              <Label htmlFor="topic">Topic</Label>
              <Input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Spring deep clean promotion"
              />
            </div>
            <div>
              <Label htmlFor="tone">Tone</Label>
              <select
                id="tone"
                value={tone}
                onChange={(e) => setTone(e.target.value as Tone)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
              >
                <option value="friendly">Friendly</option>
                <option value="professional">Professional</option>
                <option value="playful">Playful</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <Label htmlFor="cta">Call to action</Label>
              <Input
                id="cta"
                value={cta}
                onChange={(e) => setCta(e.target.value)}
                placeholder="Book 20% off this week"
              />
            </div>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? "Generating…" : "Generate with Claude"}
            </Button>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-base font-semibold">Caption</h2>
          <div className="space-y-3">
            {hook ? (
              <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Hook:</span> {hook}
              </div>
            ) : null}
            <Textarea
              rows={10}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption will appear here after generation, or write your own."
            />
            {hashtags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {hashtags.map((h) => (
                  <span key={h} className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
                    {h}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold">Attach assets</h2>
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No assets in the library yet.{" "}
            <Link href="/admin/marketing/assets" className="text-primary hover:underline">
              Upload some →
            </Link>
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {assets.map((a) => {
              const selected = selectedAssetIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAsset(a.id)}
                  className={`rounded-md border p-2 text-left transition ${
                    selected
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  {a.mediaType === "IMAGE" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.name} className="mb-1 h-20 w-full rounded object-cover" />
                  ) : (
                    <div className="mb-1 flex h-20 w-full items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                      {a.mediaType}
                    </div>
                  )}
                  <p className="truncate text-xs text-foreground">{a.name}</p>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {error ? (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href="/admin/marketing/social">Cancel</Link>
        </Button>
        <Button onClick={handleSaveDraft} disabled={saving || caption.trim().length === 0}>
          {saving ? "Saving…" : "Save as draft"}
        </Button>
      </div>
    </div>
  );
}
