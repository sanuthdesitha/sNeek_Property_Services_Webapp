"use client";

/**
 * "Move to team…" (owner decision 2026-11-13): move one assistant to another
 * team of the SAME client. Only that client's other teams are offered; the
 * dialog states exactly what access changes ("Loses: …  Gains: …", property
 * scope) from the same pure rule the server records (lib/va/move-rules.ts);
 * a switched-off destination needs an explicit tick. The choice is frozen
 * while the move is in flight and a failed move keeps it for a retry.
 * PATCH /api/admin/va-teams/[id]/members/[userId] re-checks everything.
 */
import { useMemo, useState } from "react";
import { EActionDialog } from "@/components/v2/ui/action-dialog";
import { EButton } from "@/components/v2/ui/primitives";
import type { AssistantMember, AssistantTeam } from "@/lib/people/assistants";
import { moveAccessChange, moveRefusal, MOVE_REFUSAL_TEXT, type MoveTeamFacts } from "@/lib/va/move-rules";

function facts(team: AssistantTeam): MoveTeamFacts {
  return { id: team.id, name: team.name, clientId: team.client.id, isActive: team.isActive, permissions: team.permissions, propertyIds: team.propertyIds };
}

export type MoveTeamDialogProps = {
  member: AssistantMember;
  from: AssistantTeam;
  teams: AssistantTeam[];
  onClose: () => void;
  onMoved: (message: string) => void;
};

export function MoveTeamDialog({ member, from, teams, onClose, onMoved }: MoveTeamDialogProps) {
  const options = useMemo(() => teams.filter((team) => team.client.id === from.client.id && team.id !== from.id), [teams, from]);
  const [toId, setToId] = useState(options[0]?.id ?? "");
  const [confirmInactive, setConfirmInactive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const to = options.find((team) => team.id === toId) ?? null;
  const names = useMemo(() => new Map(from.properties.map((property) => [property.id, property.name])), [from]);
  const change = to ? moveAccessChange(facts(from), facts(to), names) : null;
  const refusal = to ? moveRefusal(facts(from), facts(to), confirmInactive) : null;
  const who = member.name ?? member.email;

  async function move() {
    if (!to || refusal) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/va-teams/${encodeURIComponent(from.id)}/members/${encodeURIComponent(member.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toTeamId: to.id, confirmInactive }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error ?? `The move failed (${response.status}). Nothing changed.`);
        return;
      }
      onMoved(`${who} moved to ${to.name}. Their access follows ${to.name} from their next request.`);
    } catch {
      setError("Could not reach the server. Nothing was confirmed; reload before trying again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EActionDialog
      open
      title={`Move ${who} to another team`}
      eyebrow={`${from.client.name} · now on ${from.name}`}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <EButton size="sm" variant="outline" disabled={busy} onClick={onClose}>Cancel</EButton>
          <EButton size="sm" disabled={busy || !to || refusal !== null} onClick={() => void move()}>{busy ? "Moving…" : "Move assistant"}</EButton>
        </>
      }
    >
      {options.length === 0 ? (
        <p className="text-[0.8125rem]">{from.client.name} has no other team. Create one first; assistants never move to another client&apos;s team.</p>
      ) : (
        <fieldset disabled={busy} className="flex flex-col gap-3 text-[0.8125rem]">
          <label className="flex flex-col gap-1">
            <span className="font-[550]">Team of {from.client.name}</span>
            <select data-autofocus value={toId} onChange={(event) => { setToId(event.target.value); setConfirmInactive(false); }} className="h-9 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2">
              {options.map((team) => <option key={team.id} value={team.id}>{team.name}{team.isActive ? "" : " (switched off)"}</option>)}
            </select>
          </label>
          {change ? (
            <div aria-live="polite" className="space-y-1 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2">
              <p><b className="font-[600]">Loses:</b> {change.loses.length ? change.loses.join(", ") : "nothing"}</p>
              <p><b className="font-[600]">Gains:</b> {change.gains.length ? change.gains.join(", ") : "nothing"}</p>
              {change.scope ? <p>{change.scope}</p> : <p>Properties: unchanged.</p>}
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Their old team&apos;s permissions stop applying from their next request. Their sign-in is unchanged.</p>
            </div>
          ) : null}
          {to && !to.isActive ? (
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={confirmInactive} onChange={(event) => setConfirmInactive(event.target.checked)} className="mt-0.5" />
              <span>{MOVE_REFUSAL_TEXT.DESTINATION_INACTIVE}</span>
            </label>
          ) : null}
        </fieldset>
      )}
      {error ? <p role="alert" className="mt-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">{error}</p> : null}
    </EActionDialog>
  );
}
