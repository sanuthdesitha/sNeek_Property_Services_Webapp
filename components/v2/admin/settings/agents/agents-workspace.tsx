"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EAlert, EBadge, EButton, ECard } from "@/components/v2/ui/primitives";
import { EToneCard } from "@/components/v2/ui/tone-band";
import { OwnPinFields, useOwnPinPrompt } from "@/components/v2/shared/own-pin-fields";
import { AGENT_EXPIRY_CHOICES, AGENT_SCOPES, type AgentScopeKey } from "@/lib/agents/scopes";
import { AGENT_WRITE_SCOPES, type AgentWriteScopeKey } from "@/lib/agents/write-scopes";

type RecentCall = { at: string; method: string; tool: string | null; outcome: string; errorCode: string | null; latencyMs: number; resultBytes: number | null };
type AgentItem = {
  id: string; name: string; status: string; createdAt: string; createdBy: string; areas: string[];
  effective: AgentScopeKey[]; withheld: AgentScopeKey[];
  writeAreas: string[]; writeEffective: AgentWriteScopeKey[]; writeWithheld: AgentWriteScopeKey[];
  waitingRequests: number;
  token: { prefix: string; expiresAt: string; lastUsedAt: string | null; expired: boolean } | null;
  recentCalls: RecentCall[];
};
type ScreenState = { paused: boolean; agents: AgentItem[]; grantable: AgentScopeKey[]; grantableWrite: AgentWriteScopeKey[]; mcpUrl: string };
type AgentDraft = { name: string; areas: AgentScopeKey[]; writeAreas: AgentWriteScopeKey[]; expiresInDays: number };
type Pending =
  | ({ kind: "create" } & AgentDraft)
  | { kind: "write-areas"; agent: AgentItem; writeAreas: AgentWriteScopeKey[] }
  | { kind: "rotate"; agent: AgentItem; expiresInDays: number }
  | { kind: "revoke"; agent: AgentItem }
  | { kind: "pause"; paused: boolean };
type Revealed = { agentName: string; token: string; expiresAt: string };

const SCOPE_LABEL = new Map(AGENT_SCOPES.map((scope) => [scope.key, scope.label]));
const WRITE_LABEL = new Map(AGENT_WRITE_SCOPES.map((scope) => [scope.key, scope.label]));

/** Tick boxes for the write packs, limited to what the administrator can manage. */
function WritePackFields({ legend, value, grantable, disabled, onChange }: { legend: string; value: AgentWriteScopeKey[]; grantable: AgentWriteScopeKey[]; disabled?: boolean; onChange: (next: AgentWriteScopeKey[]) => void }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{legend}</legend>
      <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Off by default. The agent can only ask: every change waits in Approvals, Agent requests until someone who could make it approves it.</p>
      {AGENT_WRITE_SCOPES.map((scope) => {
        const allowed = grantable.includes(scope.key);
        return (
          <label key={scope.key} className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" disabled={!allowed} checked={value.includes(scope.key)} onChange={(event) => onChange(event.target.checked ? [...value, scope.key] : value.filter((key) => key !== scope.key))} />
            <span className="min-w-0"><span className="block font-medium">{scope.label}</span><span className="block text-xs text-[hsl(var(--e-muted-foreground))]">{allowed ? scope.description : "Outside what you can manage yourself."}</span></span>
          </label>
        );
      })}
    </fieldset>
  );
}
const when = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : "Never");

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

/**
 * Settings › Access › Agents. Administrators create read-only agents for
 * Hermes, Claude or any MCP client, see each token once, rotate or revoke it,
 * pause every agent, and read recent calls. Every change asks for the
 * administrator's own PIN; the server re-checks everything.
 */
export function AgentsWorkspace() {
  const [state, setState] = useState<ScreenState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState("");
  const mounted = useRef(true);
  const pin = useOwnPinPrompt(pending !== null);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const response = await fetch("/api/admin/agents", { cache: "no-store" });
      const body = await readJson(response);
      if (!mounted.current) return;
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Agents could not be loaded.");
      setState(body as unknown as ScreenState);
    } catch (error) {
      if (mounted.current) setLoadError(error instanceof Error ? error.message : "Agents could not be loaded.");
    }
  }, []);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);

  async function confirm() {
    if (!pending || !pin.credentials) return;
    setBusy(true); setMessage("");
    try {
      const request = pending.kind === "create"
        ? { url: "/api/admin/agents", body: { action: "create", name: pending.name, areas: pending.areas, writeAreas: pending.writeAreas, expiresInDays: pending.expiresInDays } }
        : pending.kind === "pause"
          ? { url: "/api/admin/agents", body: { action: "pause", paused: pending.paused } }
          : { url: `/api/admin/agents/${encodeURIComponent(pending.agent.id)}`, body: pending.kind === "rotate" ? { action: "rotate", expiresInDays: pending.expiresInDays } : pending.kind === "write-areas" ? { action: "write-areas", writeAreas: pending.writeAreas } : { action: "revoke" } };
      const response = await fetch(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request.body, credentials: pin.credentials }) });
      const body = await readJson(response);
      if (!mounted.current) return;
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The change was not made.");
      if (pending.kind === "create" || pending.kind === "rotate") {
        setRevealed({ agentName: pending.kind === "create" ? pending.name : pending.agent.name, token: String(body.token), expiresAt: String(body.expiresAt) });
      }
      if (pending.kind === "create") setDraft(null);
      setMessage(pending.kind === "revoke" ? `${pending.agent.name} was revoked. Its token stops working now.` : pending.kind === "pause" ? (pending.paused ? "Every agent is paused. Agents cannot read or ask, and waiting requests cannot be approved." : "Agents can connect again.") : pending.kind === "write-areas" ? `What ${pending.agent.name} may ask for was saved.` : "");
      setPending(null);
      await load();
    } catch (error) {
      // The prompt stays open with the draft; only the PIN is cleared.
      if (mounted.current) { pin.reset(); setMessage(error instanceof Error ? error.message : "The change was not made."); }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); } catch { setCopied("Copy failed: select the text and copy it."); }
  }

  if (loadError && !state) return <EAlert tone="danger" title="Agents unavailable">{loadError} <button type="button" className="underline" onClick={() => void load()}>Retry</button></EAlert>;
  if (!state) return <p role="status" className="text-sm">Loading agents…</p>;

  const snippet = (token: string) => JSON.stringify({ mcpServers: { sneek: { type: "http", url: state.mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);

  return (
    <div className="min-w-0 space-y-6">
      <EAlert tone="info" title="Defaults pending owner confirmation">
        Agents read within the packs you give them. With a write pack they can only ask: every change waits for a person's approval in Approvals, Agent requests, and runs as that person. Each agent sees and asks for no more than you can, never gets administrator rights, PINs, passwords or keys, and loses an area as soon as its creator does. Invoices, pay, refunds, permissions, users, settings, deletions and anything sent outside the app are never available to agents. Tokens are shown once, expire, and can be revoked at once.
      </EAlert>

      {revealed ? (
        <EToneCard tone="attention" header={<span className="font-semibold">Token for {revealed.agentName}: shown once</span>} bodyClassName="space-y-3 p-4">
          <p className="text-sm">Copy it into the agent&apos;s settings now. It is not stored and cannot be shown again; if it is lost, rotate it. Expires {when(revealed.expiresAt)}.</p>
          <code className="block break-all rounded border p-3 text-sm" data-testid="agent-token">{revealed.token}</code>
          <div className="flex flex-wrap gap-2">
            <EButton type="button" size="sm" onClick={() => void copy(revealed.token, "Token copied.")}>Copy token</EButton>
            <EButton type="button" size="sm" variant="outline" onClick={() => void copy(snippet(revealed.token), "Configuration copied.")}>Copy MCP configuration</EButton>
            <EButton type="button" size="sm" variant="ghost" onClick={() => { setRevealed(null); setCopied(""); }}>I have stored it</EButton>
          </div>
          {copied ? <p role="status" className="text-sm">{copied}</p> : null}
        </EToneCard>
      ) : null}

      <ECard className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">All agents</h2>
          <p className="text-sm text-[hsl(var(--e-muted-foreground))]">{state.paused ? "Paused: every agent call is refused, no request can be made and waiting requests cannot be approved." : "On: agents with a valid token can read within their access and ask for the changes their write packs allow."}</p>
        </div>
        <EButton type="button" variant={state.paused ? "primary" : "outline"} disabled={busy} onClick={() => setPending({ kind: "pause", paused: !state.paused })}>{state.paused ? "Resume all agents" : "Pause all agents"}</EButton>
      </ECard>

      <section aria-labelledby="agents-list-heading" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="agents-list-heading" className="text-base font-semibold">Agents ({state.agents.length})</h2>
          <EButton type="button" disabled={busy || draft !== null} onClick={() => setDraft({ name: "", areas: [], writeAreas: [], expiresInDays: 90 })}>New agent</EButton>
        </div>

        {draft ? (
          <ECard className="space-y-3 p-4">
            <h3 className="font-semibold">New agent</h3>
            <label className="block text-sm font-medium">Name
              <input className="mt-1 block h-11 w-full rounded-md border bg-transparent px-3 text-[16px] sm:text-sm" maxLength={60} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="For example Hermes or Claude" />
            </label>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">What it may read (no wider than your own access)</legend>
              {AGENT_SCOPES.map((scope) => {
                const allowed = state.grantable.includes(scope.key);
                return (
                  <label key={scope.key} className="flex min-h-11 items-start gap-3 text-sm">
                    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" disabled={!allowed} checked={draft.areas.includes(scope.key)} onChange={(event) => setDraft({ ...draft, areas: event.target.checked ? [...draft.areas, scope.key] : draft.areas.filter((key) => key !== scope.key) })} />
                    <span className="min-w-0"><span className="block font-medium">{scope.label}</span><span className="block text-xs text-[hsl(var(--e-muted-foreground))]">{allowed ? scope.description : "Outside your own access."}</span></span>
                  </label>
                );
              })}
            </fieldset>
            <WritePackFields legend="What it may ask to change (no wider than what you can manage)" value={draft.writeAreas} grantable={state.grantableWrite} onChange={(writeAreas) => setDraft({ ...draft, writeAreas })} />
            <label className="block text-sm font-medium">Token expires after
              <select className="mt-1 block h-11 w-full rounded-md border bg-transparent px-3 text-[16px] sm:text-sm" value={draft.expiresInDays} onChange={(event) => setDraft({ ...draft, expiresInDays: Number(event.target.value) })}>
                {AGENT_EXPIRY_CHOICES.map((days) => <option key={days} value={days}>{days} days</option>)}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <EButton type="button" disabled={!draft.name.trim() || draft.areas.length === 0 || busy} onClick={() => setPending({ kind: "create", name: draft.name.trim(), areas: draft.areas, writeAreas: draft.writeAreas, expiresInDays: draft.expiresInDays })}>Create agent</EButton>
              <EButton type="button" variant="outline" disabled={busy} onClick={() => setDraft(null)}>Cancel</EButton>
            </div>
          </ECard>
        ) : null}

        {pending ? (
          <ECard className="space-y-3 p-4" role="group" aria-label="Confirm with your PIN">
            <p className="text-sm font-medium">
              {pending.kind === "create" ? `Create "${pending.name}" with ${pending.areas.length} area${pending.areas.length === 1 ? "" : "s"}${pending.writeAreas.length ? ` and ${pending.writeAreas.length} write pack${pending.writeAreas.length === 1 ? "" : "s"}` : ""}?`
                : pending.kind === "write-areas" ? `Save what ${pending.agent.name} may ask to change? Waiting requests are checked again when someone approves them.`
                : pending.kind === "rotate" ? `Rotate the token of ${pending.agent.name}? The current token stops working now.`
                  : pending.kind === "revoke" ? `Revoke ${pending.agent.name}? Its token stops working now and it cannot be restored.`
                    : pending.paused ? "Pause every agent now?" : "Let agents connect again?"}
            </p>
            {pending.kind === "write-areas" ? (
              <WritePackFields legend={`What ${pending.agent.name} may ask to change`} value={pending.writeAreas} grantable={state.grantableWrite} disabled={busy} onChange={(writeAreas) => setPending({ ...pending, writeAreas })} />
            ) : null}
            {pending.kind === "rotate" ? (
              <label className="block text-sm font-medium">New token expires after
                <select className="mt-1 block h-11 w-full rounded-md border bg-transparent px-3 text-[16px] sm:text-sm" value={pending.expiresInDays} onChange={(event) => setPending({ ...pending, expiresInDays: Number(event.target.value) })}>
                  {AGENT_EXPIRY_CHOICES.map((days) => <option key={days} value={days}>{days} days</option>)}
                </select>
              </label>
            ) : null}
            <OwnPinFields {...pin.fieldProps} disabled={busy} autoFocus />
            {pin.problem && pin.fieldProps.value.pin ? <p className="text-xs">{pin.problem}</p> : null}
            <div className="flex flex-wrap gap-2">
              <EButton type="button" disabled={!pin.credentials || busy} onClick={() => void confirm()}>{busy ? "Working…" : "Confirm"}</EButton>
              <EButton type="button" variant="outline" disabled={busy} onClick={() => { setPending(null); setMessage(""); }}>Cancel</EButton>
            </div>
          </ECard>
        ) : null}
        {message ? <p role="status" className="text-sm">{message}</p> : null}

        {state.agents.length === 0 ? <p className="text-sm">No agents yet.</p> : state.agents.map((agent) => (
          <EToneCard
            key={agent.id}
            tone={agent.status !== "ACTIVE" ? null : agent.withheld.length || agent.writeWithheld.length || agent.token?.expired || !agent.token ? "attention" : null}
            header={<span className="font-semibold break-words">{agent.name}</span>}
            pill={agent.status !== "ACTIVE" ? "Revoked" : agent.token?.expired ? "Token expired" : !agent.token ? "No live token" : agent.withheld.length || agent.writeWithheld.length ? "Some access withheld" : undefined}
            bodyClassName="space-y-2 p-4"
          >
            <div className="flex flex-wrap gap-1.5">{agent.effective.map((key) => <EBadge key={key} tone="neutral" soft>{SCOPE_LABEL.get(key) ?? key}</EBadge>)}</div>
            {agent.withheld.length ? <p className="text-sm">Withheld because its creator can no longer read them: {agent.withheld.map((key) => SCOPE_LABEL.get(key) ?? key).join(", ")}.</p> : null}
            <p className="text-sm">
              <span className="text-[hsl(var(--e-muted-foreground))]">May ask to change: </span>
              {agent.writeEffective.length ? agent.writeEffective.map((key) => WRITE_LABEL.get(key) ?? key).join(", ") : "Nothing (read only)"}
              {agent.waitingRequests > 0 ? ` · ${agent.waitingRequests} request${agent.waitingRequests === 1 ? "" : "s"} waiting in Approvals` : ""}
            </p>
            {agent.writeWithheld.length ? <p className="text-sm">Write packs withheld because its creator can no longer manage them: {agent.writeWithheld.map((key) => WRITE_LABEL.get(key) ?? key).join(", ")}.</p> : null}
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <div><dt className="inline text-[hsl(var(--e-muted-foreground))]">Token: </dt><dd className="inline break-all">{agent.token ? `${agent.token.prefix}…` : "None"}</dd></div>
              <div><dt className="inline text-[hsl(var(--e-muted-foreground))]">Expires: </dt><dd className="inline">{agent.token ? when(agent.token.expiresAt) : "—"}</dd></div>
              <div><dt className="inline text-[hsl(var(--e-muted-foreground))]">Last used: </dt><dd className="inline">{agent.token ? when(agent.token.lastUsedAt) : "—"}</dd></div>
              <div><dt className="inline text-[hsl(var(--e-muted-foreground))]">Created by: </dt><dd className="inline break-words">{agent.createdBy}, {when(agent.createdAt)}</dd></div>
            </dl>
            {agent.status === "ACTIVE" ? (
              <div className="flex flex-wrap gap-2">
                <EButton type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPending({ kind: "rotate", agent, expiresInDays: 90 })}>Rotate token</EButton>
                <EButton type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPending({ kind: "write-areas", agent, writeAreas: agent.writeAreas.filter((key): key is AgentWriteScopeKey => WRITE_LABEL.has(key as AgentWriteScopeKey)) })}>Change what it may ask</EButton>
                <EButton type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPending({ kind: "revoke", agent })}>Revoke</EButton>
              </div>
            ) : null}
            <details className="rounded border p-2">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Recent calls ({agent.recentCalls.length})</summary>
              {agent.recentCalls.length === 0 ? <p className="text-sm">No calls yet.</p> : (
                <ul className="mt-1 space-y-1 text-sm">
                  {agent.recentCalls.map((call, index) => (
                    <li key={`${call.at}-${index}`} className="break-words">{when(call.at)} · {call.tool ?? call.method} · {call.outcome}{call.errorCode ? ` (${call.errorCode})` : ""} · {call.latencyMs} ms{call.resultBytes !== null ? ` · ${call.resultBytes} bytes` : ""}</li>
                  ))}
                </ul>
              )}
            </details>
          </EToneCard>
        ))}
      </section>

      <section aria-labelledby="agents-connect-heading" className="min-w-0 space-y-3">
        <h2 id="agents-connect-heading" className="text-base font-semibold">How to connect Hermes or Claude</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Create an agent above, choose what it may read, and copy its token when it is shown (only once).</li>
          <li>MCP server address: <code className="break-all">{state.mcpUrl}</code> <button type="button" className="underline" onClick={() => void copy(state.mcpUrl, "Address copied.")}>Copy</button></li>
          <li><strong>Hermes, or any MCP client that takes a JSON configuration:</strong> add a server of type &quot;http&quot; with this address and the header <code>Authorization: Bearer &lt;token&gt;</code>, for example:
            <pre className="mt-1 overflow-x-auto rounded border p-3 text-xs">{snippet("<token>")}</pre>
          </li>
          <li><strong>Claude Code:</strong> <code className="break-all">claude mcp add --transport http sneek {state.mcpUrl} --header &quot;Authorization: Bearer &lt;token&gt;&quot;</code></li>
          <li><strong>Claude apps (custom connector):</strong> not available. The connector needs an OAuth sign-in, which is not built; use Claude Code or Hermes meanwhile.</li>
          <li>Ask the agent to call <code>whoami</code> to check the connection; the call appears under Recent calls. To stop an agent at once, revoke it, or pause all agents.</li>
          <li>With a write pack, the agent&apos;s <code>request_…</code> tools create requests that wait in Approvals, Agent requests (24 hours, then they expire); <code>get_action_request</code> tells the agent what happened.</li>
        </ol>
        {copied && !revealed ? <p role="status" className="text-sm">{copied}</p> : null}
      </section>
    </div>
  );
}
