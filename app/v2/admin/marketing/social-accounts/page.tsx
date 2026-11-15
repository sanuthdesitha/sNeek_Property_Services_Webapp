import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { ConnectionsWorkspace } from "@/components/v2/admin/marketing/social/connections-workspace";

export const metadata = { title: "Social accounts and permissions · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Social accounts and permissions (2026-11-17, board "Social connections";
 * settings catalog › Operations › "Social accounts and permissions"). ADMIN
 * and OPS_MANAGER with the Marketing pack read it; every change is checked
 * again by its own route (connecting: ADMIN with PIN).
 */
export default async function SocialAccountsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();
  const connect = typeof searchParams.connect === "string" ? searchParams.connect : null;
  const reason = typeof searchParams.reason === "string" ? searchParams.reason.slice(0, 300) : null;
  const note = typeof searchParams.note === "string" ? searchParams.note.slice(0, 300) : null;
  const notice = connect === "ok"
    ? { tone: "good" as const, text: `Facebook connected.${note ? ` ${note}` : ""}` }
    : connect === "failed" ? { tone: "problem" as const, text: reason ?? "The connection could not be completed. Nothing was connected." } : null;
  return (
    <div className="space-y-5">
      <EPageHeader
        eyebrow="Setup · Settings · Integrations"
        title="Social accounts and permissions"
        description="Connect sNeek's own business accounts, record which owners allow their homes in marketing, and keep the brand frames and caption templates the generator uses."
        actions={<EButton asChild variant="outline" size="sm"><a href="/v2/admin/marketing?tab=social&view=create">Open the generator</a></EButton>}
      />
      <ConnectionsWorkspace timeZone={settings.timezone || "Australia/Sydney"} initialNotice={notice} />
    </div>
  );
}
