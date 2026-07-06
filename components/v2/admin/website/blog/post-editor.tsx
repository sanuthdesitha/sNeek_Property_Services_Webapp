"use client";

/**
 * ESTATE blog post editor — the create/edit form body used inside the EModal
 * on the blog workspace. Covers the full v1 field set (title, author, slug,
 * excerpt, tags, cover image, gallery images, SEO meta, published toggle,
 * publish date, markdown body with a live preview) and emits the exact payload
 * shape the /api/admin/blog-posts endpoints expect. Estate primitives only.
 */

import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ImagePlus, Link2, Upload, X } from "lucide-react";
import { EButton, EBadge } from "@/components/v2/ui/primitives";
import { EField, EInput, ETextarea, ESwitch } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";

export type BlogPostRecord = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverImageUrl: string | null;
  galleryImageUrls?: string[];
  tags?: string[];
  isPublished: boolean;
  authorName?: string | null;
  publishedAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

export type BlogForm = {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverImageUrl: string;
  galleryImageUrls: string[];
  tags: string;
  isPublished: boolean;
  authorName: string;
  publishedAt: string;
};

export const EMPTY_BLOG_FORM: BlogForm = {
  slug: "",
  title: "",
  excerpt: "",
  body: "",
  coverImageUrl: "",
  galleryImageUrls: [],
  tags: "",
  isPublished: false,
  authorName: "sNeek Team",
  publishedAt: "",
};

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

/** Build a BlogForm from an existing record (edit mode). */
export function formFromPost(post: BlogPostRecord): BlogForm {
  const publishedAt = post.publishedAt ? new Date(post.publishedAt) : null;
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    body: post.body,
    coverImageUrl: post.coverImageUrl || "",
    galleryImageUrls: Array.isArray(post.galleryImageUrls) ? post.galleryImageUrls : [],
    tags: (post.tags ?? []).join(", "),
    isPublished: post.isPublished,
    authorName: post.authorName || "sNeek Team",
    publishedAt: publishedAt ? toDatetimeLocal(publishedAt) : "",
  };
}

/** Convert a form into the JSON payload the API route validates. */
export function payloadFromForm(form: BlogForm) {
  const slug = form.slug.trim() || slugify(form.title);
  return {
    slug,
    title: form.title.trim(),
    excerpt: form.excerpt.trim(),
    body: form.body,
    coverImageUrl: form.coverImageUrl.trim() || null,
    galleryImageUrls: form.galleryImageUrls,
    tags: form.tags
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    isPublished: form.isPublished,
    authorName: form.authorName.trim() || "sNeek Team",
    publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : null,
  };
}

function toDatetimeLocal(date: Date) {
  // yyyy-MM-ddThh:mm in local time for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

async function uploadBlogImage(file: File) {
  const data = new FormData();
  data.append("file", file);
  data.append("folder", "website/blog");
  const response = await fetch("/api/uploads/direct", { method: "POST", body: data });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Could not upload image.");
  return body.url as string;
}

export function PostEditor({
  form,
  setForm,
}: {
  form: BlogForm;
  setForm: React.Dispatch<React.SetStateAction<BlogForm>>;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [coverUrlDraft, setCoverUrlDraft] = useState("");
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const liveSlug = useMemo(
    () => form.slug.trim() || slugify(form.title),
    [form.slug, form.title]
  );

  async function handleCoverUpload(file: File) {
    setUploadingCover(true);
    try {
      const url = await uploadBlogImage(file);
      setForm((current) => ({ ...current, coverImageUrl: url }));
      toast({ title: "Cover image uploaded" });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error?.message ?? "Could not upload image.",
        variant: "destructive",
      });
    } finally {
      setUploadingCover(false);
    }
  }

  async function handleGalleryUpload(files: FileList | null) {
    if (!files?.length) return;
    setUploadingGallery(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        urls.push(await uploadBlogImage(file));
      }
      setForm((current) => ({
        ...current,
        galleryImageUrls: [...current.galleryImageUrls, ...urls].slice(0, 24),
      }));
      toast({ title: `${urls.length} image${urls.length === 1 ? "" : "s"} uploaded` });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error?.message ?? "Could not upload images.",
        variant: "destructive",
      });
    } finally {
      setUploadingGallery(false);
    }
  }

  const chipTab = (key: "write" | "preview", label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      aria-current={tab === key ? "true" : undefined}
      className={
        "rounded-[var(--e-radius-sm)] px-3 py-1.5 text-[0.8125rem] font-[550] transition-colors duration-[160ms] " +
        (tab === key
          ? "bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-[var(--e-elevation-1)]"
          : "text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <EField label="Title">
          <EInput
            value={form.title}
            onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))}
            placeholder="How we turn over a property in 90 minutes"
          />
        </EField>
        <EField label="Author">
          <EInput
            value={form.authorName}
            onChange={(e) => setForm((c) => ({ ...c, authorName: e.target.value }))}
          />
        </EField>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <EField label="Slug" hint={<>Public URL: /blog/{liveSlug || "your-post-slug"}</>}>
          <EInput
            value={form.slug}
            onChange={(e) => setForm((c) => ({ ...c, slug: e.target.value }))}
            placeholder="auto-generated if blank"
          />
        </EField>
        <div className="flex items-end pb-1">
          <div className="flex h-10 items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-4">
            <span className="text-[0.8125rem] font-[550] text-[hsl(var(--e-text-secondary))]">
              Published
            </span>
            <ESwitch
              checked={form.isPublished}
              onCheckedChange={(value) => setForm((c) => ({ ...c, isPublished: value }))}
            />
          </div>
        </div>
      </div>

      <EField label="Excerpt" hint="Short summary shown on the blog index and in link previews.">
        <ETextarea
          rows={3}
          value={form.excerpt}
          onChange={(e) => setForm((c) => ({ ...c, excerpt: e.target.value }))}
        />
      </EField>

      <div className="grid gap-4 sm:grid-cols-2">
        <EField label="Tags" hint="Comma separated — up to 12.">
          <EInput
            value={form.tags}
            onChange={(e) => setForm((c) => ({ ...c, tags: e.target.value }))}
            placeholder="airbnb, hosting, cleaning"
          />
        </EField>
        <EField label="Publish date" hint="Optional — defaults to now when you publish.">
          <EInput
            type="datetime-local"
            value={form.publishedAt}
            onChange={(e) => setForm((c) => ({ ...c, publishedAt: e.target.value }))}
          />
        </EField>
      </div>

      {/* Cover image */}
      <EField label="Cover image">
        <div className="space-y-3">
          <div className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]">
            {form.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.coverImageUrl}
                alt={form.title || "Cover image"}
                className="h-44 w-full object-cover"
              />
            ) : (
              <div className="flex h-44 items-center justify-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                No cover selected
              </div>
            )}
          </div>
          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) await handleCoverUpload(file);
              e.currentTarget.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <EButton
              type="button"
              variant="outline"
              size="sm"
              onClick={() => coverInputRef.current?.click()}
              disabled={uploadingCover}
            >
              <Upload className="h-3.5 w-3.5" />
              {uploadingCover ? "Uploading…" : "Upload cover"}
            </EButton>
            {form.coverImageUrl ? (
              <EButton
                type="button"
                variant="ghost"
                size="sm"
                className="text-[hsl(var(--e-danger))] hover:text-[hsl(var(--e-danger))]"
                onClick={() => setForm((c) => ({ ...c, coverImageUrl: "" }))}
              >
                Remove
              </EButton>
            ) : null}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <EInput
                value={coverUrlDraft}
                onChange={(e) => setCoverUrlDraft(e.target.value)}
                placeholder="…or paste an image URL"
              />
            </div>
            <EButton
              type="button"
              variant="outline"
              size="sm"
              disabled={!coverUrlDraft.trim()}
              onClick={() => {
                setForm((c) => ({ ...c, coverImageUrl: coverUrlDraft.trim() }));
                setCoverUrlDraft("");
              }}
            >
              <Link2 className="h-3.5 w-3.5" /> Use URL
            </EButton>
          </div>
        </div>
      </EField>

      {/* Gallery images */}
      <EField
        label={
          <span className="flex items-center gap-2">
            Gallery images
            <EBadge tone="neutral" soft>
              {form.galleryImageUrls.length}/24
            </EBadge>
          </span>
        }
      >
        <div className="space-y-3">
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={async (e) => {
              await handleGalleryUpload(e.target.files);
              e.currentTarget.value = "";
            }}
          />
          <EButton
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => galleryInputRef.current?.click()}
            disabled={uploadingGallery}
          >
            <ImagePlus className="h-3.5 w-3.5" />
            {uploadingGallery ? "Uploading images…" : "Add gallery images"}
          </EButton>
          {form.galleryImageUrls.length ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {form.galleryImageUrls.map((url, index) => (
                <div
                  key={`${url}-${index}`}
                  className="relative overflow-hidden rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Gallery ${index + 1}`} className="h-20 w-full object-cover" />
                  <button
                    type="button"
                    aria-label={`Remove gallery image ${index + 1}`}
                    onClick={() =>
                      setForm((c) => ({
                        ...c,
                        galleryImageUrls: c.galleryImageUrls.filter((_, i) => i !== index),
                      }))
                    }
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(160_18%_8%/0.6)] text-white transition-colors hover:bg-[hsl(160_18%_8%/0.85)]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </EField>

      {/* Body — write / preview */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">
            Body (Markdown)
          </label>
          <div className="inline-flex items-center gap-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1">
            {chipTab("write", "Write")}
            {chipTab("preview", "Preview")}
          </div>
        </div>
        {tab === "write" ? (
          <ETextarea
            rows={16}
            value={form.body}
            onChange={(e) => setForm((c) => ({ ...c, body: e.target.value }))}
            className="font-mono text-[0.8125rem] leading-6"
            placeholder="# Heading&#10;&#10;Write the article in Markdown…"
          />
        ) : (
          <div className="min-h-[24rem] rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-5">
            <h1 className="e-display-sm">{form.title || "Preview title"}</h1>
            <p className="mt-2 text-[0.875rem] leading-7 text-[hsl(var(--e-muted-foreground))]">
              {form.excerpt || "Your post excerpt will appear here."}
            </p>
            {form.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.coverImageUrl}
                alt={form.title || "Cover"}
                className="mt-4 max-h-72 w-full rounded-[var(--e-radius)] object-cover"
              />
            ) : null}
            <div className="prose prose-sm mt-6 max-w-none text-[hsl(var(--e-foreground))]">
              <ReactMarkdown>{form.body || "Start writing to preview the article here."}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
