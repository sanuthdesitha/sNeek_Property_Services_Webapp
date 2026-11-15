import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPhotos, listCandidates } from "@/lib/marketing/social/eligibility";
import { makeSocialCrop } from "@/lib/marketing/social/image-pipeline";
import { networkResultView, SOCIAL_RATIOS, type SocialRatio } from "@/lib/marketing/social/networks";
import { readEvidencePhoto } from "@/lib/marketing/social/storage";
import type { AgentContext } from "./access";

/**
 * Social post generator tools for agents (2026-11-17), read pack "social"
 * ("Marketing photos"). Read only:
 *
 * - list_social_candidates: the SAME eligibility function as the screen
 *   (permission, QA passed, no open case, allowlisted fields, scores). No
 *   address, unit, property or client name, cleaner, original file, storage
 *   key or stamp; the suburb only when the owner allows it.
 * - get_social_photo: one cropped copy as MCP image content (stamp band and
 *   top strip cut off, metadata removed, at most 1080 px wide), eligibility
 *   checked again; never the evidence original. Made on the fly, not stored.
 * - list_social_posts: recent posts with each network's result and link and
 *   "not recorded" figures; never tokens or account ids.
 *
 * Drafts are asked for with request_social_draft (lib/agents/action-catalog.ts),
 * which only creates a request a person approves. No tool here, or anywhere
 * an agent can reach, publishes or schedules.
 */

export const MCP_IMAGE_KEY = "__mcpImage";
const MAX_IMAGE_BYTES = 1_500_000;

export class SocialToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialToolError";
  }
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

export type SocialToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  input: z.ZodType<Record<string, unknown>>;
  auditKeys: string[];
  run: (context: AgentContext, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const ratioSchema = z.enum(["4:5", "1:1", "1.91:1"]);

export const SOCIAL_AGENT_TOOLS: SocialToolDefinition[] = [
  {
    name: "list_social_candidates",
    title: "Photos usable for social posts",
    description: "Photos from finished, QA-passed jobs with no open case, at properties whose owner gave marketing permission, with a score (0-100, no AI), reasons in words, room, form field, the job's finish day and whether it was used before. Photos left out are listed with the reason. Use the photo ids with get_social_photo and request_social_draft.",
    inputSchema: object({
      days: { type: "integer", minimum: 1, maximum: 60, description: "How far back, default 30" },
      room: { type: "string", description: "Only this room, e.g. Bedroom" },
      ratio: { type: "string", enum: [...SOCIAL_RATIOS], description: "Shape the score is worked out for, default 4:5" },
      includeBefore: { type: "boolean", description: "Include before photos (only where the owner allows them)" },
      limit: { type: "integer", minimum: 1, maximum: 60 },
    }),
    input: z.object({ days: z.number().int().min(1).max(60).optional(), room: z.string().trim().min(1).max(40).optional(), ratio: ratioSchema.optional(), includeBefore: z.boolean().optional(), limit: z.number().int().min(1).max(60).optional() }).strict(),
    auditKeys: ["days", "room", "ratio", "includeBefore", "limit"],
    run: async (_context, args) => {
      const ratio = (args.ratio as SocialRatio | undefined) ?? "4:5";
      const list = await listCandidates({ days: (args.days as number | undefined) ?? 30, ratio, includeBefore: Boolean(args.includeBefore), hideUsed: false, room: (args.room as string | undefined) ?? null });
      const suburbByJob = new Map(list.jobs.map((job) => [job.jobId, job.suburb]));
      const limit = (args.limit as number | undefined) ?? 40;
      const usable = list.photos.filter((photo) => photo.state === "usable" || photo.state === "needs_look").slice(0, limit);
      const leftOut = list.photos.filter((photo) => photo.state === "left_out").slice(0, 20);
      return {
        period: { from: list.from, to: list.to },
        ratio,
        summary: { usable: list.summary.usable, leftOut: list.summary.leftOut, stillBeingChecked: list.summary.stillChecking, jobsWithPermission: list.summary.atPermission, jobsWithoutPermission: list.summary.noPermission },
        photos: usable.map((photo) => ({
          photoId: photo.photoId,
          setId: photo.jobId,
          score: photo.score ?? "not scored yet",
          room: photo.room,
          fieldLabel: photo.fieldLabel,
          kind: photo.fieldKind,
          needsPersonCheck: photo.state === "needs_look" ? "Before photo: a person must tick 'no guest belongings, faces, mail, screens or plates' in sNeek before it is posted." : null,
          reasons: photo.reasons,
          finishedOn: photo.finishedOn,
          suburb: suburbByJob.get(photo.jobId) ?? "not allowed to be named",
          usedBefore: photo.usedBefore,
          shapesThatFit: photo.fits,
        })),
        leftOut: leftOut.map((photo) => ({ photoId: photo.photoId, room: photo.room || "not recorded", reason: photo.leftOutReason ?? "not recorded" })),
        note: "setId groups photos of the same job (a before and after pair must share it). Never name a street, building, unit, client or cleaner in captions.",
      };
    },
  },
  {
    name: "get_social_photo",
    title: "One cleaned photo copy",
    description: "One eligible photo as a cropped JPEG (time and address stamp cut off, camera and location data removed, at most 1080 px wide), checked again for permission. Never the original.",
    inputSchema: object({ photoId: { type: "string" }, ratio: { type: "string", enum: [...SOCIAL_RATIOS] } }, ["photoId"]),
    input: z.object({ photoId: z.string().min(1).max(100), ratio: ratioSchema.optional() }).strict(),
    auditKeys: ["photoId", "ratio"],
    run: async (_context, args) => {
      const ratio = (args.ratio as SocialRatio | undefined) ?? "4:5";
      const { eligible, refused } = await checkPhotos([args.photoId as string], { ratio });
      const photo = eligible.get(args.photoId as string);
      if (!photo) throw new SocialToolError(refused[0]?.reason ?? "This photo cannot be used.");
      let bytes: Buffer;
      try {
        bytes = (await makeSocialCrop(await readEvidencePhoto(photo.s3Key), ratio)).bytes;
      } catch {
        throw new SocialToolError("The cleaned copy could not be made for this photo.");
      }
      if (bytes.length > MAX_IMAGE_BYTES) throw new SocialToolError("The cleaned copy is too large to send.");
      return {
        photoId: photo.photoId,
        room: photo.field.room,
        fieldLabel: photo.field.label,
        ratio,
        bytes: bytes.length,
        note: "Cropped copy: the stamp band and top strip are cut off and all photo metadata is removed.",
        [MCP_IMAGE_KEY]: { data: bytes.toString("base64"), mimeType: "image/jpeg" },
      };
    },
  },
  {
    name: "list_social_posts",
    title: "Recent social posts",
    description: "Recent social posts and drafts: format, each network's result as the network confirmed it, links, and reach or likes when the network returned them (otherwise \"not recorded\").",
    inputSchema: object({ limit: { type: "integer", minimum: 1, maximum: 30 } }),
    input: z.object({ limit: z.number().int().min(1).max(30).optional() }).strict(),
    auditKeys: ["limit"],
    run: async (_context, args) => {
      const groups = await db.socialPostGroup.findMany({
        where: { status: { not: "CANCELLED" } },
        orderBy: { createdAt: "desc" },
        take: (args.limit as number | undefined) ?? 10,
        select: {
          id: true, format: true, status: true, createdVia: true, createdAt: true, plannedFor: true,
          posts: { select: { channel: true, status: true, deliveryMode: true, externalId: true, externalUrl: true, scheduledFor: true, metrics: { orderBy: { fetchedAt: "desc" }, take: 1, select: { reach: true, likes: true, comments: true } } } },
        },
      });
      return {
        posts: groups.map((group) => ({
          postId: group.id,
          format: group.format,
          status: group.status,
          draftedBy: group.createdVia === "AGENT" ? "an agent (approved by a person)" : "a person",
          createdAt: group.createdAt.toISOString(),
          plannedFor: group.plannedFor?.toISOString() ?? "not planned",
          networks: group.posts.map((post) => ({
            network: post.channel,
            result: networkResultView({ status: post.status, externalId: post.externalId, deliveryMode: post.deliveryMode, scheduledFor: post.scheduledFor }).label,
            link: post.externalUrl ?? "not recorded",
            reach: post.metrics[0]?.reach ?? "not recorded",
            likes: post.metrics[0]?.likes ?? "not recorded",
            comments: post.metrics[0]?.comments ?? "not recorded",
          })),
        })),
      };
    },
  },
];
