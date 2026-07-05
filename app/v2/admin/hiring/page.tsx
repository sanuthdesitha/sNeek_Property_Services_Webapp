import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureDefaultHiringPosition, listHiringPositions } from "@/lib/workforce/service";
import { ensureDefaultQuizTemplates } from "@/lib/workforce/quiz";
import { HiringPipeline } from "@/components/v2/admin/hiring/pipeline/hiring-pipeline";

export const metadata = { title: "Hiring · Estate admin" };
export const dynamic = "force-dynamic";

// Estate-native ATS hub. Same endpoints/data as the v1 hiring hub; brand-new
// Estate UI. We read the applications with quiz assignments + screening score
// server-side (mirrors the v1 page query) so the board can show quiz status.
export default async function V2HiringPage() {
  const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
  await ensureDefaultHiringPosition(session.user.id);
  await ensureDefaultQuizTemplates();

  const [positions, applications] = await Promise.all([
    listHiringPositions(),
    db.hiringApplication.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: {
        position: { select: { id: true, title: true, slug: true } },
        quizAssignments: { select: { id: true, status: true, score: true } },
      },
    }),
  ]);

  return (
    <HiringPipeline
      positions={JSON.parse(JSON.stringify(positions))}
      applications={JSON.parse(JSON.stringify(applications))}
    />
  );
}
