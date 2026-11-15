import "server-only";
import { z } from "zod";
import { captionProblems, finalCaption } from "@/lib/marketing/social/captions";
import { lintAgainstAll } from "@/lib/marketing/social/caption-linter";
import { checkPhotos } from "@/lib/marketing/social/eligibility";
import { networkDefinition, SOCIAL_FORMATS, SOCIAL_NETWORK_KEYS, type SocialFormat, type SocialNetwork } from "@/lib/marketing/social/networks";
import type { ActionPreview } from "./action-catalog";

/**
 * `request_social_draft` (2026-11-17, write pack "social_drafts"): an agent
 * ASKS for a social post draft made of eligible photos, with captions per
 * network and alt text per photo. The dry run checks permission and
 * eligibility for every photo, the format, the network limits and the
 * caption linter; nothing is stored unless it passes. Approval (a person, in
 * Approvals › Agent requests) runs the dry run again and creates a DRAFT in
 * Marketing › Social posts marked "Drafted by Claude/agent". The agent never
 * publishes or plans a post.
 */

const network = z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "GOOGLE_BUSINESS", "LINKEDIN"]);

export const socialDraftArgs = z.object({
  photoIds: z.array(z.string().min(1).max(100)).min(1).max(6),
  format: z.enum(["SINGLE", "CAROUSEL", "BEFORE_AFTER", "FRAME"]),
  title: z.string().trim().min(1).max(160).optional(),
  captions: z.record(network, z.string().trim().min(1).max(5000)),
  hashtags: z.record(network, z.array(z.string().regex(new RegExp("^#[\\p{L}\\p{N}_]{2,60}$", "u"))).max(30)).optional(),
  altText: z.record(z.string().min(1).max(100), z.string().trim().min(1).max(1000)),
  plannedFor: z.string().datetime().optional(),
}).strict();

export type SocialDraftArgs = z.infer<typeof socialDraftArgs>;

export const SOCIAL_DRAFT_INPUT_SCHEMA_PROPERTIES = {
  photoIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Photo ids from list_social_candidates, in order" },
  format: { type: "string", enum: ["SINGLE", "CAROUSEL", "BEFORE_AFTER", "FRAME"] },
  title: { type: "string", maxLength: 160 },
  captions: { type: "object", description: "One caption per network key (INSTAGRAM, FACEBOOK, TIKTOK, GOOGLE_BUSINESS, LINKEDIN); hashtags go in hashtags" },
  hashtags: { type: "object", description: "Hashtags per network key, each starting with #" },
  altText: { type: "object", description: "Alt text per photo id: what the photo shows" },
  plannedFor: { type: "string", description: "A suggested time (ISO 8601). It is only a note for the person; the agent never schedules." },
};

/** The dry run. Throws a plain Error with the reason when the draft cannot be made. */
export async function previewSocialDraft(raw: Record<string, unknown>, refuse: (message: string) => Error): Promise<ActionPreview> {
  const args = socialDraftArgs.parse(raw);
  const rule = SOCIAL_FORMATS.find((item) => item.key === args.format)!;
  const photoIds = Array.from(new Set(args.photoIds));
  if (photoIds.length < rule.minPhotos || photoIds.length > rule.maxPhotos) throw refuse(`${rule.label} needs ${rule.minPhotos === rule.maxPhotos ? rule.minPhotos : `${rule.minPhotos} to ${rule.maxPhotos}`} photos.`);
  const { eligible, refused } = await checkPhotos(photoIds);
  if (refused.length) throw refuse(`These photos cannot be used: ${refused.map((item) => `${item.photoId} (${item.reason})`).join("; ")}`);
  const photos = photoIds.map((id) => eligible.get(id)!);
  if (args.format === "BEFORE_AFTER" && (photos.filter((photo) => photo.field.kind === "BEFORE").length !== 1 || photos[0].jobId !== photos[1]?.jobId)) {
    throw refuse("Before and after needs one before photo and one after photo from the same job.");
  }
  if (args.format !== "BEFORE_AFTER" && photos.some((photo) => photo.field.kind === "BEFORE")) throw refuse("Before photos can only be used in a before and after post.");
  const missingAlt = photoIds.filter((id) => !args.altText[id]?.trim());
  if (missingAlt.length) throw refuse(`Write alt text for every photo (missing: ${missingAlt.join(", ")}).`);
  const forbidden = photos.map((photo) => photo.forbidden);
  const problems: string[] = [];
  const networks = Object.keys(args.captions) as SocialNetwork[];
  if (networks.length === 0) throw refuse("Write at least one caption.");
  for (const key of networks) {
    const tags = args.hashtags?.[key] ?? [];
    problems.push(...captionProblems(key, args.captions[key]!, tags));
    problems.push(...lintAgainstAll(finalCaption(key, args.captions[key]!, tags), forbidden, `The ${networkDefinition(key).label} caption`));
  }
  for (const id of photoIds) problems.push(...lintAgainstAll(args.altText[id], forbidden, "Alt text"));
  if (problems.length) throw refuse(Array.from(new Set(problems)).join(" "));
  const consentIds = Array.from(new Set(photos.map((photo) => photo.consent.consentId))).sort();
  const rooms = photos.map((photo) => photo.field.room.toLowerCase());
  return {
    summary: `Create a social post draft (${rule.label.toLowerCase()}, ${photos.length} photo${photos.length === 1 ? "" : "s"}: ${rooms.join(", ")}) with captions for ${networks.map((key) => networkDefinition(key).label).join(", ")}.`,
    details: [
      ...photos.map((photo, index) => `Photo ${index + 1}: ${photo.field.room} at ${photo.propertyName} (${photo.jobNumber}); permission from ${photo.consent.givenByName}.`),
      ...networks.map((key) => `${networkDefinition(key).label}: ${args.captions[key]!.length} characters.`),
      ...(args.plannedFor ? [`The agent suggests posting at ${args.plannedFor}; it is not planned. A person chooses when to post.`] : []),
    ],
    effects: ["Approving creates a DRAFT in Marketing › Social posts, marked as drafted by the agent. Nothing is posted or planned: a person reviews the photos and posts it."],
    entity: { type: "SocialDraft", id: null, label: `Social draft · ${photos.length} photo${photos.length === 1 ? "" : "s"}` },
    fingerprint: { photoIds: photoIds.join(","), consentIds: consentIds.join(","), format: args.format as SocialFormat },
    execution: null,
  };
}

export const SOCIAL_DRAFT_NETWORKS = SOCIAL_NETWORK_KEYS;
