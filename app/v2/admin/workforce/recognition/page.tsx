import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getRecognitionBoard, listStaffDirectory } from "@/lib/workforce/service";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { WorkforceSubnav } from "@/components/v2/admin/workforce/workforce-subnav";
import {
  RecognitionBoard,
  type LeaderRow,
  type RecognitionEntry,
  type RecognitionStaff,
} from "@/components/v2/admin/workforce/recognition-board";

export const metadata = { title: "Recognition · Estate workforce" };
export const dynamic = "force-dynamic";

export default async function WorkforceRecognitionPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const [board, directory] = await Promise.all([
    getRecognitionBoard().catch(() => null),
    listStaffDirectory().catch(() => []),
  ]);

  const mapEntry = (r: any): RecognitionEntry => ({
    id: r.id,
    title: r.title,
    message: r.message ?? null,
    badgeKey: r.badgeKey,
    celebrationStyle: r.celebrationStyle,
    createdAt: new Date(r.createdAt).toISOString(),
    user: { id: r.user.id, name: r.user.name ?? "Unknown", image: r.user.image },
    sentByName: r.sentBy?.name ?? null,
  });

  const mapLeader = (r: any): LeaderRow => ({
    id: r.id,
    name: r.name ?? "Unknown",
    image: r.image,
    role: r.role,
    qaAverage: r.qaAverage ?? null,
    monthJobsCompleted: r.monthJobsCompleted ?? 0,
    recognitionsReceived: r.recognitionsReceived ?? 0,
  });

  const wall: RecognitionEntry[] = (board?.recentRecognitions ?? []).map(mapEntry);
  const spotlight: RecognitionEntry | null = board?.spotlight ? mapEntry(board.spotlight) : null;
  const leaderboard = {
    qa: (board?.leaderboard.qa ?? []).map(mapLeader),
    completed: (board?.leaderboard.completed ?? []).map(mapLeader),
    recognition: (board?.leaderboard.recognition ?? []).map(mapLeader),
  };

  const staff: RecognitionStaff[] = directory
    .filter((u) => u.role === "CLEANER" || u.role === "LAUNDRY")
    .map((u) => ({ id: u.id, name: u.name ?? u.email, role: u.role }));

  return (
    <div className="space-y-6">
      <EPageHeader
        eyebrow="Workforce"
        title="Recognition"
        description="Celebrate strong work, keep the wall fresh and see who's leading the team."
      />
      <WorkforceSubnav active="recognition" />
      <RecognitionBoard wall={wall} spotlight={spotlight} leaderboard={leaderboard} staff={staff} />
    </div>
  );
}
