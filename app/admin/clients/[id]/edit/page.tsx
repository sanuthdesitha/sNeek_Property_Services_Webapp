import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/settings";
import { Role } from "@prisma/client";
import { EditClientForm } from "@/components/admin/edit-client-form";
import type { ClientPortalVisibility } from "@/lib/settings";

function sanitizePortalVisibilityOverrides(input: unknown): Partial<ClientPortalVisibility> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const output: Partial<ClientPortalVisibility> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "boolean") {
      (output as Record<string, boolean>)[key] = value;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}

export default async function EditClientPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const settings = await getAppSettings();

  const client = await db.client.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      notes: true,
      portalVisibilityOverrides: true,
    },
  });

  if (!client) notFound();

  return (
    <EditClientForm
      client={{
        ...client,
        portalVisibilityOverrides: sanitizePortalVisibilityOverrides(client.portalVisibilityOverrides),
      }}
      defaultPortalVisibility={settings.clientPortalVisibility}
    />
  );
}
