"use client";

/**
 * Native Estate laundry team hub — feed + recognition + leaderboards over the
 * SAME endpoint the v1 workforce hub uses (`GET /api/me/workforce`, backed by
 * `getStaffWorkforceOverview`). Mirrors the cleaner team-hub pattern
 * (`components/v2/cleaner/team-hub.tsx`) but is laundry-owned and reads the
 * ACTUAL recognitionBoard shape returned by the service:
 *   board.publicWall / board.recentRecognitions   → recognition wall
 *   board.spotlight                                → spotlight card
 *   board.leaderboard.qa / board.leaderboard.completed → leaderboards
 *
 * Zero imports from v1 (`@/components/{workforce,ui,shared,...}`), only the v2
 * Estate kit + lucide + `hsl(var(--e-*))` tokens.
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EBadge, EButton, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";

/* ── Local chip (laundry-owned; no shared field imports) ───────────────── */
function EChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[var(--e-radius-pill)] border px-3 py-1 text-[0.75rem] font-[550] tracking-[0.02em] transition-colors duration-[160ms]",
        active
          ? "border-[hsl(var(--e-primary))] bg-[hsl(var(--e-primary-soft))] text-[hsl(var(--e-foreground))]"
          : "border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-muted-foreground))] hover:text-[hsl(var(--e-foreground))]"
      )}
    >
      {children}
    </button>
  );
}

/* ── Types (mirror the /api/me/workforce payload) ──────────────────────── */
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
  qaAverage?: number | null;
  monthJobsCompleted?: number;
  recognitionsReceived?: number;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */
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

export function LaundryTeamHub() {
  const [tab, setTab] = React.useState<"feed" | "recognition" | "leaderboard">("feed");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<any>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/me/workforce", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load team hub");
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Could not load team hub");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

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
  // The service returns leaderboards under board.leaderboard.{qa,completed}.
  const qaLeaderboard: BoardRow[] = Array.isArray(board?.leaderboard?.qa)
    ? board.leaderboard.qa
    : Array.isArray(board?.qaLeaderboard)
      ? board.qaLeaderboard
      : [];
  const completedLeaderboard: BoardRow[] = Array.isArray(board?.leaderboard?.completed)
    ? board.leaderboard.completed
    : Array.isArray(board?.completedLeaderboard)
      ? board.completedLeaderboard
      : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <EChip active={tab === "feed"} onClick={() => setTab("feed")}>
            <span className="inline-flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5" /> Feed</span>
          </EChip>
          <EChip active={tab === "recognition"} onClick={() => setTab("recognition")}>
            <span className="inline-flex items-center gap-1.5"><Award className="h-3.5 w-3.5" /> Recognition</span>
          </EChip>
          <EChip active={tab === "leaderboard"} onClick={() => setTab("leaderboard")}>
            <span className="inline-flex items-center gap-1.5"><Trophy className="h-3.5 w-3.5" /> Leaderboard</span>
          </EChip>
        </div>
        <EButton variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </EButton>
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

      {tab === "recognition" ? (
        <div className="space-y-3">
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
        qaLeaderboard.length === 0 && completedLeaderboard.length === 0 ? (
          <EEmptyState eyebrow="Coming soon" title="No leaderboard data yet" description="Rankings appear once QA scores and completed jobs are in." />
        ) : (
          <div className="space-y-4">
            <LeaderboardCard
              title="QA average"
              rows={qaLeaderboard}
              metric={(r) => (r.qaAverage != null ? `${r.qaAverage}%` : "—")}
            />
            <LeaderboardCard
              title="Jobs this month"
              rows={completedLeaderboard}
              metric={(r) => String(r.monthJobsCompleted ?? 0)}
            />
          </div>
        )
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
