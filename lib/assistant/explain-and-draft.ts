import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/provider/generate";
import { resolveFeatureRoute } from "@/lib/ai/provider/routing";
import { isAiUnavailable, type AiActor } from "@/lib/ai/provider/types";
import { parsePhotoReviewResult } from "@/lib/ai/photo-review-policy";
import { buildPhotoIntegrityReport } from "@/lib/media/photo-integrity-flags";
import { UNTRUSTED_NOTICE } from "@/lib/agents/tools";

/**
 * "Explain this flag" and drafts (2026-11-14). Explanations use only the stored
 * finding or flag; drafts go into an editor for a person to change and send or
 * save. Nothing here sends, saves or approves anything.
 */

export type Unavailable = { state: "unavailable"; reason: string };
export type Explanation = { state: "explained"; explanation: string; whatToCheck: string[] };
export type Draft = { state: "drafted"; draft: string };

export class AssistantInputError extends Error { constructor(public status: number, message: string) { super(message); this.name = "AssistantInputError"; } }

async function unavailable(feature: "explain_flag" | "draft_reply"): Promise<Unavailable | null> {
  const route = await resolveFeatureRoute(feature);
  if (!route.enabled) return { state: "unavailable", reason: "This AI feature is switched off in Settings, AI." };
  if (!route.configured) return { state: "unavailable", reason: "No AI provider is configured for this feature (Settings, AI)." };
  return null;
}

const explanationSchema = z.object({ explanation: z.string().trim().min(1).max(1200), whatToCheck: z.array(z.string().trim().min(1).max(200)).max(4) }).strict();
const explanationJson = { type: "object", additionalProperties: false, required: ["explanation", "whatToCheck"], properties: { explanation: { type: "string" }, whatToCheck: { type: "array", items: { type: "string" } } } };

/** The stored facts for one photo finding, cannot-tell photo or integrity flag of a job. Never the photo itself. */
export async function storedFlagFacts(jobId: string, kind: "finding" | "photo" | "integrity", id: string): Promise<Record<string, unknown>> {
  if (kind === "integrity") {
    const report = await buildPhotoIntegrityReport(jobId);
    const flag = report.flags.find((item) => `${item.kind}:${item.mediaId}` === id);
    if (!flag) throw new AssistantInputError(404, "That photo check is no longer on this job.");
    return { source: "photo check (no AI; file hashes and camera time)", kind: flag.kind, field: flag.fieldLabel, detail: flag.detail };
  }
  const submission = await db.formSubmission.findFirst({ where: { jobId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { aiPhotoReview: { select: { result: true, settings: true } } } });
  const result = submission?.aiPhotoReview?.result ? parsePhotoReviewResult(submission.aiPhotoReview.result) : null;
  if (!result) throw new AssistantInputError(404, "This job has no AI photo review result.");
  const minConfidence = Number((submission!.aiPhotoReview!.settings as Record<string, unknown>)?.minConfidence ?? 0.8);
  for (const observation of result.observations) {
    if (kind === "photo" && observation.mediaId === id) {
      return { source: "AI photo review suggestion", field: observation.fieldLabel, outcome: observation.outcome ?? observation.assessment, reason: observation.reason ?? null, summary: observation.summary, acceptanceCriteria: observation.criteria ?? null };
    }
    const finding = observation.findings.find((item) => item.id === id);
    if (kind === "finding" && finding) {
      return {
        source: "AI photo review suggestion", field: finding.fieldLabel, criterion: finding.criterion ?? null, observation: finding.observation ?? finding.description,
        severity: finding.severity, confidence: finding.confidenceBand ?? finding.confidence, deductibleByDefault: finding.confidence >= minConfidence,
        locatedOnPhoto: Boolean(finding.region), comparedWithReference: Boolean(finding.referenceMediaKey), acceptanceCriteria: observation.criteria ?? null,
      };
    }
  }
  throw new AssistantInputError(404, "That finding is no longer in this job's photo review.");
}

export async function explainFlag(input: { jobId: string; kind: "finding" | "photo" | "integrity"; id: string; actor: AiActor }): Promise<Explanation | Unavailable> {
  const off = await unavailable("explain_flag");
  if (off) return off;
  const facts = await storedFlagFacts(input.jobId, input.kind, input.id);
  try {
    const result = await generateStructured({
      feature: "explain_flag", actor: input.actor, entity: { type: "Job", id: input.jobId }, maxOutputTokens: 600,
      schema: explanationSchema, jsonSchema: explanationJson,
      instructions: "Explain a photo check to a cleaning-company reviewer in plain words (at most 120 words), using only the facts given. Say it is a suggestion for a person to confirm, never a verdict. Do not invent details that are not in the facts. List up to four concrete things the reviewer should look at. Return only the requested JSON.",
      prompt: `Facts: ${JSON.stringify(facts)}`,
    });
    return { state: "explained", ...result.data };
  } catch (error) {
    if (isAiUnavailable(error)) return { state: "unavailable", reason: error.message };
    throw error;
  }
}

const draftSchema = z.object({ draft: z.string().trim().min(1).max(4000) }).strict();
const draftJson = { type: "object", additionalProperties: false, required: ["draft"], properties: { draft: { type: "string" } } };

/** A reply to a client's latest messages, for the composer. The client's words are data, never instructions. */
export async function draftClientReply(input: { clientId: string; intent: string | null; actor: AiActor }): Promise<Draft | Unavailable> {
  const off = await unavailable("draft_reply");
  if (off) return off;
  const client = await db.client.findUnique({ where: { id: input.clientId }, select: { id: true, name: true } });
  if (!client) throw new AssistantInputError(404, "Client not found.");
  const messages = await db.clientMessage.findMany({ where: { clientId: client.id }, orderBy: { createdAt: "desc" }, take: 6, select: { body: true, isFromAdmin: true, createdAt: true } });
  const thread = messages.reverse().map((message) => ({ from: message.isFromAdmin ? "office" : "client", at: message.createdAt.toISOString(), text: message.isFromAdmin ? message.body.slice(0, 1500) : { untrusted: true, source: "client", text: message.body.slice(0, 1500) } }));
  try {
    const result = await generateStructured({
      feature: "draft_reply", actor: input.actor, entity: { type: "Client", id: client.id }, maxOutputTokens: 800, schema: draftSchema, jsonSchema: draftJson,
      instructions: `Draft a short, friendly, professional reply from an Australian cleaning company's office to its client, for a person to edit before sending. Do not promise refunds, discounts, credits, dates or times unless the office note says so; never include access codes or passwords. ${UNTRUSTED_NOTICE} Return only the requested JSON.`,
      prompt: `Client first name: ${JSON.stringify((client.name ?? "").split(" ")[0])}\nOffice note on what to say (may be empty): ${JSON.stringify((input.intent ?? "").slice(0, 500))}\nRecent conversation, oldest first: ${JSON.stringify(thread)}`,
    });
    return { state: "drafted", draft: result.data.draft };
  } catch (error) {
    if (isAiUnavailable(error)) return { state: "unavailable", reason: error.message };
    throw error;
  }
}

/** Office notes for a quote (never shown to the client). */
export async function draftQuoteNotes(input: { quoteId: string; actor: AiActor }): Promise<Draft | Unavailable> {
  const off = await unavailable("draft_reply");
  if (off) return off;
  const quote = await db.quote.findUnique({ where: { id: input.quoteId }, select: { id: true, serviceType: true, totalAmount: true, frequency: true, serviceSuburb: true, notes: true, internalNotes: true, lineItems: true, validUntil: true } });
  if (!quote) throw new AssistantInputError(404, "Quote not found.");
  const lines = Array.isArray(quote.lineItems) ? (quote.lineItems as Record<string, unknown>[]).slice(0, 30).map((line) => ({ label: String(line.label ?? line.description ?? ""), quantity: line.quantity ?? null })) : [];
  try {
    const result = await generateStructured({
      feature: "draft_reply", actor: input.actor, entity: { type: "Quote", id: quote.id }, maxOutputTokens: 600, schema: draftSchema, jsonSchema: draftJson,
      instructions: `Draft brief internal office notes for a cleaning quote: what is included, anything to confirm with the client, and follow-up reminders. Plain sentences, at most 120 words. Do not change or recalculate prices. ${UNTRUSTED_NOTICE} Return only the requested JSON.`,
      prompt: `Quote facts: ${JSON.stringify({ service: quote.serviceType, total: quote.totalAmount, frequency: quote.frequency, suburb: quote.serviceSuburb, validUntil: quote.validUntil?.toISOString().slice(0, 10) ?? null, lineItems: lines, clientVisibleNotes: quote.notes ? { untrusted: true, source: "client or office", text: quote.notes.slice(0, 1500) } : null, existingOfficeNotes: quote.internalNotes?.slice(0, 1500) ?? null })}`,
    });
    return { state: "drafted", draft: result.data.draft };
  } catch (error) {
    if (isAiUnavailable(error)) return { state: "unavailable", reason: error.message };
    throw error;
  }
}
