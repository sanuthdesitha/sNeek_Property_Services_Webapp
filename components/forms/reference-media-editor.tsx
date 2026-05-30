"use client";

import * as React from "react";
import { ImagePlus, Link2, Loader2, Trash2, Video, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { FormFieldReference, FormFieldReferenceKind } from "@/lib/forms/types";

export interface ReferenceMediaEditorProps {
  references: FormFieldReference[];
  onChange: (next: FormFieldReference[]) => void;
}

function inferKindFromUrl(url: string): FormFieldReferenceKind {
  const clean = url.split("?")[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v|avi)$/.test(clean)) return "video";
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(clean)) return "image";
  return "link";
}

// Builds a viewable URL for a reference. Uploaded refs store a storageKey and
// are resolved through the admin-scoped access endpoint; external links use
// their URL directly.
async function resolveReferenceUrl(ref: FormFieldReference): Promise<string> {
  if (ref.url) return ref.url;
  if (ref.storageKey) {
    try {
      const res = await fetch(`/api/uploads/access?key=${encodeURIComponent(ref.storageKey)}`);
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) return body.url as string;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export function ReferenceMediaEditor({ references, onChange }: ReferenceMediaEditorProps) {
  const [linkDraft, setLinkDraft] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [previewUrls, setPreviewUrls] = React.useState<Record<number, string>>({});

  // Resolve viewable URLs for any reference that only has a storageKey.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        references.map(async (ref, idx) => [idx, await resolveReferenceUrl(ref)] as const)
      );
      if (cancelled) return;
      setPreviewUrls(Object.fromEntries(entries.filter(([, url]) => url)));
    })();
    return () => {
      cancelled = true;
    };
  }, [references]);

  function update(next: FormFieldReference[]) {
    onChange(next);
  }

  function addLink() {
    const url = linkDraft.trim();
    if (!url) return;
    update([...references, { kind: inferKindFromUrl(url), url }]);
    setLinkDraft("");
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const added: FormFieldReference[] = [];
      for (const file of Array.from(files)) {
        const presignRes = await fetch("/api/uploads/presign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            folder: "form-references",
          }),
        });
        const presign = await presignRes.json().catch(() => ({}));
        if (!presignRes.ok || !presign.uploadUrl || !presign.key) continue;
        await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        added.push({
          kind: file.type.startsWith("video") ? "video" : "image",
          url: "",
          storageKey: presign.key,
        });
      }
      if (added.length) update([...references, ...added]);
    } finally {
      setUploading(false);
    }
  }

  function removeAt(index: number) {
    update(references.filter((_, i) => i !== index));
  }

  function setCaption(index: number, caption: string) {
    update(references.map((ref, i) => (i === index ? { ...ref, caption: caption || undefined } : ref)));
  }

  function setKind(index: number, kind: FormFieldReferenceKind) {
    update(references.map((ref, i) => (i === index ? { ...ref, kind } : ref)));
  }

  return (
    <div className="space-y-3">
      <Label>Reference / example media</Label>
      <p className="text-xs text-muted-foreground">
        Show the cleaner what &quot;good&quot; looks like — example photos, demo videos, or how-to links.
      </p>

      {references.length > 0 && (
        <div className="space-y-2">
          {references.map((ref, index) => {
            const previewUrl = previewUrls[index];
            return (
              <div key={`${ref.storageKey ?? ref.url}-${index}`} className="flex items-start gap-2 rounded-md border p-2">
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                  {ref.kind === "image" && previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrl} alt={ref.caption ?? "Reference"} className="size-12 object-cover" />
                  ) : ref.kind === "video" ? (
                    <Video className="size-5 text-muted-foreground" />
                  ) : ref.kind === "image" ? (
                    <ImageIcon className="size-5 text-muted-foreground" />
                  ) : (
                    <Link2 className="size-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <Input
                    value={ref.caption ?? ""}
                    onChange={(e) => setCaption(index, e.target.value)}
                    placeholder="Caption (optional)"
                    className="h-8 text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <Select value={ref.kind} onValueChange={(v) => setKind(index, v as FormFieldReferenceKind)}>
                      <SelectTrigger className="h-7 w-24 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="image">Image</SelectItem>
                        <SelectItem value="video">Video</SelectItem>
                        <SelectItem value="link">Link</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="truncate text-[11px] text-muted-foreground">
                      {ref.storageKey ? "Uploaded file" : ref.url}
                    </span>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeAt(index)} aria-label="Remove reference">
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-muted">
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
          {uploading ? "Uploading…" : "Upload image/video"}
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              void handleUpload(e.target.files);
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={linkDraft}
          onChange={(e) => setLinkDraft(e.target.value)}
          placeholder="Paste an image, video, or page URL"
          className="h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLink();
            }
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={addLink} disabled={!linkDraft.trim()}>
          Add link
        </Button>
      </div>
    </div>
  );
}
