import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { QaSelfReworkWorkspace } from "@/components/v2/qa/qa-self-rework-workspace";

export const metadata = { title: "QA rework · Estate QA" };
export const dynamic = "force-dynamic";

// Path (c) of the rework decision: the inspector fixes the flagged items
// themselves. They complete the SAME fix checklist the cleaner would have been
// given (buildReworkFormSchema) and claim the time/pay, which lands PENDING.
export default async function QaSelfReworkPage({ params }: { params: { id: string } }) {
  await requireRole([Role.QA_INSPECTOR, Role.OPS_MANAGER, Role.ADMIN]);

  const exists = await db.job
    .findUnique({ where: { id: params.id }, select: { id: true } })
    .catch(() => null);
  if (!exists) notFound();

  return <QaSelfReworkWorkspace jobId={params.id} />;
}
