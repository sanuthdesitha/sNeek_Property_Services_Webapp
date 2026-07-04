import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { ClientMessagesThread } from "@/components/client/messages-thread";

export const metadata = { title: "Messages · Estate client" };
export const dynamic = "force-dynamic";

export default async function ClientMessagesPage() {
  await requireRole([Role.CLIENT]);

  return (
    <div className="space-y-6">
      <EPageHeader eyebrow="Support" title="Messages" description="Talk directly with the ops team." />
      <ClientMessagesThread />
    </div>
  );
}
