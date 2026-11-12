import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Composing moved into the Messages page (board "Messages", 2026-11). The old
 * URL opens the composer there and keeps its query (e.g. `?recipient=`).
 */
export default async function V2AdminMessagesComposeRedirect({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (key === "compose") continue;
    for (const entry of Array.isArray(value) ? value : value ? [value] : []) params.append(key, entry);
  }
  params.set("compose", "1");
  redirect(`/v2/admin/messages?${params.toString()}`);
}
