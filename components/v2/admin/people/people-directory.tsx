"use client";

/**
 * People as drawn: one h1, a real summary line, Export / Invite person / New
 * client, one tab per group, and each tab's own body (columns, chips, figures,
 * bulk bar, side panel). The tab lives in `?tab=`; switching tabs starts that
 * tab's own filters afresh (its URL values are dropped), Back/Forward follow.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EButton } from "@/components/v2/ui/primitives";
import type { EstateBirthdayRow } from "@/components/v2/admin/accounts/birthdays-card";
import type { EstateVaClientOption } from "@/components/v2/admin/accounts/va-manager";
import { InvitePersonDialog } from "@/components/v2/admin/accounts/hub/invite-person-dialog";
import { CREATE_ROLE_FOR_TAB } from "@/components/v2/admin/accounts/hub/managed-roles";
import type { CleanerFigures } from "@/lib/people/cleaner-figures";
import type { PeopleCounts } from "@/lib/people/counts";
import { accountListTabFor, allowedPeopleTabs, normalizePeopleTab, type PeopleAccess, type PeopleTab } from "@/lib/people/tabs";
import { AccountListTab } from "./account-list-tab";
import { AssistantsTab } from "./assistants/assistants-tab";
import { ClientsTab } from "./clients/clients-tab";
import { InvitationsTab } from "./invitations/invitations-tab";
import { PeopleTabs } from "./people-tabs";
import { SuppliersSection } from "./suppliers-section";

export type PeopleCapabilities = {
  isAdmin: boolean;
  canWriteNotes: boolean;
  canMessageStaff: boolean;
  canSeeWorkforce: boolean;
  canViewAddresses: boolean;
};

function count(value: number | null, one: string, many: string): string {
  if (value === null) return `– ${many}`;
  return `${value} ${value === 1 ? one : many}`;
}

function summaryLine(counts: PeopleCounts, access: PeopleAccess): string {
  const parts = [
    access.clients ? count(counts.clients, "client", "clients") : null,
    count(counts.cleaners, "cleaner", "cleaners"),
    `${counts.office ?? "–"} office and other staff`,
    count(counts.partners, "partner or supplier", "partners and suppliers"),
    count(counts.assistants, "client assistant", "client assistants"),
    count(counts.invitationsOpen, "invitation open", "invitations open"),
  ];
  return parts.filter(Boolean).join(" · ");
}

export function PeopleDirectory({
  initialTab,
  initialSearch,
  access,
  capabilities,
  counts,
  cleanerFigures,
  vaClients,
  birthdays,
}: {
  initialTab: PeopleTab;
  initialSearch: string;
  access: PeopleAccess;
  capabilities: PeopleCapabilities;
  counts: PeopleCounts;
  cleanerFigures: CleanerFigures;
  vaClients: EstateVaClientOption[];
  birthdays: EstateBirthdayRow[];
}) {
  const [tab, setTab] = useState<PeopleTab>(initialTab);
  const [search, setSearch] = useState(initialSearch);
  const [exportHref, setExportHref] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const allowed = allowedPeopleTabs(access);

  useEffect(() => {
    const sync = () => {
      const next = normalizePeopleTab(new URLSearchParams(window.location.search).get("tab"), initialTab);
      setSearch(window.location.search);
      setTab(allowed.includes(next) ? next : initialTab);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [allowed, initialTab]);

  const selectTab = useCallback((next: PeopleTab) => {
    const query = `?tab=${next}`;
    window.history.pushState(window.history.state, "", `${window.location.pathname}${query}`);
    setSearch(query);
    setExportHref(null);
    setTab(next);
  }, []);

  const listTab = accountListTabFor(tab);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="e-display-md">People</h1>
          <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{summaryLine(counts, access)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {exportHref ? (
            <EButton asChild variant="outline" size="sm">
              <a href={exportHref} download>Export</a>
            </EButton>
          ) : null}
          {capabilities.isAdmin ? <EButton size="sm" variant="outline" onClick={() => setInviteOpen(true)}>Invite person</EButton> : null}
          {access.clients ? (
            <EButton asChild size="sm" variant="primary">
              <Link href="/v2/admin/clients/new">New client</Link>
            </EButton>
          ) : null}
        </div>
      </header>

      <PeopleTabs active={tab} counts={counts} access={access} onSelect={selectTab} />

      <div key={`${tab}:${revision}`} className="min-w-0">
        {tab === "clients" ? (
          <ClientsTab initialSearch={search} counts={counts} onExportHref={setExportHref} onSelectView={selectTab} />
        ) : tab === "invitations" ? (
          <InvitationsTab initialSearch={search} canWrite={capabilities.canWriteNotes} />
        ) : tab === "assistants" ? (
          <AssistantsTab canManage={capabilities.isAdmin} canResend={capabilities.canWriteNotes} clients={vaClients} initialSearch={search} />
        ) : listTab ? (
          <div className="flex flex-col gap-6">
            <AccountListTab
              peopleTab={tab}
              listTab={listTab}
              initialSearch={search}
              capabilities={capabilities}
              counts={counts}
              cleanerFigures={cleanerFigures}
              birthdays={birthdays}
              onExportHref={setExportHref}
              onSelectView={selectTab}
            />
            {tab === "partners" ? <SuppliersSection /> : null}
          </div>
        ) : null}
      </div>

      {capabilities.isAdmin ? (
        <InvitePersonDialog
          open={inviteOpen}
          defaultRole={CREATE_ROLE_FOR_TAB[listTab ?? "everyone"]}
          onClose={() => setInviteOpen(false)}
          onCreated={() => setRevision((value) => value + 1)}
        />
      ) : null}
    </div>
  );
}
