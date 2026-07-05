"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EField, EInput, EModal, ESelect } from "@/components/v2/admin/estate-kit";

type MarketingAsset = {
  id: string;
  name: string;
  url: string;
  mediaType: "IMAGE" | "VIDEO" | "GIF";
  createdAt: string;
};

type Toast = { title: string; description?: string; tone: "success" | "danger" };

export function AssetLibrary({
  initialAssets,
  onToast,
}: {
  initialAssets: MarketingAsset[];
  onToast: (t: Toast) => void;
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [mediaType, setMediaType] = useState<MarketingAsset["mediaType"]>("IMAGE");

  async function addAsset() {
    if (!name.trim() || !url.trim()) return onToast({ title: "Name and URL are required", tone: "danger" });
    setSaving(true);
    try {
      const res = await fetch("/api/admin/marketing/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url, mediaType }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save asset.");
      const asset: MarketingAsset = body.asset ?? body;
      setAssets((cur) => [asset, ...cur]);
      onToast({ title: "Asset added", tone: "success" });
      setOpen(false);
      setName("");
      setUrl("");
    } catch (error: any) {
      onToast({ title: "Save failed", description: error?.message ?? "Could not save asset.", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          Images, videos, and GIFs available for social posts and campaigns.
        </p>
        <EButton size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add by URL</EButton>
      </div>

      <ECard>
        <ECardHeader className="pb-2"><ECardTitle className="text-[0.95rem]">Library</ECardTitle></ECardHeader>
        <ECardBody className="pt-0">
          {assets.length === 0 ? (
            <EEmptyState eyebrow="Assets" title="No assets yet" description="Add a hosted image, video, or GIF by URL." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {assets.map((a) => (
                <div key={a.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2">
                  {a.mediaType === "IMAGE" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.url} alt={a.name} className="mb-1 h-24 w-full rounded-[var(--e-radius-sm)] object-cover" />
                  ) : (
                    <div className="mb-1 flex h-24 w-full items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-muted))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {a.mediaType}
                    </div>
                  )}
                  <p className="truncate text-[0.75rem] text-[hsl(var(--e-foreground))]" title={a.name}>{a.name}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{new Date(a.createdAt).toLocaleDateString("en-AU")}</p>
                </div>
              ))}
            </div>
          )}
        </ECardBody>
      </ECard>

      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Direct drag-and-drop file uploads (S3) run through the classic uploader; add hosted media by URL here.
      </p>

      <EModal open={open} onClose={() => setOpen(false)} title="Add marketing asset" eyebrow="Assets">
        <div className="space-y-4">
          <EField label="Name"><EInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring promo hero" /></EField>
          <EField label="URL"><EInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></EField>
          <EField label="Media type">
            <ESelect value={mediaType} onChange={(e) => setMediaType(e.target.value as MarketingAsset["mediaType"])}>
              <option value="IMAGE">Image</option>
              <option value="VIDEO">Video</option>
              <option value="GIF">GIF</option>
            </ESelect>
          </EField>
          <div className="flex justify-end gap-2 pt-1">
            <EButton variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>Cancel</EButton>
            <EButton size="sm" onClick={addAsset} disabled={saving}>{saving ? "Saving…" : "Add asset"}</EButton>
          </div>
        </div>
      </EModal>
    </div>
  );
}
