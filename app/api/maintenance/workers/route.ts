import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { listMaintenanceWorkers } from "@/lib/maintenance/workers";

export const dynamic = "force-dynamic";

/**
 * Assignable maintenance workers, safe projection (id/name/trade/company only).
 * Any authenticated portal user can read this so a client can pick a worker for
 * their own item; no contact details or internal notes are exposed.
 */
export async function GET() {
  try {
    await requireSession();
    const workers = await listMaintenanceWorkers({ activeOnly: true });
    const safe = workers.map((w: any) => ({
      id: w.id,
      name: w.name,
      trade: w.trade ?? null,
      company: w.company ?? null,
      isPermanent: Boolean(w.isPermanent),
    }));
    return NextResponse.json({ workers: safe });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
