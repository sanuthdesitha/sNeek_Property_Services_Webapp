import { Mail } from "lucide-react";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { AdminPageShell } from "@/components/admin/page-shell";
import { EmailTemplatesWorkspace } from "@/components/admin/templates/email-templates-workspace";

export const dynamic = "force-dynamic";

export default async function EmailTemplatesPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  return (
    <AdminPageShell
      icon={<Mail />}
      title="Email & SMS templates"
      description="Design the email a customer receives with drag-in blocks, and edit the matching SMS — per event, with live preview."
    >
      <EmailTemplatesWorkspace />
    </AdminPageShell>
  );
}
