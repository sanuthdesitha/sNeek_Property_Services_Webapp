// @vitest-environment node
/**
 * Social post generator (2026-11-17) on a real, disposable PostgreSQL
 * (127.0.0.1:55439, a fresh database): marketing permission enforced at every
 * server step (candidates, export, drafts, agent tools, agent approval,
 * posting); revoke removes drafts and flags posted posts; the register is
 * append-only; posting is idempotent under real concurrency and recorded only
 * as the (stubbed) network confirmed; sign-in refresh and "needs reconnect";
 * planned posts re-check at their time; agents only read cleaned copies and
 * ask for drafts, never post; who may do what. No request leaves the test.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFixturePhoto } from "../helpers/social-images";

const m = vi.hoisted(() => ({
  client: null as unknown as PrismaClient,
  files: new Map<string, Buffer>(),
  notice: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_t, key) { const value = (m.client as unknown as Record<string | symbol, unknown>)[key]; return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(m.client) : value; } }) }));
vi.mock("@/lib/settings", () => ({ getAppSettings: async () => ({ timezone: "Australia/Sydney", companyName: "sNeek Property Services" }) }));
vi.mock("@/lib/notifications/agent-requests", () => ({ sendAgentRequestNotice: m.notice }));
vi.mock("@/lib/marketing/social/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/marketing/social/storage")>("@/lib/marketing/social/storage");
  return {
    ...actual,
    readEvidencePhoto: async (key: string) => { const bytes = m.files.get(key); if (!bytes) throw new Error("The stored photo could not be read."); return bytes; },
    putDerivative: async (key: string, bytes: Buffer) => { m.files.set(key, bytes); },
    readDerivative: async (key: string) => { const bytes = m.files.get(key); if (!bytes) throw new Error("missing"); return bytes; },
    deleteDerivative: async (key: string) => m.files.delete(key),
  };
});

import { encryptSecret } from "@/lib/security/encryption";
import { activeConsents, recordConsent, revokeConsent } from "@/lib/marketing/social/consent";
import { checkPhotos, listCandidates } from "@/lib/marketing/social/eligibility";
import { processSocialScoreQueue } from "@/lib/marketing/social/score-queue";
import { createGroup, ensureDerivatives, markReviewed, updateGroup } from "@/lib/marketing/social/groups";
import { publishGroup, planGroup, PublishRefused } from "@/lib/marketing/social/publish";
import { processPlannedSocialPosts } from "@/lib/marketing/social/scheduled";
import { listAccounts, usableAccount } from "@/lib/marketing/social/accounts";
import { socialRightRefusal } from "@/lib/marketing/social/access";
import { createAgent, setAgentWriteAreas } from "@/lib/agents/admin";
import { authenticateAgent } from "@/lib/agents/access";
import { handleMcpPost } from "@/lib/agents/mcp";
import { proposeAgentAction } from "@/lib/agents/action-requests";
import { decideAgentRequest } from "@/lib/agents/action-execute";
import type { HttpClient, HttpRequest } from "@/lib/marketing/social/networks/http";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const tag = randomUUID().slice(0, 8);
const OPS_KEY = "ops_feature_permissions_v1";
const PAUSE_KEY = "agents_paused_v1";
const ids = {
  admin: `sp-admin-${tag}`, opsManage: `sp-ops-m-${tag}`, opsRead: `sp-ops-r-${tag}`, opsNoClients: `sp-ops-nc-${tag}`, cleaner: `sp-cleaner-${tag}`,
  client: `sp-client-${tag}`, otherClient: `sp-client2-${tag}`, propA: `sp-prop-a-${tag}`, propB: `sp-prop-b-${tag}`, template: `sp-tpl-${tag}`,
};
const PUBLIC = "https://app.example.test";
let savedPolicy: unknown;
let jobA: string;
let jobB: string;
let jobUnreviewed: string;
const media: Record<string, string> = {};

type Stub = { http: HttpClient; calls: HttpRequest[] };

function metaStub(mode: "ok" | "fail190" | "timeout" = "ok", delayMs = 0): Stub {
  const calls: HttpRequest[] = [];
  let counter = 0;
  const http: HttpClient = async (request) => {
    calls.push(request);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const path = new URL(request.url).pathname;
    if (mode === "fail190" && /\/(photos|feed)$/.test(path)) return { status: 400, json: { error: { message: "Error validating access token", code: 190 } } };
    if (mode === "timeout" && /\/photos$/.test(path) && request.form?.published === "true") {
      const { HttpTransportError } = await import("@/lib/marketing/social/networks/http");
      throw new HttpTransportError(true, "timeout");
    }
    counter += 1;
    if (path.endsWith("/photos")) return { status: 200, json: request.form?.published === "false" ? { id: `m${counter}` } : { id: `p${counter}`, post_id: `page_${counter}` } };
    if (path.endsWith("/feed")) return { status: 200, json: { id: `page_feed_${counter}` } };
    if (path.endsWith("/media")) return { status: 200, json: { id: `c${counter}` } };
    if (path.endsWith("/media_publish")) return { status: 200, json: { id: `ig${counter}` } };
    if (path.endsWith("/oauth/access_token")) return { status: 200, json: { access_token: `REFRESHED-${counter}`, expires_in: 5_184_000 } };
    const fields = new URL(request.url).searchParams.get("fields");
    if (fields === "status_code") return { status: 200, json: { status_code: "FINISHED" } };
    if (fields === "permalink_url") return { status: 200, json: { permalink_url: `https://www.facebook.com/posts/${counter}` } };
    if (fields === "permalink") return { status: 200, json: { permalink: `https://www.instagram.com/p/${counter}/` } };
    return { status: 404, json: { error: { message: "unhandled", code: 100 } } };
  };
  return { http, calls };
}

async function setPolicy() {
  const assignments = {
    [ids.opsManage]: { presetId: "existing", overrides: { marketing: "manage", clients: "manage", approvals: "manage" } },
    [ids.opsRead]: { presetId: "existing", overrides: { marketing: "read", clients: "manage", approvals: "manage" } },
    [ids.opsNoClients]: { presetId: "existing", overrides: { marketing: "manage", clients: "read", approvals: "manage" } },
  };
  const policy = { revision: 1, presets: [], assignments };
  await m.client.appSetting.upsert({ where: { key: OPS_KEY }, create: { key: OPS_KEY, value: policy }, update: { value: policy } });
}

async function makeJob(propertyId: string, number: string, options: { qa?: boolean | null; photos: Array<{ field: string; seed: number; blur?: number }> }) {
  const job = await m.client.job.create({ data: { jobNumber: `SP-${tag}-${number}`, propertyId, jobType: "AIRBNB_TURNOVER", status: "COMPLETED", scheduledDate: new Date("2026-11-10T00:00:00Z"), completedAt: new Date("2026-11-12T04:00:00Z") } });
  await m.client.jobAssignment.create({ data: { jobId: job.id, userId: ids.cleaner, isPrimary: true } });
  if (options.qa !== null && options.qa !== undefined) await m.client.qAReview.create({ data: { jobId: job.id, score: 96, passed: options.qa, kind: "QA" } });
  const submission = await m.client.formSubmission.create({ data: { jobId: job.id, templateId: ids.template, submittedById: ids.cleaner, data: {} } });
  const { perceptualHash } = await import("@/lib/media/photo-integrity");
  for (const photo of options.photos) {
    const bytes = await makeFixturePhoto({ seed: photo.seed, blur: photo.blur, width: 900, height: 1200 });
    const key = `jobs/${job.id}/${randomUUID()}.jpg`;
    m.files.set(key, bytes);
    const row = await m.client.submissionMedia.create({ data: { submissionId: submission.id, fieldId: photo.field, mediaType: "PHOTO", url: `https://storage.invalid/${key}`, s3Key: key, perceptualHash: await perceptualHash(bytes), integrityCheckedAt: new Date() } });
    media[`${number}:${photo.field}`] = row.id;
  }
  return job.id;
}

async function giveConsent(propertyIds: string[], options: { allowSuburb?: boolean; allowBefore?: boolean } = {}) {
  return recordConsent({ clientId: ids.client, propertyIds, allowSuburb: options.allowSuburb ?? true, allowBefore: options.allowBefore ?? true, method: "EMAIL", givenByName: "Sarah Fixture", recordedById: ids.admin, evidenceS3Key: "marketing-consent/fixture.pdf" }, { userId: ids.admin, via: "OFFICE" });
}

async function connectFacebook(options: { expiresAt?: Date | null } = {}) {
  await m.client.socialAccount.updateMany({ where: { network: { in: ["FACEBOOK", "INSTAGRAM"] } }, data: { status: "DISCONNECTED" } });
  return m.client.socialAccount.create({ data: {
    network: "FACEBOOK", externalId: "page-1", displayName: "sNeek Page (fixture)", tokenCiphertext: encryptSecret("PAGE-TOKEN-SECRET"), refreshCiphertext: encryptSecret("USER-TOKEN-SECRET"),
    tokenExpiresAt: options.expiresAt ?? null, connectedById: ids.admin, status: "CONNECTED",
  } });
}

async function readyGroup(photoIds: string[], format: "SINGLE" | "CAROUSEL" = photoIds.length > 1 ? "CAROUSEL" : "SINGLE") {
  const groupId = await createGroup({ format, photoIds }, { userId: ids.admin, via: "USER" });
  let group = await m.client.socialPostGroup.findUniqueOrThrow({ where: { id: groupId } });
  await updateGroup(groupId, { expectedRevision: group.revision, altText: Object.fromEntries(photoIds.map((id) => [id, "Bright living room with a green sofa"])) }, ids.admin);
  group = await m.client.socialPostGroup.findUniqueOrThrow({ where: { id: groupId } });
  await markReviewed(groupId, ids.admin, group.revision, true);
  return groupId;
}

describe.skipIf(!url)("social post generator (database)", () => {
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1" || new URL(url!).port !== "55439") throw Error("Dedicated loopback fixture database required");
    process.env.ENCRYPTION_KEY = "db-test-encryption-key-0123456789";
    process.env.NEXTAUTH_SECRET = "db-test-nextauth-secret-0123456789";
    m.client = new PrismaClient({ datasources: { db: { url } } });
    savedPolicy = (await m.client.appSetting.findUnique({ where: { key: OPS_KEY } }))?.value;
    await m.client.appSetting.deleteMany({ where: { key: PAUSE_KEY } });
    for (const [id, role] of [[ids.admin, "ADMIN"], [ids.opsManage, "OPS_MANAGER"], [ids.opsRead, "OPS_MANAGER"], [ids.opsNoClients, "OPS_MANAGER"], [ids.cleaner, "CLEANER"]] as const) {
      await m.client.user.create({ data: { id, name: id === ids.cleaner ? "Priya Fixture" : id, email: `${id}@example.invalid`, role, passwordHash: "fixture-only" } });
    }
    await setPolicy();
    await m.client.client.create({ data: { id: ids.client, name: "Harbour Fixture Stays" } });
    await m.client.client.create({ data: { id: ids.otherClient, name: "Other Fixture Owner" } });
    await m.client.property.create({ data: { id: ids.propA, clientId: ids.client, name: "Bondi Fixture House", address: "18 Campbell Parade, Bondi Beach", suburb: "Bondi", postcode: "2026", bedrooms: 3 } });
    await m.client.property.create({ data: { id: ids.propB, clientId: ids.client, name: "Coogee Fixture Terrace", address: "7 Arden Street, Coogee", suburb: "Coogee", postcode: "2034", bedrooms: 2 } });
    await m.client.formTemplate.create({ data: { id: ids.template, name: `Fixture form ${tag}`, serviceType: "AIRBNB_TURNOVER", schema: {} } });
    jobA = await makeJob(ids.propA, "A", { qa: true, photos: [{ field: "staging-living", seed: 11 }, { field: "bed-final-look", seed: 12 }, { field: "kitchen-benches-sink", seed: 13, blur: 14 }, { field: "kitchen-closeup-rangehood", seed: 14 }, { field: "arrival-before-photos", seed: 15 }] });
    jobB = await makeJob(ids.propB, "B", { qa: true, photos: [{ field: "staging-kitchen", seed: 21 }] });
    jobUnreviewed = await makeJob(ids.propA, "C", { qa: null, photos: [{ field: "staging-living", seed: 31 }] });
    const scored = await processSocialScoreQueue({ jobIds: [jobA, jobB, jobUnreviewed], batch: 50, now: new Date("2026-11-15T00:00:00Z") });
    expect(scored.scored).toBeGreaterThanOrEqual(4);
  }, 120_000);

  beforeEach(() => {
    m.notice.mockReset();
    m.notice.mockResolvedValue([{ state: "inbox_available" }]);
  });

  afterAll(async () => {
    if (!m.client) return;
    await m.client.$executeRawUnsafe(`ALTER TABLE "MarketingConsent" DISABLE TRIGGER "MarketingConsent_guard"`);
    await m.client.$executeRawUnsafe(`ALTER TABLE "MarketingConsentProperty" DISABLE TRIGGER "MarketingConsentProperty_append_only"`);
    await m.client.$executeRawUnsafe(`ALTER TABLE "AgentActionEvent" DISABLE TRIGGER "AgentActionEvent_append_only"`);
    await m.client.$executeRawUnsafe(`ALTER TABLE "AgentActionRequest" DISABLE TRIGGER "AgentActionRequest_guard"`);
    const consents = await m.client.marketingConsent.findMany({ where: { clientId: { in: [ids.client, ids.otherClient] } }, select: { id: true } });
    await m.client.marketingConsentProperty.deleteMany({ where: { consentId: { in: consents.map((row) => row.id) } } });
    await m.client.marketingConsent.deleteMany({ where: { id: { in: consents.map((row) => row.id) } } });
    const agents = await m.client.agentProfile.findMany({ where: { createdById: ids.admin }, select: { id: true } });
    const requests = await m.client.agentActionRequest.findMany({ where: { agentId: { in: agents.map((row) => row.id) } }, select: { id: true } });
    await m.client.agentActionEvent.deleteMany({ where: { requestId: { in: requests.map((row) => row.id) } } });
    await m.client.agentActionRequest.deleteMany({ where: { id: { in: requests.map((row) => row.id) } } });
    await m.client.$executeRawUnsafe(`ALTER TABLE "MarketingConsent" ENABLE TRIGGER "MarketingConsent_guard"`);
    await m.client.$executeRawUnsafe(`ALTER TABLE "MarketingConsentProperty" ENABLE TRIGGER "MarketingConsentProperty_append_only"`);
    await m.client.$executeRawUnsafe(`ALTER TABLE "AgentActionEvent" ENABLE TRIGGER "AgentActionEvent_append_only"`);
    await m.client.$executeRawUnsafe(`ALTER TABLE "AgentActionRequest" ENABLE TRIGGER "AgentActionRequest_guard"`);
    await m.client.agentAuditEntry.deleteMany({ where: { agentId: { in: agents.map((row) => row.id) } } }).catch(() => undefined);
    await m.client.agentProfile.deleteMany({ where: { createdById: ids.admin } });
    await m.client.socialPostGroup.deleteMany({ where: { OR: [{ createdById: { in: [ids.admin, ids.opsManage] } }, { plannedById: ids.admin }] } });
    await m.client.socialPost.deleteMany({ where: { createdById: { in: [ids.admin, ids.opsManage] } } });
    await m.client.marketingAsset.deleteMany({ where: { sourcePropertyId: { in: [ids.propA, ids.propB] } } });
    await m.client.socialAccount.deleteMany({ where: { connectedById: ids.admin } });
    const jobs = [jobA, jobB, jobUnreviewed].filter(Boolean);
    await m.client.socialPhotoScore.deleteMany({ where: { jobId: { in: jobs } } });
    await m.client.submissionMedia.deleteMany({ where: { submission: { jobId: { in: jobs } } } });
    await m.client.formSubmission.deleteMany({ where: { jobId: { in: jobs } } });
    await m.client.qAReview.deleteMany({ where: { jobId: { in: jobs } } });
    await m.client.issueTicket.deleteMany({ where: { title: { contains: tag } } });
    await m.client.jobAssignment.deleteMany({ where: { jobId: { in: jobs } } });
    await m.client.job.deleteMany({ where: { id: { in: jobs } } });
    await m.client.formTemplate.deleteMany({ where: { id: ids.template } });
    await m.client.property.deleteMany({ where: { id: { in: [ids.propA, ids.propB] } } });
    await m.client.client.deleteMany({ where: { id: { in: [ids.client, ids.otherClient] } } });
    await m.client.auditLog.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    // Fixture people are deactivated before removal so no live administrator is left behind.
    await m.client.user.updateMany({ where: { id: { in: [ids.admin, ids.opsManage, ids.opsRead, ids.opsNoClients, ids.cleaner] } }, data: { isActive: false } });
    await m.client.user.deleteMany({ where: { id: { in: [ids.admin, ids.opsManage, ids.opsRead, ids.opsNoClients, ids.cleaner] } } });
    await m.client.appSetting.deleteMany({ where: { key: OPS_KEY } });
    if (savedPolicy !== undefined) await m.client.appSetting.create({ data: { key: OPS_KEY, value: savedPolicy as never } });
    await m.client.$disconnect();
  }, 60_000);

  it("without a recorded permission no photo is offered, exported, drafted or read by an agent", async () => {
    const list = await listCandidates({ days: 30, ratio: "4:5", includeBefore: true, hideUsed: false, now: new Date("2026-11-15T00:00:00Z") });
    expect(list.photos.filter((photo) => photo.jobId === jobA)).toEqual([]);
    expect(list.summary.noPermission).toBeGreaterThanOrEqual(2);
    expect(list.jobs.some((job) => job.jobId === jobA)).toBe(false);
    const checked = await checkPhotos([media["A:staging-living"]]);
    expect(checked.refused[0].reason).toMatch(/No marketing permission/);
    await expect(createGroup({ format: "SINGLE", photoIds: [media["A:staging-living"]] }, { userId: ids.admin, via: "USER" })).rejects.toMatchObject({ status: 409 });
  });

  it("with permission: eligible photos only, scored without AI, with reasons and the hard stops in words", async () => {
    await giveConsent([ids.propA, ids.propB]);
    const list = await listCandidates({ days: 30, ratio: "4:5", includeBefore: true, hideUsed: false, now: new Date("2026-11-15T00:00:00Z") });
    const living = list.photos.find((photo) => photo.photoId === media["A:staging-living"])!;
    expect(living.state).toBe("usable");
    expect(living.score).toBeGreaterThan(0);
    expect(living.reasons.join(" ")).toMatch(/Final look/);
    expect(list.photos.find((photo) => photo.photoId === media["A:kitchen-benches-sink"])?.leftOutReason).toMatch(/^Blurry/);
    expect(list.photos.find((photo) => photo.photoId === media["A:kitchen-closeup-rangehood"])).toBeUndefined();
    expect(list.photos.find((photo) => photo.photoId === media["A:arrival-before-photos"])?.state).toBe("needs_look");
    expect(list.jobs.find((job) => job.jobId === jobUnreviewed)?.reason).toMatch(/QA not reviewed yet/);
    expect(list.jobs.find((job) => job.jobId === jobA)?.suburb).toBe("Bondi");
    const ticket = await m.client.issueTicket.create({ data: { title: `Open case ${tag}`, propertyId: ids.propB, state: "OPEN" } });
    expect((await checkPhotos([media["B:staging-kitchen"]])).refused[0].reason).toMatch(/Open case/);
    await m.client.issueTicket.update({ where: { id: ticket.id }, data: { state: "RESOLVED" } });
    expect((await checkPhotos([media["B:staging-kitchen"]])).eligible.size).toBe(1);
  });

  it("a property that moves to another owner keeps no permission", async () => {
    await m.client.property.update({ where: { id: ids.propB }, data: { clientId: ids.otherClient } });
    expect((await activeConsents([ids.propB])).size).toBe(0);
    await m.client.property.update({ where: { id: ids.propB }, data: { clientId: ids.client } });
    expect((await activeConsents([ids.propB])).size).toBe(1);
  });

  it("the register is append-only: no edit, no delete, ended only once", async () => {
    const row = await m.client.marketingConsent.findFirstOrThrow({ where: { clientId: ids.client, endedAt: null } });
    await expect(m.client.marketingConsent.update({ where: { id: row.id }, data: { allowBefore: false } })).rejects.toThrow();
    await expect(m.client.marketingConsent.delete({ where: { id: row.id } })).rejects.toThrow();
    await expect(m.client.marketingConsentProperty.deleteMany({ where: { consentId: row.id } })).rejects.toThrow();
  });

  it("the cleaned copies are new files linked to the photo and job; the original is never touched", async () => {
    const groupId = await createGroup({ format: "SINGLE", photoIds: [media["A:staging-living"]] }, { userId: ids.admin, via: "USER" });
    const original = m.files.get((await m.client.submissionMedia.findUniqueOrThrow({ where: { id: media["A:staging-living"] } })).s3Key)!;
    const before = Buffer.from(original);
    const images = await ensureDerivatives(groupId, ids.admin);
    const asset = await m.client.marketingAsset.findUniqueOrThrow({ where: { id: images[0].assetId } });
    expect(asset).toMatchObject({ derivativeKind: "social_crop", sourceSubmissionMediaId: media["A:staging-living"], sourceJobId: jobA, sourcePropertyId: ids.propA, exifStripped: true });
    expect(asset.s3Key).toMatch(/^marketing\/social\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.jpg$/);
    expect((await sharp(m.files.get(asset.s3Key!)!).metadata()).exif).toBeUndefined();
    expect(m.files.get((await m.client.submissionMedia.findUniqueOrThrow({ where: { id: media["A:staging-living"] } })).s3Key)!.equals(before)).toBe(true);
  });

  it("publishing refuses until the photos were looked at, alt text is written and the caption names no address", async () => {
    await connectFacebook();
    const stub = metaStub();
    const groupId = await createGroup({ format: "SINGLE", photoIds: [media["A:bed-final-look"]] }, { userId: ids.admin, via: "USER" });
    await expect(publishGroup({ groupId, networks: ["FACEBOOK"], actorId: ids.admin, trigger: "CLICK" }, { http: stub.http, publicBase: PUBLIC })).rejects.toBeInstanceOf(PublishRefused);
    let group = await m.client.socialPostGroup.findUniqueOrThrow({ where: { id: groupId } });
    await updateGroup(groupId, { expectedRevision: group.revision, altText: { [media["A:bed-final-look"]]: "Made bed" }, captions: { FACEBOOK: { caption: "Fresh linen at 18 Campbell Parade today" } } }, ids.admin);
    group = await m.client.socialPostGroup.findUniqueOrThrow({ where: { id: groupId } });
    await markReviewed(groupId, ids.admin, group.revision, true);
    const refused = await publishGroup({ groupId, networks: ["FACEBOOK"], actorId: ids.admin, trigger: "CLICK" }, { http: stub.http, publicBase: PUBLIC }).catch((error) => error);
    expect(refused).toBeInstanceOf(PublishRefused);
    expect((refused as PublishRefused).problems.join(" ")).toMatch(/street/);
    expect(stub.calls).toHaveLength(0);
  });

  it("five clicks at once post once: one claim, one attempt, one network call; the result is what the network confirmed", async () => {
    await connectFacebook();
    const groupId = await readyGroup([media["A:staging-living"], media["A:bed-final-look"]]);
    const stub = metaStub("ok", 30);
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => publishGroup({ groupId, networks: ["FACEBOOK"], actorId: ids.admin, trigger: "CLICK" }, { http: stub.http, publicBase: PUBLIC }).catch((error) => error)));
    const rows = outcomes.flatMap((outcome) => (Array.isArray(outcome) ? outcome : []));
    expect(rows.filter((row) => row.outcome === "POSTED")).toHaveLength(1);
    expect(rows.filter((row) => row.outcome === "ALREADY").length).toBe(rows.length - 1);
    expect(stub.calls.filter((call) => call.url.endsWith("/feed"))).toHaveLength(1);
    const post = await m.client.socialPost.findFirstOrThrow({ where: { groupId, channel: "FACEBOOK" } });
    expect(post).toMatchObject({ status: "PUBLISHED", deliveryMode: "API", attemptCount: 1 });
    expect(post.externalId).toMatch(/^page_feed_/);
    expect(await m.client.socialPublishAttempt.count({ where: { socialPostId: post.id } })).toBe(1);
    // Every image URL the network got was a signed link to a cleaned copy on the public address.
    expect(stub.calls.filter((call) => call.form?.url).every((call) => call.form!.url.startsWith(`${PUBLIC}/api/public/social-media/`))).toBe(true);
    // Unconnected networks were not contacted and wait for the fallback.
    const tiktok = await m.client.socialPost.findFirstOrThrow({ where: { groupId, channel: "TIKTOK" } });
    expect(tiktok.status).toBe("DRAFT");
  });

  it("a refused sign-in is FAILED with the reason and marks the account; a timeout is UNCONFIRMED and needs the person's check to retry", async () => {
    const account = await connectFacebook();
    const failGroup = await readyGroup([media["A:staging-living"]]);
    const [failed] = await publishGroup({ groupId: failGroup, networks: ["FACEBOOK"], actorId: ids.admin, trigger: "CLICK" }, { http: metaStub("fail190").http, publicBase: PUBLIC });
    expect(failed).toMatchObject({ outcome: "FAILED" });
    expect(failed.message).toMatch(/code 190/);
    expect(await m.client.socialPost.findFirstOrThrow({ where: { groupId: failGroup, channel: "FACEBOOK" } })).toMatchObject({ status: "FAILED", failureCode: "TOKEN_INVALID", externalId: null });
    expect((await m.client.socialAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe("NEEDS_RECONNECT");
    const [notConnected] = await publishGroup({ groupId: failGroup, networks: ["FACEBOOK"], actorId: ids.admin, trigger: "RETRY" }, { http: metaStub().http, publicBase: PUBLIC });
    expect(notConnected.outcome).toBe("NOT_CONNECTED");

    await connectFacebook();
    const timeoutGroup = await readyGroup([media["A:bed-final-look"]]);
    const [unconfirmed] = await publishGroup({ groupId: timeoutGroup, networks: ["FACEBOOK"], actorId: ids.admin, trigger: "CLICK" }, { http: metaStub("timeout").http, publicBase: PUBLIC });
    expect(unconfirmed.outcome).toBe("UNCONFIRMED");
    const [again] = await publishGroup({ groupId: timeoutGroup, networks: ["FACEBOOK"], actorId: ids.admin, trigger: "RETRY" }, { http: metaStub().http, publicBase: PUBLIC });
    expect(again.outcome).toBe("ALREADY");
    const [checked] = await publishGroup({ groupId: timeoutGroup, networks: ["FACEBOOK"], actorId: ids.admin, trigger: "RETRY", confirmNotPosted: true }, { http: metaStub().http, publicBase: PUBLIC });
    expect(checked.outcome).toBe("POSTED");
    const post = await m.client.socialPost.findFirstOrThrow({ where: { groupId: timeoutGroup, channel: "FACEBOOK" } });
    expect(await m.client.socialPublishAttempt.findMany({ where: { socialPostId: post.id }, orderBy: { attempt: "asc" }, select: { attempt: true, outcome: true } })).toEqual([{ attempt: 1, outcome: "UNCONFIRMED" }, { attempt: 2, outcome: "POSTED" }]);
  });

  it("refreshes a sign-in close to expiry, and marks an expired one 'needs reconnect'", async () => {
    const soon = await connectFacebook({ expiresAt: new Date(Date.now() + 2 * 86_400_000) });
    await m.client.appSetting.upsert({ where: { key: "social_meta_app_v1" }, create: { key: "social_meta_app_v1", value: { appId: "123456789", appSecretCiphertext: encryptSecret("abcdefabcdefabcdef12"), updatedAt: "x", updatedById: ids.admin } }, update: { value: { appId: "123456789", appSecretCiphertext: encryptSecret("abcdefabcdefabcdef12"), updatedAt: "x", updatedById: ids.admin } } });
    const stub = metaStub();
    const usable = await usableAccount("FACEBOOK", stub.http);
    expect(usable?.token).toMatch(/^REFRESHED-/);
    expect(stub.calls[0].form).toMatchObject({ grant_type: "fb_exchange_token" });
    expect((await m.client.socialAccount.findUniqueOrThrow({ where: { id: soon.id } })).tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 30 * 86_400_000);
    const expired = await connectFacebook({ expiresAt: new Date(Date.now() - 1000) });
    expect(await usableAccount("FACEBOOK", metaStub().http)).toBeNull();
    expect((await m.client.socialAccount.findUniqueOrThrow({ where: { id: expired.id } })).status).toBe("NEEDS_RECONNECT");
    await m.client.appSetting.deleteMany({ where: { key: "social_meta_app_v1" } });
  });

  it("no token or secret appears in account listings, results or audit rows", async () => {
    await connectFacebook();
    const groupId = await readyGroup([media["B:staging-kitchen"]]);
    const results = await publishGroup({ groupId, networks: ["FACEBOOK", "INSTAGRAM", "GOOGLE_BUSINESS"], actorId: ids.admin, trigger: "CLICK" }, { http: metaStub().http, publicBase: PUBLIC });
    const audits = await m.client.auditLog.findMany({ where: { userId: ids.admin, action: { startsWith: "SOCIAL_" } } });
    const text = JSON.stringify([await listAccounts(), results, audits]);
    expect(text).not.toMatch(/PAGE-TOKEN-SECRET|USER-TOKEN-SECRET|enc:v1:/);
  });

  it("a planned post is sent at its time after the checks run again; a lost right or a late run is refused with the reason", async () => {
    await connectFacebook();
    const now = new Date();
    const groupId = await readyGroup([media["A:staging-living"]]);
    await planGroup({ groupId, plannedFor: new Date(now.getTime() + 3_600_000), networks: ["FACEBOOK", "TIKTOK"], actorId: ids.admin }, { now });
    expect(await m.client.socialPost.findFirstOrThrow({ where: { groupId, channel: "TIKTOK" } })).toMatchObject({ status: "SCHEDULED", deliveryMode: "MANUAL" });
    const notify = vi.fn().mockResolvedValue([]);
    const early = await processPlannedSocialPosts({ http: metaStub().http, publicBase: PUBLIC, now, notify });
    expect(early.groups).toBe(0);
    const due = await processPlannedSocialPosts({ http: metaStub().http, publicBase: PUBLIC, now: new Date(now.getTime() + 3_700_000), notify });
    expect(due).toMatchObject({ groups: 1, posted: 1 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ groupId, plannerId: ids.admin, rows: [expect.objectContaining({ network: "FACEBOOK", outcome: "POSTED" })] }));
    expect(await m.client.socialPost.findFirstOrThrow({ where: { groupId, channel: "TIKTOK" } })).toMatchObject({ status: "SCHEDULED", deliveryMode: "MANUAL" });

    const opsGroup = await createGroup({ format: "SINGLE", photoIds: [media["A:bed-final-look"]] }, { userId: ids.opsManage, via: "USER" });
    let group = await m.client.socialPostGroup.findUniqueOrThrow({ where: { id: opsGroup } });
    await updateGroup(opsGroup, { expectedRevision: group.revision, altText: { [media["A:bed-final-look"]]: "Made bed" } }, ids.opsManage);
    group = await m.client.socialPostGroup.findUniqueOrThrow({ where: { id: opsGroup } });
    await markReviewed(opsGroup, ids.opsManage, group.revision, true);
    await planGroup({ groupId: opsGroup, plannedFor: new Date(now.getTime() + 3_600_000), networks: ["FACEBOOK"], actorId: ids.opsManage }, { now });
    await m.client.appSetting.update({ where: { key: OPS_KEY }, data: { value: { revision: 2, presets: [], assignments: { [ids.opsManage]: { presetId: "existing", overrides: { marketing: "read" } } } } } });
    const stub = metaStub();
    const refused = await processPlannedSocialPosts({ http: stub.http, publicBase: PUBLIC, now: new Date(now.getTime() + 3_700_000), notify });
    expect(refused.posted).toBe(0);
    expect(stub.calls).toHaveLength(0);
    expect(await m.client.socialPost.findFirstOrThrow({ where: { groupId: opsGroup, channel: "FACEBOOK" } })).toMatchObject({ status: "FAILED", failureCode: "REFUSED_AT_TIME" });
    await setPolicy();

    const lateGroup = await readyGroup([media["B:staging-kitchen"]]);
    await planGroup({ groupId: lateGroup, plannedFor: new Date(now.getTime() + 3_600_000), networks: ["FACEBOOK"], actorId: ids.admin }, { now });
    const late = await processPlannedSocialPosts({ http: stub.http, publicBase: PUBLIC, now: new Date(now.getTime() + 8 * 3_600_000), notify });
    expect(late.posted).toBe(0);
    expect(await m.client.socialPost.findFirstOrThrow({ where: { groupId: lateGroup, channel: "FACEBOOK" } })).toMatchObject({ status: "FAILED", failureCode: "MISSED_TIME" });
    // A draft nobody planned is never touched.
    const draftOnly = await createGroup({ format: "SINGLE", photoIds: [media["A:staging-living"]] }, { userId: ids.admin, via: "USER" });
    await processPlannedSocialPosts({ http: stub.http, publicBase: PUBLIC, now: new Date(now.getTime() + 9 * 3_600_000), notify });
    expect((await m.client.socialPost.findMany({ where: { groupId: draftOnly } })).every((post) => post.status === "DRAFT")).toBe(true);
    expect(stub.calls).toHaveLength(0);
  });

  it("agents: social tools only with the pack, cleaned copies only as image content, drafts only through a person's approval", async () => {
    const plain = await createAgent({ name: `Plain ${tag}`, areas: ["jobs"], writeAreas: [], expiresInDays: 30 }, ids.admin);
    const plainList = await handleMcpPost({ authorization: `Bearer ${plain.token}`, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(JSON.stringify(plainList.body)).not.toMatch(/list_social_candidates|get_social_photo|request_social_draft/);

    const agent = await createAgent({ name: `Claude ${tag}`, areas: ["social"], writeAreas: ["social_drafts"], expiresInDays: 30 }, ids.admin);
    const list = await handleMcpPost({ authorization: `Bearer ${agent.token}`, body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_social_candidates", arguments: { days: 60, includeBefore: true } } } });
    const listText = JSON.stringify(list.body);
    expect(listText).toContain(media["A:staging-living"]);
    expect(listText).not.toMatch(/Campbell Parade|Bondi Fixture House|Harbour Fixture|Priya Fixture|jobs\/|storage\.invalid/);

    const photo = await handleMcpPost({ authorization: `Bearer ${agent.token}`, body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_social_photo", arguments: { photoId: media["A:staging-living"] } } } });
    const content = (photo.body as { result: { content: Array<{ type: string; data?: string; mimeType?: string }>; isError: boolean } }).result;
    expect(content.isError).toBe(false);
    const image = content.content.find((item) => item.type === "image")!;
    expect(image.mimeType).toBe("image/jpeg");
    const bytes = Buffer.from(image.data!, "base64");
    expect((await sharp(bytes).metadata()).exif).toBeUndefined();
    const closeup = await handleMcpPost({ authorization: `Bearer ${agent.token}`, body: { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_social_photo", arguments: { photoId: media["A:kitchen-closeup-rangehood"] } } } });
    expect((closeup.body as { result: { isError: boolean } }).result.isError).toBe(true);

    const context = await authenticateAgent(`Bearer ${agent.token}`);
    const groupsBefore = await m.client.socialPostGroup.count();
    const receipt = await proposeAgentAction(context, "request_social_draft", {
      idempotencyKey: `social-${tag}-1`,
      photoIds: [media["A:staging-living"], media["A:bed-final-look"]],
      format: "CAROUSEL",
      captions: { INSTAGRAM: "Guest-ready in Bondi. Book a walkthrough: link in bio", FACEBOOK: "Guest-ready in Bondi." },
      altText: { [media["A:staging-living"]]: "Living room set for guests", [media["A:bed-final-look"]]: "Bed made with fresh linen" },
      plannedFor: "2026-11-20T09:00:00.000Z",
    });
    expect(receipt.status).toBe("WAITING");
    expect(await m.client.socialPostGroup.count()).toBe(groupsBefore);
    await expect(proposeAgentAction(context, "request_social_draft", { idempotencyKey: `social-${tag}-2`, photoIds: [media["A:staging-living"]], format: "SINGLE", captions: { FACEBOOK: "At 18 Campbell Parade" }, altText: { [media["A:staging-living"]]: "Living" } })).rejects.toMatchObject({ code: "PRECONDITION" });

    await expect(decideAgentRequest({ requestId: receipt.requestId, approver: { userId: ids.opsRead, impersonating: false }, decision: "approve" })).rejects.toMatchObject({ status: 403 });
    const outcome = await decideAgentRequest({ requestId: receipt.requestId, approver: { userId: ids.admin, impersonating: false }, decision: "approve" });
    expect(outcome.status).toBe("EXECUTED");
    const draft = await m.client.socialPostGroup.findFirstOrThrow({ where: { agentActionRequestId: receipt.requestId }, include: { posts: true } });
    expect(draft).toMatchObject({ createdVia: "AGENT", status: "DRAFT", plannedFor: null, reviewedAt: null });
    expect(draft.posts.every((post) => post.status === "DRAFT" && post.externalId === null)).toBe(true);
    // Taking the write pack away stops further requests at once.
    await setAgentWriteAreas(agent.agentId, { writeAreas: [] }, ids.admin);
    const narrowed = await authenticateAgent(`Bearer ${agent.token}`);
    await expect(proposeAgentAction(narrowed, "request_social_draft", { idempotencyKey: `social-${tag}-3`, photoIds: [media["B:staging-kitchen"]], format: "SINGLE", captions: { FACEBOOK: "Ready" }, altText: { [media["B:staging-kitchen"]]: "Kitchen" } })).rejects.toMatchObject({ code: "SCOPE" });
  }, 60_000);

  it("who may do what: ADMIN, OPS with Marketing at Manage; consent also needs Clients", async () => {
    expect(await socialRightRefusal(ids.admin, "post")).toBeNull();
    expect(await socialRightRefusal(ids.opsManage, "post")).toBeNull();
    expect(await socialRightRefusal(ids.opsRead, "post")).toMatch(/Marketing set to Manage/);
    expect(await socialRightRefusal(ids.opsNoClients, "consent")).toMatch(/Clients and Marketing/);
    expect(await socialRightRefusal(ids.cleaner, "post")).toMatch(/Only administrators/);
  });

  it("revoking removes unposted drafts with their files and flags posted posts for a person", async () => {
    await connectFacebook();
    const posted = await readyGroup([media["A:staging-living"]]);
    await publishGroup({ groupId: posted, networks: ["FACEBOOK"], actorId: ids.admin, trigger: "CLICK" }, { http: metaStub().http, publicBase: PUBLIC });
    const draft = await createGroup({ format: "SINGLE", photoIds: [media["A:bed-final-look"]] }, { userId: ids.admin, via: "USER" });
    const draftImages = await ensureDerivatives(draft, ids.admin);
    const draftKey = draftImages[0].s3Key;
    expect(m.files.has(draftKey)).toBe(true);
    const cascade = await revokeConsent(ids.client, { userId: ids.admin, via: "OFFICE" }, "Owner asked");
    expect(cascade.draftsRemoved).toBeGreaterThanOrEqual(1);
    expect(cascade.postedFlagged).toBeGreaterThanOrEqual(1);
    expect(await m.client.socialPostGroup.findUnique({ where: { id: draft } })).toBeNull();
    expect(m.files.has(draftKey)).toBe(false);
    const flagged = await m.client.socialPost.findFirstOrThrow({ where: { groupId: posted, channel: "FACEBOOK" } });
    expect(flagged).toMatchObject({ status: "PUBLISHED", removalDoneAt: null });
    expect(flagged.removalNeededAt).not.toBeNull();
    expect((await m.client.socialPost.findFirstOrThrow({ where: { groupId: posted, channel: "INSTAGRAM" } })).status).toBe("CANCELLED");
    expect((await checkPhotos([media["A:staging-living"]])).refused).toHaveLength(1);
    await expect(revokeConsent(ids.client, { userId: ids.admin, via: "OFFICE" }, null)).rejects.toMatchObject({ status: 409 });
    expect((await m.client.marketingConsent.findMany({ where: { clientId: ids.client } })).every((row) => row.endedAt !== null)).toBe(true);
  });
});
