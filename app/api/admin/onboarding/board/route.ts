import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { requireRole } from "@/lib/auth/session";
import { listOnboardingBoard } from "@/lib/onboarding/workspace/service";
import { onboardingRouteError } from "@/lib/onboarding/workspace/route-errors";
import type { OnboardingBoardTab } from "@/lib/onboarding/workspace/view-types";

const TABS: readonly OnboardingBoardTab[] = ["open", "progress", "waiting", "ready", "activated", "rejected"];

/** The onboarding list with readiness, next step and real counts per tab. */
export async function GET(req: NextRequest) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const params = req.nextUrl.searchParams;
    const tabParam = params.get("tab") ?? "open";
    if (!TABS.includes(tabParam as OnboardingBoardTab)) return NextResponse.json({ error: "Unknown tab." }, { status: 400 });
    const search = (params.get("search") ?? "").slice(0, 100);
    return NextResponse.json(await listOnboardingBoard({ tab: tabParam as OnboardingBoardTab, search }));
  } catch (error) {
    return onboardingRouteError(error, "board");
  }
}
