"use client";

/**
 * Images tab (board "Marketing", 2026-11-16): the image library used by the
 * email editor, the blog and the website. Uploads go through the existing
 * /api/uploads/direct storage; images can also be added by address. Each image
 * shows where it is used, and removing one asks first (tier B) with that list.
 * Removing takes it out of the library only; the stored file and the places
 * that use its address are not changed.
 */
import * as React from "react";
import { Plus, Upload } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { EField, EInput, EModal, ESelect } from "@/components/v2/admin/estate-kit";
import { formatOrgDay } from "@/lib/public-site/zoned-time";
import type { LibraryAssetRow } from "@/lib/marketing/workspace-types";

type Toast = { title: string; description?: string; tone: "success" | "danger" };

type UsageState =
  | { status: "loading" }
  | { status: "known"; uses: Array<{ kind: string; label: string; href: string }> }
  | { status: "unknown"; message: string };

function mediaTypeFor(file: File): LibraryAssetRow["mediaType"] {
  if (file.type === "image/gif") return "GIF";
  if (file.type.startsWith("video/")) return "VIDEO";
  return "IMAGE";
}

export function AssetLibrary({
  initialAssets,
  onToast,
  timeZone = "Australia/Sydney",
}: {
  initialAssets: LibraryAssetRow[];
  onToast: (t: Toast) => void;
  timeZone?: string;
}) {
  const [assets, setAssets] = React.useState(initialAssets);
  const [addOpen, setAddOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [mediaType, setMediaType] = React.useState<LibraryAssetRow["mediaType"]>("IMAGE");
  const [usage, setUsage] = React.useState<Record<string, UsageState>>({});
  const [removing, setRemoving] = React.useState<LibraryAssetRow | null>(null);
  const [removeBusy, setRemoveBusy] = React.useState(false);
  const [removeError, setRemoveError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  async function createAsset(input: { name: string; url: string; mediaType: LibraryAssetRow["mediaType"] }) {
    const res = await fetch("/api/admin/marketing/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? "The image was not added.");
    const asset = body.asset ?? body;
    const row: LibraryAssetRow = { id: asset.id, name: asset.name, url: asset.url, mediaType: asset.mediaType, createdAt: asset.createdAt ?? new Date().toISOString() };
    setAssets((current) => [row, ...current]);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    let added = 0;
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("folder", "marketing");
        const res = await fetch("/api/uploads/direct", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body.url) throw new Error(body?.error ?? `${file.name} was not uploaded.`);
        await createAsset({ name: file.name, url: body.url, mediaType: mediaTypeFor(file) });
        added += 1;
      }
      onToast({ title: `${added} file${added === 1 ? "" : "s"} added to the library`, tone: "success" });
    } catch (error) {
      onToast({ title: added ? `${added} added, then one failed` : "Not uploaded", description: error instanceof Error ? error.message : undefined, tone: "danger" });
    } finally {
      setUploading(false);
    }
  }

  async function addByUrl() {
    if (!name.trim() || !url.trim()) {
      onToast({ title: "Name and address are required", tone: "danger" });
      return;
    }
    setSaving(true);
    try {
      await createAsset({ name: name.trim(), url: url.trim(), mediaType });
      onToast({ title: "Added to the library", tone: "success" });
      setAddOpen(false);
      setName("");
      setUrl("");
    } catch (error) {
      onToast({ title: "Not added", description: error instanceof Error ? error.message : undefined, tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  async function loadUsage(asset: LibraryAssetRow): Promise<UsageState> {
    setUsage((current) => ({ ...current, [asset.id]: { status: "loading" } }));
    let next: UsageState;
    try {
      const res = await fetch(`/api/admin/marketing/assets/${asset.id}/usage`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      next = res.ok && body?.status === "known" && Array.isArray(body.uses)
        ? { status: "known", uses: body.uses }
        : { status: "unknown", message: body?.message ?? body?.error ?? "Where this image is used could not be checked." };
    } catch {
      next = { status: "unknown", message: "Where this image is used could not be checked." };
    }
    setUsage((current) => ({ ...current, [asset.id]: next }));
    return next;
  }

  async function remove() {
    if (!removing || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      const res = await fetch(`/api/admin/marketing/assets/${removing.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "The image was not removed.");
      const id = removing.id;
      setAssets((current) => current.filter((asset) => asset.id !== id));
      setRemoving(null);
      onToast({ title: "Removed from the library", tone: "success" });
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : "The image was not removed.");
    } finally {
      setRemoveBusy(false);
    }
  }

  const removingUsage = removing ? usage[removing.id] : undefined;
  const usageSentence = !removingUsage || removingUsage.status === "loading"
    ? "Checking where it is used…"
    : removingUsage.status === "unknown"
      ? `${removingUsage.message} Remove it only if you are sure.`
      : removingUsage.uses.length === 0
        ? "It is not used in any campaign, blog post, social post or website page."
        : `It is used in: ${removingUsage.uses.map((use) => use.label).join("; ")}. Campaigns, blog posts and website pages keep the image's address, so they still show it.${
            removingUsage.uses.some((use) => use.kind === "social_post") ? " Social posts lose it as an attachment." : ""
          }`;

  return (
    <div className="space-y-4">
      <ECard className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[0.9375rem] font-[600]">Images</h2>
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {assets.length} file{assets.length === 1 ? "" : "s"}. Used by the email editor, the blog and the website. Each shows where it is used before you remove it.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <EButton size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="h-3.5 w-3.5" aria-hidden /> {uploading ? "Uploading…" : "Upload images"}
            </EButton>
            <EButton variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add by address
            </EButton>
          </div>
          <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={async (e) => { await upload(e.target.files); e.currentTarget.value = ""; }} />
        </div>
        {assets.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No images yet. Upload one to use it in emails, the blog and the website.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {assets.map((asset) => {
              const state = usage[asset.id];
              return (
                <li key={asset.id} className="min-w-0 space-y-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
                  {asset.mediaType === "VIDEO" ? (
                    <div className="flex aspect-square w-full items-center justify-center rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-sunken))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Video</div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.url} alt="" className="aspect-square w-full rounded-[var(--e-radius-sm)] object-cover" />
                  )}
                  <p className="truncate text-[0.75rem] font-[600]" title={asset.name}>{asset.name}</p>
                  <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Added {formatOrgDay(asset.createdAt, timeZone)}</p>
                  <div className="flex flex-wrap gap-1">
                    <EButton variant="ghost" size="sm" className="px-1.5 text-[0.75rem]" onClick={() => void loadUsage(asset)}>Where it&apos;s used</EButton>
                    <EButton variant="ghost" size="sm" className="px-1.5 text-[0.75rem] text-[hsl(var(--e-danger))]" onClick={() => { setRemoveError(null); setRemoving(asset); if (!usage[asset.id] || usage[asset.id]?.status === "unknown") void loadUsage(asset); }}>Remove…</EButton>
                  </div>
                  <div aria-live="polite" className="text-[0.6875rem]">
                    {state?.status === "loading" ? <p className="text-[hsl(var(--e-muted-foreground))]">Checking…</p> : null}
                    {state?.status === "unknown" ? <p className={`rounded px-1.5 py-1 ${toneNoticeClass("problem")}`}>{state.message}</p> : null}
                    {state?.status === "known" ? (
                      state.uses.length === 0 ? (
                        <p className="text-[hsl(var(--e-muted-foreground))]">Not used anywhere yet.</p>
                      ) : (
                        <ul className="space-y-0.5">
                          {state.uses.map((use) => (
                            <li key={`${use.kind}-${use.label}`}>
                              <a href={use.href} className="text-[hsl(var(--e-primary))] underline [overflow-wrap:anywhere]">{use.label}</a>
                            </li>
                          ))}
                        </ul>
                      )
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ECard>

      <EModal open={addOpen} onClose={() => (saving ? undefined : setAddOpen(false))} title="Add an image by address" eyebrow="Images">
        <fieldset disabled={saving} className="space-y-4">
          <legend className="sr-only">Image</legend>
          <EField label="Name"><EInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring promo hero" /></EField>
          <EField label="Address"><EInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></EField>
          <EField label="Kind">
            <ESelect value={mediaType} onChange={(e) => setMediaType(e.target.value as LibraryAssetRow["mediaType"])}>
              <option value="IMAGE">Image</option>
              <option value="GIF">GIF</option>
              <option value="VIDEO">Video</option>
            </ESelect>
          </EField>
          <div className="flex justify-end gap-2">
            <EButton variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</EButton>
            <EButton size="sm" onClick={() => void addByUrl()}>{saving ? "Adding…" : "Add image"}</EButton>
          </div>
        </fieldset>
      </EModal>

      <EConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        tier="destructive"
        title={`Remove "${removing?.name ?? "this image"}" from the library?`}
        description={`${usageSentence} This cannot be undone.`}
        confirmLabel="Remove from library"
        busy={removeBusy}
        confirmDisabled={!removingUsage || removingUsage.status === "loading"}
        error={removeError ?? undefined}
        onConfirm={() => remove()}
      />
    </div>
  );
}
