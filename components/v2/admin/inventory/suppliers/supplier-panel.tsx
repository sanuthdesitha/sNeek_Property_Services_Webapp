"use client";

/**
 * Suppliers side panel (`?open=<key>`), as drawn: eyebrow with the type, the
 * name, a status line and a "⋯" menu (edit, delete). A laundry partner has
 * tabs Overview, Logins, Schedule, Runs, Costs; a stock supplier shows lead
 * days, categories and website; a trade shows its login and open cases (it
 * is edited in Maintenance, not here).
 */
import * as React from "react";
import Link from "next/link";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EPill } from "@/components/v2/ui/pill";
import { EButton } from "@/components/v2/ui/primitives";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import type { LaundryPartnerRecord, LaundryUserOption, StockSupplierRecord } from "@/lib/suppliers/directory-types";
import { laundryRunsHref } from "@/lib/suppliers/directory-types";
import { TYPE_LABELS, type DirectoryEntry } from "@/lib/suppliers/directory-view";
import { PartnerLoginDialog, type LoginChange } from "./partner-login-dialog";
import {
  ChaseHistory,
  Facts,
  LoginList,
  MAINTENANCE_HREF,
  PEOPLE_INVITE_HREF,
  PartnerRunPills,
  Section,
  partnerFacts,
  stockFacts,
  tradeFacts,
} from "./supplier-panel-sections";

type PartnerTab = "overview" | "logins" | "schedule" | "runs" | "costs";
const PARTNER_TABS: Array<{ id: PartnerTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "logins", label: "Logins" },
  { id: "schedule", label: "Schedule" },
  { id: "runs", label: "Runs" },
  { id: "costs", label: "Costs" },
];

export type PanelActions = {
  onEditPartner: (partner: LaundryPartnerRecord) => void;
  onEditStock: (stock: StockSupplierRecord) => void;
  onDeleteStock: (stock: StockSupplierRecord) => void;
  onSaved: () => void;
};

type Props = PanelActions & {
  entry: DirectoryEntry | null;
  laundryUsers: LaundryUserOption[];
  partnerNames: ReadonlyMap<string, string>;
  onClose: () => void;
};

function ScheduleNote() {
  return (
    <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
      No pickup and drop schedule is recorded for this partner. Planned pickup and drop times are set per run in Laundry (Set planned times).
    </p>
  );
}

function PartnerBody({ partner, stock, laundryUsers, partnerNames, onSaved }: { partner: LaundryPartnerRecord; stock: StockSupplierRecord | null; laundryUsers: LaundryUserOption[]; partnerNames: ReadonlyMap<string, string>; onSaved: () => void }) {
  const [tab, setTab] = React.useState<PartnerTab>("overview");
  const [change, setChange] = React.useState<LoginChange | null>(null);
  // Another partner opens on its overview, with no dialog left open.
  React.useEffect(() => {
    setTab("overview");
    setChange(null);
  }, [partner.id]);
  const logins = (
    <Section title="Laundry portal logins" action={<Link href={PEOPLE_INVITE_HREF} className="text-[0.75rem] text-[hsl(var(--e-primary))] hover:underline">+ Invite</Link>}>
      <LoginList team={partner.team} onRemove={tab === "logins" ? (member) => setChange({ mode: "remove", userId: member.id, name: member.name?.trim() || member.email }) : undefined} />
      <EButton size="sm" variant="outline" className="self-start" onClick={() => setChange({ mode: "link" })}>Link an existing laundry login</EButton>
    </Section>
  );
  return (
    <>
      <div role="tablist" aria-label="Partner details" className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--e-border))]">
        {PARTNER_TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`min-h-9 whitespace-nowrap px-2.5 text-[0.8125rem] ${tab === item.id ? "border-b-2 border-[hsl(var(--e-primary))] font-[600]" : "text-[hsl(var(--e-muted-foreground))]"}`}>
            {item.label}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <>
          <Facts rows={partnerFacts(partner, stock)} />
          {logins}
          <Section title="Pickup and drop schedule"><ScheduleNote /></Section>
          <PartnerRunPills partner={partner} />
        </>
      ) : null}
      {tab === "logins" ? logins : null}
      {tab === "schedule" ? <ScheduleNote /> : null}
      {tab === "runs" ? (
        <>
          <PartnerRunPills partner={partner} />
          <p className="text-[0.8125rem]">{partner.runCount} run{partner.runCount === 1 ? "" : "s"} on record. <Link className="text-[hsl(var(--e-primary))] hover:underline" href={laundryRunsHref(partner.id)}>Open the Pipeline filtered to {partner.name}</Link></p>
          <Section title="Chase history"><ChaseHistory partner={partner} /></Section>
        </>
      ) : null}
      {tab === "costs" ? (
        <>
          <Facts rows={[["Price", partner.pricePerKg == null ? "Not recorded" : `$${partner.pricePerKg.toFixed(2)} per kg`], ["On time", partner.stats?.onTimePct == null ? "–" : `${partner.stats.onTimePct}% of ${partner.stats.measuredRuns} runs, 30 days`]]} />
          <Link className="text-[0.8125rem] text-[hsl(var(--e-primary))] hover:underline" href={`/v2/admin/laundry?tab=reports&supplier=${encodeURIComponent(partner.id)}`}>Costs and invoices in Laundry</Link>
        </>
      ) : null}
      {change ? (
        <PartnerLoginDialog partner={partner} change={change} laundryUsers={laundryUsers} partnerNames={partnerNames} onClose={() => setChange(null)} onSaved={() => { setChange(null); onSaved(); }} />
      ) : null}
    </>
  );
}

export function SupplierPanel({ entry, laundryUsers, partnerNames, onClose, onEditPartner, onEditStock, onDeleteStock, onSaved }: Props) {
  if (!entry) return null;
  const partner = entry.row?.laundry ?? null;
  const stock = entry.row?.stock ?? null;
  const trade = entry.trade;
  const eyebrow = partner && stock ? "Laundry partner · Stock supplier" : partner ? "Laundry partner" : stock ? "Stock supplier" : "Trades and maintenance";
  const menu: ERowMenuItem[] = [
    ...(partner ? [{ key: "edit-partner", label: "Edit laundry partner", onSelect: () => onEditPartner(partner) }] : []),
    ...(stock ? [{ key: "edit-stock", label: "Edit stock supplier", onSelect: () => onEditStock(stock) }] : []),
    ...(trade ? [{ key: "trade", label: "Edit in Maintenance", href: MAINTENANCE_HREF }] : []),
    ...(stock ? [{ key: "delete-stock", label: "Delete stock supplier", danger: true, separated: true, onSelect: () => onDeleteStock(stock) }] : []),
  ];
  return (
    <ESidePanel
      open
      label={`Supplier: ${entry.name}`}
      title={entry.name}
      subtitle={<span>{entry.types.map((type) => TYPE_LABELS[type]).join(" · ")} · <EPill tone={entry.active ? "ok" : "neutral"}>{entry.active ? "Active" : "Inactive"}</EPill></span>}
      toolbar={<div className="flex items-center justify-between gap-2"><span className="e-eyebrow">{eyebrow}</span><ERowMenu label={`More for ${entry.name}: edit, delete`} items={menu} /></div>}
      onClose={onClose}
      className="lg:w-[350px]"
    >
      {entry.attention.length ? <ul className="list-disc pl-5 text-[0.8125rem] text-[hsl(var(--e-warning,var(--e-danger)))]">{entry.attention.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
      {partner ? <PartnerBody partner={partner} stock={stock} laundryUsers={laundryUsers} partnerNames={partnerNames} onSaved={onSaved} /> : null}
      {stock && !partner ? <Facts rows={stockFacts(stock)} /> : null}
      {stock && partner ? <Section title="Stock supplier record"><Facts rows={stockFacts(stock)} /></Section> : null}
      {trade ? (
        <>
          <Facts rows={tradeFacts(trade)} />
          <Section title="Maintenance portal login">
            {trade.login ? <p className="text-[0.8125rem] break-all">{trade.login.email}{trade.login.isActive ? "" : " (disabled)"}</p> : <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No portal login. The office assigns work to this trade directly.</p>}
          </Section>
          <Section title="Open cases"><p className="text-[0.8125rem]">{trade.openCases ? `${trade.openCases} assigned and not resolved.` : "None assigned."} <Link className="text-[hsl(var(--e-primary))] hover:underline" href={MAINTENANCE_HREF}>Open Maintenance</Link></p></Section>
        </>
      ) : null}
    </ESidePanel>
  );
}
