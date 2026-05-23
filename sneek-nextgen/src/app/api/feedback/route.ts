import { apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, rating, comments } = body;

    if (!token || !rating) {
      return apiError("Token and rating are required", 400);
    }

    if (rating < 1 || rating > 5) {
      return apiError("Rating must be between 1 and 5", 400);
    }

    const feedback = await prisma.jobFeedback.findFirst({
      where: { token, tokenExpiresAt: { gt: new Date() } },
    });

    if (!feedback) {
      return apiError("Invalid or expired feedback token", 404);
    }

    const updated = await prisma.jobFeedback.update({
      where: { id: feedback.id },
      data: {
        rating,
        comment: comments ?? null,
        submittedAt: new Date(),
      },
    });

    return apiSuccess(updated);
  } catch (error) {
    console.error("Feedback API error:", error);
    return apiError("Failed to submit feedback", 500);
  }
}
