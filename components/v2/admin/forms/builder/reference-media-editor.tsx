"use client";

/**
 * ESTATE form builder — reference/example media editor. Same FormFieldReference
 * shape v1 stores ({ kind, url, storageKey?, caption? }). Reuses shared upload
 * endpoints. Native Estate controls.
 */
import * as React from "react";
import { ImagePlus, Link2, Loader2, Trash2, Video, Image as ImageIcon } from "lucide-react";
import type { FormFieldReference, FormFieldReferenceKind } from "@/lib/forms/types";
import { EButton } from "@/components/v2/ui/primitives";
import { EInput, ESelect } from "@/components/v2/admin/estate-kit";

function inferKindFromUrl(url: string): FormFieldReferenceKind {
  const clean = url.split("?")[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v|avi)$/.test(clean)) return "video";
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(clean)) return "image";
  return "link";
}

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

export function ReferenceMediaEditor({
  references,
  onChange,
}: {
  references: FormFieldReference[];
  onChange: (next: FormFieldReference[]) => void;
}) {
  const [linkDraft, setLinkDraft] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [previewUrls, setPreviewUrls] = React.useState<Record<number, string>>({});

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

  function addLink() {
    const url = linkDraft.trim();
    if (!url) return;
    onChange([...references, { kind: inferKindFromUrl(url), url }]);
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
        added.push({ kind: file.type.startsWith("video") ? "video" : "image", url: "", storageKey: presign.key });
      }
      if (added.length) onChange([...references, ...added]);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Show the cleaner what &ldquo;good&rdquo; looks like — example photos, demo videos, or how-to links.
      </p>

      {references.length > 0 && (
        <div className="space-y-2">
          {references.map((ref, index) => {
            const previewUrl = previewUrls[index];
            return (
              <div
                key={`${ref.storageKey ?? ref.url}-${index}`}
                className="flex items-start gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2"
              >
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-muted))]">
                  {ref.kind === "image" && previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrl} alt={ref.caption ?? "Reference"} className="size-12 object-cover" />
                  ) : ref.kind === "video" ? (
                    <Video className="size-5 text-[hsl(var(--e-text-faint))]" />
                  ) : ref.kind === "image" ? (
                    <ImageIcon className="size-5 text-[hsl(var(--e-text-faint))]" />
                  ) : (
                    <Link2 className="size-5 text-[hsl(var(--e-text-faint))]" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <EInput
                    value={ref.caption ?? ""}
                    onChange={(e) =>
                      onChange(references.map((r, i) => (i === index ? { ...r, caption: e.target.value || undefined } : r)))
                    }
                    placeholder="Caption (optional)"
                    className="h-8 text-[0.75rem]"
                  />
                  <div className="flex items-center gap-2">
                    <ESelect
                      value={ref.kind}
                      onChange={(e) =>
                        onChange(
                          references.map((r, i) => (i === index ? { ...r, kind: e.target.value as FormFieldReferenceKind } : r))
                        )
                      }
                      className="h-8 w-24 text-[0.75rem]"
                    >
                      <option value="image">Image</option>
                      <option value="video">Video</option>
                      <option value="link">Link</option>
                    </ESelect>
                    <span className="truncate text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                      {ref.storageKey ? "Uploaded file" : ref.url}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onChange(references.filter((_, i) => i !== index))}
                  aria-label="Remove reference"
                  className="shrink-0 rounded-[var(--e-radius-sm)] p-1.5 text-[hsl(var(--e-danger))] hover:bg-[hsl(var(--e-muted))]"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-3 py-1.5 text-[0.75rem] text-[hsl(var(--e-foreground))] hover:bg-[hsl(var(--e-muted))]">
        {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
        {uploading ? "Uploading…" : "Upload image / video"}
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

      <div className="flex items-center gap-2">
        <EInput
          value={linkDraft}
          onChange={(e) => setLinkDraft(e.target.value)}
          placeholder="Paste an image, video, or page URL"
          className="h-8 text-[0.75rem]"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addLink();
            }
          }}
        />
        <EButton type="button" variant="outline" size="sm" onClick={addLink} disabled={!linkDraft.trim()}>
          Add link
        </EButton>
      </div>
    </div>
  );
}
