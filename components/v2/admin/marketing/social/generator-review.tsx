"use client";

/**
 * Step 4 of the social post generator (2026-11-17): review and post. sNeek
 * posts only when a person clicks (a tier A confirmation naming every
 * destination) or at a time a person planned, and reports "Posted" only
 * when the network confirms it with a post id. Networks that are not
 * connected use the fallback: download the cleaned copies, copy the caption,
 * open the network, then paste the link back ("Posted by you").
 */
import * as React from "react";
import { Check, ExternalLink, TriangleAlert } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { EToneCard, EToneNotice } from "@/components/v2/ui/tone-band";
import { captionProblems, finalCaption } from "@/lib/marketing/social/captions";
import { networkDefinition, networkResultView, SOCIAL_NETWORKS, type SocialNetwork } from "@/lib/marketing/social/networks";
import type { AccountView, GroupView, NetworkPostView, PublishResultRow } from "@/lib/marketing/social/view-types";
import { formatOrgDateTime, zonedInputToIso } from "@/lib/public-site/zoned-time";
import { copyText, socialRequest, SOCIAL_API } from "./social-api";

export type AccountsLoad = { state: "loading" } | { state: "failed"; message: string } | { state: "ready"; accounts: AccountView[]; publicProblem: string | null; stubbed: boolean };

const TONE_PILL: Record<string, EPillTone> = { good: "ok", attention: "warn", problem: "bad", neutral: "neutral" };

function accountFor(accounts: AccountView[], network: SocialNetwork): AccountView | null {
  return accounts.find((account) => account.network === network && account.status !== "DISCONNECTED") ?? null;
}

type Check = { ok: boolean; text: string };

function serverChecks(group: GroupView, networks: SocialNetwork[], dirty: boolean, timeZone: string): Check[] {
  const checks: Check[] = [];
  const refused = group.photos.filter((photo) => photo.refusal);
  const names = Array.from(new Set(group.photos.map((photo) => photo.propertyName))).join(", ");
  checks.push(refused.length ? { ok: false, text: `A photo can no longer be used: ${refused[0].refusal}` } : { ok: true, text: `Permission still recorded for ${names}. Checked again at the moment of posting.` });
  checks.push(group.derivatives.length ? { ok: true, text: `${group.derivatives.length} cleaned cop${group.derivatives.length === 1 ? "y" : "ies"} made: stamp band cut off, camera and location data removed.` } : { ok: true, text: "The cleaned copies are made when you post (or in step 2)." });
  checks.push(group.reviewedAt ? { ok: true, text: `${group.reviewedByName ?? "You"} ticked "I looked at every photo" at ${formatOrgDateTime(group.reviewedAt, timeZone)}.` } : { ok: false, text: "Tick \"I looked at every photo\" (step 1, or below). Posting stays off until then." });
  const before = group.photos.find((photo) => photo.role === "BEFORE");
  if (before && !before.beforeCheckedAt) checks.push({ ok: false, text: "Tick \"I checked the before photo\" in step 2." });
  const missingAlt = group.photos.findIndex((photo) => !photo.altText.trim());
  checks.push(missingAlt >= 0 ? { ok: false, text: `Alt text missing on photo ${missingAlt + 1}. Posting stays off until it is written.` } : { ok: true, text: "Alt text written for every photo." });
  const problems = networks.flatMap((network) => {
    const post = group.posts.find((row) => row.network === network);
    return post ? captionProblems(network, post.caption, post.hashtags) : [];
  });
  checks.push(problems.length ? { ok: false, text: problems.join(" ") } : { ok: true, text: `Captions within limits: ${networks.map((network) => { const post = group.posts.find((row) => row.network === network); return post ? `${networkDefinition(network).label} ${finalCaption(network, post.caption, post.hashtags).length.toLocaleString("en-AU")}/${networkDefinition(network).captionLimit.toLocaleString("en-AU")}` : ""; }).join(" · ")}.` });
  if (dirty) checks.push({ ok: false, text: "Save your caption and alt text changes in step 3 first." });
  return checks;
}

function ResultRow({ post, message, onFallback, onLink, onRetry, busy }: {
  post: NetworkPostView;
  message: string | null;
  onFallback: () => void;
  onLink: (url: string) => Promise<string | null>;
  onRetry: (confirmNotPosted: boolean) => void;
  busy: boolean;
}) {
  const definition = networkDefinition(post.network);
  const view = networkResultView(post);
  const [link, setLink] = React.useState("");
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const manual = post.status === "DRAFT" || (post.status === "SCHEDULED" && post.deliveryMode === "MANUAL") || (post.status === "FAILED" && post.deliveryMode !== "API");
  const tone = view.tone === "problem" ? "problem" : view.tone === "attention" ? "attention" : view.tone === "good" ? "good" : null;
  return (
    <EToneCard
      tone={tone}
      header={<p className="text-[0.8125rem] font-[600]"><span aria-hidden className="mr-1.5 font-[700]">{definition.mark}</span>{definition.label}</p>}
      pill={<EPill tone={TONE_PILL[view.tone]}>{post.status === "DRAFT" && !post.deliveryMode ? "Not sent" : view.label}</EPill>}
    >
      <div className="space-y-2 text-[0.8125rem]">
        {post.status === "PUBLISHED" ? (
          <p>{post.deliveryMode === "API" ? `${definition.label} confirmed post ${post.externalId?.slice(0, 14) ?? ""}${(post.externalId?.length ?? 0) > 14 ? "…" : ""}` : "Posted by you"}{post.externalUrl ? <> · <a className="inline-flex items-center gap-1 underline" href={post.externalUrl} target="_blank" rel="noopener noreferrer">View post <ExternalLink className="h-3 w-3" aria-hidden /></a></> : " · link not returned"}</p>
        ) : null}
        {post.status === "PUBLISHED" ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Reach {post.metrics?.reach ?? "not recorded"} · likes {post.metrics?.likes ?? "not recorded"}</p> : null}
        {post.status === "FAILED" || post.status === "UNCONFIRMED" ? <p className="[overflow-wrap:anywhere]">{post.failureReason ?? message ?? "No reason was recorded."}</p> : null}
        {message && post.status !== "FAILED" && post.status !== "UNCONFIRMED" && post.status !== "PUBLISHED" ? <p className="text-[0.75rem] [overflow-wrap:anywhere]">{message}</p> : null}
        {post.removalNeededAt && !post.removalDoneAt ? <p className="font-[600]">Permission was revoked: remove this post on {definition.label} yourself, then mark it done in Social posts.</p> : null}
        {post.status === "FAILED" && post.deliveryMode === "API" ? <EButton size="sm" variant="outline" disabled={busy} onClick={() => onRetry(false)}>Retry {definition.label}</EButton> : null}
        {post.status === "UNCONFIRMED" ? <EButton size="sm" variant="outline" disabled={busy} onClick={() => onRetry(true)}>I checked: it is not there. Retry</EButton> : null}
        {manual ? (
          <div className="space-y-2">
            <EButton size="sm" variant="outline" onClick={onFallback}>Download images + copy caption</EButton>
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor={`link-${post.postId}`}>Link to the {definition.label} post</label>
              <input id={`link-${post.postId}`} type="url" placeholder="Paste the post link (https://…)" value={link} onChange={(event) => setLink(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 text-[0.8125rem] max-sm:text-[1rem]" />
              <EButton size="sm" variant="outline" disabled={!link.trim()} onClick={async () => setLinkError(await onLink(link.trim()))}>Save link</EButton>
            </div>
            {linkError ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{linkError}</p> : null}
          </div>
        ) : null}
      </div>
    </EToneCard>
  );
}

export function GeneratorReview({
  group, accounts, dirty, timeZone, onGroup, onError,
}: {
  group: GroupView;
  accounts: AccountsLoad;
  dirty: boolean;
  timeZone: string;
  onGroup: (group: GroupView) => void;
  onError: (message: string) => void;
}) {
  const ready = accounts.state === "ready" ? accounts : null;
  const connected = (network: SocialNetwork) => Boolean(ready && networkDefinition(network).apiState === "api" && accountFor(ready.accounts, network)?.status === "CONNECTED");
  const [chosen, setChosen] = React.useState<SocialNetwork[]>([]);
  React.useEffect(() => {
    if (ready) setChosen(SOCIAL_NETWORKS.filter((network) => network.apiState === "api" && Boolean(accountFor(ready.accounts, network.key)?.status === "CONNECTED")).map((network) => network.key));
  }, [ready]);
  const [when, setWhen] = React.useState<"now" | "plan">(group.plannedFor ? "plan" : "now");
  const [plannedAt, setPlannedAt] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [refusal, setRefusal] = React.useState<{ message: string; problems: string[] } | null>(null);
  const [results, setResults] = React.useState<{ at: string; rows: PublishResultRow[] } | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const allNetworks = SOCIAL_NETWORKS.map((network) => network.key);
  const checks = serverChecks(group, chosen.length ? chosen : allNetworks, dirty, timeZone);
  const blocked = checks.some((check) => !check.ok);
  const posted = group.posts.some((post) => ["PUBLISHED", "SENT_TO_INBOX", "UNCONFIRMED", "SENDING"].includes(post.status) && post.deliveryMode === "API");
  const notSent = SOCIAL_NETWORKS.filter((network) => !chosen.includes(network.key)).map((network) => network.label);

  async function publish(networks: SocialNetwork[], options: { retry?: boolean; confirmNotPosted?: boolean } = {}) {
    setBusy(true);
    setRefusal(null);
    const result = await socialRequest<{ results: PublishResultRow[]; group: GroupView }>(`${SOCIAL_API}/groups/${group.id}/publish`, { method: "POST", body: { networks, ...options } });
    setBusy(false);
    if (!result.ok) {
      setRefusal({ message: result.error, problems: result.problems });
      return false;
    }
    setResults({ at: new Date().toISOString(), rows: result.data.results });
    onGroup(result.data.group);
    return true;
  }

  async function tick(value: boolean) {
    if (!value) return;
    setBusy(true);
    const result = await socialRequest<{ group: GroupView }>(`${SOCIAL_API}/groups/${group.id}/review`, { method: "POST", body: { expectedRevision: group.revision, reviewed: true } });
    setBusy(false);
    if (!result.ok) {
      setRefusal({ message: result.error, problems: [] });
      return;
    }
    onGroup(result.data.group);
  }

  async function plan(clear: boolean) {
    const iso = clear ? null : zonedInputToIso(plannedAt, timeZone);
    if (!clear && !iso) {
      setRefusal({ message: "Choose the date and time to post.", problems: [] });
      return;
    }
    setBusy(true);
    setRefusal(null);
    const result = await socialRequest<{ group: GroupView; plan: Array<{ network: SocialNetwork; mode: string }> }>(`${SOCIAL_API}/groups/${group.id}/plan`, { method: "POST", body: { plannedFor: iso, networks: allNetworks } });
    setBusy(false);
    if (!result.ok) {
      setRefusal({ message: result.error, problems: result.problems });
      return;
    }
    onGroup(result.data.group);
    setNotice(clear ? "The plan was cleared. Nothing will be posted by itself." : `Planned for ${formatOrgDateTime(iso!, timeZone)}. Connected networks are posted then, after the checks run again; the others wait for your link.`);
  }

  async function fallback(network: SocialNetwork) {
    const definition = networkDefinition(network);
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    const post = group.posts.find((row) => row.network === network);
    if (!group.derivatives.length) {
      const made = await socialRequest<{ group: GroupView }>(`${SOCIAL_API}/groups/${group.id}/derivatives`, { method: "POST" });
      if (!made.ok) {
        tab?.close();
        onError(`${made.error} ${made.problems.join(" ")}`.trim());
        return;
      }
      onGroup(made.data.group);
    }
    const anchor = document.createElement("a");
    anchor.href = `${SOCIAL_API}/groups/${group.id}/download`;
    anchor.download = "sneek-social-post.zip";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    const copied = post ? await copyText(finalCaption(network, post.caption, post.hashtags)) : false;
    if (tab) tab.location.href = definition.openUrl;
    setNotice(`${definition.label}: the cleaned copies are downloading${copied ? " and the caption is on your clipboard" : "; the caption could not be copied, select it in step 3"}. Post it there, then paste the link here.`);
  }

  async function saveLink(post: NetworkPostView, url: string): Promise<string | null> {
    const result = await socialRequest(`${SOCIAL_API}/posts/${post.postId}/link`, { method: "POST", body: { url } });
    if (!result.ok) return result.error;
    const refreshed = await socialRequest<{ group: GroupView }>(`${SOCIAL_API}/groups/${group.id}`);
    if (refreshed.ok) onGroup(refreshed.data.group);
    return null;
  }

  const resultMessage = (network: SocialNetwork) => results?.rows.find((row) => row.network === network)?.message ?? null;
  const showResults = Boolean(results) || group.posts.some((post) => post.status !== "DRAFT" || post.deliveryMode);

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <ECard className="min-w-0 space-y-2 p-4">
          <h3 className="text-[0.875rem] font-[600]">Checked again on the server when you click</h3>
          <ul className="space-y-1.5 text-[0.8125rem]">
            {checks.map((check) => (
              <li key={check.text} className="flex gap-2">
                {check.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-success))]" aria-label="Done" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--e-danger))]" aria-label="Needs you" />}
                <span className="[overflow-wrap:anywhere]">{check.text}</span>
              </li>
            ))}
          </ul>
          {!group.reviewedAt && !posted ? (
            <label className="flex min-h-11 items-start gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-[0.8125rem]">
              <input type="checkbox" className="mt-1 h-4 w-4" disabled={busy} onChange={(event) => void tick(event.target.checked)} />
              <span>I looked at every photo: no faces, guest belongings, mail, screens, plates or street numbers. sNeek cannot detect them.</span>
            </label>
          ) : null}
          <fieldset disabled={busy || posted} className="space-y-2 pt-2">
            <legend className="text-[0.8125rem] font-[600]">When</legend>
            <div className="flex flex-wrap gap-3 text-[0.8125rem]">
              <label className="flex min-h-11 items-center gap-2"><input type="radio" name="social-when" checked={when === "now"} onChange={() => setWhen("now")} /> Post now</label>
              <label className="flex min-h-11 items-center gap-2"><input type="radio" name="social-when" checked={when === "plan"} onChange={() => setWhen("plan")} /> Plan for a time</label>
            </div>
            {when === "plan" ? (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[0.75rem]">Date and time ({timeZone})
                  <input type="datetime-local" value={plannedAt} onChange={(event) => setPlannedAt(event.target.value)} className="mt-1 block min-h-11 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-2 max-sm:text-[1rem]" />
                </label>
                <EButton size="sm" variant="outline" disabled={blocked || !plannedAt} onClick={() => void plan(false)}>Plan this post</EButton>
                {group.plannedFor ? <EButton size="sm" variant="ghost" onClick={() => void plan(true)}>Clear the plan ({formatOrgDateTime(group.plannedFor, timeZone)})</EButton> : null}
              </div>
            ) : null}
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">A planned post is posted by sNeek at that time only for connected networks; it is checked again then, and fails with a reason (never silently) if permission was revoked. You get the result in your inbox.</p>
          </fieldset>
        </ECard>

        <ECard className="min-w-0 space-y-2 p-4">
          <h3 className="text-[0.875rem] font-[600]">What goes where</h3>
          {accounts.state === "loading" ? <p role="status" className="text-[0.8125rem]">Loading connected accounts…</p> : null}
          {accounts.state === "failed" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">Connected accounts could not be loaded: {accounts.message} Nothing can be posted until they load.</p> : null}
          {ready?.stubbed ? <EToneNotice tone="info">Local inspection: the network layer is a stand-in (no real network is contacted).</EToneNotice> : null}
          {ready?.publicProblem && !ready.stubbed ? <EToneNotice tone="attention">{ready.publicProblem}</EToneNotice> : null}
          <ul className="space-y-2">
            {SOCIAL_NETWORKS.map((network) => {
              const account = ready ? accountFor(ready.accounts, network.key) : null;
              const isConnected = connected(network.key);
              const post = group.posts.find((row) => row.network === network.key);
              return (
                <li key={network.key} className="flex items-start gap-2 text-[0.8125rem]">
                  {isConnected ? (
                    <input type="checkbox" aria-label={`Post to ${network.label}`} className="mt-1 h-4 w-4" disabled={posted} checked={chosen.includes(network.key)} onChange={(event) => setChosen((current) => (event.target.checked ? [...current, network.key] : current.filter((key) => key !== network.key)))} />
                  ) : <span aria-hidden className="mt-0.5 w-4 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block font-[600]"><span aria-hidden className="mr-1 font-[700]">{network.mark}</span>{network.label}{account ? ` ${account.displayName}` : ""}</span>
                    <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {isConnected
                        ? `${group.photos.length > 1 && group.format !== "BEFORE_AFTER" ? `${Math.min(group.photos.length, network.maxImages)} photos` : "1 photo"}, caption${post?.hashtags.length && network.usesHashtags ? `, ${post.hashtags.length} hashtags` : ""}, alt text on each`
                        : account?.status === "NEEDS_RECONNECT" ? `Needs reconnecting: ${account.statusReason ?? ""} Fallback below.` : network.whyNot ? `Not connected: ${network.whyNot}` : "Not connected. Fallback below."}
                    </span>
                  </span>
                  <EPill tone={isConnected ? "ok" : "neutral"}>{isConnected ? "Connected" : "Download"}</EPill>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1 max-sm:hidden">
            <EButton disabled={blocked || busy || posted || chosen.length === 0 || when !== "now"} onClick={() => setConfirming(true)}>Post to {chosen.length} network{chosen.length === 1 ? "" : "s"}…</EButton>
          </div>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">&quot;Download images + copy caption&quot; saves the cleaned copies as a zip, copies that network&apos;s caption and opens the network in a new tab. Then paste the post link back so the post is recorded.</p>
        </ECard>
      </div>

      {refusal ? (
        <EToneNotice tone="problem" role="alert" title={`Not posted: ${refusal.message}`}>
          {refusal.problems.length ? <ul className="list-disc pl-4">{refusal.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
          <p className="mt-1">Nothing was sent. Your draft is kept.</p>
        </EToneNotice>
      ) : null}
      {notice ? <p role="status" className="text-[0.8125rem]">{notice}</p> : null}

      {showResults ? (
        <section aria-labelledby="social-results-heading" className="space-y-2">
          <h3 id="social-results-heading" className="font-serif text-[1.125rem]">
            {results ? `Results, ${formatOrgDateTime(results.at, timeZone)}: ${results.rows.filter((row) => row.outcome === "POSTED").length} posted, ${results.rows.filter((row) => row.outcome !== "POSTED").length} waiting for you` : "Each network"}
          </h3>
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {group.posts.map((post) => (
              <li key={post.postId}>
                <ResultRow post={post} message={resultMessage(post.network)} busy={busy} onFallback={() => void fallback(post.network)} onLink={(url) => saveLink(post, url)} onRetry={(confirmNotPosted) => void publish([post.network], { retry: true, confirmNotPosted })} />
              </li>
            ))}
          </ul>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">A result says exactly what the network answered. &quot;Not confirmed&quot; means sNeek sent it but the answer never came: check the network before retrying. Retry sends only that network, once.</p>
        </section>
      ) : null}

      <div className="sm:hidden">
        <EButton className="w-full" disabled={blocked || busy || posted || chosen.length === 0 || when !== "now"} onClick={() => setConfirming(true)}>Post to {chosen.length} network{chosen.length === 1 ? "" : "s"}…</EButton>
      </div>

      <EConfirmDialog
        open={confirming}
        onClose={() => (busy ? undefined : setConfirming(false))}
        tier="ordinary"
        title={`Post to ${chosen.length} network${chosen.length === 1 ? "" : "s"} now?`}
        description={
          <div className="space-y-1.5">
            {chosen.map((network) => {
              const account = ready ? accountFor(ready.accounts, network) : null;
              const post = group.posts.find((row) => row.network === network);
              const count = group.format === "BEFORE_AFTER" && group.splitLayout !== "SLIDES" ? 1 : Math.min(group.photos.length, networkDefinition(network).maxImages);
              return <p key={network}><strong>{networkDefinition(network).label} {account?.displayName ?? ""}</strong>: {count > 1 ? `${network === "INSTAGRAM" ? "carousel of" : ""} ${count} photos` : "1 photo"}, caption {post ? finalCaption(network, post.caption, post.hashtags).length.toLocaleString("en-AU") : 0} characters{post?.hashtags.length && networkDefinition(network).usesHashtags ? `, ${post.hashtags.length} hashtags` : ""}.</p>;
            })}
            <p>Public as soon as each network accepts it. Removing it later is done in each network&apos;s own app.{notSent.length ? ` Not sent: ${notSent.join(", ")} (use the fallback).` : ""}</p>
          </div>
        }
        confirmLabel={`Post to ${chosen.length} network${chosen.length === 1 ? "" : "s"}`}
        busy={busy}
        error={refusal ? `It was not posted: ${refusal.message}` : undefined}
        onConfirm={async () => {
          const ok = await publish(chosen);
          if (ok) setConfirming(false);
        }}
      />
    </div>
  );
}
