"use client";

/**
 * Website › Blog (board "Website and blog", 2026-11-16): the post list on the
 * left, the post opens beside it (a full-screen sheet below lg). States are
 * Draft, Scheduled (published with a future publish time: hidden from the
 * public site until then) and Published. Unsaved edits are kept per post while
 * you switch between posts. Same endpoints as before
 * (GET/POST /api/admin/blog-posts, PATCH/DELETE /api/admin/blog-posts/[id]).
 * Delete is tier B and cannot be undone; unpublish (tier A) is the safe way out.
 */
import * as React from "react";
import { ExternalLink, Plus, Search } from "lucide-react";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EPhoneActionBar } from "@/components/v2/ui/phone-bars";
import { EInput } from "@/components/v2/admin/estate-kit";
import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import { BLOG_STATE_LABEL, blogPostState, type BlogPostState } from "@/lib/public-site/blog-visibility";
import { formatOrgDateTime, formatOrgDay, zonedInputToIso } from "@/lib/public-site/zoned-time";
import {
  EMPTY_BLOG_FORM,
  PostEditor,
  blogFormProblems,
  formFromPost,
  payloadFromForm,
  sameBlogForm,
  type BlogForm,
  type BlogPostRecord,
} from "./post-editor";

type Filter = "all" | BlogPostState;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; posts: BlogPostRecord[] };

type PendingAction = "publish" | "unpublish" | "delete" | null;

const NEW_KEY = "new";

const STATE_TONE: Record<BlogPostState, EPillTone> = { draft: "neutral", scheduled: "info", published: "ok" };

function readOpenParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("open");
}

function writeOpenParam(value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set("open", value);
  else url.searchParams.delete("open");
  window.history.replaceState(window.history.state, "", url.toString());
}

function dateCell(post: BlogPostRecord, state: BlogPostState, timeZone: string) {
  if (state === "scheduled") return formatOrgDateTime(post.publishedAt ?? null, timeZone);
  if (state === "published") return formatOrgDay(post.publishedAt ?? post.updatedAt ?? null, timeZone);
  const edited = formatOrgDay(post.updatedAt ?? null, timeZone);
  return edited ? `edited ${edited}` : "";
}

export function BlogWorkspace({ timeZone }: { timeZone: string }) {
  const [load, setLoad] = React.useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useRestorableState("blog-workspace:query", "");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, BlogForm>>({});
  const [saving, setSaving] = React.useState(false);
  const [pending, setPending] = React.useState<PendingAction>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const loadAbort = React.useRef<AbortController | null>(null);

  const loadPosts = React.useCallback(async () => {
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    setLoad({ status: "loading" });
    try {
      const res = await fetch("/api/admin/blog-posts", { signal: controller.signal, cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok || !Array.isArray(body)) {
        setLoad({ status: "error", message: (body && typeof body.error === "string" && body.error) || "Posts could not be loaded." });
        return;
      }
      setLoad({ status: "ready", posts: body as BlogPostRecord[] });
    } catch {
      if (!controller.signal.aborted) setLoad({ status: "error", message: "Posts could not be loaded." });
    }
  }, []);

  React.useEffect(() => {
    setOpenKey(readOpenParam());
    void loadPosts();
    return () => loadAbort.current?.abort();
  }, [loadPosts]);

  const posts = load.status === "ready" ? load.posts : [];
  const now = new Date();
  const counts = React.useMemo(() => {
    const result: Record<Filter, number> = { all: posts.length, draft: 0, scheduled: 0, published: 0 };
    for (const post of posts) result[blogPostState(post)] += 1;
    return result;
  }, [posts]);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return posts.filter((post) => {
      if (filter !== "all" && blogPostState(post) !== filter) return false;
      if (!q) return true;
      return [post.title, post.slug, post.authorName ?? "", (post.tags ?? []).join(" ")].join(" ").toLowerCase().includes(q);
    });
  }, [posts, query, filter]);

  const openPost = openKey && openKey !== NEW_KEY ? posts.find((post) => post.id === openKey) ?? null : null;
  const baseForm = openPost ? formFromPost(openPost, timeZone) : EMPTY_BLOG_FORM;
  const form = openKey ? drafts[openKey] ?? baseForm : baseForm;
  const dirty = openKey ? !sameBlogForm(form, baseForm) : false;
  const openState: BlogPostState = openPost ? blogPostState(openPost) : "draft";
  const editorOpen = openKey === NEW_KEY || Boolean(openPost);

  function open(key: string | null) {
    setOpenKey(key);
    setActionError(null);
    setNotice(null);
    writeOpenParam(key);
  }

  const setForm: React.Dispatch<React.SetStateAction<BlogForm>> = (update) => {
    if (!openKey) return;
    setDrafts((current) => {
      const previous = current[openKey] ?? baseForm;
      const next = typeof update === "function" ? (update as (value: BlogForm) => BlogForm)(previous) : update;
      return { ...current, [openKey]: next };
    });
  };

  async function save(isPublished: boolean, successNotice: string) {
    if (!openKey || saving) return;
    const problems = blogFormProblems(form);
    if (problems.length > 0) {
      setActionError(`Add ${problems.join(", ")} first. Nothing was saved.`);
      setPending(null);
      return;
    }
    setSaving(true);
    setActionError(null);
    const key = openKey;
    try {
      const res = await fetch(openPost ? `/api/admin/blog-posts/${openPost.id}` : "/api/admin/blog-posts", {
        method: openPost ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadFromForm(form, isPublished, timeZone)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.id) throw new Error(body?.error ?? "The post was not saved.");
      const saved = body as BlogPostRecord;
      setLoad((current) =>
        current.status === "ready"
          ? { status: "ready", posts: openPost ? current.posts.map((post) => (post.id === saved.id ? saved : post)) : [saved, ...current.posts] }
          : current
      );
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      if (!openPost) open(saved.id);
      setNotice(successNotice);
      setPending(null);
    } catch (error) {
      setActionError(`${error instanceof Error ? error.message : "The post was not saved."} Your edits are kept.`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!openPost || saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/blog-posts/${openPost.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "The post was not deleted.");
      const id = openPost.id;
      setLoad((current) => (current.status === "ready" ? { status: "ready", posts: current.posts.filter((post) => post.id !== id) } : current));
      setDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setPending(null);
      open(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The post was not deleted.");
    } finally {
      setSaving(false);
    }
  }

  const publishIso = zonedInputToIso(form.publishAt, timeZone);
  const schedules = publishIso !== null && new Date(publishIso).getTime() > now.getTime();
  const publishWhen = publishIso ? formatOrgDateTime(publishIso, timeZone) : "";
  const eyebrow = openKey === NEW_KEY
    ? "New post · not saved"
    : openPost
      ? `${BLOG_STATE_LABEL[openState]} · ${
          openState === "scheduled"
            ? `goes public ${formatOrgDateTime(openPost.publishedAt ?? null, timeZone)}`
            : `edited ${formatOrgDateTime(openPost.updatedAt ?? null, timeZone)}`
        }${dirty ? " · unsaved edits" : ""}`
      : "";

  const primaryAction =
    openState === "draft" ? (
      <EButton size="sm" disabled={saving} onClick={() => setPending("publish")}>
        {schedules ? "Schedule…" : "Publish…"}
      </EButton>
    ) : (
      <EButton size="sm" disabled={saving || !dirty} onClick={() => void save(true, openState === "scheduled" ? "Saved. The post stays scheduled." : "Saved. The public post shows these edits now.")}>
        {saving ? "Saving…" : "Save changes"}
      </EButton>
    );

  const editorActions = (
    <div className="flex flex-wrap items-center gap-2">
      {openPost ? (
        <EButton asChild variant="outline" size="sm">
          <a href={`/v2/admin/website/blog/${openPost.id}/preview`} target="_blank" rel="noreferrer">
            Preview <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </EButton>
      ) : null}
      {openState === "draft" ? (
        <EButton variant="outline" size="sm" disabled={saving || (!dirty && Boolean(openPost))} onClick={() => void save(false, "Draft saved. It is not on the public site.")}>
          {saving ? "Saving…" : "Save draft"}
        </EButton>
      ) : (
        <EButton variant="outline" size="sm" disabled={saving} onClick={() => setPending("unpublish")}>
          Unpublish…
        </EButton>
      )}
      {primaryAction}
    </div>
  );

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <ECard className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative w-full sm:w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" aria-hidden />
            <EInput aria-label="Search posts" className="pl-9 max-sm:text-[1rem]" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title, tag or author" />
          </div>
          <EFilterChips
            label="Post state"
            active={filter}
            onChange={setFilter}
            phoneLayout="carousel"
            chips={[
              { key: "all", label: "All", count: load.status === "ready" ? counts.all : null },
              { key: "draft", label: "Drafts", count: load.status === "ready" ? counts.draft : null },
              { key: "scheduled", label: "Scheduled", count: load.status === "ready" ? counts.scheduled : null },
              { key: "published", label: "Published", count: load.status === "ready" ? counts.published : null },
            ]}
          />
          <EButton size="sm" className="ml-auto max-sm:hidden" onClick={() => open(NEW_KEY)}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New post
          </EButton>
        </div>

        {load.status === "loading" ? (
          <p role="status" className="border-t border-[hsl(var(--e-border))] px-4 py-10 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Loading posts…
          </p>
        ) : load.status === "error" ? (
          <div role="alert" className={`m-3 space-y-2 rounded-[var(--e-radius)] p-3 text-[0.8125rem] ${toneNoticeClass("problem")}`}>
            <p>{load.message}</p>
            <EButton variant="outline" size="sm" onClick={() => void loadPosts()}>Try again</EButton>
          </div>
        ) : posts.length === 0 ? (
          <p className="border-t border-[hsl(var(--e-border))] px-4 py-10 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            No posts yet. Start one with New post.
          </p>
        ) : visible.length === 0 ? (
          <p className="border-t border-[hsl(var(--e-border))] px-4 py-10 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            No posts match this search or state.
          </p>
        ) : (
          <div role="region" aria-label="Blog posts" className="overflow-x-auto border-t border-[hsl(var(--e-border))]">
            <table className="w-full text-left text-[0.8125rem]">
              <thead className="bg-[hsl(var(--e-surface-raised))] text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-muted-foreground))] max-sm:sr-only">
                <tr>
                  <th scope="col" className="px-3 py-2 font-[600]">Post</th>
                  <th scope="col" className="px-3 py-2 font-[600]">State</th>
                  <th scope="col" className="px-3 py-2 font-[600]">Date</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((post) => {
                  const state = blogPostState(post);
                  const selected = post.id === openKey;
                  const hasDraft = Boolean(drafts[post.id]) && !sameBlogForm(drafts[post.id]!, formFromPost(post, timeZone));
                  return (
                    <tr
                      key={post.id}
                      onClick={() => open(post.id)}
                      className={`cursor-pointer border-t border-[hsl(var(--e-border))] max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-2 max-sm:py-2 ${selected ? "bg-[hsl(var(--e-primary-soft))]" : "hover:bg-[hsl(var(--e-muted))]"}`}
                    >
                      <td className="px-3 py-2.5 max-sm:w-full max-sm:py-0">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[var(--e-radius-sm)] bg-[hsl(var(--e-surface-sunken))] text-center text-[0.5625rem] leading-tight text-[hsl(var(--e-muted-foreground))]">
                            {post.coverImageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={post.coverImageUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              "No cover"
                            )}
                          </span>
                          <div className="min-w-0">
                            <button
                              type="button"
                              className="text-left font-[600] text-[hsl(var(--e-foreground))] [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
                              aria-current={selected ? "true" : undefined}
                              onClick={(event) => {
                                event.stopPropagation();
                                open(post.id);
                              }}
                            >
                              {post.title}
                            </button>
                            <p className="line-clamp-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
                              {[(post.tags ?? []).join(", "), post.authorName].filter(Boolean).join(" · ")}
                              {hasDraft ? <span className="ml-1 font-[600] text-[hsl(var(--e-warning))]">· unsaved edits</span> : null}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 max-sm:px-3 max-sm:py-0">
                        <EPill tone={STATE_TONE[state]}>{BLOG_STATE_LABEL[state]}</EPill>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[0.75rem] text-[hsl(var(--e-text-secondary))] max-sm:px-0 max-sm:py-0">
                        {dateCell(post, state, timeZone)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-[hsl(var(--e-border))] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          A published post with a future publish time is Scheduled: it stays off the public site until then. Delete cannot be undone; unpublish is the safe way out.
        </p>
      </ECard>

      {!editorOpen ? (
        <ECard className="hidden min-w-0 p-6 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))] lg:block">
          Choose a post on the left, or start a new one. It opens here.
        </ECard>
      ) : null}

      <ESidePanel
        open={editorOpen}
        label="Blog post editor"
        title={form.title.trim() || (openKey === NEW_KEY ? "New post" : "Untitled post")}
        subtitle={eyebrow}
        onClose={() => open(null)}
        toolbar={editorActions}
        className="lg:static lg:top-auto lg:z-auto lg:max-h-none lg:w-auto lg:overflow-visible"
      >
        {actionError ? (
          <p role="alert" className={`rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass("problem")}`}>{actionError}</p>
        ) : null}
        {notice ? (
          <p role="status" className={`rounded-[var(--e-radius)] px-3 py-2 text-[0.8125rem] ${toneNoticeClass("good")}`}>{notice}</p>
        ) : null}
        <fieldset disabled={saving} className="min-w-0 overflow-hidden rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-0">
          <legend className="sr-only">Post</legend>
          <PostEditor key={openKey ?? "none"} form={form} setForm={setForm} timeZone={timeZone} published={openState !== "draft"} />
        </fieldset>
        {openPost ? (
          <div className="flex justify-end">
            <EButton variant="ghost" size="sm" className="text-[hsl(var(--e-danger))]" disabled={saving} onClick={() => setPending("delete")}>
              Delete post…
            </EButton>
          </div>
        ) : null}
      </ESidePanel>

      <EPhoneActionBar
        label="Blog actions"
        hidden={editorOpen}
        primary={
          <EButton onClick={() => open(NEW_KEY)}>
            <Plus className="h-4 w-4" aria-hidden /> New post
          </EButton>
        }
      />

      <EConfirmDialog
        open={pending === "publish"}
        onClose={() => setPending(null)}
        tier="ordinary"
        title={schedules ? "Schedule this post?" : "Publish this post?"}
        description={
          schedules
            ? `It stays off the public site until ${publishWhen} (organisation time), then appears on the blog by itself.`
            : "It appears on the public blog straight away."
        }
        confirmLabel={schedules ? "Schedule post" : "Publish now"}
        busy={saving}
        error={actionError ?? undefined}
        onConfirm={() => save(true, schedules ? `Scheduled. It goes public ${publishWhen}.` : "Published. It is on the public blog now.")}
      />
      <EConfirmDialog
        open={pending === "unpublish"}
        onClose={() => setPending(null)}
        tier="ordinary"
        title="Unpublish this post?"
        description="It leaves the public blog now and stays here as a draft."
        confirmLabel="Unpublish"
        busy={saving}
        error={actionError ?? undefined}
        onConfirm={() => save(false, "Unpublished. It is a draft again and not on the public site.")}
      />
      <EConfirmDialog
        open={pending === "delete"}
        onClose={() => setPending(null)}
        tier="destructive"
        title={`Delete "${openPost?.title ?? "this post"}"?`}
        description="The post is removed from the blog and from this list. This cannot be undone."
        confirmLabel="Delete post"
        busy={saving}
        error={actionError ?? undefined}
        onConfirm={() => remove()}
      />
    </div>
  );
}
