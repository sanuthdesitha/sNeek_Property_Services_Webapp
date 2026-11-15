import { NextResponse } from "next/server";
import { processSocialScoreQueue } from "@/lib/marketing/social/score-queue";
import { requireSocialRight, socialErrorResponse } from "@/lib/marketing/social/route-helpers";

/** "Score now": scores up to 20 waiting photos (the worker does the rest every 10 minutes). */
export async function POST() {
  try {
    await requireSocialRight("post");
    const result = await processSocialScoreQueue({ batch: 20 });
    return NextResponse.json(result);
  } catch (error) {
    return socialErrorResponse(error);
  }
}
