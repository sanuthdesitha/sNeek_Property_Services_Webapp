"use client";

import { toneNoticeClass } from "@/components/v2/ui/tone-band";
import * as React from "react";
import { useSession } from "next-auth/react";
import { PortalShell, type NavItem } from "@/components/v2/portal/portal-shell";
import {
  useClientPortalCounts,
  withAttentionBadges,
  type ClientPortalGate,
} from "@/components/v2/portal/use-attention-counts";
import {
  CLIENT_RAIL,
  CLIENT_TABS,
  destinationAllowed,
  type ClientNavViewer,
} from "@/components/v2/client/portal/portal-nav";
import { ClientRequestProvider } from "@/components/v2/client/portal/request-sheet";
import { ClientHeaderActions } from "@/components/v2/client/portal/header-actions";

/**
 * Client portal shell (approved boards "Client portal" and "Client portal
 * desktop", 2026-11).
 *
 * Phone: five tabs (Home, Cleans, Approvals, Money, More). The More tab is the
 * grouped, role-filtered menu that replaces the drawer; Messages (with the
 * unread count) and the Request sheet sit in the header on every screen.
 * Laundry and Reports left the tab bar: they live in More, on each property
 * and on each clean, with their URLs unchanged.
 *
 * Desktop: the grouped rail lists every destination.
 *
 * Gates: a VA is only OFFERED destinations their grants open (fail closed while
 * grants load), and nobody is offered a module switched off for this client.
 * Every page keeps its own server guard; this only avoids offering a tap that
 * would be refused.
 */
const APPROVALS = "/v2/client/approvals";
const QUOTES = "/v2/client/quotes";
const MESSAGES = "/v2/client/messages";

/** Quotes waiting for a decision are listed on Approvals, so they count there. */
function badgeCounts(counts: Record<string, number>): Record<string, number> {
  const merged: Record<string, number> = { ...counts };
  if (typeof counts[APPROVALS] === "number" || typeof counts[QUOTES] === "number") {
    merged[APPROVALS] = (counts[APPROVALS] ?? 0) + (counts[QUOTES] ?? 0);
  }
  delete merged[QUOTES];
  return merged;
}

function buildNav(viewer: ClientNavViewer): NavItem[] {
  const tabFor = (href: string) => CLIENT_TABS.find((tab) => tab.href === href);
  const rail: NavItem[] = CLIENT_RAIL.filter((item) => destinationAllowed(item, viewer)).map((item) => {
    const tab = tabFor(item.href);
    return {
      href: item.href,
      label: item.label,
      icon: item.icon,
      group: item.group,
      ...(tab && tab.activePrefixes.length > 0 ? { tabActivePrefixes: tab.activePrefixes } : {}),
    };
  });
  const phoneOnly: NavItem[] = CLIENT_TABS.filter((tab) => tab.mobileOnly).map((tab) => ({
    href: tab.href,
    label: tab.label,
    icon: tab.icon,
    mobileOnly: true,
  }));
  return [...rail, ...phoneOnly];
}

export default function V2ClientLayout({ children }: { children: React.ReactNode }) {
  // Everything waiting on this client: approvals and quotes to decide, a case
  // asking them a question, an invoice to pay, unread office replies. Both
  // CLIENT and VA render this portal.
  const { data: session } = useSession();
  const identity = session?.user?.id ? JSON.stringify([
    session.user.id, session.user.role, session.impersonation?.actorId,
    session.impersonation?.mode, session.impersonation?.startedAt,
  ]) : "";
  const { counts, gate, status: gateStatus, refresh } = useClientPortalCounts("/api/client/attention-counts", identity);
  const isVa = session?.user?.role === "VA";
  const confirmedVaGate = isVa && gateStatus === "ready" && gate?.actor === "VA" ? gate : null;
  const confirmedClientGate = !isVa && gateStatus === "ready" && gate?.actor === "CLIENT" ? gate : null;

  // A VA with an unconfirmed gate is treated as holding no grants; a client is
  // the account holder. Module switches apply once the server has sent them.
  const viewer = React.useMemo<ClientNavViewer | null>(() => {
    if (!identity || gateStatus === "denied") return null;
    if (isVa) {
      return {
        actor: "VA",
        permissions: confirmedVaGate?.permissions ?? {},
        modules: confirmedVaGate?.modules ?? null,
      };
    }
    return { actor: "CLIENT", permissions: {}, modules: confirmedClientGate?.modules ?? null };
  }, [identity, gateStatus, isVa, confirmedVaGate, confirmedClientGate]);

  const nav = React.useMemo(
    () => (viewer ? withAttentionBadges(buildNav(viewer), badgeCounts(counts)) : []),
    [viewer, counts],
  );
  const showMessages = nav.some((item) => item.href === MESSAGES);

  // An assistant sees their OWN name in the rail with the client they act for
  // underneath, never "Client".
  const roleLabel = isVa
    ? confirmedVaGate?.actingFor
      ? "Assistant · " + confirmedVaGate.actingFor
      : "Assistant"
    : "Client";

  // The request sheet is offered only once access is confirmed.
  const requestViewer = viewer && (isVa ? confirmedVaGate : true) ? viewer : null;

  return (
    <div
      data-skin="estate"
      data-portal-accent="client"
      data-portal-actor={isVa ? "va" : "client"}
    >
      <ClientRequestProvider viewer={requestViewer}>
        <PortalShell
          accent="client"
          wordmark="sNeek"
          nav={nav}
          roleLabel={roleLabel}
          hideMobileMenuButton
          headerActions={viewer ? <ClientHeaderActions showMessages={showMessages} unread={counts[MESSAGES]} /> : null}
        >
          {identity && (gateStatus === "unavailable" || gateStatus === "denied") ? (
            <div role="alert" className={`mb-4 rounded-[var(--e-radius)] ${toneNoticeClass("attention")} px-3 py-2 text-sm`}>
              {gateStatus === "denied" ? "Your access could not be confirmed." : "Navigation updates are unavailable."}
              {isVa ? " Delegated actions are hidden until access is confirmed." : ""}
              <button type="button" onClick={refresh} className="ml-2 min-h-11 underline">Retry</button>
            </div>
          ) : null}
          {isVa ? <VaActingBanner name={session?.user?.name} gate={confirmedVaGate} loading={gateStatus === "loading"} /> : null}
          {children}
        </PortalShell>
      </ClientRequestProvider>
    </div>
  );
}

/**
 * Standing reminder of whose account this is. It renders on every page because
 * the risk is a VA switching accounts mid-task and cancelling the wrong clean.
 * The last line states the one rule that is never delegable.
 */
function VaActingBanner({
  name,
  gate,
  loading,
}: {
  name?: string | null;
  gate: ClientPortalGate | null;
  loading: boolean;
}) {
  return (
    <section aria-label="Assistant account context" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-[hsl(var(--e-border))] px-3 py-2 text-[0.8125rem] [overflow-wrap:anywhere]">
      <span className="min-w-0 font-medium text-[hsl(var(--e-foreground))]">{name || "Assistant"}</span>
      <span className="min-w-0 text-[hsl(var(--e-muted-foreground))]" role="status">
        {gate?.actingFor
          ? "is working in " + gate.actingFor + "’s account"
          : loading ? "Confirming client account..." : "Client account not confirmed"}
        {gate?.teamName ? " · " + gate.teamName : ""}
      </span>
      <span className="ml-auto text-[0.75rem] text-[hsl(var(--e-text-faint))]">
        Approvals and payments stay with the client
      </span>
    </section>
  );
}
