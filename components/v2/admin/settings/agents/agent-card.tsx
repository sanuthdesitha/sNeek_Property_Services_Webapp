"use client";

/**
 * One agent as a card. The title band turns honey, with the written reason,
 * when read areas or write packs are withheld or the token cannot be used.
 * Shows what it may read and ask, expiry, last use and its recent calls
 * (wording from the stored call records only), with Change what it may ask,
 * Rotate token and Revoke for an active agent.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { EToneCard, toneMutedClass } from "@/components/v2/ui/tone-band";
import { cn } from "@/lib/utils";
import { callCost, callOutcome } from "./agent-call-outcome";
import { agentFlag, formatWhen, plural, readAreaLabel, writePackLabel, type AgentCallRecord, type AgentItem } from "./agent-model";

const LABEL = "text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]";
const MUTED = "text-[hsl(var(--e-muted-foreground))]";

/** How many calls show before "Show N more calls". */
const CALLS_SHOWN = 3;

function RecentCalls({ calls, timeZone }: { calls: AgentCallRecord[]; timeZone: string }) {
  const [expanded, setExpanded] = React.useState(false);
  if (calls.length === 0) {
    return (
      <div>
        <p className={LABEL}>Recent calls</p>
        <p className={cn("text-[0.8125rem]", MUTED)}>No calls yet.</p>
      </div>
    );
  }
  const shown = expanded ? calls : calls.slice(0, CALLS_SHOWN);
  const more = calls.length - shown.length;
  return (
    <div className="min-w-0">
      <p className={LABEL}>Recent calls · {calls.length} shown · tool, outcome, time taken</p>
      <ul className="mt-1 space-y-1.5 text-[0.75rem]">
        {shown.map((call, index) => {
          const outcome = callOutcome(call);
          return (
            <li key={`${call.at}-${index}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 sm:grid-cols-[9.5rem_minmax(0,1fr)_auto]">
              <span className={cn("e-tnum max-sm:col-span-2", MUTED)}>{formatWhen(call.at, timeZone)}</span>
              <span className="min-w-0 font-mono [overflow-wrap:anywhere]">
                {call.tool ?? call.method} <span className={cn("font-sans", MUTED)}>· {callCost(call)}</span>
              </span>
              <EPill tone={outcome.tone} className="h-auto min-h-5 whitespace-normal py-0.5 text-right">{outcome.label}</EPill>
            </li>
          );
        })}
      </ul>
      {more > 0 ? (
        <button type="button" className="mt-1 min-h-11 text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] underline underline-offset-2 sm:min-h-8" onClick={() => setExpanded(true)}>
          Show {plural(more, "more call")}
        </button>
      ) : null}
    </div>
  );
}

type AgentCardProps = {
  agent: AgentItem;
  timeZone: string;
  busy: boolean;
  onRotate: () => void;
  onChangeWrite: () => void;
  onRevoke: () => void;
};

export function AgentCard({ agent, timeZone, busy, onRotate, onChangeWrite, onRevoke }: AgentCardProps) {
  const flag = agentFlag(agent);
  const active = agent.status === "ACTIVE";
  const headingId = `agent-${agent.id}-name`;
  const tokenText = agent.token ? `${agent.token.prefix}…` : null;
  const subline = cn("text-[0.75rem]", flag.tone ? toneMutedClass(flag.tone) : MUTED);
  return (
    <EToneCard
      role="article"
      aria-labelledby={headingId}
      tone={flag.tone}
      header={
        <div className="min-w-0">
          <h3 id={headingId} className="text-[0.9375rem] font-semibold [overflow-wrap:anywhere]">{agent.name}</h3>
          <p className={subline}>
            Created by {agent.createdBy}, {formatWhen(agent.createdAt, timeZone)} · {tokenText ? <>token <span className="font-mono [overflow-wrap:anywhere]">{tokenText}</span></> : "no live token"}
          </p>
        </div>
      }
      pill={flag.tone ? flag.label : <EPill tone={active ? "ok" : "neutral"}>{flag.label}</EPill>}
      bodyClassName="space-y-3"
    >
      <div>
        <p className={LABEL}>{agent.effective.length ? `May read · ${plural(agent.effective.length, "area")}` : "May read"}</p>
        {agent.effective.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {agent.effective.map((key) => <EPill key={key}>{readAreaLabel(key)}</EPill>)}
          </div>
        ) : (
          <p className={cn("text-[0.8125rem]", MUTED)}>{active ? "Nothing: every area it was given is withheld." : "Nothing: revoked."}</p>
        )}
      </div>
      {agent.withheld.length ? (
        <p className="text-[0.8125rem]">
          Withheld because its creator, {agent.createdBy}, can no longer read them: <strong>{agent.withheld.map(readAreaLabel).join(", ")}</strong>. They come back if that access does.
        </p>
      ) : null}

      <div>
        <p className={LABEL}>May ask to change</p>
        {agent.writeEffective.length ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {agent.writeEffective.map((key) => <EPill key={key} tone="info" className="h-auto min-h-5 whitespace-normal py-0.5">{writePackLabel(key)}</EPill>)}
          </div>
        ) : (
          <p className={cn("text-[0.8125rem]", MUTED)}>Nothing: read only</p>
        )}
        {agent.waitingRequests > 0 ? (
          <p className="mt-1 text-[0.8125rem]">{plural(agent.waitingRequests, "request")} waiting in Approvals › Agent requests.</p>
        ) : null}
      </div>
      {agent.writeWithheld.length ? (
        <p className="text-[0.8125rem]">
          Write packs withheld because its creator, {agent.createdBy}, can no longer manage them: <strong>{agent.writeWithheld.map(writePackLabel).join(", ")}</strong>. They come back if that access does.
        </p>
      ) : null}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 gap-y-1 text-[0.8125rem]">
        <dt className={MUTED}>Expires</dt>
        <dd className="m-0">{agent.token ? `${formatWhen(agent.token.expiresAt, timeZone)}${agent.token.expired ? " (expired)" : ""}` : "No live token"}</dd>
        <dt className={MUTED}>Last used</dt>
        <dd className={cn("m-0", agent.token?.lastUsedAt ? undefined : MUTED)}>{agent.token ? formatWhen(agent.token.lastUsedAt, timeZone) : "No live token"}</dd>
      </dl>

      <RecentCalls calls={agent.recentCalls} timeZone={timeZone} />

      {active ? (
        <div className="flex flex-wrap gap-1.5 border-t border-[hsl(var(--e-border))] pt-2.5 max-sm:flex-col">
          <EButton type="button" size="sm" variant="outline" disabled={busy} onClick={onChangeWrite}>Change what it may ask…</EButton>
          <EButton type="button" size="sm" variant="outline" disabled={busy} onClick={onRotate}>Rotate token…</EButton>
          <span className="grow max-sm:hidden" aria-hidden />
          <EButton type="button" size="sm" variant="outline" disabled={busy} onClick={onRevoke} className="text-[hsl(var(--e-danger))]">Revoke…</EButton>
        </div>
      ) : null}
    </EToneCard>
  );
}
