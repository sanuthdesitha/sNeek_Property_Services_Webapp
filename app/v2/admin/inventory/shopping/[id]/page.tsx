import { Role } from "@prisma/client";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/session";
import { getShoppingRunBillingContextById } from "@/lib/inventory/shopping-runs";
import { EstateShoppingRunDetail } from "@/components/v2/admin/inventory/estate-shopping-run-detail";

export const metadata = { title: "Shopping run · Estate admin" };
export const dynamic = "force-dynamic";

export default async function EstateShoppingRunPage({
  params,
}: {
  params: { id: string };
}) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const run = await getShoppingRunBillingContextById(params.id);
  if (!run) notFound();

  // Serialize through JSON so the client component receives a plain object
  // (dates/decimals already stringified by the billing serializer).
  return <EstateShoppingRunDetail initialRun={JSON.parse(JSON.stringify(run))} runId={params.id} />;
}
