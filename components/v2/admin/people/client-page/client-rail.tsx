/**
 * Client page right rail as drawn: Contact and notes, Portal logins (with the
 * assistant teams), Billing (terms, 12-month revenue, cleaner cost, margin),
 * What the client sees (a summary of the portal visibility switches; the
 * editor is the existing client edit dialog, from the Portal access tab),
 * Messages and automation, Documents. Server-renderable; editors are the
 * existing components on their tabs.
 */
import Link from "next/link";
import { EPill } from "@/components/v2/ui/pill";
import { formatLastSeen, formatMoney } from "@/components/v2/admin/accounts/hub/account-display";
import type { ClientSummary } from "@/lib/people/clients/summary-types";
import { termsLabel } from "../format";
import { Card } from "./client-sections";

export type VisibilityItem = { key: string; label: string; shown: boolean; overridden: boolean };

const muted = "text-[hsl(var(--e-muted-foreground))]";

export function ClientRail({ summary, visibility }: { summary: ClientSummary; visibility: VisibilityItem[] }) {
  const base = `/v2/admin/clients/${summary.id}`;
  const shown = visibility.filter((item) => item.shown);
  const overrides = visibility.filter((item) => item.overridden).length;
  return (
    <aside aria-label="Client details" className="flex w-full flex-col gap-3 lg:w-[340px] lg:flex-none">
      <Card title="Contact and notes" action={<Link className="text-[0.8125rem] underline" href={`${base}?tab=portal`}>Edit</Link>}>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-[0.8125rem]">
          <dt className={muted}>Phone</dt><dd>{summary.phone ? <a className="underline" href={`tel:${summary.phone}`}>{summary.phone}</a> : "–"}</dd>
          <dt className={muted}>Email</dt><dd className="break-all">{summary.email ?? "–"}</dd>
          <dt className={muted}>Address</dt><dd>{[summary.address, summary.suburb].filter(Boolean).join(", ") || "–"}</dd>
          <dt className={muted}>Office notes</dt><dd className="whitespace-pre-line">{summary.notes?.trim() || <span className={muted}>None</span>}</dd>
        </dl>
      </Card>
      <Card title="Portal logins" action={<Link className="text-[0.8125rem] underline" href={`${base}?tab=portal`}>Send portal invite</Link>}>
        {summary.logins.length === 0 ? <p className={`text-[0.8125rem] ${muted}`}>No portal login yet.</p> : null}
        {summary.logins.map((login) => (
          <div key={login.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
            <Link href={`/v2/admin/accounts/users/${login.id}`} className="hover:underline">{login.name ?? login.email}</Link>
            <span className={muted}>{login.invited ? "Invited" : !login.isActive ? "Disabled" : formatLastSeen(login.lastSeenAt)}</span>
          </div>
        ))}
        {summary.teams.map((team) => (
          <div key={team.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
            <span>{team.name} <span className={muted}>{team.members} assistant{team.members === 1 ? "" : "s"}, {team.propertyCount === null ? "all properties" : `${team.propertyCount} properties`}</span></span>
            <Link className="underline" href={`/v2/admin/accounts?tab=assistants&team=${team.id}`}>Manage access</Link>
          </div>
        ))}
      </Card>
      {summary.money ? (
        <Card title="Billing" action={<Link className="text-[0.8125rem] underline" href={`${base}?tab=profit`}>Edit terms</Link>}>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-[0.8125rem] e-tnum">
            <dt className={muted}>Terms</dt><dd>{termsLabel(summary.terms)}</dd>
            <dt className={muted}>Revenue</dt><dd>{summary.money.revenue12 === null ? "–" : `${formatMoney(summary.money.revenue12)}, 12 mo`}</dd>
            <dt className={muted}>Cleaner cost</dt><dd>{summary.money.cleanerCost12 === null ? "–" : formatMoney(summary.money.cleanerCost12)}</dd>
            <dt className={muted}>Margin</dt><dd>{summary.money.margin12 === null ? "–" : `${formatMoney(summary.money.margin12)}${summary.money.marginPct12 === null ? "" : ` · ${summary.money.marginPct12.toFixed(0)}%`}`}</dd>
          </dl>
          <p className={`text-[0.75rem] ${muted}`}>Turnover rates are set per property.</p>
        </Card>
      ) : null}
      <Card title="What the client sees" action={<Link className="text-[0.8125rem] underline" href={`${base}?tab=portal`}>Edit</Link>}>
        <p className="text-[0.8125rem]">{shown.length} shown, {visibility.length - shown.length} hidden, {overrides === 0 ? "organisation defaults" : `${overrides} override${overrides === 1 ? "" : "s"}`}</p>
        <div className="flex flex-wrap gap-1">
          {visibility.slice(0, 11).map((item) => <EPill key={item.key} tone={item.shown ? "ok" : "neutral"}>{item.label}</EPill>)}
          {visibility.length > 11 ? <span className={`text-[0.75rem] ${muted}`}>+{visibility.length - 11}</span> : null}
        </div>
      </Card>
      <Card title="Messages and automation" action={<Link className="text-[0.8125rem] underline" href={`${base}?tab=messages`}>Sent history</Link>}>
        <p className={`text-[0.8125rem] ${muted}`}>Automation rules, custom messages and everything sent are in Messages.</p>
        <div className="flex flex-wrap gap-2 text-[0.8125rem]">
          <Link className="underline" href={`${base}?tab=messages`}>Send update</Link>
          <Link className="underline" href={`${base}?tab=messages#automation`}>New rule</Link>
        </div>
      </Card>
      <Card title="Documents" action={<Link className="text-[0.8125rem] underline" href={`${base}?tab=documents`}>Re-send</Link>}>
        <p className={`text-[0.8125rem] ${muted}`}>Quote, invoice, checklist, add-ons, link or report.</p>
      </Card>
    </aside>
  );
}
