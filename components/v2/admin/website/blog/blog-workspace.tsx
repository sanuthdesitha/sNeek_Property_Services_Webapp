"use client";

/**
 * ESTATE blog workspace — lists posts (title, slug, status, date, author) with
 * search + status filter, opens a create/edit modal (PostEditor), and deletes
 * with an EConfirmModal. Same endpoints as the legacy manager
 * (GET/POST /api/admin/blog-posts, PATCH/DELETE /api/admin/blog-posts/[id]);
 * new Estate UI, no dependency on components/{admin,ui,shared}.
 */

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ExternalLink, PencilLine, Plus, Search, Trash2 } from "lucide-react";
import { EBadge, EButton, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import { EModal, EConfirmModal, ETableShell } from "@/components/v2/admin/estate-kit";
import { toast } from "@/hooks/use-toast";
import {
  PostEditor,
  EMPTY_BLOG_FORM,
  formFromPost,
  payloadFromForm,
  type BlogForm,
  type BlogPostRecord,
} from "./post-editor";

const INPUT_CLS =
  "h-9 w-full rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 " +
  "text-[0.8125rem] text-[hsl(var(--e-foreground))] outline-none transition-colors " +
  "focus:border-[hsl(var(--e-ring))] focus:ring-1 focus:ring-[hsl(var(--e-ring))]";

const LABEL_CLS = "text-[0.6875rem] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--e-text-faint))]";

type StatusFilter = "all" | "published" | "draft";

function postDate(post: BlogPostRecord) {
  const raw = post.publishedAt ?? post.updatedAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function BlogWorkspace() {
  const [posts, setPosts] = useState<BlogPostRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BlogForm>(EMPTY_BLOG_FORM);
  const [saving, setSaving] = useState(false);

  const [postToDelete, setPostToDelete] = useState<BlogPostRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadPosts() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/blog-posts");
      const data = await res.json().catch(() => []);
      setPosts(Array.isArray(data) ? data : []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPosts();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter((post) => {
      if (status === "published" && !post.isPublished) return false;
      if (status === "draft" && post.isPublished) return false;
      if (!q) return true;
      const haystack = [
        post.title,
        post.slug,
        post.excerpt,
        post.authorName ?? "",
        (post.tags ?? []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [posts, query, status]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_BLOG_FORM);
    setEditorOpen(true);
  }

  function openEdit(post: BlogPostRecord) {
    setEditingId(post.id);
    setForm(formFromPost(post));
    setEditorOpen(true);
  }

  async function savePost() {
    setSaving(true);
    try {
      const payload = payloadFromForm(form);
      const res = await fetch(
        editingId ? `/api/admin/blog-posts/${editingId}` : "/api/admin/blog-posts",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save blog post.");
      setPosts((current) =>
        editingId
          ? current.map((item) => (item.id === body.id ? body : item))
          : [body, ...current]
      );
      toast({ title: editingId ? "Blog post updated" : "Blog post created" });
      setEditorOpen(false);
      setEditingId(null);
    } catch (error: any) {
      toast({
        title: "Blog save failed",
        description: error?.message ?? "Request failed.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!postToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/blog-posts/${postToDelete.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not delete post.");
      setPosts((current) => current.filter((item) => item.id !== postToDelete.id));
      toast({ title: "Blog post deleted" });
      setPostToDelete(null);
    } catch (error: any) {
      toast({
        title: "Delete failed",
        description: error?.message ?? "Could not delete post.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <ECard className="p-4">
        <div className="grid gap-3 md:grid-cols-[1.6fr_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <p className={LABEL_CLS}>Search</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
              <input
                className={`${INPUT_CLS} pl-9`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Title, slug, tag, or author"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <p className={LABEL_CLS}>Status</p>
            <select
              className={INPUT_CLS}
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="all">All posts</option>
              <option value="published">Published</option>
              <option value="draft">Drafts</option>
            </select>
          </div>
          <div className="flex items-end">
            <EButton size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> New post
            </EButton>
          </div>
        </div>
      </ECard>

      {/* List */}
      <ECard>
        {loading ? (
          <p className="py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            Loading posts…
          </p>
        ) : filtered.length === 0 ? (
          <EEmptyState
            eyebrow="Blog"
            title={posts.length === 0 ? "No blog posts yet" : "No matching posts"}
            description={
              posts.length === 0
                ? "Publish your first article to bring the public blog to life."
                : "Adjust the search or status filter to widen the results."
            }
            className="border-0"
            action={
              posts.length === 0 ? (
                <EButton size="sm" onClick={openCreate}>
                  <Plus className="h-3.5 w-3.5" /> New post
                </EButton>
              ) : undefined
            }
          />
        ) : (
          <ETableShell
            headers={[
              { label: "Post" },
              { label: "Status" },
              { label: "Author" },
              { label: "Date" },
              { label: "", align: "right" },
            ]}
          >
            {filtered.map((post) => {
              const date = postDate(post);
              return (
                <tr key={post.id} className="hover:bg-[hsl(var(--e-muted))]">
                  <td className="px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="h-11 w-14 shrink-0 overflow-hidden rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))]">
                        {post.coverImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={post.coverImageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[0.875rem] font-[550] text-[hsl(var(--e-foreground))]">
                          {post.title}
                        </p>
                        <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          /{post.slug}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <EBadge tone={post.isPublished ? "success" : "neutral"} soft={post.isPublished}>
                      {post.isPublished ? "Published" : "Draft"}
                    </EBadge>
                  </td>
                  <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                    {post.authorName || "—"}
                  </td>
                  <td className="px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {date ? <span className="e-tnum">{format(date, "dd MMM yyyy")}</span> : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <EButton variant="ghost" size="sm" onClick={() => openEdit(post)}>
                        <PencilLine className="h-3.5 w-3.5" /> Edit
                      </EButton>
                      <EButton variant="ghost" size="sm" asChild>
                        <a
                          href={`/blog/${post.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="View live post"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </EButton>
                      <EButton
                        variant="ghost"
                        size="sm"
                        className="text-[hsl(var(--e-danger))] hover:text-[hsl(var(--e-danger))]"
                        onClick={() => setPostToDelete(post)}
                        aria-label="Delete post"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </EButton>
                    </div>
                  </td>
                </tr>
              );
            })}
          </ETableShell>
        )}
      </ECard>

      {!loading && filtered.length > 0 ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
          <span className="e-tnum">{filtered.length}</span> of{" "}
          <span className="e-tnum">{posts.length}</span> posts
        </p>
      ) : null}

      {/* Create / edit modal */}
      <EModal
        open={editorOpen}
        onClose={() => (saving ? undefined : setEditorOpen(false))}
        eyebrow="Website · Blog"
        title={editingId ? "Edit post" : "New post"}
        wide
      >
        <div className="space-y-5">
          <PostEditor form={form} setForm={setForm} />
          <div className="flex justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            <EButton
              variant="outline"
              size="sm"
              onClick={() => setEditorOpen(false)}
              disabled={saving}
            >
              Cancel
            </EButton>
            <EButton size="sm" onClick={() => void savePost()} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Create post"}
            </EButton>
          </div>
        </div>
      </EModal>

      {/* Delete confirm */}
      <EConfirmModal
        open={Boolean(postToDelete)}
        onClose={() => (deleting ? undefined : setPostToDelete(null))}
        title="Delete blog post"
        description={
          <>
            This permanently removes{" "}
            <span className="font-[550] text-[hsl(var(--e-foreground))]">
              {postToDelete?.title}
            </span>{" "}
            from the public website. This cannot be undone.
          </>
        }
        confirmLabel="Delete post"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
