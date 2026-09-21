import { NextResponse } from "next/server";
import { requireClientPortal } from "@/lib/auth/client-portal";
import { isClientModuleEnabled } from "@/lib/portal-access";
import { listClientLaundryForUser } from "@/lib/client/portal-data";
import { LaundryStatus } from "@prisma/client";
import { z } from "zod";
import { sydneyDayBoundary } from "@/lib/billing/period";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid calendar date.");
const filtersSchema = z.object({ from: day.optional(), to: day.optional(), propertyId: z.string().trim().min(1).optional(), status: z.nativeEnum(LaundryStatus).optional(), dateField: z.enum(["any", "cleaning", "pickup", "dropoff"]).optional() })
  .refine(value => !value.from || !value.to || value.from <= value.to, "The end date must be on or after the start date.");

export async function GET(req: Request) {
  try {
    // Core portal read, so no extra VA grant — the property scope is still
    // applied in the data layer.
    const portal = await requireClientPortal();
    if (!isClientModuleEnabled(portal.visibility, "laundry")) {
      return NextResponse.json({ error: "Laundry updates are hidden for this client." }, { status: 403 });
    }
    const params = new URL(req.url).searchParams;
    const filters = filtersSchema.parse(Object.fromEntries(params));
    const options = { propertyId: filters.propertyId, status: filters.status, dateField: filters.dateField,
      fromDate: sydneyDayBoundary(filters.from, "start"), toDate: sydneyDayBoundary(filters.to, "end") };
    const rows = await listClientLaundryForUser(portal.userId, options);
    return NextResponse.json(rows, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Could not load laundry updates." },
      { status: err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400 }
    );
  }
}
