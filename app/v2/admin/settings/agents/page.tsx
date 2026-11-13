import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EButton, EPageHeader } from "@/components/v2/ui/primitives";
import { AgentsWorkspace } from "@/components/v2/admin/settings/agents/agents-workspace";

export const metadata = { title: "Agents · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * Settings › Access › Agents. Administrators only; every change also asks for
 * the administrator's own PIN, and every API call re-checks on the server.
 */
export default async function AgentsSettingsPage() {
  await requireRole([Role.ADMIN]);
  return (
    <div className="min-w-0 space-y-5">
      <EPageHeader
        eyebrow="Settings · Access"
        title="Agents"
        description="Connect Hermes, Claude or any MCP client so it can read your operations within the access you choose. Agents cannot change anything."
        actions={<EButton asChild variant="outline"><a href="/v2/admin/settings/access">Back to access</a></EButton>}
      />
      <AgentsWorkspace />
    </div>
  );
}
