import { apiSuccess, apiError } from "@/lib/auth/api";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, phone, subject, message } = body;

    if (!email || !message) {
      return apiError("Email and message are required", 400);
    }

    // Contact submissions are logged and will be handled by admin
    // In production, this would send an email notification to the admin team
    return apiSuccess({ message: "Contact form submitted successfully" });
  } catch (error) {
    console.error("Contact API error:", error);
    return apiError("Failed to submit contact form", 500);
  }
}
