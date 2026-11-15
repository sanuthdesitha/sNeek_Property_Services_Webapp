"use client";

/**
 * Settings › Access › Agents (board "Settings leftovers: Agents", 2026-11).
 * Administrators create agents for Hermes, Claude or any MCP client, see each
 * token once, rotate or revoke it, change what it may ask, pause every agent,
 * and read recent calls. Every change asks for the administrator's own PIN in
 * the tier C dialog; the server re-checks everything.
 *
 * Layout: the on/paused title band (with the real connection address), the
 * token shown once, then the agents list with the New agent form beside it
 * (below it on a phone), then the connection guide. One h1 comes from the page
 * header; this workspace uses h2 and h3 only.
 */
import * as React from "react";
import { EAlert, EButton, ECard } from "@/components/v2/ui/primitives";
import { EToneBand, EToneCard, toneMutedClass } from "@/components/v2/ui/tone-band";
import { ENote } from "@/components/v2/ui/form-dialog-parts";
import type { ConfirmResult } from "@/components/v2/ui/confirm-dialog";
import { sensitiveVerificationText, type SensitiveCredentialsInput } from "@/lib/security/pin-rules";
import { cn } from "@/lib/utils";
import { AgentCard } from "./agent-card";
import { AgentConfirmDialog } from "./agent-confirm-dialog";
import {
  EMPTY_AGENT_DRAFT,
  DEFAULT_EXPIRY_DAYS,
  formatWhen,
  hasValidToken,
  isWritePackKey,
  plural,
  type AgentDraft,
  type AgentItem,
  type AgentsScreenState,
  type PendingChange,
  type RevealedToken,
} from "./agent-model";
import { AGENT_NAME_INPUT_ID, NewAgentForm } from "./new-agent-form";

const DEFAULT_TIMEZONE = "Australia/Sydney";

type LoadStatus = "loading" | "ready" | "failed";

type AgentRequest = { url: string; body: Record<string, unknown> };

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

function errorText(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

/** The existing API request for each change (unchanged routes and bodies). */
function requestFor(pending: PendingChange): AgentRequest {
  switch (pending.kind) {
    case "create": {
      const { draft } = pending;
      return { url: "/api/admin/agents", body: { action: "create", name: draft.name.trim(), areas: draft.areas, writeAreas: draft.writeAreas, expiresInDays: draft.expiresInDays } };
    }
    case "pause":
      return { url: "/api/admin/agents", body: { action: "pause", paused: pending.paused } };
    case "rotate":
      return { url: `/api/admin/agents/${encodeURIComponent(pending.agent.id)}`, body: { action: "rotate", expiresInDays: pending.expiresInDays } };
    case "write-areas":
      return { url: `/api/admin/agents/${encodeURIComponent(pending.agent.id)}`, body: { action: "write-areas", writeAreas: pending.writeAreas } };
    case "revoke":
      return { url: `/api/admin/agents/${encodeURIComponent(pending.agent.id)}`, body: { action: "revoke" } };
  }
}

function successMessage(pending: PendingChange): string {
  switch (pending.kind) {
    case "revoke":
      return `${pending.agent.name} was revoked. Its token stops working now.`;
    case "pause":
      return pending.paused ? "Every agent is paused. Agents cannot read or ask, and waiting requests cannot be approved." : "Agents can connect again.";
    case "write-areas":
      return `What ${pending.agent.name} may ask for was saved.`;
    case "create":
      return `${pending.draft.name.trim()} was created.`;
    case "rotate":
      return `The token of ${pending.agent.name} was rotated. The old token stops working now.`;
  }
}

function mcpSnippet(mcpUrl: string, token: string): string {
  return JSON.stringify({ mcpServers: { sneek: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}

/** The on / paused title band with the real connection address. */
function ServiceBand({ state, busy, onToggle }: { state: AgentsScreenState; busy: boolean; onToggle: () => void }) {
  const tone = state.paused ? "attention" : "good";
  const valid = state.agents.filter(hasValidToken).length;
  const lead = state.paused
    ? "Every agent call is refused, no request can be made and waiting requests cannot be approved."
    : valid === 0
      ? "No agent has a valid token yet."
      : `${plural(valid, "agent")} with valid tokens can read within their access and ask for the changes their write packs allow.`;
  return (
    <section aria-labelledby="agents-service-heading" className="min-w-0 overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <EToneBand tone={tone} className="flex flex-wrap items-start justify-between gap-3 border-b-0 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="agents-service-heading" className="text-[0.9375rem] font-semibold">{state.paused ? "Agents are paused" : "Agents are on"}</h2>
          <p className={cn("text-[0.8125rem]", toneMutedClass(tone))}>
            {lead} Connection address: <code className="font-mono text-[0.75rem] [overflow-wrap:anywhere]">{state.mcpUrl}</code>
          </p>
        </div>
        <EButton type="button" size="sm" variant={state.paused ? "primary" : "outline"} disabled={busy} onClick={onToggle} className="max-sm:w-full">
          {state.paused ? "Resume all agents…" : "Pause all agents…"}
        </EButton>
      </EToneBand>
    </section>
  );
}

/** The token shown once, with the copy buttons; "I have stored it" removes it. */
function RevealedTokenCard({ revealed, timeZone, copied, onCopy, onDone }: { revealed: RevealedToken; timeZone: string; copied: string; onCopy: (what: "token" | "config") => void; onDone: () => void }) {
  return (
    <EToneCard
      role="region"
      aria-label={`Token for ${revealed.agentName}, shown once`}
      tone="attention"
      header={
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold [overflow-wrap:anywhere]">Token for {revealed.agentName}, shown once</h2>
          <p className={cn("text-[0.8125rem]", toneMutedClass("attention"))}>
            Copy it into the agent&apos;s settings now. It is not stored and cannot be shown again; if it is lost, rotate it. Expires {formatWhen(revealed.expiresAt, timeZone)}.
          </p>
        </div>
      }
      pill="Copy now"
      bodyClassName="space-y-3"
    >
      <code data-testid="agent-token" className="block rounded-[var(--e-radius)] border border-[hsl(var(--e-band-attention-line))] bg-[hsl(var(--e-surface))] px-2.5 py-2 font-mono text-[0.75rem] [overflow-wrap:anywhere]">
        {revealed.token}
      </code>
      <div className="flex flex-wrap items-center gap-1.5 max-sm:flex-col max-sm:items-stretch">
        <EButton type="button" size="sm" onClick={() => onCopy("token")}>Copy token</EButton>
        <EButton type="button" size="sm" variant="outline" onClick={() => onCopy("config")}>Copy MCP configuration</EButton>
        <span className="grow max-sm:hidden" aria-hidden />
        <EButton type="button" size="sm" variant="ghost" onClick={onDone}>I have stored it</EButton>
      </div>
      {copied ? <p role="status" className="text-[0.8125rem]">{copied}</p> : null}
    </EToneCard>
  );
}

/** The real connection guide (unchanged wording, Estate card). */
function ConnectionGuide({ mcpUrl, copied, onCopyAddress }: { mcpUrl: string; copied: string; onCopyAddress: () => void }) {
  return (
    <ECard className="min-w-0 p-4 sm:p-5">
      <section aria-labelledby="agents-connect-heading" className="min-w-0 space-y-3">
        <h2 id="agents-connect-heading" className="text-[0.9375rem] font-semibold">How to connect Hermes or Claude</h2>
        <ol className="list-decimal space-y-2 pl-5 text-[0.8125rem]">
          <li>Create an agent with the New agent form, choose what it may read, and copy its token when it is shown (only once).</li>
          <li>
            MCP server address: <code className="font-mono [overflow-wrap:anywhere]">{mcpUrl}</code>{" "}
            <button type="button" className="min-h-8 font-[550] text-[hsl(var(--e-primary))] underline underline-offset-2" onClick={onCopyAddress}>Copy</button>
          </li>
          <li>
            <strong>Hermes, or any MCP client that takes a JSON configuration:</strong> add a server of type &quot;http&quot; with this address and the header <code>Authorization: Bearer &lt;token&gt;</code>, for example:
            <pre className="mt-1 overflow-x-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.75rem]">{mcpSnippet(mcpUrl, "<token>")}</pre>
          </li>
          <li><strong>Claude Code:</strong> <code className="[overflow-wrap:anywhere]">claude mcp add --transport http sneek {mcpUrl} --header &quot;Authorization: Bearer &lt;token&gt;&quot;</code></li>
          <li><strong>Claude apps (custom connector, web or desktop; not tried with sNeek yet):</strong> Anthropic documents fixed credentials sent as request headers instead of OAuth. In Claude, open Customize, Connectors, choose Add, then add a custom connector. Name it &quot;sNeek&quot; and paste the address above. Under Authentication choose no OAuth, and under Request headers add <code>Authorization</code> with the value <code>Bearer &lt;token&gt;</code>. Claude reaches sNeek from Anthropic&apos;s cloud, so the address must be your public https site. On Team or Enterprise plans an owner adds it in Organization settings, and everyone who connects uses the same token, so give that agent only what all of them may read. Claude Code is the tested path.</li>
          <li>Ask the agent to call <code>whoami</code> to check the connection; the call appears under Recent calls. To stop an agent at once, revoke it, or pause all agents.</li>
          <li>With a write pack, the agent&apos;s <code>request_…</code> tools create requests that wait in Approvals, Agent requests (24 hours, then they expire); <code>get_action_request</code> tells the agent what happened.</li>
        </ol>
        {copied ? <p role="status" className="text-[0.8125rem]">{copied}</p> : null}
      </section>
    </ECard>
  );
}

function writePacksOf(agent: AgentItem) {
  return agent.writeAreas.filter(isWritePackKey);
}

export function AgentsWorkspace({ timeZone = DEFAULT_TIMEZONE }: { timeZone?: string }) {
  const [state, setState] = React.useState<AgentsScreenState | null>(null);
  const [loadStatus, setLoadStatus] = React.useState<LoadStatus>("loading");
  const [loadError, setLoadError] = React.useState("");
  const [draft, setDraft] = React.useState<AgentDraft>(EMPTY_AGENT_DRAFT);
  const [pending, setPending] = React.useState<PendingChange | null>(null);
  const [dialogError, setDialogError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [revealed, setRevealed] = React.useState<RevealedToken | null>(null);
  const [message, setMessage] = React.useState("");
  const [copied, setCopied] = React.useState("");
  const [guideCopied, setGuideCopied] = React.useState("");
  const loadController = React.useRef<AbortController | null>(null);
  const mounted = React.useRef(true);

  /** Reads the list; a newer read cancels an older one, and a late answer is ignored. */
  const load = React.useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoadStatus("loading");
    setLoadError("");
    try {
      const response = await fetch("/api/admin/agents", { cache: "no-store", signal: controller.signal });
      const body = await readJson(response);
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(errorText(body, "Agents could not be loaded."));
      setState(body as unknown as AgentsScreenState);
      setLoadStatus("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(error instanceof Error ? error.message : "Agents could not be loaded.");
      setLoadStatus("failed");
    }
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      loadController.current?.abort();
    };
  }, [load]);

  function openChange(next: PendingChange) {
    setDialogError("");
    setMessage("");
    setPending(next);
  }

  function closeDialog() {
    if (busy) return;
    setPending(null);
    setDialogError("");
  }

  async function confirm(result: ConfirmResult) {
    if (!pending || !result.credentials) return;
    const change = pending;
    const credentials: SensitiveCredentialsInput = result.credentials;
    const request = requestFor(change);
    setBusy(true);
    setDialogError("");
    try {
      const response = await fetch(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request.body, credentials }) });
      const body = await readJson(response);
      if (!mounted.current) return;
      if (!response.ok) {
        // The dialog stays open with the server's message; the shared dialog clears only the credential.
        setDialogError(typeof body.error === "string" && body.error ? sensitiveVerificationText(body.error) : "The change was not made.");
        return;
      }
      if (change.kind === "create" || change.kind === "rotate") {
        setRevealed({ agentName: change.kind === "create" ? change.draft.name.trim() : change.agent.name, token: String(body.token), expiresAt: String(body.expiresAt) });
        setCopied("");
      }
      if (change.kind === "create") setDraft(EMPTY_AGENT_DRAFT);
      setMessage(successMessage(change));
      setPending(null);
      void load();
    } catch {
      if (mounted.current) setDialogError("The change could not be sent. Check the connection and try again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function copyText(text: string, done: string, report: (text: string) => void) {
    try {
      await navigator.clipboard.writeText(text);
      report(done);
    } catch {
      report("Copy failed: select the text and copy it.");
    }
  }

  function focusNewAgent() {
    const input = document.getElementById(AGENT_NAME_INPUT_ID);
    if (!input) return;
    if (typeof input.scrollIntoView === "function") input.scrollIntoView({ block: "center" });
    input.focus();
  }

  if (!state) {
    if (loadStatus === "failed") {
      return (
        <EAlert tone="danger" title="Agents unavailable">
          <p>{loadError}</p>
          <EButton type="button" size="sm" variant="outline" className="mt-2" onClick={() => void load()}>Retry</EButton>
        </EAlert>
      );
    }
    return <p role="status" className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading agents…</p>;
  }

  return (
    <div className="min-w-0 space-y-5">
      <ServiceBand state={state} busy={busy} onToggle={() => openChange({ kind: "pause", paused: !state.paused })} />

      {loadStatus === "failed" ? (
        <EAlert tone="warning" title="This list may be out of date">
          <p>{loadError} It shows what was loaded before.</p>
          <EButton type="button" size="sm" variant="outline" className="mt-2" onClick={() => void load()}>Retry</EButton>
        </EAlert>
      ) : null}

      {revealed ? (
        <RevealedTokenCard
          revealed={revealed}
          timeZone={timeZone}
          copied={copied}
          onCopy={(what) => void copyText(what === "token" ? revealed.token : mcpSnippet(state.mcpUrl, revealed.token), what === "token" ? "Token copied." : "Configuration copied.", setCopied)}
          onDone={() => { setRevealed(null); setCopied(""); }}
        />
      ) : null}

      {message ? <ENote role="status" tone="good">{message}</ENote> : null}

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <section aria-labelledby="agents-list-heading" aria-busy={loadStatus === "loading" || undefined} className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="agents-list-heading" className="e-display-sm">Agents · {state.agents.length}</h2>
            <EButton type="button" size="sm" variant="outline" className="lg:hidden" onClick={focusNewAgent}>New agent</EButton>
          </div>
          {loadStatus === "loading" ? <p role="status" className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Refreshing…</p> : null}
          {state.agents.length === 0 ? (
            <ECard className="p-4 text-[0.875rem]">
              <p className="font-[550]">No agents yet.</p>
              <p className="text-[hsl(var(--e-muted-foreground))]">Create one with the New agent form; its token is shown once.</p>
            </ECard>
          ) : (
            state.agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                timeZone={timeZone}
                busy={busy}
                onRotate={() => openChange({ kind: "rotate", agent, expiresInDays: DEFAULT_EXPIRY_DAYS })}
                onChangeWrite={() => openChange({ kind: "write-areas", agent, writeAreas: writePacksOf(agent) })}
                onRevoke={() => openChange({ kind: "revoke", agent })}
              />
            ))
          )}
        </section>

        <NewAgentForm
          draft={draft}
          grantable={state.grantable}
          grantableWrite={state.grantableWrite}
          busy={busy}
          onChange={setDraft}
          onCreate={() => openChange({ kind: "create", draft: { ...draft, name: draft.name.trim() } })}
        />
      </div>

      <ConnectionGuide mcpUrl={state.mcpUrl} copied={guideCopied} onCopyAddress={() => void copyText(state.mcpUrl, "Address copied.", setGuideCopied)} />

      <AgentConfirmDialog
        pending={pending}
        grantableWrite={state.grantableWrite}
        busy={busy}
        error={dialogError}
        onChange={setPending}
        onClose={closeDialog}
        onConfirm={confirm}
      />
    </div>
  );
}
