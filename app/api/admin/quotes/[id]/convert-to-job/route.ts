import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { Role, QuoteStatus } from "@prisma/client";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { assignPreferredCleanerIfAvailable } from "@/lib/jobs/preferred-cleaner";
import { serializeJobInternalNotes, type JobAdditional } from "@/lib/jobs/meta";

const schema = z.object({
  propertyId: z.string().min(1),
  scheduledDate: z.string().datetime(),
});

/** Pull the structured extras the admin/client picked, out of the quote notes META. */
function extrasFromQuoteNotes(notes: string | null | undefined): JobAdditional[] {
  if (!notes) return [];
  const match = notes.match(/\[\[META:([\s\S]+?)\]\]/);
  if (!match) return [];
  try {
    const meta = JSON.parse(match[1]) as { extras?: unknown };
    if (!Array.isArray(meta.extras)) return [];
    return meta.extras
      .map((raw, i) => {
        const e = (raw ?? {}) as Record<string, unknown>;
        const label = typeof e.label === "string" ? e.label.trim() : "";
        if (!label) return null;
        return {
          id: typeof e.id === "string" && e.id.trim() ? e.id.trim() : `extra-${i + 1}`,
          label,
          instructions: typeof e.instructions === "string" ? e.instructions.trim() || undefined : undefined,
        } as JobAdditional;
      })
      .filter((x): x is JobAdditional => x !== null);
  } catch {
    return [];
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { propertyId, scheduledDate } = schema.parse(await req.json());

    const quote = await db.quote.findUnique({ where: { id: params.id } });
    if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (quote.status === QuoteStatus.CONVERTED && quote.convertedJobId) {
      return NextResponse.json(
        { error: "Quote already converted", jobId: quote.convertedJobId },
        { status: 400 }
      );
    }
    if (quote.status === QuoteStatus.DECLINED) {
      return NextResponse.json(
        { error: "A declined quote can't be converted to a job." },
        { status: 400 }
      );
    }

    // The chosen property must belong to the quote's client (if any) — otherwise
    // the job, and its billing, would attach to the wrong client's property.
    const property = await db.property.findUnique({
      where: { id: propertyId },
      select: { id: true, clientId: true },
    });
    if (!property) {
      return NextResponse.json({ error: "Property not found." }, { status: 404 });
    }
    if (quote.clientId && property.clientId !== quote.clientId) {
      return NextResponse.json(
        { error: "That property belongs to a different client than the quote." },
        { status: 400 }
      );
    }

    const jobNumber = await reserveJobNumber(db);
    const additionals = extrasFromQuoteNotes(quote.notes);
    const job = await db.job.create({
      data: {
        jobNumber,
        propertyId,
        jobType: quote.serviceType,
        scheduledDate: new Date(scheduledDate),
        notes: `Converted from quote #${params.id}`,
        // Carry the quoted extras onto the job so the cleaner's form shows them
        // as an "Additionals" section with how-to instructions.
        internalNotes: additionals.length > 0 ? serializeJobInternalNotes({ additionals }) : undefined,
      },
    });

    await db.quote.update({
      where: { id: params.id },
      data: { status: QuoteStatus.CONVERTED, convertedJobId: job.id },
    });
    await assignPreferredCleanerIfAvailable({
      jobId: job.id,
      propertyId,
      jobType: job.jobType,
    });

    return NextResponse.json({ job });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
