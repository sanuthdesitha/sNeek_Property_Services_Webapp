import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { NewFormLauncher } from "@/components/v2/admin/forms/management/new-form-launcher";

export const metadata = { title: "New form template · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateNewFormPage() {
  await requireRole([Role.ADMIN]);
  // NewFormLauncher (blank + seed paths, starter blueprints and "copy an
  // existing form") replaced the older builder/new-template.tsx, now removed.
  return <NewFormLauncher />;
}
