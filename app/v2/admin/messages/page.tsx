import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { can } from "@/lib/rbac/can";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { MessagesPage } from "@/components/v2/admin/messages/inbox/messages-page";
import type { ComposeRecipient } from "@/lib/messages/compose-checks";

export const metadata = { title: "Messages · Estate admin" };
export const dynamic = "force-dynamic";

type SearchParams = { compose?: string | string[]; recipient?: string | string[]; client?: string | string[] };
const ID = /^[A-Za-z0-9_-]{1,200}$/;

function single(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && ID.test(raw) ? raw : null;
}

/**
 * Messages (board "Messages", 2026-11): client conversations, the open
 * thread and composing with a template on one page. `?compose=1` opens the
 * composer (the old `/v2/admin/messages/compose` redirects here),
 * `?recipient=<clientId>` (the classic compose links) preselects an active
 * client, `?client=<clientId>` opens that conversation. Sending from the
 * composer stays behind `messages.compose_send`, checked by the send route;
 * the page only reads it to say so before sending.
 */
export default async function V2AdminMessagesPage({ searchParams }: { searchParams?: SearchParams }) {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const recipientId = single(searchParams?.recipient);
  const [canSend, settings, recipientClient] = await Promise.all([
    can(session, "messages.compose_send"),
    getAppSettings(),
    recipientId ? db.client.findFirst({ where: { id: recipientId, isActive: true }, select: { id: true, name: true, email: true, phone: true } }) : null,
  ]);
  const initialRecipient: ComposeRecipient | null = recipientClient
    ? { id: recipientClient.id, kind: "client", name: recipientClient.name, email: recipientClient.email ?? null, phone: recipientClient.phone ?? null }
    : null;
  const composeParam = single(searchParams?.compose);
  return (
    <MessagesPage
      canSend={canSend}
      timezone={typeof settings.timezone === "string" && settings.timezone.trim() ? settings.timezone : "Australia/Sydney"}
      initialCompose={Boolean(composeParam === "1" || recipientId)}
      initialRecipient={initialRecipient}
      recipientMissing={Boolean(recipientId && !recipientClient)}
      initialClientId={single(searchParams?.client)}
    />
  );
}
