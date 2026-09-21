import { resolveTemplate, type VariableContext } from "@/lib/messages/variables";

/** Shared by live delivery and previews. Invalid variables stop delivery; optional missing values stay empty. */
export async function renderCampaignContent(source: { subject?: string | null; body?: string | null }, context: VariableContext) {
  const body = source.body ?? "";
  const htmlSource = body.includes("<") ? body : body.replace(/\n/g, "<br/>");
  const [subject, html, text] = await Promise.all([
    resolveTemplate(source.subject || "(no subject)", context, { strictVariables: true, firstNameFallback: "there" }),
    resolveTemplate(htmlSource, context, { strictVariables: true, firstNameFallback: "there", escapeHtml: true }),
    resolveTemplate(body.replace(/<[^>]+>/g, ""), context, { strictVariables: true, firstNameFallback: "there" }),
  ]);
  return { subject, html, text: text.trim() };
}
