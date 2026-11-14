import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getHiringPositionForEdit } from "@/lib/workforce/service";
import { EstatePositionEditor } from "@/components/v2/admin/hiring/position/position-editor";

export const metadata = { title: "Edit role · Estate admin" };
export const dynamic = "force-dynamic";

export default async function V2PositionEditorPage({ params }: { params: { id: string } }) {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  // "new" mints a fresh role via POST — no DB row exists yet, so we render the
  // editor in create mode with the strong default schema shapes.
  if (params.id === "new") {
    return <EstatePositionEditor mode="new" position={null} />;
  }

  const position = await getHiringPositionForEdit(params.id);
  if (!position) notFound();
  const applicationCount = await db.hiringApplication.count({ where: { positionId: position.id } });
  return (
    <EstatePositionEditor
      mode="edit"
      position={JSON.parse(JSON.stringify(position))}
      applicationCount={applicationCount}
      hireAccountRole={position.hireAccountRole}
    />
  );
}
