"use client";

/**
 * Account emails (person panel, Activity tab and full page): what account
 * emails were sent to this person, when, to which address, and what the email
 * provider answered ("Not recorded" when nothing was recorded; accepted is not
 * delivered). Senders (ADMIN, or OPS_MANAGER with Staff accounts at manage;
 * never to a higher role) can resend: the invitation link, a password reset
 * link, or the sign-up code — each a fresh one that replaces the previous —
 * and copy a pending invitation link. Reads for a previous person are aborted
 * and never shown; buttons freeze while a send is in flight; a failed send
 * keeps its message until the next action.
 * Endpoints: GET/POST /api/admin/users/[id]/account-emails,
 * POST /api/admin/users/[id]/account-emails/invitation-link.
 */
import { useEffect, useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import type { AccountEmailState, AccountEmailType } from "@/lib/accounts/account-email-rules";
import { formatDateTime } from "../hub/account-display";

type HistoryEntry = { id: string; label: string; at: string; to: string | null; state: AccountEmailState; stateLabel: string; sentBy: string; note: string | null };
type Option = { type: AccountEmailType; label: string; allowed: boolean; reason: string | null };
type Overview = {
  email: string;
  invitation: { expiresAt: string; acceptedAt: string | null; expired: boolean } | null;
  options: Option[];
  canCopyInvitationLink: boolean;
  history: HistoryEntry[];
  coolDownMinutes: number;
};
type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; overview: Overview };
type ActionState =
  | { status: "idle" }
  | { status: "confirming"; type: AccountEmailType }
  | { status: "working"; label: string }
  | { status: "done"; message: string; tone: EPillTone }
  | { status: "failed"; message: string };

const STATE_TONE: Record<AccountEmailState, EPillTone> = { ACCEPTED: "ok", NOT_ACCEPTED: "bad", UNKNOWN: "warn", SKIPPED: "warn", NOT_RECORDED: "neutral" };
const STATE_SHORT: Record<AccountEmailState, string> = { ACCEPTED: "Accepted", NOT_ACCEPTED: "Not sent", UNKNOWN: "Unknown", SKIPPED: "Not sent", NOT_RECORDED: "Not recorded" };

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  return (await response.json().catch(() => null)) as Record<string, unknown> | null;
}

export function AccountEmailsSection({ userId }: { userId: string }) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<ActionState>({ status: "idle" });

  // A different person starts over; their read replaces nothing of the last person.
  useEffect(() => setAction({ status: "idle" }), [userId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoad((current) => (current.status === "ready" && revision > 0 ? current : { status: "loading" }));
    fetch(`/api/admin/users/${encodeURIComponent(userId)}/account-emails`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await readJson(response);
        if (controller.signal.aborted) return;
        if (!response.ok || !body || !Array.isArray(body.history)) throw new Error(typeof body?.error === "string" ? body.error : `Could not load account emails (${response.status}).`);
        setLoad({ status: "ready", overview: body as unknown as Overview });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: reason instanceof Error ? reason.message : "Could not load account emails." });
      });
    return () => controller.abort();
  }, [userId, revision]);

  async function send(option: Option) {
    setAction({ status: "working", label: `Sending ${option.label.toLowerCase()}…` });
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/account-emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: option.type }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        setAction({ status: "failed", message: typeof body?.error === "string" ? body.error : `Could not send (${response.status}).` });
        return;
      }
      const state = body?.state as AccountEmailState | undefined;
      const label = typeof body?.stateLabel === "string" ? body.stateLabel : "Sent";
      setAction({ status: "done", message: `${option.label}: ${label}${typeof body?.error === "string" && body.error ? ` (${body.error})` : ""}`, tone: state ? STATE_TONE[state] : "neutral" });
      setRevision((value) => value + 1);
    } catch {
      setAction({ status: "failed", message: "Could not reach the server. Nothing was confirmed as sent; reload before trying again." });
    }
  }

  async function copyLink() {
    setAction({ status: "working", label: "Copying the invitation link…" });
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/account-emails/invitation-link`, { method: "POST" });
      const body = await readJson(response);
      if (!response.ok || typeof body?.link !== "string") {
        setAction({ status: "failed", message: typeof body?.error === "string" ? body.error : `Could not read the link (${response.status}).` });
        return;
      }
      await navigator.clipboard.writeText(body.link);
      setAction({ status: "done", message: `Invitation link copied. It works until ${formatDateTime(String(body.expiresAt))}.`, tone: "ok" });
      setRevision((value) => value + 1);
    } catch {
      setAction({ status: "failed", message: "Could not copy the link to the clipboard." });
    }
  }

  const working = action.status === "working";
  const overview = load.status === "ready" ? load.overview : null;
  const allowed = overview?.options.filter((option) => option.allowed) ?? [];
  const refusal = overview && allowed.length === 0 ? overview.options.find((option) => option.reason)?.reason ?? null : null;

  return (
    <section aria-label="Account emails" className="flex flex-col gap-2 rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-2.5">
      <h3 className="text-[0.65625rem] font-[600] uppercase tracking-[0.1em] text-[hsl(var(--e-gold-ink))]">Account emails</h3>
      {load.status === "loading" ? <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading account emails…</p> : null}
      {load.status === "error" ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[0.8125rem]">
          <span className="text-[hsl(var(--e-danger))]">{load.message}</span>
          <EButton size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>Try again</EButton>
        </div>
      ) : null}
      {overview ? (
        <>
          <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
            Sent only to the account address: {overview.email}.
            {overview.invitation
              ? overview.invitation.acceptedAt
                ? ` Invitation accepted ${formatDateTime(overview.invitation.acceptedAt)}.`
                : overview.invitation.expired
                  ? ` Invitation expired ${formatDateTime(overview.invitation.expiresAt)}; never signed in.`
                  : ` Invitation pending until ${formatDateTime(overview.invitation.expiresAt)}; never signed in.`
              : ""}
          </p>
          {allowed.length || overview.canCopyInvitationLink ? (
            <div className="flex flex-wrap gap-1.5">
              {allowed.map((option) => (
                <EButton key={option.type} size="sm" variant="outline" disabled={working} onClick={() => setAction({ status: "confirming", type: option.type })}>
                  {option.label}
                </EButton>
              ))}
              {overview.canCopyInvitationLink ? <EButton size="sm" variant="ghost" disabled={working} onClick={() => void copyLink()}>Copy invitation link</EButton> : null}
            </div>
          ) : refusal ? (
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{refusal}</p>
          ) : null}
          {action.status === "confirming" ? (
            <ConfirmSend
              option={overview.options.find((option) => option.type === action.type)!}
              email={overview.email}
              coolDownMinutes={overview.coolDownMinutes}
              onCancel={() => setAction({ status: "idle" })}
              onConfirm={(option) => void send(option)}
            />
          ) : null}
          {action.status === "working" ? <p role="status" className="text-[0.75rem]">{action.label}</p> : null}
          {action.status === "done" ? <p role="status" className="text-[0.75rem]"><EPill tone={action.tone}>Result</EPill> {action.message}</p> : null}
          {action.status === "failed" ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">{action.message}</p> : null}
          {overview.history.length === 0 ? (
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No account emails recorded for this person.</p>
          ) : (
            <ul className="space-y-2">
              {overview.history.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2 border-b border-[hsl(var(--e-border)/0.7)] pb-2 last:border-b-0 last:pb-0">
                  <EPill tone={STATE_TONE[entry.state]}>{STATE_SHORT[entry.state]}</EPill>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.8125rem] font-[550] [overflow-wrap:anywhere]">{entry.label}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">
                      {formatDateTime(entry.at)} · {entry.sentBy}{entry.to ? ` · to ${entry.to}` : ""}
                    </p>
                    <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))] [overflow-wrap:anywhere]">{entry.stateLabel}{entry.note ? ` · ${entry.note}` : ""}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">Sign-in codes and two-step emails the person requests while signing in are not listed.</p>
        </>
      ) : null}
    </section>
  );
}

function ConfirmSend({ option, email, coolDownMinutes, onCancel, onConfirm }: { option: Option; email: string; coolDownMinutes: number; onCancel: () => void; onConfirm: (option: Option) => void }) {
  const replaces = option.type === "INVITATION" ? "The previous invitation link stops working." : option.type === "PASSWORD_RESET" ? "Any earlier reset link stops working; the password does not change until they choose a new one." : "Any earlier code stops working.";
  return (
    <div role="group" aria-label={`Confirm ${option.label}`} className="space-y-2 rounded-[var(--e-radius)] bg-[hsl(var(--e-surface-raised))] px-3 py-2 text-[0.8125rem]">
      <p>Send a fresh {option.label.replace(/^(Resend|Send) /, "").toLowerCase()} to <b className="font-[600] [overflow-wrap:anywhere]">{email}</b>? {replaces} One per person every {coolDownMinutes} minutes.</p>
      <div className="flex gap-1.5">
        <EButton size="sm" onClick={() => onConfirm(option)}>{option.label}</EButton>
        <EButton size="sm" variant="outline" onClick={onCancel}>Cancel</EButton>
      </div>
    </div>
  );
}
