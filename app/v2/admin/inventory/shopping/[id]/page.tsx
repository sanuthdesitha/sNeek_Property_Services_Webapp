import { Role } from "@prisma/client";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { loadShoppingRunPage } from "@/lib/inventory/shopping-run-page";
import { ShoppingRunPage } from "@/components/v2/admin/inventory/shopping-run/shopping-run-page";

export const metadata = { title: "Shopping run · Estate admin" };
export const dynamic = "force-dynamic";

/**
 * One shopping run (board "Shopping run", 2026-11-17). Read on the server;
 * every save re-reads it (router.refresh), so a late answer never fills
 * another run. Administrators and operations managers, as before.
 */
export default async function EstateShoppingRunPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const data = await loadShoppingRunPage(params.id);
  if (!data) notFound();
  // Serialize through JSON so the client component receives a plain object.
  return <ShoppingRunPage key={data.run.id} data={JSON.parse(JSON.stringify(data))} />;
}
