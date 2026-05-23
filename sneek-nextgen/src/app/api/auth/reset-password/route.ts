import { apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { hash } from "@/lib/auth/crypto";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, confirmPassword } = body;

    if (!email || !password || !confirmPassword) {
      return apiError("All fields are required", 400);
    }

    if (password !== confirmPassword) {
      return apiError("Passwords do not match", 400);
    }

    if (password.length < 8) {
      return apiError("Password must be at least 8 characters", 400);
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      return apiError("User not found", 404);
    }

    const passwordHash = await hash(password);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return apiSuccess({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password API error:", error);
    return apiError("Failed to reset password", 500);
  }
}
