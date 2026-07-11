import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { Role, QuoteStatus, FormKind, type JobType } from "@prisma/client";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { assignPreferredCleanerIfAvailable } from "@/lib/jobs/preferred-cleaner";
import {
  serializeJobInternalNotes,
  type JobAdditional,
  type JobQuoteReferenceImage,
} from "@/lib/jobs/meta";
import { getAppSettings, saveAppSettings } from "@/lib/settings";
import { withSignoffSection } from "@/lib/checklists/compose";

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

interface QuoteChecklistOverride {
  summary?: string;
  sections: Array<{ title: string; items: Array<{ label: string; covered: boolean }> }>;
}

/**
 * If the admin edited the checklist for this quote, a `checklist` override
 * lives in the notes META (same shape the send route reads). Returns null when
 * there is no override — the job then keeps the generic property/job-type form.
 */
function checklistOverrideFromNotes(notes: string | null | undefined): QuoteChecklistOverride | null {
  if (!notes) return null;
  const match = notes.match(/\[\[META:([\s\S]+?)\]\]/);
  if (!match) return null;
  try {
    const meta = JSON.parse(match[1]) as { checklist?: unknown };
    const ov = meta.checklist as { summary?: unknown; sections?: unknown } | undefined;
    if (!ov || !Array.isArray(ov.sections)) return null;
    const sections = ov.sections
      .map((rawSection) => {
        const s = (rawSection ?? {}) as { title?: unknown; items?: unknown };
        const items = Array.isArray(s.items)
          ? s.items
              .map((rawItem) => {
                const it = (rawItem ?? {}) as { label?: unknown; covered?: unknown };
                const label = typeof it.label === "string" ? it.label.trim() : "";
                if (!label) return null;
                return { label, covered: Boolean(it.covered) };
              })
              .filter((x): x is { label: string; covered: boolean } => x !== null)
          : [];
        return { title: typeof s.title === "string" ? s.title : "", items };
      })
      .filter((s) => s.items.length > 0);
    if (sections.length === 0) return null;
    return {
      summary: typeof ov.summary === "string" && ov.summary.trim() ? ov.summary.trim() : undefined,
      sections,
    };
  } catch {
    return null;
  }
}

/** Reference images attached to the quote ([{key,url,label}]) → job meta shape. */
function referenceImagesFromQuote(raw: unknown): JobQuoteReferenceImage[] {
  if (!Array.isArray(raw)) return [];
  const out: JobQuoteReferenceImage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const img = item as Record<string, unknown>;
    const url = typeof img.url === "string" ? img.url.trim() : "";
    if (!url) continue;
    const label = typeof img.label === "string" ? img.label.trim() : "";
    out.push({ url, ...(label ? { label } : {}) });
  }
  return out;
}

/**
 * Build the cleaner-form schema for the AGREED SCOPE: every covered item on the
 * quote's checklist override becomes a checkbox, grouped by its section. Same
 * section/field shape composeFormSchema emits, so the existing form engine and
 * QA pipeline consume it unchanged. Not-covered items are simply omitted.
 */
function buildAgreedScopeSchema(override: QuoteChecklistOverride): { sections: unknown[] } {
  const sections: unknown[] = [];
  override.sections.forEach((section, si) => {
    const fields = section.items
      .filter((item) => item.covered)
      .map((item, ii) => ({
        id: `quote-scope-${si}-${ii}`,
        type: "checkbox",
        label: item.label,
        required: false,
      }));
    if (fields.length === 0) return;
    sections.push({
      id: `quote-scope-sec-${si}`,
      title: section.title || `Agreed scope ${si + 1}`,
      ...(si === 0 && override.summary ? { description: override.summary } : {}),
      fields,
    });
  });
  // Every generated cleaner form carries a sign-off section by default
  // (matches composeFormSchema / checklistToFormSchema behaviour).
  return { sections: withSignoffSection(sections) };
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

    // Carry quote context onto the job meta for transparency: the pricing-variable
    // selections the quote was priced on, and any client reference images.
    const quoteServiceContext =
      quote.serviceContext && typeof quote.serviceContext === "object" && !Array.isArray(quote.serviceContext)
        ? (quote.serviceContext as Record<string, unknown>)
        : undefined;
    const quoteReferenceImages = referenceImagesFromQuote(quote.referenceImages);

    const hasMeta =
      additionals.length > 0 || quoteServiceContext !== undefined || quoteReferenceImages.length > 0;

    const job = await db.job.create({
      data: {
        jobNumber,
        propertyId,
        jobType: quote.serviceType,
        scheduledDate: new Date(scheduledDate),
        notes: `Converted from quote #${params.id}`,
        // Carry the quoted extras onto the job so the cleaner's form shows them
        // as an "Additionals" section with how-to instructions, plus the quote's
        // pricing-variable snapshot and reference images for transparency.
        internalNotes: hasMeta
          ? serializeJobInternalNotes({
              additionals,
              quoteServiceContext,
              quoteReferenceImages: quoteReferenceImages.length > 0 ? quoteReferenceImages : undefined,
            })
          : undefined,
      },
    });

    // SPECIAL CHECKLIST: when the quote carries a per-quote checklist override
    // (the "agreed scope" the client accepted), materialise a one-off
    // FormTemplate from its covered items and register it as this property's
    // form override for the job type — the same attachment path
    // generatePropertyTemplates uses, which the job-form pipeline resolves.
    // Quotes without an override keep the generic property/job-type template.
    const checklistOverride = checklistOverrideFromNotes(quote.notes);
    let agreedScopeTemplateId: string | null = null;
    if (checklistOverride) {
      const scopeSchema = buildAgreedScopeSchema(checklistOverride);
      if (scopeSchema.sections.length > 0) {
        const quoteRef = params.id.slice(-6).toUpperCase();
        const template = await db.formTemplate.create({
          data: {
            name: `Quote ${quoteRef} — agreed scope`,
            serviceType: quote.serviceType,
            kind: FormKind.CUSTOM,
            version: 1,
            isActive: true,
            schema: scopeSchema as any,
            publishedAt: new Date(),
          },
          select: { id: true },
        });
        agreedScopeTemplateId = template.id;

        const settings = await getAppSettings();
        const overrides = { ...(settings.propertyFormTemplateOverrides ?? {}) };
        const forProperty: Partial<Record<JobType, string>> = {
          ...(overrides[propertyId] ?? {}),
        };
        forProperty[quote.serviceType] = template.id;
        overrides[propertyId] = forProperty;
        await saveAppSettings({ propertyFormTemplateOverrides: overrides });
      }
    }

    await db.quote.update({
      where: { id: params.id },
      data: { status: QuoteStatus.CONVERTED, convertedJobId: job.id },
    });
    await assignPreferredCleanerIfAvailable({
      jobId: job.id,
      propertyId,
      jobType: job.jobType,
    });

    return NextResponse.json({ job, agreedScopeTemplateId });
  } catch (err: any) {
    const status = err.message === "UNAUTHORIZED" ? 401 : err.message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
