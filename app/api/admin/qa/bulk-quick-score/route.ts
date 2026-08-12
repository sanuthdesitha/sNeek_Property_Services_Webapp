import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { applyQuickQaScore } from "@/lib/qa/auto-score";

// Bulk-apply admin quick QA scores (the "approve the suggestions" action).
// Jobs already carrying a real inspection are skipped, not overwritten.
const bodySchema = z.object({
  items: z
    .array(
      z.object({
        jobId: z.string().min(1),
        score: z.number().min(0).max(100),
        notes: z.string().trim().max(4000).optional(),
      })
    )
    .min(1)
    .max(200),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const body = bodySchema.parse(await req.json());

    // Sequential on purpose: each apply takes a per-job advisory lock and fires
    // completion side-effects; a 200-wide parallel burst would hammer the pool.
    const results = [];
    for (const item of body.items) {
      results.push(
        await applyQuickQaScore({
          jobId: item.jobId,
          score: item.score,
          kind: "ADMIN",
          actorUserId: session.user.id,
          notes: item.notes ?? null,
        })
      );
    }

    const applied = results.filter((r) => r.ok);
    return NextResponse.json({
      applied: applied.length,
      passed: applied.filter((r) => r.ok && r.passed).length,
      skipped: results
        .filter((r) => !r.ok)
        .map((r) => (r.ok ? null : { jobId: r.jobId, reason: r.reason })),
      results,
    });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
