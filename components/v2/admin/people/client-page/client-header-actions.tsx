"use client";

/**
 * Client page header actions as drawn: New quote, Send update, the primary
 * action that follows the account (an overdue invoice → "Chase overdue
 * invoice", else "Send update"), and More (Edit client details, Send portal
 * invite, Re-send a document, Add property, Open in Approvals; Danger zone:
 * Delete client, behind the PIN or password). The dialogs are the existing
 * ClientActions ones (same routes and rules).
 */
import Link from "next/link";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { EButton } from "@/components/v2/ui/primitives";
import { ClientActions, type ClientActionsClient } from "@/components/v2/admin/clients/client-actions";
import type { ClientPortalVisibility } from "@/lib/settings";

const ITEM = "flex min-h-10 cursor-default select-none items-center rounded px-3 py-2 text-sm outline-none focus:bg-[hsl(var(--e-muted))] data-[disabled]:opacity-50";

export function ClientHeaderActions({
  client,
  defaultPortalVisibility,
  overdueInvoice,
}: {
  client: ClientActionsClient;
  defaultPortalVisibility: ClientPortalVisibility;
  overdueInvoice: { id: string; invoiceNumber: string } | null;
}) {
  const base = `/v2/admin/clients/${client.id}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EButton asChild size="sm" variant="outline"><Link href="/v2/admin/quotes/new">New quote</Link></EButton>
      {overdueInvoice ? (
        <>
          <EButton asChild size="sm" variant="outline"><Link href={`${base}?tab=messages`}>Send update</Link></EButton>
          <EButton asChild size="sm" variant="primary"><Link href={`/v2/admin/finance/invoices/${overdueInvoice.id}`}>Chase overdue invoice</Link></EButton>
        </>
      ) : (
        <EButton asChild size="sm" variant="primary"><Link href={`${base}?tab=messages`}>Send update</Link></EButton>
      )}
      <ClientActions
        client={client}
        defaultPortalVisibility={defaultPortalVisibility}
        renderTrigger={(controls) => (
          <Menu.Root>
            <Menu.Trigger asChild>
              <EButton size="sm" variant="outline" aria-label="More client actions">More ▾</EButton>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content data-skin="estate" aria-label="More client actions" align="end" sideOffset={4} className="z-50 min-w-56 max-w-[calc(100vw-2rem)] rounded border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-1 text-[hsl(var(--e-foreground))] shadow-lg">
                <Menu.Label className="px-3 py-1 text-[0.6875rem] font-[600] uppercase tracking-wide text-[hsl(var(--e-muted-foreground))]">Client</Menu.Label>
                <Menu.Item className={ITEM} onSelect={controls.edit}>Edit client details</Menu.Item>
                <Menu.Item className={ITEM} disabled={!controls.invite} onSelect={() => controls.invite?.()}>{controls.invite ? "Send portal invite" : "Send portal invite (add an email first)"}</Menu.Item>
                <Menu.Item asChild className={ITEM}><Link href={`${base}?tab=documents`}>Re-send a document</Link></Menu.Item>
                <Menu.Item asChild className={ITEM}><Link href={`/v2/admin/properties/new?clientId=${encodeURIComponent(client.id)}`}>Add property</Link></Menu.Item>
                <Menu.Item asChild className={ITEM}><Link href="/v2/admin/approvals">Open in Approvals</Link></Menu.Item>
                <Menu.Separator className="my-1 h-px bg-[hsl(var(--e-border))]" />
                <Menu.Label className="px-3 py-1 text-[0.6875rem] font-[600] uppercase tracking-wide text-[hsl(var(--e-muted-foreground))]">Danger zone</Menu.Label>
                <Menu.Item className={`${ITEM} text-[hsl(var(--e-danger))]`} onSelect={controls.remove}>Delete client… <span className="ml-auto pl-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Your PIN</span></Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        )}
      />
    </div>
  );
}
