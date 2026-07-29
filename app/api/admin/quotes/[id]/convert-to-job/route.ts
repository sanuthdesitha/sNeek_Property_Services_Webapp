import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { z } from "zod";
import { Role, QuoteStatus, type JobType } from "@prisma/client";
import { reserveJobNumber } from "@/lib/jobs/job-number";
import { assignPreferredCleanerIfAvailable } from "@/lib/jobs/preferred-cleaner";
import {
  serializeJobInternalNotes,
  type JobAdditional,
  type JobQuoteReferenceImage,
} from "@/lib/jobs/meta";
import {
  materializeJobScopedFormTemplate,
  quoteScopeTemplateName,
  type JobScopedTemplateClient,
} from "@/lib/forms/job-scoped-template";
import { withSignoffSection } from "@/lib/checklists/compose";
import { getChecklist } from "@/lib/checklists/store";
import { checklistToFormSchema } from "@/lib/checklists/to-form";
import { stripHtmlToText } from "@/lib/forms/sanitize";
import { recordQuoteEvent } from "@/lib/quotes/events";
import { sendLifecycleEmail } from "@/lib/notifications/lifecycle";
import { logger } from "@/lib/logger";

/** Recurring cadences a quote can carry (one_off → a single job, no schedule). */
const RECURRING_FREQUENCIES = new Set(["weekly", "fortnightly", "monthly"]);

const newPropertySchema = z.object({
  address: z.string().trim().min(1, "A service address is required."),
  suburb: z.string().trim().min(1, "A suburb is required."),
  name: z.string().trim().min(1).max(200).optional(),
  // Optional geo captured from the address autocomplete; persisted when present.
  latitude: z.number().finite().optional(),
  longitude: z.number().finite().optional(),
});

const schema = z
  .object({
    // Link an existing property…
    propertyId: z.string().min(1).optional(),
    // …or create one from the service address.
    newProperty: newPropertySchema.optional(),
    // Convert can create the job now, or just link/create the property + mark
    // the quote won so the admin schedules the visit later.
    createJob: z.boolean().default(true),
    scheduledDate: z.string().datetime().optional(),
  })
  .refine((d) => !d.createJob || Boolean(d.scheduledDate), {
    message: "A scheduled date is required to create the job now.",
    path: ["scheduledDate"],
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
  // Quote-authored strings (summary + item labels) can carry rich text; strip to
  // plain text before they enter the cleaner-form schema.
  const summary = override.summary ? stripHtmlToText(override.summary) : undefined;
  override.sections.forEach((section, si) => {
    const fields = section.items
      .filter((item) => item.covered)
      .map((item, ii) => ({
        id: `quote-scope-${si}-${ii}`,
        type: "checkbox",
        label: stripHtmlToText(item.label),
        required: false,
      }));
    if (fields.length === 0) return;
    sections.push({
      id: `quote-scope-sec-${si}`,
      title: section.title || `Agreed scope ${si + 1}`,
      ...(si === 0 && summary ? { description: summary } : {}),
      fields,
    });
  });
  // Every generated cleaner form carries a sign-off section by default
  // (matches composeFormSchema / checklistToFormSchema behaviour).
  return { sections: withSignoffSection(sections) };
}

/**
 * Materialise a one-off cleaner FormTemplate from a form schema and pin it to
 * THE JOB it was minted for (`Job.formTemplateId`). Returns the template id.
 *
 * It used to register the template as the property's permanent per-job-type
 * override instead, which made one quote's agreed scope the form for every
 * future job of that type at that property — and cut those jobs off from the
 * admin's edits to the real global template. Owner's rule: use it for that job
 * only. See lib/forms/job-scoped-template.ts.
 */
async function materializeJobFormTemplate({
  name,
  serviceType,
  schema,
  jobId,
}: {
  name: string;
  serviceType: JobType;
  schema: unknown;
  jobId: string;
}): Promise<string> {
  return materializeJobScopedFormTemplate(db as unknown as JobScopedTemplateClient, {
    jobId,
    name,
    serviceType,
    schema,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole([Role.ADMIN, Role.OPS_MANAGER]);
    const { propertyId, newProperty, createJob, scheduledDate } = schema.parse(await req.json());

    const quote = await db.quote.findUnique({ where: { id: params.id } });
    if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (quote.status === QuoteStatus.CONVERTED && quote.convertedJobId) {
      return NextResponse.json(
        { error: "Quote already converted", jobId: quote.convertedJobId },
        { status: 400 }
      );
    }
    if (quote.status === QuoteStatus.CONVERTED) {
      // Already marked won without a job (createJob was OFF) — nothing to redo.
      return NextResponse.json({ error: "Quote already converted." }, { status: 400 });
    }
    if (quote.status === QuoteStatus.DECLINED) {
      return NextResponse.json(
        { error: "A declined quote can't be converted to a job." },
        { status: 400 }
      );
    }

    // ── Property target: link an existing one, or create from the address ────
    // The convert flow can't proceed without a service address somewhere, so
    // block early when neither an existing property nor a new address is given.
    if (!propertyId && !newProperty) {
      return NextResponse.json(
        { error: "A service address is required to convert this quote." },
        { status: 400 }
      );
    }
    // A brand-new property must hang off a client (Property.clientId is required).
    if (!propertyId && newProperty && !quote.clientId) {
      return NextResponse.json(
        { error: "Assign this quote to a client before creating a property from its address." },
        { status: 400 }
      );
    }

    const isRecurring = Boolean(quote.frequency && RECURRING_FREQUENCIES.has(quote.frequency));
    const quoteRef = params.id.slice(-6).toUpperCase();

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

    // The cadence we persist onto the property so ops know the service recurs.
    const recurringSchedule = isRecurring
      ? { frequency: quote.frequency, notes: `From quote ${quoteRef}` }
      : null;

    // ── Core mutations run transactionally: resolve/create the property, (opt.)
    // create the first job, and flip the quote to CONVERTED together. ─────────
    const result = await db.$transaction(async (tx) => {
      // Resolve the target property.
      let targetPropertyId: string;
      if (propertyId) {
        const property = await tx.property.findUnique({
          where: { id: propertyId },
          select: { id: true, clientId: true },
        });
        if (!property) throw new Error("Property not found.");
        // The chosen property must belong to the quote's client (if any) —
        // otherwise the job, and its billing, attach to the wrong client.
        if (quote.clientId && property.clientId !== quote.clientId) {
          throw new Error("That property belongs to a different client than the quote.");
        }
        targetPropertyId = property.id;
        if (recurringSchedule) {
          await tx.property.update({
            where: { id: property.id },
            data: { recurringSchedule: recurringSchedule as any },
          });
        }
      } else {
        // Create a minimal property from the address under the quote's client —
        // same required fields as the property-create route (geocode optional).
        const created = await tx.property.create({
          data: {
            clientId: quote.clientId!,
            name: newProperty!.name?.trim() || newProperty!.address.trim(),
            address: newProperty!.address.trim(),
            suburb: newProperty!.suburb.trim(),
            ...(newProperty!.latitude != null ? { latitude: newProperty!.latitude } : {}),
            ...(newProperty!.longitude != null ? { longitude: newProperty!.longitude } : {}),
            ...(recurringSchedule ? { recurringSchedule: recurringSchedule as any } : {}),
            integration: { create: { isEnabled: false } },
          },
          select: { id: true },
        });
        targetPropertyId = created.id;
      }

      // When the admin opted not to schedule now, just mark the quote won and
      // return the linked/created property — no job, no job number burned.
      if (!createJob) {
        await tx.quote.update({
          where: { id: params.id },
          data: { status: QuoteStatus.CONVERTED },
        });
        return { propertyId: targetPropertyId, job: null as null | { id: string } };
      }

      const jobNumber = await reserveJobNumber(tx);
      const recurringNote = isRecurring
        ? `\nRecurring service — ${quote.frequency} (schedule saved on the property).`
        : "";

      const job = await tx.job.create({
        data: {
          jobNumber,
          propertyId: targetPropertyId,
          jobType: quote.serviceType,
          scheduledDate: new Date(scheduledDate!),
          notes: `Converted from quote #${params.id}${recurringNote}`,
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

      await tx.quote.update({
        where: { id: params.id },
        data: { status: QuoteStatus.CONVERTED, convertedJobId: job.id },
      });

      return { propertyId: targetPropertyId, job: { id: job.id } };
    });

    const targetPropertyId = result.propertyId;
    const job = result.job;

    // CUSTOM CHECKLIST: every conversion materialises a one-off FormTemplate and
    // pins it to THIS JOB (Job.formTemplateId), which the job-form pipeline
    // resolves ahead of the property override. It is scoped to this job only —
    // future jobs at the property keep normal resolution. When the quote carries a per-quote checklist
    // override (the "agreed scope" the client accepted), the template is built
    // from its covered items; otherwise we fall back to the base service
    // checklist so the job still gets a custom form (mirrors documents.ts's
    // `checklistOverrideFromNotes(...) ?? getChecklist(...)`).
    let agreedScopeTemplateId: string | null = null;
    if (job) {
      const checklistOverride = checklistOverrideFromNotes(quote.notes);
      if (checklistOverride) {
        const scopeSchema = buildAgreedScopeSchema(checklistOverride);
        if (scopeSchema.sections.length > 0) {
          agreedScopeTemplateId = await materializeJobFormTemplate({
            name: quoteScopeTemplateName(quoteRef, "agreed"),
            serviceType: quote.serviceType,
            schema: scopeSchema,
            jobId: job.id,
          });
        }
      } else {
        // No override → build from the base service checklist. WS-1A's
        // checklistToFormSchema auto-includes arrival media + signature.
        const checklist = await getChecklist(String(quote.serviceType));
        const standardSchema = checklist ? checklistToFormSchema(checklist) : null;
        if (standardSchema && standardSchema.sections.length > 0) {
          agreedScopeTemplateId = await materializeJobFormTemplate({
            name: quoteScopeTemplateName(quoteRef, "standard"),
            serviceType: quote.serviceType,
            schema: standardSchema,
            jobId: job.id,
          });
        } else {
          logger.warn(
            { quoteId: params.id, jobId: job.id, serviceType: quote.serviceType },
            "convert-to-job: no base checklist to materialise a standard-scope form; job keeps the generic property/job-type form"
          );
        }
      }

      await assignPreferredCleanerIfAvailable({
        jobId: job.id,
        propertyId: targetPropertyId,
        jobType: quote.serviceType,
      });
    }

    // Timeline entry so the quote detail shows the conversion + its outcome.
    await recordQuoteEvent(params.id, "CONVERTED", {
      propertyId: targetPropertyId,
      ...(job ? { jobId: job.id } : {}),
      frequency: quote.frequency ?? "one_off",
    });

    // A job was actually created (createJob path) → confirm the booking with the
    // client. Best-effort auto send (gated + never throws). No job = nothing to
    // confirm yet (the admin schedules the visit later).
    if (job) {
      const scheduleText = new Date(scheduledDate!).toLocaleDateString("en-AU", {
        timeZone: "Australia/Sydney",
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      await sendLifecycleEmail({
        jobId: job.id,
        stage: "BOOKING_CONFIRMED",
        mode: "auto",
        extra: { scheduleText },
      }).catch(() => {});
    }

    return NextResponse.json({ job, propertyId: targetPropertyId, agreedScopeTemplateId });
  } catch (err: any) {
    const status =
      err.message === "UNAUTHORIZED"
        ? 401
        : err.message === "FORBIDDEN"
          ? 403
          : err.message === "Property not found."
            ? 404
            : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
}
