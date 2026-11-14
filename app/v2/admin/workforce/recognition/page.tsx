import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { getRecognitionBoard, listStaffDirectory } from "@/lib/workforce/service";
import { loadWorkforceAreaSummary } from "@/lib/workforce/area-counts";
import { WorkforceArea } from "@/components/v2/admin/workforce/workforce-area";
import {
  RecognitionBoard,
  type LeaderRow,
  type RecognitionEntry,
  type RecognitionStaff,
} from "@/components/v2/admin/workforce/recognition-board";

export const metadata = { title: "Recognition · Workforce" };
export const dynamic = "force-dynamic";

export default async function WorkforceRecognitionPage() {
  await requireRole([Role.ADMIN, Role.OPS_MANAGER]);

  const [board, directory, summary] = await Promise.all([
    getRecognitionBoard().catch(() => null),
    listStaffDirectory().catch(() => []),
    loadWorkforceAreaSummary(),
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
    <WorkforceArea active="recognition" summary={summary}>
      {board === null ? (
        <div role="alert" className="mb-4 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 text-[0.875rem]">
          The kudos wall and leaders could not be loaded; what is shown below may be incomplete. Reload to try again.
        </div>
      ) : null}
      <RecognitionBoard wall={wall} spotlight={spotlight} leaderboard={leaderboard} staff={staff} />
    </WorkforceArea>
  );
}
