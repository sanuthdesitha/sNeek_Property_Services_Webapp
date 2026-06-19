import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getHiringPositionForEdit } from "@/lib/workforce/service";
import { PositionEditor } from "@/components/hiring/position-editor";

export const dynamic = "force-dynamic";

export default async function PositionEditorPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  const position = await getHiringPositionForEdit(params.id);
  if (!position) notFound();
  return <PositionEditor position={JSON.parse(JSON.stringify(position))} />;
}
