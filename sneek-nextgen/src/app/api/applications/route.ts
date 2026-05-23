import { apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, phone, position, experience, availability, notes } = body;

    if (!email || !name) {
      return apiError("Name and email are required", 400);
    }

    const application = await prisma.hiringApplication.create({
      data: {
        positionId: "",
        fullName: name,
        email: email.toLowerCase(),
        phone: phone ?? null,
        coverLetter: notes ?? null,
      },
    });

    return apiSuccess(application);
  } catch (error) {
    console.error("Applications API error:", error);
    return apiError("Failed to submit application", 500);
  }
}
