"use client";

/**
 * Blog post editor (board "Website and blog", 2026-11-16): title, excerpt with
 * a character count, Markdown write and preview, address, tags, cover and
 * gallery, a search-result preview, author and publish time. The publish time
 * is typed in the organisation timezone; a future time schedules the post (it
 * stays off the public site until then). Emits the payload the
 * /api/admin/blog-posts routes validate. Images use /api/uploads/direct.
 */
import * as React from "react";
import ReactMarkdown from "react-markdown";
import { ImagePlus, Upload, X } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, EInput, ETextarea } from "@/components/v2/admin/estate-kit";
import { isoToZonedInput, zonedInputToIso } from "@/lib/public-site/zoned-time";
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
  tags: string[];
  authorName: string;
  /** Organisation wall clock "yyyy-MM-ddTHH:mm"; empty = publish at once. */
  publishAt: string;
};

export const EMPTY_BLOG_FORM: BlogForm = {
  slug: "",
  title: "",
  excerpt: "",
  body: "",
  coverImageUrl: "",
  galleryImageUrls: [],
  tags: [],
  authorName: "sNeek Team",
  publishAt: "",
};

/** Search results show about this many characters of the excerpt. */
export const EXCERPT_GUIDE = 160;

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

export function formFromPost(post: BlogPostRecord, timeZone: string): BlogForm {
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    body: post.body,
    coverImageUrl: post.coverImageUrl || "",
    galleryImageUrls: Array.isArray(post.galleryImageUrls) ? post.galleryImageUrls : [],
    tags: Array.isArray(post.tags) ? post.tags : [],
    authorName: post.authorName || "sNeek Team",
    publishAt: isoToZonedInput(post.publishedAt ?? null, timeZone),
  };
}

/** The JSON the API validates. `isPublished` is decided by the action (save draft / publish / unpublish). */
export function payloadFromForm(form: BlogForm, isPublished: boolean, timeZone: string) {
  return {
    slug: form.slug.trim() || slugify(form.title),
    title: form.title.trim(),
    excerpt: form.excerpt.trim(),
    body: form.body,
    coverImageUrl: form.coverImageUrl.trim() || null,
    galleryImageUrls: form.galleryImageUrls,
    tags: form.tags,
    isPublished,
    authorName: form.authorName.trim() || "sNeek Team",
    publishedAt: zonedInputToIso(form.publishAt, timeZone),
  };
}

/** What is missing before the API would accept the post (its own minimums). */
export function blogFormProblems(form: BlogForm): string[] {
  const problems: string[] = [];
  if (form.title.trim().length < 2) problems.push("a title");
  if (form.excerpt.trim().length < 2) problems.push("an excerpt");
  if (form.body.trim().length < 2) problems.push("the post wording");
  if ((form.slug.trim() || slugify(form.title)).length < 2) problems.push("an address");
  return problems;
}

export function sameBlogForm(left: BlogForm, right: BlogForm) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function uploadBlogImage(file: File) {
  const data = new FormData();
  data.append("file", file);
  data.append("folder", "website/blog");
  const response = await fetch("/api/uploads/direct", { method: "POST", body: data });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.url) throw new Error(body.error ?? "Could not upload the image.");
  return body.url as string;
}

function truncate(text: string, length: number) {
  const clean = text.trim();
  return clean.length > length ? `${clean.slice(0, length - 1).trimEnd()}…` : clean;
}

export function PostEditor({
  form,
  setForm,
  timeZone,
  published,
}: {
  form: BlogForm;
  setForm: React.Dispatch<React.SetStateAction<BlogForm>>;
  timeZone: string;
  /** The post is already public: changing the address breaks old links. */
  published: boolean;
}) {
  const [tab, setTab] = React.useState<"write" | "preview">("write");
  const [uploading, setUploading] = React.useState<"cover" | "gallery" | null>(null);
  const [tagDraft, setTagDraft] = React.useState("");
  const coverInputRef = React.useRef<HTMLInputElement | null>(null);
  const galleryInputRef = React.useRef<HTMLInputElement | null>(null);
  const liveSlug = form.slug.trim() || slugify(form.title);
  const excerptLength = form.excerpt.trim().length;

  async function upload(kind: "cover" | "gallery", files: FileList | null) {
    if (!files?.length) return;
    setUploading(kind);
    try {
      if (kind === "cover") {
        const url = await uploadBlogImage(files[0]!);
        setForm((current) => ({ ...current, coverImageUrl: url }));
      } else {
        const urls: string[] = [];
        for (const file of Array.from(files)) urls.push(await uploadBlogImage(file));
        setForm((current) => ({ ...current, galleryImageUrls: [...current.galleryImageUrls, ...urls].slice(0, 24) }));
      }
    } catch (error) {
      toast({ title: "Image not uploaded", description: error instanceof Error ? error.message : "Could not upload the image.", variant: "destructive" });
    } finally {
      setUploading(null);
    }
  }

  function addTag() {
    const tag = tagDraft.trim().replace(/,$/, "");
    if (!tag) return;
    setForm((current) => (current.tags.includes(tag) || current.tags.length >= 12 ? current : { ...current, tags: [...current.tags, tag] }));
    setTagDraft("");
  }

  return (
    <div className="grid min-w-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
      <div className="min-w-0 space-y-3 p-4 xl:border-r xl:border-[hsl(var(--e-border))]">
        <EField label="Title">
          <EInput value={form.title} onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))} placeholder="How we turn over a property in 90 minutes" />
        </EField>
        <EField
          label="Excerpt"
          hint={
            <span className={excerptLength > EXCERPT_GUIDE ? "text-[hsl(var(--e-warning))]" : undefined}>
              Shown on the blog list and in link previews · {excerptLength} of {EXCERPT_GUIDE} characters
              {excerptLength > EXCERPT_GUIDE ? "; search results cut the rest" : ""}
            </span>
          }
        >
          <ETextarea rows={3} maxLength={500} value={form.excerpt} onChange={(e) => setForm((c) => ({ ...c, excerpt: e.target.value }))} />
        </EField>
        <div className="overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))]">
          <div role="tablist" aria-label="Post wording" className="flex items-center gap-0.5 border-b border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-1 text-[0.75rem]">
            {(["write", "preview"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`min-h-9 rounded-[var(--e-radius-sm)] px-2.5 max-sm:min-h-11 ${tab === key ? "bg-[hsl(var(--e-surface))] font-[600]" : "text-[hsl(var(--e-muted-foreground))]"}`}
              >
                {key === "write" ? "Write" : "Preview"}
              </button>
            ))}
            <span className="ml-auto pr-2 text-[hsl(var(--e-muted-foreground))]">Markdown</span>
          </div>
          {tab === "write" ? (
            <textarea
              aria-label="Post wording (Markdown)"
              rows={14}
              value={form.body}
              onChange={(e) => setForm((c) => ({ ...c, body: e.target.value }))}
              className="block w-full resize-y border-0 bg-[hsl(var(--e-surface))] p-3 font-mono text-[0.8125rem] leading-6 text-[hsl(var(--e-foreground))] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--e-ring))] max-sm:text-[1rem]"
              placeholder={"## Heading\n\nWrite the post in Markdown…"}
            />
          ) : (
            <div className="prose prose-sm max-w-none p-4 text-[hsl(var(--e-foreground))] dark:prose-invert">
              <ReactMarkdown>{form.body || "Start writing to preview the post here."}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-3 bg-[hsl(var(--e-surface-raised))] p-4">
        <EField label="Address" hint={published ? "Changing it after publishing breaks old links." : "Made from the title; changing it after publishing breaks old links."}>
          <EInput value={form.slug} onChange={(e) => setForm((c) => ({ ...c, slug: slugify(e.target.value) }))} placeholder={liveSlug || "made-from-the-title"} />
        </EField>
        <div className="space-y-1.5">
          <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Tags</p>
          <ul className="flex flex-wrap gap-1">
            {form.tags.map((tag) => (
              <li key={tag} className="inline-flex h-7 items-center gap-1 rounded-full border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] pl-2.5 text-[0.75rem]">
                {tag}
                <button type="button" aria-label={`Remove tag ${tag}`} className="inline-flex h-7 w-7 items-center justify-center rounded-full" onClick={() => setForm((c) => ({ ...c, tags: c.tags.filter((item) => item !== tag) }))}>
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <EInput
            aria-label="Add a tag"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
            placeholder="+ tag (Enter to add)"
            className="max-sm:text-[1rem]"
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Cover and gallery</p>
          <div className="flex flex-wrap gap-1.5">
            {form.coverImageUrl ? (
              <span className="relative h-12 w-[70px] overflow-hidden rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.coverImageUrl} alt="" className="h-full w-full object-cover" />
                <button type="button" aria-label="Remove cover image" className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(160_18%_8%/0.7)] text-white" onClick={() => setForm((c) => ({ ...c, coverImageUrl: "" }))}>
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ) : (
              <button type="button" className="flex h-12 w-[70px] items-center justify-center rounded-[var(--e-radius-sm)] border border-dashed border-[hsl(var(--e-border-strong))] text-[0.625rem] text-[hsl(var(--e-muted-foreground))]" onClick={() => coverInputRef.current?.click()} disabled={uploading !== null}>
                <Upload className="mr-1 h-3 w-3" aria-hidden />
                {uploading === "cover" ? "Uploading…" : "Cover"}
              </button>
            )}
            {form.galleryImageUrls.map((url, index) => (
              <span key={`${url}-${index}`} className="relative h-12 w-12 overflow-hidden rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
                <button type="button" aria-label={`Remove gallery image ${index + 1}`} className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[hsl(160_18%_8%/0.7)] text-white" onClick={() => setForm((c) => ({ ...c, galleryImageUrls: c.galleryImageUrls.filter((_, i) => i !== index) }))}>
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </span>
            ))}
            <button type="button" className="flex h-12 w-12 flex-col items-center justify-center rounded-[var(--e-radius-sm)] border border-dashed border-[hsl(var(--e-border-strong))] text-[0.625rem] text-[hsl(var(--e-muted-foreground))]" onClick={() => galleryInputRef.current?.click()} disabled={uploading !== null || form.galleryImageUrls.length >= 24} aria-label="Add gallery images">
              <ImagePlus className="h-3.5 w-3.5" aria-hidden />
              {uploading === "gallery" ? "…" : "Add"}
            </button>
          </div>
          <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { await upload("cover", e.target.files); e.currentTarget.value = ""; }} />
          <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={async (e) => { await upload("gallery", e.target.files); e.currentTarget.value = ""; }} />
          <details className="text-[0.75rem]">
            <summary className="cursor-pointer text-[hsl(var(--e-muted-foreground))]">Use an image address for the cover</summary>
            <div className="mt-2">
              <EField label="Cover image address">
                <EInput value={form.coverImageUrl} onChange={(e) => setForm((c) => ({ ...c, coverImageUrl: e.target.value }))} placeholder="https://…" />
              </EField>
            </div>
          </details>
        </div>
        <div className="space-y-1.5">
          <p className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Search result preview</p>
          <div className="space-y-0.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2.5 text-[0.75rem]" aria-label="How the post may look in search results">
            <p className="text-[hsl(var(--e-success))] [overflow-wrap:anywhere]">Public site › blog › {liveSlug || "address"}</p>
            <p className="text-[0.875rem] text-[hsl(var(--e-info))] [overflow-wrap:anywhere]">{truncate(form.title || "Post title", 60)}</p>
            <p className="text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{truncate(form.excerpt || "The excerpt appears here.", 155)}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
          <EField label="Author">
            <EInput value={form.authorName} onChange={(e) => setForm((c) => ({ ...c, authorName: e.target.value }))} />
          </EField>
          <EField label={`Publish time (${timeZone.replace(/^.*\//, "").replace(/_/g, " ")} time)`} hint="Empty: published at once. A future time schedules the post; it stays off the public site until then.">
            <EInput type="datetime-local" value={form.publishAt} onChange={(e) => setForm((c) => ({ ...c, publishAt: e.target.value }))} />
          </EField>
        </div>
      </div>
    </div>
  );
}
