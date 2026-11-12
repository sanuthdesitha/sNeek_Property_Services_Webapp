"use client";

/**
 * Pieces of the Suppliers side panel: definition lists, the laundry login
 * list, partner figures and chase history. Unknowns read as such ("Not
 * recorded", "–"); nothing is shown as zero that was not counted.
 */
import * as React from "react";
import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { SYDNEY_TZ } from "@/lib/time/sydney-range";
import type { LaundryPartnerRecord, LaundryTeamMember, StockSupplierRecord, TradeSupplierRecord } from "@/lib/suppliers/directory-types";
import { laundryRunsHref } from "@/lib/suppliers/directory-types";

export const PEOPLE_INVITE_HREF = "/v2/admin/accounts?tab=invitations";
export const MAINTENANCE_HREF = "/v2/admin/maintenance";

export function Facts({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.8125rem]">
      {rows.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-[hsl(var(--e-muted-foreground))]">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-[10px] border border-[hsl(var(--e-border))] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2"><span className="e-eyebrow">{title}</span>{action}</div>
      {children}
    </section>
  );
}

export function contactLines(email: string | null, phone: string | null): React.ReactNode {
  if (!email && !phone) return <span className="text-[hsl(var(--e-muted-foreground))]">No contact on file</span>;
  return <>{email ? <span className="block break-all">{email}</span> : null}{phone ? <span className="block">{phone}</span> : null}</>;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function seen(member: LaundryTeamMember): React.ReactNode {
  if (member.invitedAt) return <EPill tone="info">Invited {formatDistanceToNowStrict(new Date(member.invitedAt))} ago</EPill>;
  if (!member.isActive) return <EPill tone="neutral">Disabled</EPill>;
  if (member.lastSeenAt) return <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Seen {formatDistanceToNowStrict(new Date(member.lastSeenAt))} ago</span>;
  return <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Not seen yet</span>;
}

export function LoginList({ team, onRemove }: { team: LaundryTeamMember[]; onRemove?: (member: LaundryTeamMember) => void }) {
  if (team.length === 0) return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No laundry portal logins linked. Requests to this partner&apos;s team cannot be sent until one is.</p>;
  return (
    <ul className="space-y-1.5">
      {team.map((member) => {
        const name = member.name?.trim() || member.email;
        return (
          <li key={member.id} className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-primary)/0.12)] text-[0.65rem] font-[600] text-[hsl(var(--e-primary))]">{initials(name)}</span>
            <span className="min-w-0 flex-1 break-words text-[0.8125rem]"><b className="font-[600]">{name}</b> <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{member.email}</span></span>
            {seen(member)}
            {onRemove ? <EButton size="sm" variant="ghost" aria-label={`Remove ${name} from the team`} onClick={() => onRemove(member)}>Remove</EButton> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function partnerFacts(partner: LaundryPartnerRecord, stock: StockSupplierRecord | null): Array<[string, React.ReactNode]> {
  const stats = partner.stats;
  const agreed = partner.avgTurnaround == null ? "Not agreed" : `Agreed ${partner.avgTurnaround} h`;
  const actual = stats?.actualAvgHours == null ? "actual not measured yet" : `actual ${stats.actualAvgHours} h on average (${stats.measuredRuns} runs, 30 days)`;
  const chaseBy = [partner.email ? "Email" : null, partner.phone ? "SMS" : null].filter(Boolean);
  const rows: Array<[string, React.ReactNode]> = [
    ["Contact", contactLines(partner.email, partner.phone)],
    ["Turnaround", `${agreed} · ${actual}`],
    ["Price", partner.pricePerKg == null ? "Not recorded" : `$${partner.pricePerKg.toFixed(2)} per kg`],
    ["Properties", stats ? `${stats.recentProperties} with runs in the last 60 days` : "Not available"],
    ["Chase by", chaseBy.length ? `${chaseBy.join(" and ")} to the contact above` : "No stored contact: Chase supplier cannot send"],
  ];
  if (partner.address) rows.splice(1, 0, ["Address", partner.address]);
  if (stock) rows.push(["Same business", `Stock supplier record: ${stock.name}`]);
  return rows;
}

export function PartnerRunPills({ partner }: { partner: LaundryPartnerRecord }) {
  const stats = partner.stats;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {stats ? (
        <>
          <EPill>{stats.toPickUp} to pick up</EPill>
          <EPill>{stats.atLaundry} at the laundry</EPill>
          <EPill>{stats.toDrop} to drop</EPill>
          {stats.late ? <EPill tone="warn">{stats.late} over {partner.avgTurnaround} h</EPill> : null}
        </>
      ) : <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Run figures not available.</span>}
      <Link href={laundryRunsHref(partner.id)} className="ml-auto text-[0.75rem] text-[hsl(var(--e-primary))] hover:underline">Open in Laundry</Link>
    </div>
  );
}

export function ChaseHistory({ partner }: { partner: LaundryPartnerRecord }) {
  const chases = partner.stats?.chases;
  if (!chases) return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Chase history not available.</p>;
  if (!chases.length) return <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No chases in the last 90 days.</p>;
  return (
    <ul className="space-y-1 text-[0.8125rem]">
      {chases.map((chase) => (
        <li key={`${chase.at}:${chase.transport}`}>
          {formatInTimeZone(new Date(chase.at), SYDNEY_TZ, "EEE d MMM HH:mm")} · {chase.transport === "SMS" ? "SMS" : chase.transport === "EMAIL" ? "Email" : chase.transport} · {chase.state.replace(/_/g, " ")} · {chase.byName}
          {chase.taskId ? <> · <Link className="text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/laundry?open=${encodeURIComponent(chase.taskId)}`}>run</Link></> : null}
        </li>
      ))}
    </ul>
  );
}

export function stockFacts(stock: StockSupplierRecord): Array<[string, React.ReactNode]> {
  return [
    ["Contact", contactLines(stock.email, stock.phone)],
    ["Website", stock.website ? <a className="break-all text-[hsl(var(--e-primary))] hover:underline" href={/^https?:\/\//.test(stock.website) ? stock.website : `https://${stock.website}`} target="_blank" rel="noreferrer">{stock.website}</a> : "Not recorded"],
    ["Lead time", `${stock.defaultLeadDays} day${stock.defaultLeadDays === 1 ? "" : "s"}`],
    ["Categories", stock.categories.length ? stock.categories.join(", ") : "None"],
    ["Notes", stock.notes || "None"],
  ];
}

export function tradeFacts(trade: TradeSupplierRecord): Array<[string, React.ReactNode]> {
  return [
    ["Contact", contactLines(trade.email, trade.phone)],
    ["Trade", trade.trade || "Not recorded"],
    ["Person", trade.contactName],
    ["Call-out", "Not recorded"],
    ["Notes", trade.notes || "None"],
  ];
}
