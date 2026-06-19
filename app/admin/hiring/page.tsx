import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureDefaultHiringPosition, listHiringPositions } from "@/lib/workforce/service";
import { ensureDefaultQuizTemplates } from "@/lib/workforce/quiz";
import { HiringHub } from "@/components/hiring/hiring-hub";

export const dynamic = "force-dynamic";

export default async function HiringPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  await ensureDefaultHiringPosition(session.user.id);
  await ensureDefaultQuizTemplates();

  const [positions, applications] = await Promise.all([
    listHiringPositions(),
    db.hiringApplication.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { position: { select: { id: true, title: true, slug: true } } },
    }),
  ]);

  return (
    <HiringHub
      positions={JSON.parse(JSON.stringify(positions))}
      applications={JSON.parse(JSON.stringify(applications))}
    />
  );
}
