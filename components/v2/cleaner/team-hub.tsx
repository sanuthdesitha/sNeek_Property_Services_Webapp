"use client";

/**
 * Native Estate team hub — feed + recognition over the SAME endpoint the v1 hub
 * uses (`GET /api/me/workforce` → { me, posts, recognitionBoard, ... }). Renders
 * the announcement feed, the recognition wall, and QA / jobs leaderboards
 * natively in Estate. No v1 workforce / UI components are imported.
 */
import * as React from "react";
import {
  Loader2,
  Megaphone,
  Award,
  Trophy,
  Pin,
  Sparkles,
  RefreshCw,
  MessageCircle,
  GraduationCap,
  FileCheck2,
} from "lucide-react";
import { EBadge, EButton, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { EChip } from "@/components/v2/cleaner/fields";
import { ChatPanel } from "@/components/v2/cleaner/hub/chat-panel";
import { LearningPanel } from "@/components/v2/cleaner/hub/learning-panel";
import { DocumentsPanel } from "@/components/v2/cleaner/hub/documents-panel";

interface Post {
  id: string;
  title: string;
  body: string;
  type: string;
  pinned?: boolean;
  createdAt: string;
  createdBy?: { name?: string | null; role?: string | null } | null;
  seenCount?: number;
}
interface Recognition {
  id: string;
  title: string;
  message?: string | null;
  createdAt: string;
  user?: { name?: string | null; role?: string | null } | null;
  sentBy?: { name?: string | null } | null;
}
interface BoardRow {
  id: string;
  name: string | null;
  role: string;
  qaAverage: number | null;
  monthJobsCompleted?: number;
  recognitionsReceived?: number;
}

function initials(name?: string | null) {
  return (name ?? "?").trim().slice(0, 2).toUpperCase();
}
function ago(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function titleCase(v: string) {
  return v.toLowerCase().split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

type HubTab = "feed" | "chat" | "learning" | "documents" | "recognition" | "leaderboard";

export function TeamHub() {
  const [tab, setTab] = React.useState<HubTab>("feed");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<any>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/me/workforce", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load team hub");
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Could not load team hub");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Shared workforce action helper — every DM/learning/document mutation posts to
   * the SAME endpoint the v1 hub uses: `POST /api/me/workforce` with an `action`
   * field (OPEN_DIRECT_CHAT / START_LEARNING / SAVE_LEARNING_PROGRESS /
   * SUBMIT_LEARNING / RESTART_LEARNING / SIGN_DOCUMENT). Returns the JSON body.
   */
  const runAction = React.useCallback(async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/me/workforce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Action failed.");
    return json;
  }, []);

  const openDirectChat = React.useCallback(
    async (otherUserId: string): Promise<string | null> => {
      const body = await runAction({ action: "OPEN_DIRECT_CHAT", otherUserId });
      const id = body?.result?.id ?? null;
      await load();
      return id;
    },
    [runAction, load]
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  // Feed read receipts — same endpoint the v1 hub fires when the feed is viewed:
  // POST /api/admin/workforce/posts/[postId]/read for every unread post.
  const markedReadRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    if (tab !== "feed" || !data) return;
    const unread = (Array.isArray(data.posts) ? data.posts : []).filter(
      (p: any) => p.isUnread === true && !markedReadRef.current.has(p.id)
    );
    for (const p of unread) {
      markedReadRef.current.add(p.id);
      void fetch(`/api/admin/workforce/posts/${p.id}/read`, { method: "POST" }).catch(() => null);
    }
  }, [tab, data]);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (error) {
    return (
      <ECard className="border-[hsl(var(--e-danger))]">
        <ECardBody className="space-y-3 pt-6">
          <p className="text-[0.875rem] text-[hsl(var(--e-danger))]">{error}</p>
          <EButton variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" /> Retry
          </EButton>
        </ECardBody>
      </ECard>
    );
  }

  const posts: Post[] = Array.isArray(data?.posts) ? data.posts : [];
  const board = data?.recognitionBoard ?? {};
  const wall: Recognition[] = Array.isArray(board?.publicWall)
    ? board.publicWall
    : Array.isArray(board?.recentRecognitions)
      ? board.recentRecognitions
      : [];
  const spotlight: Recognition | null = board?.spotlight ?? null;
  // API shape parity with v1: recognitionBoard.leaderboard = { qa, completed, recognition }.
  const qaLeaderboard: BoardRow[] = Array.isArray(board?.leaderboard?.qa) ? board.leaderboard.qa : [];
  const completedLeaderboard: BoardRow[] = Array.isArray(board?.leaderboard?.completed)
    ? board.leaderboard.completed
    : [];
  const recognitionLeaderboard: BoardRow[] = Array.isArray(board?.leaderboard?.recognition)
    ? board.leaderboard.recognition
    : [];
  const me = data?.me ?? null;
  const myRecognitions: any[] = Array.isArray(data?.recognitions) ? data.recognitions : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <EChip active={tab === "feed"} onClick={() => setTab("feed")}>
          <span className="inline-flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5" /> Feed</span>
        </EChip>
        <EChip active={tab === "chat"} onClick={() => setTab("chat")}>
          <span className="inline-flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> Chat</span>
        </EChip>
        <EChip active={tab === "learning"} onClick={() => setTab("learning")}>
          <span className="inline-flex items-center gap-1.5"><GraduationCap className="h-3.5 w-3.5" /> Learning</span>
        </EChip>
        <EChip active={tab === "documents"} onClick={() => setTab("documents")}>
          <span className="inline-flex items-center gap-1.5"><FileCheck2 className="h-3.5 w-3.5" /> Documents</span>
        </EChip>
        <EChip active={tab === "recognition"} onClick={() => setTab("recognition")}>
          <span className="inline-flex items-center gap-1.5"><Award className="h-3.5 w-3.5" /> Recognition</span>
        </EChip>
        <EChip active={tab === "leaderboard"} onClick={() => setTab("leaderboard")}>
          <span className="inline-flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" /> Leaderboard</span>
        </EChip>
      </div>

      {tab === "feed" ? (
        posts.length === 0 ? (
          <EEmptyState eyebrow="Quiet" title="No team updates yet" description="Announcements and updates will show here." />
        ) : (
          <div className="space-y-3">
            {posts.map((p) => (
              <ECard key={p.id} variant={p.pinned ? "ceremony" : "default"}>
                <ECardBody className="space-y-2 pt-6">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {p.pinned ? <Pin className="h-3.5 w-3.5 text-[hsl(var(--e-gold-ink))]" /> : null}
                      <EBadge tone={p.type === "RECOGNITION" ? "gold" : "info"} soft>
                        {titleCase(p.type || "UPDATE")}
                      </EBadge>
                    </div>
                    <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">{ago(p.createdAt)}</span>
                  </div>
                  <p className="text-[0.9375rem] font-[550]">{p.title}</p>
                  <p className="whitespace-pre-wrap text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{p.body}</p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {p.createdBy?.name || "Team"}
                    {p.seenCount ? ` · ${p.seenCount} seen` : ""}
                  </p>
                </ECardBody>
              </ECard>
            ))}
          </div>
        )
      ) : null}

      {tab === "chat" ? (
        <ChatPanel
          channels={Array.isArray(data?.channels) ? data.channels : []}
          directory={Array.isArray(data?.directory) ? data.directory : []}
          myUserId={data?.me?.id ?? null}
          onOpenDirectChat={openDirectChat}
        />
      ) : null}

      {tab === "learning" ? (
        <LearningPanel
          assignments={Array.isArray(data?.assignments) ? data.assignments : []}
          runAction={runAction}
          reload={load}
        />
      ) : null}

      {tab === "documents" ? (
        <DocumentsPanel
          documents={Array.isArray(data?.documents) ? data.documents : []}
          documentRequests={Array.isArray(data?.documentRequests) ? data.documentRequests : []}
          runAction={runAction}
          reload={load}
        />
      ) : null}

      {tab === "recognition" ? (
        <div className="space-y-3">
          {/* Your recognition stats — QA average, month jobs, shout-outs (v1 parity) */}
          {me ? (
            <div className="grid grid-cols-3 gap-3">
              <ECard>
                <ECardBody className="pt-6 text-center">
                  <p className="e-eyebrow">QA average</p>
                  <p className="mt-1 text-[1.25rem] font-[600] tabular-nums">
                    {me.qaAverage != null ? `${me.qaAverage}%` : "—"}
                  </p>
                </ECardBody>
              </ECard>
              <ECard>
                <ECardBody className="pt-6 text-center">
                  <p className="e-eyebrow">Jobs this month</p>
                  <p className="mt-1 text-[1.25rem] font-[600] tabular-nums">{me.monthJobsCompleted ?? 0}</p>
                </ECardBody>
              </ECard>
              <ECard>
                <ECardBody className="pt-6 text-center">
                  <p className="e-eyebrow">Shout-outs</p>
                  <p className="mt-1 text-[1.25rem] font-[600] tabular-nums">{me.publicRecognitionCount ?? 0}</p>
                </ECardBody>
              </ECard>
            </div>
          ) : null}

          {/* Recognition sent to YOU — badge history from admin */}
          {myRecognitions.length > 0 ? (
            <ECard>
              <ECardBody className="space-y-3 pt-6">
                <p className="e-eyebrow flex items-center gap-1.5">
                  <Award className="h-3.5 w-3.5" /> Your recognition
                </p>
                {myRecognitions.map((r: any) => (
                  <div key={r.id} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[0.875rem] font-[550]">{r.title}</p>
                      {r.badgeKey ? (
                        <EBadge tone="gold" soft>
                          <span className="inline-flex items-center gap-1">
                            <Sparkles className="h-3 w-3" /> {titleCase(String(r.badgeKey))}
                          </span>
                        </EBadge>
                      ) : null}
                    </div>
                    {r.message ? (
                      <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{r.message}</p>
                    ) : null}
                    <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">{ago(r.createdAt)}</p>
                  </div>
                ))}
              </ECardBody>
            </ECard>
          ) : null}

          {spotlight ? (
            <ECard variant="ceremony">
              <ECardBody className="space-y-2 pt-6">
                <p className="e-eyebrow flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> Spotlight</p>
                <p className="text-[0.9375rem] font-[550]">
                  {spotlight.user?.name} — {spotlight.title}
                </p>
                {spotlight.message ? (
                  <p className="text-[0.875rem] text-[hsl(var(--e-text-secondary))]">{spotlight.message}</p>
                ) : null}
              </ECardBody>
            </ECard>
          ) : null}
          {wall.length === 0 ? (
            <EEmptyState eyebrow="Coming soon" title="No recognition yet" description="Kudos from the team will appear here." />
          ) : (
            wall.map((r) => (
              <ECard key={r.id}>
                <ECardBody className="flex items-start gap-3 pt-6">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-gold-soft))] text-[0.8125rem] font-semibold text-[hsl(var(--e-gold-ink))]">
                    {initials(r.user?.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.875rem] font-[550]">
                      {r.user?.name} <span className="font-normal text-[hsl(var(--e-muted-foreground))]">· {r.title}</span>
                    </p>
                    {r.message ? (
                      <p className="mt-0.5 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{r.message}</p>
                    ) : null}
                    <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                      {r.sentBy?.name ? `From ${r.sentBy.name} · ` : ""}
                      {ago(r.createdAt)}
                    </p>
                  </div>
                </ECardBody>
              </ECard>
            ))
          )}
        </div>
      ) : null}

      {tab === "leaderboard" ? (
        <div className="space-y-4">
          <LeaderboardCard title="QA average" rows={qaLeaderboard} metric={(r) => (r.qaAverage != null ? `${r.qaAverage}%` : "—")} />
          <LeaderboardCard
            title="Jobs this month"
            rows={completedLeaderboard}
            metric={(r) => String(r.monthJobsCompleted ?? 0)}
          />
          <LeaderboardCard
            title="Most recognised"
            rows={recognitionLeaderboard}
            metric={(r) => String(r.recognitionsReceived ?? 0)}
          />
        </div>
      ) : null}
    </div>
  );
}

function LeaderboardCard({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: BoardRow[];
  metric: (r: BoardRow) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <ECard>
      <ECardBody className="space-y-3 pt-6">
        <p className="e-eyebrow flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" /> {title}</p>
        {rows.map((r, i) => (
          <div key={r.id} className="flex items-center gap-3">
            <span className="w-5 text-center font-serif text-[0.9375rem] text-[hsl(var(--e-gold-ink))]">{i + 1}</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--e-surface-raised))] text-[0.75rem] font-semibold">
              {initials(r.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.875rem] font-[550]">{r.name || "Team member"}</p>
              <p className="text-[0.6875rem] uppercase tracking-[0.06em] text-[hsl(var(--e-text-faint))]">
                {titleCase(r.role)}
              </p>
            </div>
            <span className="text-[0.9375rem] font-[550] tabular-nums">{metric(r)}</span>
          </div>
        ))}
      </ECardBody>
    </ECard>
  );
}
