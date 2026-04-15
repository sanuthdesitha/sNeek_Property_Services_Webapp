import { requireApiRole, apiSuccess, apiError } from "@/lib/auth/api";
import { prisma } from "@/lib/db/prisma";
import { calculateEstimatedHours } from "@/lib/pricing/calculator";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  await requireApiRole("ADMIN", "OPS_MANAGER");

  const body = await req.json();
  const { surveyId, jobType, bedrooms, bathrooms, conditionLevel, addOns } = body;

  if (!surveyId || !jobType) {
    return apiError("surveyId and jobType are required", 400);
  }

  const beds = bedrooms ?? 1;
  const baths = bathrooms ?? 1;
  const condition = conditionLevel ?? "standard";

  const estimatedHours = await calculateEstimatedHours(jobType, beds, baths, condition, addOns);

  // Get price from price book
  const priceBookEntry = await prisma.priceBook.findFirst({
    where: { jobType, bedrooms: beds, bathrooms: baths },
  });

  const estimatedCost = priceBookEntry?.baseRate ?? 0;

  // Auto-suggest team size
  let teamSize = 1;
  if (estimatedHours > 5) teamSize = 2;
  if (estimatedHours > 8) teamSize = 3;

  // Auto-suggest equipment
  const equipment: string[] = ["vacuum", "mop", "microfiber-cloths"];
  if (jobType === "DEEP_CLEAN" || jobType === "END_OF_LEASE") {
    equipment.push("steamer");
  }
  if (jobType === "PRESSURE_WASH") {
    equipment.push("pressure-washer");
  }
  if (jobType === "WINDOW_CLEAN") {
    equipment.push("window-squeegee", "extension-pole");
  }
  if (jobType === "GUTTER_CLEANING") {
    equipment.push("ladder");
  }

  // Risk flags
  const riskFlags: { type: string; message: string }[] = [];
  if (condition === "heavy") {
    riskFlags.push({ type: "heavy-mess", message: "Heavy mess detected — may need extra time and supplies" });
  }
  if (estimatedHours > 6) {
    riskFlags.push({ type: "long-job", message: "Job exceeds 6 hours — consider splitting into multiple visits" });
  }
  if (addOns?.sameDay) {
    riskFlags.push({ type: "same-day", message: "Same-day service — express surcharge applies" });
  }

  // Intelligent follow-up suggestions
  const suggestions: string[] = [];
  if (beds >= 3 && condition === "heavy" && jobType !== "CARPET_STEAM_CLEAN") {
    suggestions.push("Consider adding Carpet Steam cleaning for 3+ bedrooms with heavy condition");
  }
  if (addOns?.balcony && condition === "heavy" && jobType !== "PRESSURE_WASH") {
    suggestions.push("Balcony with heavy mess — Pressure Wash recommended");
  }
  if (baths >= 2) {
    suggestions.push(`Based on ${baths} bathrooms, we recommend ${teamSize} cleaner${teamSize > 1 ? "s" : ""}`);
  }

  const result = await prisma.estimationResult.create({
    data: {
      surveyId,
      jobType,
      estimatedHours,
      estimatedCost,
      teamSize,
      equipment,
      riskFlags,
    },
  });

  return apiSuccess({
    estimation: result,
    suggestions,
    equipment,
    riskFlags,
  });
}
