"use client";

/**
 * Marketing › Social posts (2026-11-17): the post list ("Posts") and the
 * generator ("Create from jobs") as two views of the same tab. The old link
 * /v2/admin/marketing?tab=social still opens the list; &view=create opens the
 * generator (&group=<id> a saved draft).
 */
import * as React from "react";
import { ExternalLink } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EToneCard } from "@/components/v2/ui/tone-band";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { networkDefinition, networkResultView, isSocialNetwork } from "@/lib/marketing/social/networks";
import { formatOrgDateTime } from "@/lib/public-site/zoned-time";
import type { SocialPostRow } from "@/lib/marketing/workspace-types";
import { SocialManager } from "@/components/v2/admin/marketing/social-manager";
import { SocialGenerator } from "./social-generator";
import { readGeneratorParams, socialRequest, SOCIAL_API, writeGeneratorParams } from "./social-api";
import { cn } from "@/lib/utils";

export type SocialGroupRow = {
  id: string;
  title: string;
  format: string;
  status: string;
  createdVia: string;
  createdAt: string;
  plannedFor: string | null;
  posts: Array<{ postId: string; network: string; status: string; deliveryMode: string | null; externalUrl: string | null; externalId: string | null; scheduledFor: string | null; removalNeededAt: string | null; removalDoneAt: string | null }>;
};

type Toast = { title: string; description?: string; tone: "success" | "danger" };

const TONE_PILL: Record<string, EPillTone> = { good: "ok", attention: "warn", problem: "bad", neutral: "neutral" };

function GroupsList({ groups, timeZone, onOpen, onRemoved }: { groups: SocialGroupRow[]; timeZone: string; onOpen: (id: string) => void; onRemoved: (postId: string) => Promise<void> }) {
  const removals = groups.flatMap((group) => group.posts.filter((post) => post.removalNeededAt && !post.removalDoneAt).map((post) => ({ group, post })));
  return (
    <div className="space-y-3">
      {removals.length ? (
        <EToneCard tone="problem" header={<h3 className="text-[0.875rem] font-[600]">Posts to take down</h3>} pill={`${removals.length} waiting`}>
          <p className="mb-2 text-[0.8125rem]">An owner revoked their permission. Remove each post on the network yourself, then mark it done. sNeek does not delete posts on networks.</p>
          <ul className="space-y-2">
            {removals.map(({ group, post }) => (
              <li key={post.postId} className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{isSocialNetwork(post.network) ? networkDefinition(post.network).label : post.network}: {group.title}</span>
                {post.externalUrl ? <a className="inline-flex min-h-9 items-center gap-1 underline" href={post.externalUrl} target="_blank" rel="noopener noreferrer">Open post <ExternalLink className="h-3 w-3" aria-hidden /></a> : <span className="text-[hsl(var(--e-muted-foreground))]">link not recorded</span>}
                <EButton size="sm" variant="outline" onClick={() => void onRemoved(post.postId)}>Mark removed</EButton>
              </li>
            ))}
          </ul>
        </EToneCard>
      ) : null}
      <ECard className="space-y-3 p-4">
        <h3 className="text-[0.9375rem] font-[600]">Posts made from jobs</h3>
        {groups.length === 0 ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">None yet. Use &quot;Create from jobs&quot;.</p> : null}
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.id} className="space-y-1.5 border-b border-[hsl(var(--e-border))] pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <button type="button" className="min-h-9 text-left text-[0.875rem] font-[600] underline-offset-2 hover:underline [overflow-wrap:anywhere]" onClick={() => onOpen(group.id)}>{group.title}</button>
                <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{group.format.toLowerCase().replace("_", " ")} · {formatOrgDateTime(group.createdAt, timeZone)}{group.createdVia === "AGENT" ? " · drafted by an agent" : ""}{group.plannedFor ? ` · planned ${formatOrgDateTime(group.plannedFor, timeZone)}` : ""}</span>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {group.posts.filter((post) => isSocialNetwork(post.network)).map((post) => {
                  const view = networkResultView(post);
                  return (
                    <li key={post.postId} className="inline-flex items-center gap-1 text-[0.75rem]">
                      <span aria-hidden className="font-[700]">{networkDefinition(post.network as never).mark}</span>
                      <EPill tone={TONE_PILL[view.tone]}>{post.status === "DRAFT" && !post.deliveryMode ? "Draft" : view.label}</EPill>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </ECard>
    </div>
  );
}

export function SocialTab({ initialPosts, initialGroups, onToast, timeZone }: { initialPosts: SocialPostRow[]; initialGroups: SocialGroupRow[] | null; onToast: (toast: Toast) => void; timeZone: string }) {
  const [view, setView] = React.useState<"list" | "create">("list");
  const [groupId, setGroupId] = React.useState<string | null>(null);
  const [groups, setGroups] = React.useState<SocialGroupRow[] | null>(initialGroups);
  const [groupsError, setGroupsError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const params = readGeneratorParams();
    setView(params.view);
    setGroupId(params.group);
  }, []);

  async function refreshGroups() {
    const result = await socialRequest<{ groups: SocialGroupRow[] }>(`${SOCIAL_API}/groups`);
    if (result.ok) {
      setGroups(result.data.groups);
      setGroupsError(null);
    } else setGroupsError(result.error);
  }

  function choose(next: "list" | "create", id: string | null = null) {
    setView(next);
    setGroupId(id);
    writeGeneratorParams(next, id);
    if (next === "list") void refreshGroups();
  }

  const count = (groups?.length ?? 0) + initialPosts.filter((post) => post.status !== "CANCELLED").length;

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Social posts view" className="flex gap-1.5">
          <button type="button" className={cn(E_CHIP_CLASS, view === "list" && E_CHIP_ON_CLASS)} aria-pressed={view === "list"} onClick={() => choose("list")}>Posts <span className="ml-1 e-tnum">{count}</span></button>
          <button type="button" className={cn(E_CHIP_CLASS, view === "create" && E_CHIP_ON_CLASS)} aria-pressed={view === "create"} onClick={() => choose("create", groupId)}>Create from jobs</button>
        </div>
        <EButton asChild variant="outline" size="sm"><a href="/v2/admin/marketing/social-accounts">Social accounts and permissions</a></EButton>
      </div>
      {view === "create" ? (
        <SocialGenerator key={groupId ?? "new"} initialGroupId={groupId} timeZone={timeZone} onClose={() => choose("list")} />
      ) : (
        <div className="space-y-4">
          {groupsError ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Posts made from jobs could not be loaded: {groupsError}</p> : null}
          {groups ? (
            <GroupsList
              groups={groups}
              timeZone={timeZone}
              onOpen={(id) => choose("create", id)}
              onRemoved={async (postId) => {
                const result = await socialRequest(`${SOCIAL_API}/posts/${postId}/removed`, { method: "POST" });
                if (!result.ok) onToast({ title: "Not marked", description: result.error, tone: "danger" });
                await refreshGroups();
              }}
            />
          ) : !groupsError ? <p role="alert" className="text-[0.8125rem]">Posts made from jobs could not be loaded. Reload the page to try again.</p> : null}
          <SocialManager initialPosts={initialPosts} onToast={onToast} timeZone={timeZone} />
        </div>
      )}
    </div>
  );
}
