"use client";

/**
 * People › Invitations (account emails) as drawn: four figures, type chips,
 * search and state chips, sender and period, the server-paged list, bulk
 * Resend, and the detail panel (invitation facts, the person's account email
 * history with Resend and Copy link, Open account).
 *
 * Built on GET /api/admin/users/account-emails and the existing per-person
 * account email section; sends go through the existing audited routes.
 * "Revoke" (owner decision 2026-11-13) withdraws a pending invitation from the
 * row menu, the detail panel and bulk, with a confirm; the "Revoked" chip
 * lists withdrawn ones. Not built (reported): "Send by SMS instead" (no SMS
 * path for account emails); Bounced and Opened are not stored for account
 * emails, so the Bounced figure says "Not recorded".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { EDataTable } from "@/components/v2/ui/data-table";
import { EPagination } from "@/components/v2/ui/pagination";
import { EPill } from "@/components/v2/ui/pill";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { E_CHIP_CLASS, E_CHIP_ON_CLASS } from "@/components/v2/ui/filter-chips";
import { EFilterBar, type EActiveFilter } from "@/components/v2/ui/filter-bar";
import { AccountsBulk } from "@/components/v2/admin/accounts/hub/accounts-bulk";
import { AccountEmailsSection } from "@/components/v2/admin/accounts/person/account-emails-section";
import type { AccountRow } from "@/lib/accounts/list/types";
import { ACCOUNT_EMAIL_KINDS, ACCOUNT_EMAIL_KIND_LABEL, type AccountEmailListResponse, type AccountEmailListRow, type EmailStateFilter } from "@/lib/people/account-emails/types";
import { copyInvitationLink } from "../copy-invite-link";
import { FactStrip } from "../fact-strip";
import { formatInstantDay } from "../format";
import { useRead } from "../use-read";
import { RevokeInvitationDialog, type RevokeTarget } from "../revoke-invitation-dialog";
import { invitationColumns } from "./invitation-columns";
import { DEFAULT_INVITATIONS_VIEW, invitationsListQuery, invitationsViewSearch, patchInvitationsView, readInvitationsView, type InvitationsView } from "./invitations-view";

const STATE_CHIPS: Array<{ key: EmailStateFilter; label: string }> = [
  { key: "never-signed-in", label: "Never signed in" },
  { key: "expired", label: "Expired" },
  { key: "not-sent", label: "Not sent" },
  { key: "revoked", label: "Revoked" },
];
const SEARCH_DELAY_MS = 300;

function isList(body: unknown): body is AccountEmailListResponse {
  return Boolean(body && typeof body === "object" && Array.isArray((body as { rows?: unknown }).rows) && "figures" in body);
}

/** The bulk bar works on account rows; only the fields it reads are filled. */
function asAccountRow(row: AccountEmailListRow): AccountRow {
  return {
    id: row.userId, name: row.name, email: row.email, phone: null, role: row.role as AccountRow["role"], extraRoles: [], status: row.expiresAt ? "INVITED" : "ACTIVE",
    inviteAgeDays: null, emailVerified: true, twoFactorEnabled: false, clientName: null, documents: { kind: "NONE", label: "" }, jobsWeek: 0, lastSeenAt: row.signedInAt, attention: [],
  };
}

function EmailPanel({ row, onClose, onChanged }: { row: AccountEmailListRow; onClose: () => void; onChanged: () => void }) {
  return (
    <ESidePanel open label="Account email details" title={row.name ?? row.email} subtitle={`${row.context ?? row.role} · ${row.revokedAt ? "invitation withdrawn" : row.expiresAt ? (row.expired ? "invitation lapsed" : "invited, not accepted") : row.signedInAt ? "signed in" : "never signed in"}`} onClose={onClose}>
      <div className="flex flex-col gap-4 text-[0.8125rem]">
        <section className="flex flex-col gap-1.5">
          <h3 className="e-eyebrow">Latest</h3>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
            <dt className="text-[hsl(var(--e-muted-foreground))]">To</dt><dd className="break-all">{row.email}</dd>
            <dt className="text-[hsl(var(--e-muted-foreground))]">Email</dt><dd>{ACCOUNT_EMAIL_KIND_LABEL[row.kind]}</dd>
            {row.expiresAt ? (<><dt className="text-[hsl(var(--e-muted-foreground))]">Link</dt><dd>{row.expired ? `Lapsed ${formatInstantDay(row.expiresAt)}` : `Valid until ${formatInstantDay(row.expiresAt)}`}</dd></>) : null}
            <dt className="text-[hsl(var(--e-muted-foreground))]">Sent by</dt><dd>{row.sentBy}</dd>
          </dl>
        </section>
        {/* The person panel's own section: history timeline, Resend (warns that the old link stops working) and Copy link. */}
        <AccountEmailsSection key={row.userId} userId={row.userId} onChanged={onChanged} />
        <div className="flex flex-wrap gap-2">
          <EButton asChild size="sm" variant="outline"><Link href={`/v2/admin/accounts/users/${row.userId}`}>Open account</Link></EButton>
          <EButton size="sm" variant="ghost" onClick={onChanged}>Refresh list</EButton>
        </div>
      </div>
    </ESidePanel>
  );
}

export function InvitationsTab({ initialSearch, canWrite }: { initialSearch: string; canWrite: boolean }) {
  const [view, setView] = useState<InvitationsView>(() => readInvitationsView(initialSearch));
  const [search, setSearch] = useState(view.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [revoking, setRevoking] = useState<RevokeTarget[] | null>(null);
  const query = invitationsListQuery(view);
  const list = useRead<AccountEmailListResponse>(`/api/admin/users/account-emails?${query}`, isList, { failure: "Could not load account emails." });

  const update = useCallback((patch: Partial<InvitationsView>) => {
    setView((current) => {
      const next = patchInvitationsView(current, patch);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${invitationsViewSearch(next)}`);
      return next;
    });
  }, []);

  useEffect(() => setSelected(new Set()), [query]);
  useEffect(() => {
    if (search === view.q) return;
    const timer = window.setTimeout(() => update({ q: search }), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, view.q, update]);

  const copyLink = useCallback(async (row: AccountEmailListRow) => {
    setBusy(true);
    setNotice(await copyInvitationLink(row.userId));
    setBusy(false);
  }, []);

  const data = list.data;
  const rows = data?.rows ?? [];
  const open = useCallback((row: AccountEmailListRow) => update({ open: row.userId }), [update]);
  const revokeRow = useCallback((row: AccountEmailListRow) => setRevoking([{ userId: row.userId, label: row.name ?? row.email }]), []);
  const columns = useMemo(() => invitationColumns({ onOpen: open, onCopyLink: copyLink, onRevoke: revokeRow, busy }), [open, copyLink, revokeRow, busy]);
  const openRow = rows.find((row) => row.userId === view.open) ?? null;
  const selectedRows = rows.filter((row) => selected.has(row.userId)).map(asAccountRow);
  const revocable = rows.filter((row) => selected.has(row.userId) && row.canRevoke);
  const figures = data?.figures;
  const canBulk = canWrite && !data?.viewerRefusal;
  // Phones (board M-People2): search, state, sender and period behind one Filter button.
  const periodLabel: Record<InvitationsView["period"], string> = { "30d": "Last 30 days", "90d": "Last 90 days", all: "Last 12 months" };
  const emailFilters: EActiveFilter[] = [];
  if (search.trim()) emailFilters.push({ key: "q", label: `Search: ${search.trim()}`, onRemove: () => { setSearch(""); update({ q: "" }); } });
  const stateChip = STATE_CHIPS.find((chip) => chip.key === view.state);
  if (stateChip) emailFilters.push({ key: "state", label: stateChip.label, onRemove: () => update({ state: DEFAULT_INVITATIONS_VIEW.state }) });
  if (view.sentBy) emailFilters.push({ key: "sentBy", label: `Sent by: ${data?.senders.find((sender) => sender.id === view.sentBy)?.name ?? "Selected"}`, onRemove: () => update({ sentBy: "" }) });
  if (view.period !== DEFAULT_INVITATIONS_VIEW.period) emailFilters.push({ key: "period", label: periodLabel[view.period], onRemove: () => update({ period: DEFAULT_INVITATIONS_VIEW.period }) });

  return (
    <div className="flex min-w-0 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Invitations, codes and password resets: every email that gets a person into the app. Document requests are in each person&apos;s Documents and in Compliance.</p>
        <FactStrip
          label="Account email figures"
          collapsible={{ storageKey: "people:invitations" }}
          facts={[
            { key: "open", label: "Not accepted", value: figures ? figures.notAccepted : null, extra: figures && figures.expired > 0 ? <EPill tone="bad">{figures.expired} expired</EPill> : undefined },
            { key: "never", label: "Never signed in", value: figures ? figures.neverSignedIn : null, extra: figures?.oldestNeverSignedInDays ? <EPill tone="warn">oldest {figures.oldestNeverSignedInDays} d</EPill> : undefined },
            { key: "bounced", label: "Bounced", value: <span className="font-[500] text-[hsl(var(--e-muted-foreground))]">Not recorded</span> },
            { key: "resets", label: "Password resets, 7 d", value: figures ? figures.passwordResets7d : null, extra: figures ? <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{figures.passwordResetsByOffice7d} by the office</span> : undefined },
          ]}
        />
        <div role="group" aria-label="Email type" className="flex flex-wrap items-center gap-1.5 max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-0.5 max-sm:[scrollbar-width:none] max-sm:[&>button]:shrink-0">
          <button type="button" aria-pressed={view.state === "needs-action"} onClick={() => update({ state: view.state === "needs-action" ? "all" : "needs-action" })} className={cn(E_CHIP_CLASS, view.state === "needs-action" && E_CHIP_ON_CLASS)}>
            Needs action{data ? <span className="e-tnum ml-1">{data.stateCounts["needs-action"]}</span> : null}
          </button>
          {ACCOUNT_EMAIL_KINDS.map((kind) => (
            <button key={kind} type="button" aria-pressed={view.kind === kind} onClick={() => update({ kind: view.kind === kind ? "" : kind })} className={cn(E_CHIP_CLASS, view.kind === kind && E_CHIP_ON_CLASS)}>
              {ACCOUNT_EMAIL_KIND_LABEL[kind]}{data ? <span className="e-tnum ml-1">{data.kindCounts[kind]}</span> : null}
            </button>
          ))}
        </div>
        <EFilterBar
          label="Filter account emails"
          active={emailFilters}
          onClear={() => { setSearch(""); update({ q: "", state: DEFAULT_INVITATIONS_VIEW.state, sentBy: "", period: DEFAULT_INVITATIONS_VIEW.period }); }}
          resultLabel={data ? `Show ${data.total} ${data.total === 1 ? "person" : "people"}` : undefined}
        >
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search name or email" placeholder="Search name or email" className="h-8 w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.8125rem] sm:w-[220px]" />
          {STATE_CHIPS.map((chip) => (
            <button key={chip.key} type="button" aria-pressed={view.state === chip.key} onClick={() => update({ state: view.state === chip.key ? "all" : chip.key })} className={cn(E_CHIP_CLASS, view.state === chip.key && E_CHIP_ON_CLASS)}>
              {chip.label}{data ? <span className="e-tnum ml-1">{data.stateCounts[chip.key]}</span> : null}
            </button>
          ))}
          <select aria-label="Sent by" value={view.sentBy} onChange={(event) => update({ sentBy: event.target.value })} className="h-8 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[0.8125rem]">
            <option value="">Sent by anyone</option>
            {(data?.senders ?? []).map((sender) => <option key={sender.id} value={sender.id}>{sender.name}</option>)}
          </select>
          <select aria-label="Period" value={view.period} onChange={(event) => update({ period: event.target.value as InvitationsView["period"] })} className="h-8 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2 text-[0.8125rem]">
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">Last 12 months</option>
          </select>
        </EFilterBar>
        {notice ? <EAlert tone={notice.ok ? "success" : "danger"}>{notice.message}</EAlert> : null}
        {data?.viewerRefusal ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">You can read this list. {data.viewerRefusal}</p> : null}
        <div className="overflow-hidden rounded-[12px] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          <EDataTable<AccountEmailListRow>
            label="Account emails"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.userId}
            sort={{ key: view.sort, dir: view.dir }}
            onSortChange={(next) => update({ sort: next.key as InvitationsView["sort"], dir: next.dir })}
            selection={canBulk ? { selected, onChange: setSelected, rowLabel: (row) => `Select ${row.name ?? row.email}`, disabled: busy } : undefined}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            emptyTitle="No account emails match"
            emptyDescription="Try another chip or a longer period."
            onRowClick={open}
            activeRowKey={view.open}
            minWidth="56rem"
          />
        </div>
        {data ? <EPagination page={data.page} pageSize={data.pageSize} total={data.total} noun="people" disabled={list.loading} onPageChange={(page) => update({ page })} /> : null}
        {canBulk && revocable.length > 0 ? (
          <div className="flex flex-wrap items-center justify-end gap-2 text-[0.8125rem]">
            <span className="text-[hsl(var(--e-muted-foreground))]">{revocable.length} of {selected.size} selected have a pending invitation</span>
            <EButton size="sm" variant="outline" disabled={busy} onClick={() => setRevoking(revocable.map((row) => ({ userId: row.userId, label: row.name ?? row.email })))}>Revoke {revocable.length}</EButton>
          </div>
        ) : null}
        {canBulk ? (
          <AccountsBulk selectedRows={selectedRows} canResend isAdmin={false} onClear={() => setSelected(new Set())} onFinished={() => list.reload()} onRunningChange={setBusy} />
        ) : null}
      </div>
      {openRow ? <EmailPanel row={openRow} onClose={() => update({ open: null })} onChanged={list.reload} /> : null}
      {revoking ? (
        <RevokeInvitationDialog
          targets={revoking}
          onClose={() => setRevoking(null)}
          onDone={(outcome) => { setRevoking(null); setNotice(outcome); setSelected(new Set()); list.reload(); }}
        />
      ) : null}
    </div>
  );
}
