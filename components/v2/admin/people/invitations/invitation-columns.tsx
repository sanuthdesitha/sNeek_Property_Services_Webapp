"use client";

/**
 * People › Invitations columns as drawn: Recipient, Email, Sent (with sender),
 * Delivery (only what was recorded), Expires, Signed in, the one next step
 * and the row menu (details, copy link where a valid link exists and the
 * viewer may, open account).
 */
import type { EDataColumn } from "@/components/v2/ui/data-table";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { ERowMenu } from "@/components/v2/ui/row-menu";
import type { AccountEmailState } from "@/lib/accounts/account-email-rules";
import { ACCOUNT_EMAIL_KIND_LABEL, DELIVERY_LABEL, type AccountEmailListRow, type AccountEmailListSort } from "@/lib/people/account-emails/types";
import { formatInstant, formatInstantDay } from "../format";

export const DELIVERY_TONE: Record<AccountEmailState, EPillTone> = { ACCEPTED: "ok", NOT_ACCEPTED: "bad", UNKNOWN: "warn", SKIPPED: "warn", NOT_RECORDED: "neutral" };

const NEXT_STEP_LABEL = { RESEND_INVITATION: "Resend", NEW_INVITATION: "New invite", RESEND_SIGNUP_CODE: "Resend code" } as const;

export type InvitationRowActions = {
  onOpen: (row: AccountEmailListRow) => void;
  onCopyLink: (row: AccountEmailListRow) => void;
  /** Revoke a pending invitation (owner decision 2026-11-13); opens the confirm. */
  onRevoke: (row: AccountEmailListRow) => void;
  busy: boolean;
};

export function invitationColumns(actions: InvitationRowActions): Array<EDataColumn<AccountEmailListRow, AccountEmailListSort>> {
  return [
    {
      key: "recipient",
      header: "Recipient",
      sortKey: "recipient",
      cell: (row) => (
        <div className="min-w-0">
          <button type="button" onClick={() => actions.onOpen(row)} className="block max-w-full truncate text-left font-[600] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
            {row.name ?? row.email}
          </button>
          <div className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.context ?? row.role.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</div>
        </div>
      ),
    },
    { key: "kind", header: "Email", sortKey: "kind", cell: (row) => ACCOUNT_EMAIL_KIND_LABEL[row.kind] },
    {
      key: "sent",
      header: "Sent",
      sortKey: "sent",
      firstDir: "desc",
      cell: (row) => (
        <div className="whitespace-nowrap e-tnum">
          {formatInstant(row.sentAt)}
          <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{row.sentBy}</div>
        </div>
      ),
    },
    { key: "delivery", header: "Delivery", sortKey: "delivery", cell: (row) => <EPill tone={DELIVERY_TONE[row.delivery]}>{DELIVERY_LABEL[row.delivery]}</EPill> },
    {
      key: "expires",
      header: "Expires",
      sortKey: "expires",
      cell: (row) =>
        row.revokedAt ? (
          <EPill tone="neutral">Revoked {formatInstantDay(row.revokedAt)}</EPill>
        ) : row.expiresAt ? (
          <span className="whitespace-nowrap e-tnum">{formatInstantDay(row.expiresAt)}{row.expired ? ", lapsed" : ""}</span>
        ) : (
          <span className="text-[hsl(var(--e-muted-foreground))]">–</span>
        ),
    },
    { key: "signedIn", header: "Signed in", sortKey: "signedIn", firstDir: "desc", cell: (row) => (row.signedInAt ? formatInstantDay(row.signedInAt) : <span className="text-[hsl(var(--e-muted-foreground))]">Never</span>) },
    {
      key: "next",
      header: <span className="sr-only">Next step</span>,
      cell: (row) =>
        row.nextStep ? (
          <button
            type="button"
            disabled={!row.canResend || actions.busy}
            title={row.refusal ?? undefined}
            onClick={() => actions.onOpen(row)}
            className="inline-flex min-h-8 items-center rounded-[var(--e-radius)] bg-[hsl(var(--e-primary))] px-2.5 text-[0.75rem] font-[600] text-[hsl(var(--e-primary-foreground))] disabled:opacity-50"
          >
            {NEXT_STEP_LABEL[row.nextStep]}
          </button>
        ) : null,
    },
    {
      key: "menu",
      header: <span className="sr-only">Actions</span>,
      cell: (row) => (
        <ERowMenu
          label={`More actions for ${row.name ?? row.email}`}
          items={[
            { key: "details", label: "Details and history", onSelect: () => actions.onOpen(row) },
            { key: "copy", label: "Copy invitation link", onSelect: () => actions.onCopyLink(row), disabled: !row.canCopyLink || actions.busy, hint: row.canCopyLink ? undefined : row.refusal ?? "No valid invitation link." },
            { key: "revoke", label: "Revoke invitation", danger: true, onSelect: () => actions.onRevoke(row), disabled: !row.canRevoke || actions.busy, hint: row.canRevoke ? undefined : row.revokedAt ? "Already withdrawn. Send a new invitation instead." : row.refusal ?? "No pending invitation." },
            { key: "account", label: "Open account", href: `/v2/admin/accounts/users/${row.userId}` },
          ]}
        />
      ),
    },
  ];
}
