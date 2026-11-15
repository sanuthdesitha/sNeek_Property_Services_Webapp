"use client";

/**
 * Social accounts and permissions (2026-11-17, board "Social connections"):
 * linked accounts (official APIs only, each card saying what works today),
 * the one-time Meta setup, the marketing permission register, brand frames
 * and caption templates. Connecting, disconnecting and the Meta app secret
 * are ADMIN only with their own PIN (tier C); recording a permission is tier
 * A, revoking is tier B.
 */
import * as React from "react";
import { ExternalLink } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EToneCard, EToneNotice, toneRowCellClass } from "@/components/v2/ui/tone-band";
import { CONSENT_METHOD_LABEL, type ConsentView } from "@/lib/marketing/social/consent-rules";
import { META_SCOPES } from "@/lib/marketing/social/meta-scopes";
import { networkDefinition, type SocialNetwork } from "@/lib/marketing/social/networks";
import type { AccountView } from "@/lib/marketing/social/view-types";
import { formatOrgDateTime, formatOrgDay } from "@/lib/public-site/zoned-time";
import { socialRequest, SOCIAL_API } from "./social-api";
import { TemplatesEditor } from "./templates-editor";
import { cn } from "@/lib/utils";

type AccountsResponse = {
  accounts: AccountView[];
  metaApp: { appId: string | null; hasSecret: boolean; updatedAt: string | null };
  redirectUri: string;
  publicAddress: { ok: boolean; base?: string; problem?: string };
  encryptionKeySet: boolean;
  canConnect: boolean;
  stubbed: boolean;
};

type ClientOption = { id: string; name: string; properties: Array<{ id: string; name: string; suburb: string }> };
type RegisterResponse = { register: ConsentView[]; clients: ClientOption[] };
type Security = { pin?: string; password?: string; newPin?: string };

type SensitiveAction = { kind: "connect" } | { kind: "disconnect"; account: AccountView } | { kind: "app" };

function Rights() {
  const items = [
    { title: "Connect or disconnect an account", text: "ADMIN only, with their PIN (tier C). Never while testing as someone else." },
    { title: "Post or plan a post", text: "ADMIN, or OPS_MANAGER with the Marketing pack. Checked on the server at every click." },
    { title: "Record or revoke permission", text: "ADMIN, or OPS_MANAGER with Clients and Marketing. The client can also give or take it back in the portal." },
    { title: "Agents (Claude)", text: "May read eligible photos and ask to create drafts. Never post, never connect, never change permission." },
  ];
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <li key={item.title} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
          <p className="text-[0.8125rem] font-[600]">{item.title}</p>
          <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{item.text}</p>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 text-[0.8125rem] sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-[hsl(var(--e-muted-foreground))]">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function MetaCard({ network, account, data, timeZone, onCheck, onConnect, onDisconnect, busy }: {
  network: "FACEBOOK" | "INSTAGRAM";
  account: AccountView | null;
  data: AccountsResponse;
  timeZone: string;
  onCheck: (account: AccountView) => void;
  onConnect: () => void;
  onDisconnect: (account: AccountView) => void;
  busy: boolean;
}) {
  const definition = networkDefinition(network);
  const state = account?.status ?? "NONE";
  const tone = state === "CONNECTED" ? "good" : state === "NEEDS_RECONNECT" ? "problem" : null;
  const pill = state === "CONNECTED" ? "Connected" : state === "NEEDS_RECONNECT" ? "Needs reconnect" : "Not connected";
  return (
    <EToneCard tone={tone} header={<p className="text-[0.875rem] font-[600]"><span aria-hidden className="mr-1.5 font-[700]">{definition.mark}</span>{definition.label}{account ? ` · ${account.displayName}` : ""}</p>} pill={pill}>
      <dl className="space-y-1.5">
        {account ? (
          <>
            <Fact label="Connected by">{account.connectedByName ?? "not recorded"}, {formatOrgDateTime(account.connectedAt, timeZone)}</Fact>
            {network === "FACEBOOK" ? <Fact label="Sign-in">Page token; no fixed expiry. Stops if your Facebook password changes, your Page role is removed or the app is removed.</Fact> : <Fact label="Linked through">The Facebook Page above (same Meta app)</Fact>}
            <Fact label="Last check">{account.lastCheckAt ? `${formatOrgDateTime(account.lastCheckAt, timeZone)}, ${account.lastCheckResult ?? "result not recorded"}` : "Not checked yet"}</Fact>
            {state === "NEEDS_RECONNECT" ? <Fact label="Why">{account.statusReason ?? "The network refused the sign-in."}</Fact> : null}
            {network === "INSTAGRAM" ? <Fact label="Daily limit">{account.publishingLimit && account.publishingLimit.used !== null && account.publishingLimit.total !== null ? `${account.publishingLimit.used} of ${account.publishingLimit.total} posts used in the last 24 h` : "not recorded"}</Fact> : null}
            <Fact label="Permissions">{account.scopes.length ? account.scopes.join(", ") : "not recorded"}</Fact>
          </>
        ) : (
          <Fact label="Can post">{network === "FACEBOOK" ? "Photo and multi-photo posts, alt text, planned time" : "Single photo or carousel (sNeek caps at 6), JPEG, 4:5 to 1.91:1, 2,200 characters, 30 hashtags, alt text"}</Fact>
        )}
        <Fact label="Reach, likes">Read from the network if the insights permissions were granted; otherwise &quot;not recorded&quot;.</Fact>
        {network === "INSTAGRAM" ? <Fact label="Needs">Photos at a public https address while Instagram fetches them; sNeek gives a 1-hour signed link to the cleaned copy only.</Fact> : null}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {account ? <EButton size="sm" variant="outline" disabled={busy} onClick={() => onCheck(account)}>Check now</EButton> : null}
        {data.canConnect && network === "FACEBOOK" ? <EButton size="sm" variant={state === "CONNECTED" ? "outline" : "primary"} disabled={busy || !data.metaApp.appId || !data.metaApp.hasSecret} onClick={onConnect}>{account ? "Reconnect" : "Connect Facebook and Instagram"}</EButton> : null}
        {data.canConnect && account && network === "FACEBOOK" ? <EButton size="sm" variant="ghost" disabled={busy} onClick={() => onDisconnect(account)}>Disconnect…</EButton> : null}
      </div>
      {!data.canConnect ? <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Only an administrator, acting as themselves, can connect or disconnect.</p> : null}
      {data.canConnect && network === "FACEBOOK" && (!data.metaApp.appId || !data.metaApp.hasSecret) ? <p className="mt-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Add the Meta app details below first; Connect needs them.</p> : null}
    </EToneCard>
  );
}

function ApprovalCard({ network, steps, applyUrl }: { network: SocialNetwork; steps: string; applyUrl: string }) {
  const definition = networkDefinition(network);
  return (
    <EToneCard tone="attention" header={<p className="text-[0.875rem] font-[600]"><span aria-hidden className="mr-1.5 font-[700]">{definition.mark}</span>{definition.label}</p>} pill={definition.apiState === "fallback_only" ? "Fallback only" : `Needs ${definition.label.split(" ")[0]} approval`}>
      <p className="text-[0.8125rem]">{definition.whyNot}</p>
      <p className="mt-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{steps}</p>
      <a href={applyUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1 text-[0.8125rem] underline">How to apply <ExternalLink className="h-3 w-3" aria-hidden /></a>
    </EToneCard>
  );
}

function registerRows(data: RegisterResponse) {
  const live = new Map<string, ConsentView>();
  const ended = new Map<string, ConsentView>();
  for (const row of data.register) {
    if (!row.endedAt && !live.has(row.clientId)) live.set(row.clientId, row);
    if (row.endedAt && row.endedVia !== "REPLACED" && !ended.has(row.clientId)) ended.set(row.clientId, row);
  }
  return data.clients.filter((client) => client.properties.length > 0).map((client) => {
    const current = live.get(client.id) ?? null;
    const revoked = !current ? ended.get(client.id) ?? null : null;
    return { client, current, revoked, state: current ? "given" : revoked ? "revoked" : "not_asked" } as const;
  });
}

export function ConnectionsWorkspace({ timeZone, initialNotice }: { timeZone: string; initialNotice: { tone: "good" | "problem"; text: string } | null }) {
  const [accounts, setAccounts] = React.useState<{ state: "loading" } | { state: "failed"; message: string } | { state: "ready"; data: AccountsResponse }>({ state: "loading" });
  const [register, setRegister] = React.useState<{ state: "loading" } | { state: "failed"; message: string } | { state: "ready"; data: RegisterResponse }>({ state: "loading" });
  const [notice, setNotice] = React.useState(initialNotice);
  const [busy, setBusy] = React.useState(false);
  const [sensitive, setSensitive] = React.useState<SensitiveAction | null>(null);
  const [sensitiveError, setSensitiveError] = React.useState<string | null>(null);
  const [appId, setAppId] = React.useState("");
  const [appSecret, setAppSecret] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | "given" | "not_asked" | "revoked">("all");
  const [recording, setRecording] = React.useState<ClientOption | null>(null);
  const [revoking, setRevoking] = React.useState<ClientOption | null>(null);

  const loadAccounts = React.useCallback(async (signal?: AbortSignal) => {
    const result = await socialRequest<AccountsResponse>(`${SOCIAL_API}/accounts`, { signal });
    if (signal?.aborted) return;
    setAccounts(result.ok ? { state: "ready", data: result.data } : { state: "failed", message: result.error });
    if (result.ok) setAppId((current) => current || result.data.metaApp.appId || "");
  }, []);
  const loadRegister = React.useCallback(async (signal?: AbortSignal) => {
    const result = await socialRequest<RegisterResponse>(`${SOCIAL_API}/consent`, { signal });
    if (signal?.aborted) return;
    setRegister(result.ok ? { state: "ready", data: result.data } : { state: "failed", message: result.error });
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadAccounts(controller.signal).catch(() => undefined);
    void loadRegister(controller.signal).catch(() => undefined);
    return () => controller.abort();
  }, [loadAccounts, loadRegister]);

  async function runSensitive(security: Security | undefined) {
    if (!sensitive) return;
    setBusy(true);
    setSensitiveError(null);
    if (sensitive.kind === "connect") {
      const result = await socialRequest<{ authUrl: string }>(`${SOCIAL_API}/accounts/meta/connect`, { method: "POST", body: { security } });
      setBusy(false);
      if (!result.ok) return setSensitiveError(result.error);
      window.location.assign(result.data.authUrl);
      return;
    }
    if (sensitive.kind === "disconnect") {
      const result = await socialRequest<{ revokedAtNetwork: boolean }>(`${SOCIAL_API}/accounts/${sensitive.account.id}/disconnect`, { method: "POST", body: { security } });
      setBusy(false);
      if (!result.ok) return setSensitiveError(result.error);
      setNotice({ tone: "good", text: result.data.revokedAtNetwork ? "Disconnected. Meta confirmed sNeek's permissions were removed." : "Disconnected in sNeek. Meta did not confirm removing the permissions: remove \"sNeek posting\" in Facebook settings, Business integrations." });
    } else {
      const result = await socialRequest(`${SOCIAL_API}/accounts/meta/app`, { method: "POST", body: { appId: appId.trim(), appSecret: appSecret.trim() || null, security } });
      setBusy(false);
      if (!result.ok) return setSensitiveError(result.error);
      setAppSecret("");
      setNotice({ tone: "good", text: "Meta app details saved. The secret is stored encrypted and is never shown again." });
    }
    setSensitive(null);
    void loadAccounts();
  }

  async function check(account: AccountView) {
    setBusy(true);
    const result = await socialRequest<{ ok: boolean; message: string }>(`${SOCIAL_API}/accounts/${account.id}/check`, { method: "POST" });
    setBusy(false);
    setNotice(result.ok ? { tone: result.data.ok ? "good" : "problem", text: `${account.displayName}: ${result.data.message}` } : { tone: "problem", text: result.error });
    void loadAccounts();
  }

  const data = accounts.state === "ready" ? accounts.data : null;
  const account = (network: SocialNetwork) => data?.accounts.find((item) => item.network === network) ?? null;
  const rows = register.state === "ready" ? registerRows(register.data) : [];
  const counts = { all: rows.length, given: rows.filter((row) => row.state === "given").length, not_asked: rows.filter((row) => row.state === "not_asked").length, revoked: rows.filter((row) => row.state === "revoked").length };
  const visible = rows.filter((row) => filter === "all" || row.state === filter);

  return (
    <div className="min-w-0 space-y-6">
      <Rights />
      {notice ? <EToneNotice tone={notice.tone} role={notice.tone === "problem" ? "alert" : "status"}>{notice.text}</EToneNotice> : null}

      <section id="accounts" aria-labelledby="social-accounts-heading" className="space-y-3">
        <h2 id="social-accounts-heading" className="font-serif text-[1.25rem]">1 Linked accounts</h2>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Official APIs only. Each card says plainly what works today and what needs the network&apos;s approval.</p>
        {accounts.state === "loading" ? <p role="status" className="text-[0.8125rem]">Loading accounts…</p> : null}
        {accounts.state === "failed" ? <EToneNotice tone="problem" role="alert" title="Accounts could not be loaded.">{accounts.message} <EButton size="sm" variant="outline" onClick={() => void loadAccounts()}>Try again</EButton></EToneNotice> : null}
        {data ? (
          <>
            {data.stubbed ? <EToneNotice tone="info">Local inspection: the network layer is a stand-in; no real network is contacted.</EToneNotice> : null}
            {!data.publicAddress.ok && !data.stubbed ? <EToneNotice tone="attention" title="Public address needed">{data.publicAddress.problem} Facebook and Instagram fetch each photo from that address while posting.</EToneNotice> : null}
            {!data.encryptionKeySet ? <EToneNotice tone="problem" title="ENCRYPTION_KEY is not set">Secrets and sign-ins cannot be stored until the server has ENCRYPTION_KEY.</EToneNotice> : null}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <MetaCard network="FACEBOOK" account={account("FACEBOOK")} data={data} timeZone={timeZone} busy={busy} onCheck={(item) => void check(item)} onConnect={() => { setSensitiveError(null); setSensitive({ kind: "connect" }); }} onDisconnect={(item) => { setSensitiveError(null); setSensitive({ kind: "disconnect", account: item }); }} />
              <MetaCard network="INSTAGRAM" account={account("INSTAGRAM")} data={data} timeZone={timeZone} busy={busy} onCheck={(item) => void check(item)} onConnect={() => setSensitive({ kind: "connect" })} onDisconnect={(item) => setSensitive({ kind: "disconnect", account: item })} />
              <ApprovalCard network="TIKTOK" applyUrl="https://developers.tiktok.com/doc/content-posting-api-get-started" steps="To change later: create a TikTok app, add the Content Posting API, verify the sNeek domain for photo links, and ask TikTok for an audit. Up to 35 photos, title 90 characters. Until then: download and copy." />
              <ApprovalCard network="GOOGLE_BUSINESS" applyUrl="https://developers.google.com/my-business/content/prereqs" steps="To apply: profile verified and active 60+ days, with your website on it; apply on Google's API contact form (Application for Basic API Access). No charge from Google. Until then the fallback opens your profile." />
              <ApprovalCard network="LINKEDIN" applyUrl="https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review" steps="After approval the Development tier is enough (500 calls a day). Multi-image posts work; organic carousels do not. Sign-in lasts 60 days; LinkedIn asks you to sign in again." />
              <EToneCard tone="info" header={<p className="text-[0.875rem] font-[600]">Not connected, or a network refuses</p>} pill="Always available">
                <p className="text-[0.8125rem]">Download + copy caption + open the network. The cleaned copies download as one zip, the network&apos;s caption is on the clipboard and the network opens in a new tab. Paste the link back to record the post.</p>
                <p className="mt-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">sNeek never signs in to a network as you in a browser, never uses unofficial APIs and never stores your network password.</p>
              </EToneCard>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <ECard className="space-y-2 p-4">
                <h3 className="text-[0.9375rem] font-[600]">One-time setup: Facebook Page and Instagram (about 30 minutes, free)</h3>
                <ol className="list-decimal space-y-1.5 pl-5 text-[0.8125rem]">
                  <li>Make sure your Instagram account is a professional (business) account and is linked to the sNeek Facebook Page.</li>
                  <li>At developers.facebook.com, sign in with the Facebook account that manages the Page and create a Business app named &quot;sNeek posting&quot;.</li>
                  <li>Add the products Facebook Login for Business and Instagram (API with Facebook Login).</li>
                  <li>In Facebook Login settings add this redirect address: <code className="break-all">{data.redirectUri}</code></li>
                  <li>Copy the App ID and App Secret into the boxes here. They are stored encrypted, like the AI keys.</li>
                  <li>Leave the app in development mode. You hold a role on the app, so Meta grants Standard Access for your own Page and Instagram account without App Review.</li>
                  <li>Press Connect Facebook and Instagram (your PIN), sign in on Facebook&apos;s own page, tick the Page and the Instagram account, and allow: {META_SCOPES.join(", ")}.</li>
                  <li>sNeek swaps the short sign-in for a Page token (no fixed expiry), checks it by reading the Page name and the Instagram limit, and shows both cards as Connected.</li>
                </ol>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Only people with a role on the Meta app can connect. Business verification is needed only if the app ever goes live for other businesses. The public https address ({data.publicAddress.ok ? data.publicAddress.base : "not set"}) must be reachable from the internet so Meta can fetch the photos.</p>
              </ECard>
              <ECard className="space-y-3 p-4">
                <h3 className="text-[0.9375rem] font-[600]">Meta app details</h3>
                <fieldset disabled={!data.canConnect || busy} className="space-y-2">
                  <legend className="sr-only">Meta app details</legend>
                  <label className="block text-[0.8125rem]">App ID
                    <input value={appId} onChange={(event) => setAppId(event.target.value)} inputMode="numeric" className="mt-1 block min-h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 max-sm:text-[1rem]" />
                  </label>
                  <label className="block text-[0.8125rem]">App Secret {data.metaApp.hasSecret ? "(stored; type a new one to replace it)" : "(not stored yet)"}
                    <input type="password" autoComplete="off" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} className="mt-1 block min-h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 max-sm:text-[1rem]" />
                  </label>
                  <EButton size="sm" disabled={!appId.trim() || (!appSecret.trim() && !data.metaApp.hasSecret)} onClick={() => { setSensitiveError(null); setSensitive({ kind: "app" }); }}>Save app details…</EButton>
                </fieldset>
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Replacing a secret needs your PIN. Secrets and tokens are never shown again, never sent to the browser, never given to agents or AI, and never written to logs or Activity.</p>
                <h4 className="text-[0.8125rem] font-[600]">What sNeek stores per account</h4>
                <ul className="list-disc space-y-0.5 pl-5 text-[0.75rem]">
                  <li>Account name and id, who connected it and when</li>
                  <li>The token, encrypted with the server&apos;s credential key</li>
                  <li>Permissions granted, last check and its result</li>
                  <li>Each post&apos;s network id, link and the network&apos;s answer</li>
                </ul>
              </ECard>
            </div>
          </>
        ) : null}
      </section>

      <section id="permissions" aria-labelledby="social-permissions-heading" className="space-y-3">
        <h2 id="social-permissions-heading" className="font-serif text-[1.25rem]">2 Marketing permission register</h2>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No photo of a home is offered to the generator unless its owner said yes, and the yes is recorded here.</p>
        <div role="group" aria-label="Permission state" className="flex flex-wrap gap-1.5">
          {([["all", "All"], ["given", "Given"], ["not_asked", "Not asked"], ["revoked", "Revoked"]] as const).map(([key, label]) => (
            <button key={key} type="button" className={cn(E_CHIP_CLASS, filter === key && E_CHIP_ON_CLASS)} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}{register.state === "ready" ? <span className="ml-1 e-tnum">{counts[key]}</span> : null}</button>
          ))}
        </div>
        {register.state === "loading" ? <p role="status" className="text-[0.8125rem]">Loading the register…</p> : null}
        {register.state === "failed" ? <EToneNotice tone="problem" role="alert" title="The register could not be loaded.">{register.message} Nothing is shown rather than a false &quot;not asked&quot;.</EToneNotice> : null}
        {register.state === "ready" ? (
          <ECard className="overflow-hidden">
            <div role="region" aria-label="Permission register" tabIndex={0} className="overflow-x-auto max-sm:hidden">
              <table className="w-full min-w-[54rem] text-left text-[0.8125rem]">
                <thead className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  <tr>{["Client · properties", "What is allowed", "Given by, how", "When", "State", ""].map((label) => <th key={label} scope="col" className="px-3 py-2 font-[550]">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {visible.map((row) => {
                    const consent = row.current ?? row.revoked;
                    const tone = row.state === "revoked" ? "problem" : row.state === "not_asked" ? "attention" : null;
                    return (
                      <tr key={row.client.id} className="border-t border-[hsl(var(--e-border))] align-top">
                        <td className={cn("px-3 py-2", tone ? toneRowCellClass(tone) : "")}><span className="font-[600]">{row.client.name}</span><span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{(row.current?.properties ?? row.client.properties).map((property) => property.name).join(", ")}</span></td>
                        <td className="px-3 py-2">{row.current ? `Interior photos · suburb ${row.current.allowSuburb ? "may be named" : "not named"} · before photos: ${row.current.allowBefore ? "yes" : "no"}` : row.state === "revoked" ? "Nothing allowed now" : "not recorded"}</td>
                        <td className="px-3 py-2">{consent ? `${consent.givenByName}, ${CONSENT_METHOD_LABEL[consent.method].toLowerCase()}${consent.recordedByName ? `, recorded by ${consent.recordedByName}` : ""}${consent.hasEvidence ? " · evidence attached" : ""}` : "not recorded"}<span className="block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">{consent ? `wording ${consent.wordingVersion}` : ""}</span></td>
                        <td className="px-3 py-2">{row.current ? formatOrgDateTime(row.current.givenAt, timeZone) : row.revoked?.endedAt ? `Revoked ${formatOrgDay(row.revoked.endedAt, timeZone)}` : "not recorded"}</td>
                        <td className="px-3 py-2"><EPill tone={row.state === "given" ? "ok" : row.state === "revoked" ? "bad" : "warn"}>{row.state === "given" ? "Given" : row.state === "revoked" ? "Revoked" : "Not asked"}</EPill></td>
                        <td className="px-3 py-2 text-right">
                          {row.current ? <EButton size="sm" variant="ghost" onClick={() => setRevoking(row.client)}>Revoke…</EButton> : <EButton size="sm" variant="outline" onClick={() => setRecording(row.client)}>Record…</EButton>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-[hsl(var(--e-border))] sm:hidden">
              {visible.map((row) => (
                <li key={row.client.id} className="space-y-1 p-3 text-[0.8125rem]">
                  <div className="flex items-start justify-between gap-2"><span className="font-[600] [overflow-wrap:anywhere]">{row.client.name}</span><EPill tone={row.state === "given" ? "ok" : row.state === "revoked" ? "bad" : "warn"}>{row.state === "given" ? "Given" : row.state === "revoked" ? "Revoked" : "Not asked"}</EPill></div>
                  <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{(row.current?.properties ?? row.client.properties).map((property) => property.name).join(", ")}</p>
                  {row.current ? <p className="text-[0.75rem]">{row.current.givenByName}, {CONSENT_METHOD_LABEL[row.current.method].toLowerCase()}, {formatOrgDay(row.current.givenAt, timeZone)} · suburb {row.current.allowSuburb ? "may be named" : "not named"} · before photos {row.current.allowBefore ? "yes" : "no"}</p> : null}
                  {row.current ? <EButton size="sm" variant="ghost" onClick={() => setRevoking(row.client)}>Revoke…</EButton> : <EButton size="sm" variant="outline" onClick={() => setRecording(row.client)}>Record…</EButton>}
                </li>
              ))}
            </ul>
            <p className="border-t border-[hsl(var(--e-border))] px-3 py-2 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Missing means no. &quot;Not asked&quot; never counts as yes. Every change is an append-only history row (who, when, how, wording version); an old yes is never edited, only ended.</p>
          </ECard>
        ) : null}
      </section>

      <TemplatesEditor />

      {sensitive ? (
        <EConfirmDialog
          open
          onClose={() => (busy ? undefined : setSensitive(null))}
          tier="sensitive"
          title={sensitive.kind === "connect" ? "Connect Facebook and Instagram?" : sensitive.kind === "disconnect" ? `Disconnect ${sensitive.account.displayName}?` : "Save the Meta app details?"}
          description={sensitive.kind === "connect" ? "Facebook's own sign-in page opens next. sNeek never sees your Facebook password." : sensitive.kind === "disconnect" ? "Posting to Facebook and Instagram stops until someone connects again. Posts already made stay on the networks." : "The App Secret is stored encrypted and never shown again."}
          confirmLabel={sensitive.kind === "connect" ? "Continue to Facebook" : sensitive.kind === "disconnect" ? "Disconnect" : "Save app details"}
          busy={busy}
          error={sensitiveError ? `It was not done: ${sensitiveError}` : undefined}
          onConfirm={(result) => runSensitive(result.credentials as Security | undefined)}
        />
      ) : null}
      {recording ? <RecordConsentDialog client={recording} onClose={() => setRecording(null)} onSaved={(text) => { setRecording(null); setNotice({ tone: "good", text }); void loadRegister(); }} /> : null}
      {revoking ? <RevokeConsentDialog client={revoking} onClose={() => setRevoking(null)} onDone={(text) => { setRevoking(null); setNotice({ tone: "good", text }); void loadRegister(); }} /> : null}
    </div>
  );
}

function RecordConsentDialog({ client, onClose, onSaved }: { client: ClientOption; onClose: () => void; onSaved: (text: string) => void }) {
  const [propertyIds, setPropertyIds] = React.useState<string[]>(client.properties.map((property) => property.id));
  const [method, setMethod] = React.useState<"SIGNED_FORM" | "EMAIL" | "PHONE">("EMAIL");
  const [givenByName, setGivenByName] = React.useState(client.name);
  const [allowSuburb, setAllowSuburb] = React.useState(false);
  const [allowBefore, setAllowBefore] = React.useState(false);
  const [evidenceKey, setEvidenceKey] = React.useState<string | null>(null);
  const [evidenceName, setEvidenceName] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const needsEvidence = method !== "PHONE";

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("folder", "marketing-consent");
    try {
      const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as { key?: string; error?: string } | null;
      if (!response.ok || !body?.key) throw new Error(body?.error ?? "The file was not attached.");
      setEvidenceKey(body.key);
      setEvidenceName(file.name);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? `${uploadError.message} Remove it and attach the file again.` : "The file was not attached.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    const result = await socialRequest(`${SOCIAL_API}/consent`, { method: "POST", body: { clientId: client.id, propertyIds, method, givenByName: givenByName.trim(), allowSuburb, allowBefore, evidenceS3Key: evidenceKey, evidenceNote: note.trim() || null } });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(`Permission recorded for ${client.name}.${method === "PHONE" ? " Send the client a copy by email so they can correct it." : ""}`);
  }

  return (
    <EConfirmDialog
      open
      onClose={() => (busy ? undefined : onClose())}
      tier="ordinary"
      title={`Record ${client.name}'s permission?`}
      description="Only what the client actually agreed to. Missing means no."
      confirmLabel="Record permission"
      busy={busy}
      confirmDisabled={propertyIds.length === 0 || !givenByName.trim() || (needsEvidence && !evidenceKey) || (method === "PHONE" && !note.trim())}
      error={error ? `It was not recorded: ${error}` : undefined}
      onConfirm={() => save()}
    >
      <fieldset disabled={busy} className="space-y-3 text-[0.8125rem]">
        <legend className="sr-only">Permission</legend>
        <div>
          <p className="font-[550]">Properties</p>
          {client.properties.map((property) => (
            <label key={property.id} className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={propertyIds.includes(property.id)} onChange={(event) => setPropertyIds((current) => (event.target.checked ? [...current, property.id] : current.filter((id) => id !== property.id)))} /> {property.name}</label>
          ))}
        </div>
        <div role="radiogroup" aria-label="How it was given (required)">
          <p className="font-[550]">How it was given (required)</p>
          <div className="flex flex-wrap gap-3">
            {(["SIGNED_FORM", "EMAIL", "PHONE"] as const).map((key) => <label key={key} className="flex min-h-11 items-center gap-2"><input type="radio" name="consent-method" checked={method === key} onChange={() => setMethod(key)} /> {CONSENT_METHOD_LABEL[key]}</label>)}
          </div>
        </div>
        <label className="block">Given by (name)
          <input value={givenByName} onChange={(event) => setGivenByName(event.target.value)} className="mt-1 block min-h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 max-sm:text-[1rem]" />
        </label>
        {needsEvidence ? (
          <label className="block">Evidence ({evidenceName ? `${evidenceName} attached` : "required for email and signed form"})
            <input type="file" accept="application/pdf,image/*,.eml,message/rfc822" onChange={(event) => event.target.files?.[0] && void upload(event.target.files[0])} className="mt-1 block w-full text-[0.8125rem]" />
          </label>
        ) : null}
        <label className="block">{method === "PHONE" ? "Note of the call (required)" : "Note (optional)"}
          <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} className="mt-1 block w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2 max-sm:text-[1rem]" />
        </label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={allowSuburb} onChange={(event) => setAllowSuburb(event.target.checked)} /> Suburb may be named</label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={allowBefore} onChange={(event) => setAllowBefore(event.target.checked)} /> Before photos may be used</label>
      </fieldset>
    </EConfirmDialog>
  );
}

function RevokeConsentDialog({ client, onClose, onDone }: { client: ClientOption; onClose: () => void; onDone: (text: string) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <EConfirmDialog
      open
      onClose={() => (busy ? undefined : onClose())}
      tier="destructive"
      title={`Revoke ${client.name}'s permission?`}
      description={`Photos of ${client.properties.map((property) => property.name).join(" and ")} stop being offered now. Unposted drafts using them are deleted with their copies; posted posts are flagged for you to remove on each network. This cannot be undone (history keeps the old yes and this revocation).`}
      confirmLabel="Revoke permission"
      busy={busy}
      error={error ? `It was not revoked: ${error}` : undefined}
      onConfirm={async () => {
        setBusy(true);
        const result = await socialRequest<{ cascade: { draftsRemoved: number; postedFlagged: number; filesNotRemoved: number } }>(`${SOCIAL_API}/consent/${client.id}/revoke`, { method: "POST", body: { reason: "Revoked by the office" } });
        setBusy(false);
        if (!result.ok) return setError(result.error);
        const cascade = result.data.cascade;
        onDone(`Permission revoked for ${client.name}. ${cascade.draftsRemoved} draft${cascade.draftsRemoved === 1 ? "" : "s"} removed; ${cascade.postedFlagged} posted post${cascade.postedFlagged === 1 ? "" : "s"} flagged for you to take down.${cascade.filesNotRemoved ? ` ${cascade.filesNotRemoved} file(s) could not be deleted from storage.` : ""}`);
      }}
    />
  );
}
