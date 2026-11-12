import { NextResponse } from "next/server";
import { filterBoardForViewer, loadLiveBoardCached } from "@/lib/ops/live-board";
import { liveErrorStatus, requireLiveViewer } from "@/lib/ops/live-viewer";
import { getAppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

/**
 * Today's Live ops board: classified jobs (late, off site with the clock
 * running, not started, on site, travelling), pending continuation requests
 * and active laundry routes. Dashboard pack; drivers need the Laundry pack and
 * continuation requests the Approvals pack (lib/ops/live-access). Built at
 * most once per ten seconds per process and filtered per viewer.
 */
export async function GET() {
  let viewer;
  try {
    viewer = await requireLiveViewer();
  } catch (err) {
    const status = liveErrorStatus(err);
    return NextResponse.json({ error: status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" }, { status });
  }
  try {
    const settings = await getAppSettings().catch(() => null);
    const board = await loadLiveBoardCached({ timeZone: settings?.timezone || "Australia/Sydney" });
    return NextResponse.json(filterBoardForViewer(board, viewer.access), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The live board could not be loaded." }, { status: 500 });
  }
}
