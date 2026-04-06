import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { ClientMessagesThread } from "@/components/client/messages-thread";

export default async function ClientMessagesPage() {
  await requireRole([Role.CLIENT]);
  return <ClientMessagesThread />;
}
