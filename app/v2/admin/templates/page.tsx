import { Role } from "@prisma/client";
import { Bell, MessageSquare } from "lucide-react";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { EChipTabs } from "@/components/v2/admin/estate-kit";
import { NotificationTemplatesWorkspace } from "@/components/v2/admin/templates/notification-templates-workspace";
import { MessageTemplatesWorkspace } from "@/components/v2/admin/templates/message-templates-workspace";

export const metadata = { title: "Templates · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateTemplatesPage({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const tab = searchParams?.tab === "messages" ? "messages" : "notifications";

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Communications"
        title="Templates"
        description="Design the email, SMS and message copy sNeek sends across every event."
      />

      <EChipTabs
        tabs={[
          {
            key: "notifications",
            label: "Notification templates",
            href: "/v2/admin/templates?tab=notifications",
            active: tab === "notifications",
            icon: <Bell className="h-3.5 w-3.5" />,
          },
          {
            key: "messages",
            label: "Message templates",
            href: "/v2/admin/templates?tab=messages",
            active: tab === "messages",
            icon: <MessageSquare className="h-3.5 w-3.5" />,
          },
        ]}
      />

      {tab === "messages" ? (
        <MessageTemplatesWorkspace />
      ) : (
        <NotificationTemplatesWorkspace />
      )}
    </div>
  );
}
