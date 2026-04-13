"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ImagePlus, PencilLine, Plus, Save, Trash2, Upload } from "lucide-react";
import { AdminPageShell } from "@/components/admin/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { useBasicConfirmDialog } from "@/components/shared/use-basic-confirm";

type BlogPostRecord = {
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

type BlogForm = {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverImageUrl: string;
  galleryImageUrls: string[];
  tags: string;
  isPublished: boolean;
  authorName: string;
};

const EMPTY_FORM: BlogForm = {
  slug: "",
  title: "",
  excerpt: "",
  body: "",
  coverImageUrl: "",
  galleryImageUrls: [],
  tags: "",
  isPublished: false,
  authorName: "sNeek Team",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

async function uploadBlogImage(file: File) {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "website/blog");
  const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? "Could not upload image.");
  }
  return body.url as string;
}

export function BlogManager({ initialPosts }: { initialPosts: BlogPostRecord[] }) {
  const { confirm, dialog } = useBasicConfirmDialog();
  const [posts, setPosts] = useState(initialPosts);
  const [form, setForm] = useState<BlogForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [previewMode, setPreviewMode] = useState<"editor" | "preview">("editor");
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPosts(initialPosts);
  }, [initialPosts]);

  const liveSlug = useMemo(() => form.slug.trim() || slugify(form.title), [form.slug, form.title]);

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setPreviewMode("editor");
  }

  function loadPost(post: BlogPostRecord) {
    setEditingId(post.id);
    setForm({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      body: post.body,
      coverImageUrl: post.coverImageUrl || "",
      galleryImageUrls: Array.isArray(post.galleryImageUrls) ? post.galleryImageUrls : [],
      tags: (post.tags ?? []).join(", "),
      isPublished: post.isPublished,
      authorName: post.authorName || "sNeek Team",
    });
  }

  async function handleCoverUpload(file: File) {
    setUploadingCover(true);
    try {
      const url = await uploadBlogImage(file);
      setForm((current) => ({ ...current, coverImageUrl: url }));
      toast({ title: "Cover image uploaded" });
    } catch (error: any) {
      toast({ title: "Upload failed", description: error?.message ?? "Could not upload image.", variant: "destructive" });
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
      toast({ title: "Upload failed", description: error?.message ?? "Could not upload images.", variant: "destructive" });
    } finally {
      setUploadingGallery(false);
    }
  }

  async function savePost() {
    setSaving(true);
    try {
      const payload = {
        ...form,
        slug: liveSlug,
        coverImageUrl: form.coverImageUrl || null,
        galleryImageUrls: form.galleryImageUrls,
        tags: form.tags.split(",").map((item) => item.trim()).filter(Boolean),
      };
      const response = await fetch(editingId ? `/api/admin/blog-posts/${editingId}` : "/api/admin/blog-posts", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not save blog post.");
      if (editingId) {
        setPosts((current) => current.map((item) => (item.id === body.id ? body : item)));
      } else {
        setPosts((current) => [body, ...current]);
      }
      toast({ title: editingId ? "Blog post updated" : "Blog post created" });
      resetForm();
    } catch (error: any) {
      toast({ title: "Blog save failed", description: error?.message ?? "Request failed.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function removePost(id: string) {
    const approved = await confirm({
      title: "Delete blog post",
      description: "This will remove the blog post from the public website.",
      confirmLabel: "Delete post",
      actionKey: "deleteBlogPost",
    });
    if (!approved) return;
    const response = await fetch(`/api/admin/blog-posts/${id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete post.", variant: "destructive" });
      return;
    }
    setPosts((current) => current.filter((item) => item.id !== id));
    toast({ title: "Blog post deleted" });
    if (editingId === id) resetForm();
  }

  return (
    <AdminPageShell
      eyebrow="Website"
      title="Blog"
      description="Create, edit, publish, and remove public blog posts with cover images, gallery images, and markdown content."
      actions={<Button asChild variant="outline" className="rounded-full"><a href="/blog" target="_blank" rel="noreferrer">Open public blog</a></Button>}
    >
      {dialog}
      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <Card className="rounded-[1.8rem] border-white/70 bg-white/85 shadow-[0_18px_50px_-28px_rgba(25,67,74,0.34)]">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle>{editingId ? "Edit post" : "New post"}</CardTitle>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={resetForm}>Reset</Button>
              <Button type="button" size="sm" className="rounded-full" onClick={savePost} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving..." : editingId ? "Save changes" : "Create post"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Author</Label>
                <Input value={form.authorName} onChange={(event) => setForm((current) => ({ ...current, authorName: event.target.value }))} />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_220px]">
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input value={form.slug} onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))} placeholder="auto-generated if blank" />
                <p className="text-xs text-muted-foreground">Public URL: /blog/{liveSlug || "your-post-slug"}</p>
              </div>
              <label className="flex items-center justify-between rounded-[1.2rem] border border-border/70 px-4 py-3 text-sm">
                <span className="font-medium">Published</span>
                <Switch checked={form.isPublished} onCheckedChange={(value) => setForm((current) => ({ ...current, isPublished: value }))} />
              </label>
            </div>

            <div className="space-y-2">
              <Label>Excerpt</Label>
              <Textarea rows={3} value={form.excerpt} onChange={(event) => setForm((current) => ({ ...current, excerpt: event.target.value }))} />
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <Input value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} placeholder="airbnb, hosting, cleaning" />
            </div>

            <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Cover image</Label>
                  <div className="overflow-hidden rounded-[1.4rem] border border-border/70 bg-muted/20">
                    {form.coverImageUrl ? (
                      <img src={form.coverImageUrl} alt={form.title || "Cover image"} className="h-48 w-full object-cover" />
                    ) : (
                      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">No cover selected</div>
                    )}
                  </div>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file) await handleCoverUpload(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="rounded-full" onClick={() => coverInputRef.current?.click()} disabled={uploadingCover}>
                      <Upload className="mr-2 h-4 w-4" />
                      {uploadingCover ? "Uploading..." : "Upload cover"}
                    </Button>
                    {form.coverImageUrl ? (
                      <Button type="button" variant="ghost" className="rounded-full text-destructive hover:text-destructive" onClick={() => setForm((current) => ({ ...current, coverImageUrl: "" }))}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>Gallery images</Label>
                    <Badge variant="secondary">{form.galleryImageUrls.length}/24</Badge>
                  </div>
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={async (event) => {
                      await handleGalleryUpload(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                  <Button type="button" variant="outline" className="w-full rounded-full" onClick={() => galleryInputRef.current?.click()} disabled={uploadingGallery}>
                    <ImagePlus className="mr-2 h-4 w-4" />
                    {uploadingGallery ? "Uploading images..." : "Add gallery images"}
                  </Button>
                  <div className="grid grid-cols-3 gap-2">
                    {form.galleryImageUrls.map((url, index) => (
                      <div key={`${url}-${index}`} className="relative overflow-hidden rounded-xl border border-border/70 bg-muted/20">
                        <img src={url} alt={`Gallery ${index + 1}`} className="h-20 w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setForm((current) => ({
                            ...current,
                            galleryImageUrls: current.galleryImageUrls.filter((_, imageIndex) => imageIndex !== index),
                          }))}
                          className="absolute right-1 top-1 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold text-white"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <Tabs value={previewMode} onValueChange={(value) => setPreviewMode(value as typeof previewMode)}>
                  <TabsList className="grid w-full grid-cols-2 rounded-full">
                    <TabsTrigger value="editor">Editor</TabsTrigger>
                    <TabsTrigger value="preview">Preview</TabsTrigger>
                  </TabsList>
                  <TabsContent value="editor" className="space-y-2 pt-3">
                    <Label>Body (Markdown)</Label>
                    <Textarea rows={22} value={form.body} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} className="font-mono text-sm" />
                  </TabsContent>
                  <TabsContent value="preview" className="pt-3">
                    <div className="min-h-[26rem] rounded-[1.4rem] border border-border/70 bg-white p-5">
                      <h1 className="text-2xl font-semibold">{form.title || "Preview title"}</h1>
                      <p className="mt-2 text-sm leading-7 text-muted-foreground">{form.excerpt || "Your post excerpt will appear here."}</p>
                      {form.coverImageUrl ? <img src={form.coverImageUrl} alt={form.title || "Cover"} className="mt-4 max-h-72 w-full rounded-[1.4rem] object-cover" /> : null}
                      <div className="prose prose-slate mt-6 max-w-none prose-headings:font-semibold prose-a:text-primary prose-p:leading-8">
                        <ReactMarkdown>{form.body || "Start writing to preview the article here."}</ReactMarkdown>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-semibold">Existing posts</h3>
            <Badge variant="secondary">{posts.length}</Badge>
          </div>
          {posts.map((post) => (
            <Card key={post.id} className="rounded-[1.5rem] border-white/70 bg-white/85 shadow-[0_16px_44px_-28px_rgba(22,63,70,0.28)]">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start gap-4">
                  <div className="h-20 w-24 shrink-0 overflow-hidden rounded-xl border border-border/70 bg-muted/20">
                    {post.coverImageUrl ? (
                      <img src={post.coverImageUrl} alt={post.title} className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-semibold">{post.title}</p>
                      <Badge variant={post.isPublished ? "success" : "secondary"}>{post.isPublished ? "Published" : "Draft"}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">/{post.slug}</p>
                    <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{post.excerpt}</p>
                    <div className="flex flex-wrap gap-2">
                      {(post.tags ?? []).slice(0, 4).map((tag) => (
                        <Badge key={`${post.id}-${tag}`} variant="outline">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => loadPost(post)}>
                    <PencilLine className="mr-2 h-4 w-4" />
                    Edit
                  </Button>
                  <Button type="button" variant="destructive" size="sm" className="rounded-full" onClick={() => removePost(post.id)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => window.open(`/blog/${post.slug}`, "_blank") }>
                    View live
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {posts.length === 0 ? (
            <Card className="rounded-[1.5rem] border-white/70 bg-white/85">
              <CardContent className="p-6 text-sm text-muted-foreground">No blog posts yet.</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </AdminPageShell>
  );
}
