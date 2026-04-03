import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { WebsiteEditor } from "@/components/admin/website-editor";

export default async function AdminWebsitePage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();

  return <WebsiteEditor initialContent={settings.websiteContent} />;
}
