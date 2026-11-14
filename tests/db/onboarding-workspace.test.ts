// @vitest-environment node
/**
 * Onboarding workspace against a real database (SNEEK_TEST_DATABASE_URL, a
 * disposable loopback PostgreSQL; run with --no-file-parallelism):
 * activation parity with the existing approval, per-step autosave and the
 * stale-save notice, readiness enforced on activation, the stock list, the
 * no-login client link (hashed token, expiry, revoke, scope, rate limit, no
 * office fields or existing codes, client codes encrypted), the inbox-only
 * "finished" notice, the rooms migration and the empty-draft review.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  process.env.ENCRYPTION_KEY = "onboarding-workspace-test-key-0123456789";
  process.env.NEXTAUTH_SECRET = "onboarding-workspace-test-secret-0123456789";
  return { client: null as any, sent: [] as Array<Record<string, unknown>> };
});
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get(_target, key) { const value = m.client[key]; return typeof value === "function" ? value.bind(m.client) : value; } }) }));
vi.mock("@/lib/jobs/eta", () => ({ geocodeAddress: async () => null }));
vi.mock("@/lib/notifications/external-recipient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications/external-recipient")>();
  return {
    ...actual,
    externalTransportAvailability: async () => ({ EMAIL: { available: true, reason: null }, SMS: { available: false, reason: "SMS is switched off in the settings." } }),
    sendExternalRecipientMessage: async (input: Record<string, unknown>) => {
      m.sent.push(input);
      return { state: "provider_accepted", errorCode: null, requestId: "r1" };
    },
  };
});

import { approveSurvey } from "@/lib/onboarding/approval/workflow";
import { activateOnboarding } from "@/lib/onboarding/workspace/activate";
import { saveWorkspaceSection, listEmptyDrafts, loadWorkspaceView } from "@/lib/onboarding/workspace/service";
import { clientLinkPageView, clientLinkRateLimited, createClientLink, finishClientLink, hashClientLinkToken, resolveClientLink, revokeClientLink, saveClientLinkSection } from "@/lib/onboarding/workspace/client-link";
import { decryptSecret } from "@/lib/security/encryption";

const url = process.env.SNEEK_TEST_DATABASE_URL;
const run = randomUUID().slice(0, 8);
let adminId = "";
let otherAdminId = "";
let clientId = "";
let supplierId = "";

async function legacySurvey(tag: string, status: "DRAFT" | "PENDING_REVIEW", extra: Record<string, unknown> = {}) {
  return m.client.propertyOnboardingSurvey.create({
    data: {
      surveyNumber: `OBT-${run}-${tag}`,
      status,
      submittedById: adminId,
      existingClientId: clientId,
      propertyName: `Parity House ${tag}`,
      propertyAddress: "12 Campbell Parade",
      propertySuburb: "Bondi Beach",
      propertyPostcode: "2026",
      propertyNotes: "Gate code changes monthly",
      bedrooms: 2,
      bathrooms: 2,
      hasBalcony: true,
      floorCount: 2,
      icalUrl: "https://example.invalid/calendar.ics",
      laundrySupplierId: supplierId,
      adminOverrides: {
        formMeta: {
          propertyLatitude: -33.89,
          propertyLongitude: 151.27,
          propertyPlaceId: "place-1",
          selectedJobTypes: ["AIRBNB_TURNOVER", "DEEP_CLEAN"],
          defaultCheckinTime: "15:00",
          defaultCheckoutTime: "10:00",
          scenarios: { bedConfig: "1 king, 2 singles", wifiNetwork: "BondiNet", wifiPassword: "pw", alarmCode: "1234", consumablesProvided: true, linenBufferSets: 2, hasPets: true, petDetails: "Cat" },
          emergencyContact: { name: "David", phone: "0412", relation: "Owner" },
        },
      },
      appliances: { create: [{ applianceType: "OVEN", conditionNote: "heavy grease" }, { applianceType: "DISHWASHER" }] },
      specialRequests: { create: [{ description: "Descale the kettle", priority: "HIGH", area: "KITCHEN" }] },
      laundryDetail: { create: { hasLaundry: true, detergentType: "HYPOALLERGENIC" } },
      accessDetails: { create: [{ detailType: "LOCKBOX", value: "7788", sortOrder: 0 }, { detailType: "PARKING", value: "Visitor bay 3", sortOrder: 1 }] },
      ...extra,
    },
  });
}

const PROPERTY_FIELDS = [
  "address", "suburb", "state", "postcode", "notes", "bedrooms", "bathrooms", "hasBalcony", "floorCount", "laundryDetail", "recurringSchedule",
  "accessInfo", "keyLocation", "latitude", "longitude", "placeId", "defaultCheckinTime", "defaultCheckoutTime", "linenBufferSets",
  "inventoryEnabled", "laundryEnabled", "features", "geofenceRadiusM", "sofaBedCount", "jobTimeSource", "cleanerServiceRate", "isActive",
] as const;

async function createdSetup(propertyId: string) {
  const property = await m.client.property.findUniqueOrThrow({ where: { id: propertyId }, include: { integration: true, jobs: true, laundryTasks: true, checklistProfile: true, propertyStock: true, clientRates: true } });
  const pick = Object.fromEntries(PROPERTY_FIELDS.map((field) => [field, property[field]]));
  return {
    pick,
    accessCode: decryptSecret(property.accessCode),
    alarmCode: decryptSecret(property.alarmCode),
    guide: (property.accessGuide ?? []).map(({ id: _id, ...rest }: Record<string, unknown>) => rest),
    integration: property.integration ? { icalUrl: property.integration.icalUrl, provider: property.integration.provider, isEnabled: property.integration.isEnabled } : null,
    jobs: property.jobs.map((job: any) => ({ jobType: job.jobType, status: job.status, estimatedHours: job.estimatedHours, notes: job.notes })).sort((a: any, b: any) => a.jobType.localeCompare(b.jobType)),
    laundryTasks: property.laundryTasks.length,
    checklistModules: property.checklistProfile ? (property.checklistProfile.selections as any).modules : null,
    checklistCustomCount: property.checklistProfile ? (property.checklistProfile.selections as any).customItems.length : null,
    stockCount: property.propertyStock.length,
    clientRates: property.clientRates.map((rate: any) => ({ jobType: rate.jobType, baseCharge: rate.baseCharge, billingUnit: rate.billingUnit })),
  };
}

describe.skipIf(!url)("onboarding workspace (explicit local DB)", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || !/^postgres(ql)?:$/.test(parsed.protocol)) throw new Error("Loopback DB required");
    m.client = new PrismaClient({ datasources: { db: { url } } });
    await m.client.$connect();
    adminId = `onbt-admin-${run}`;
    otherAdminId = `onbt-admin2-${run}`;
    clientId = `onbt-client-${run}`;
    supplierId = `onbt-supplier-${run}`;
    await m.client.user.create({ data: { id: adminId, email: `${adminId}@example.invalid`, name: "Hannah Lee", role: "ADMIN" } });
    await m.client.user.create({ data: { id: otherAdminId, email: `${otherAdminId}@example.invalid`, name: "Sam Ortiz", role: "OPS_MANAGER" } });
    await m.client.client.create({ data: { id: clientId, name: "Harbour View Stays", email: "olivia@example.invalid" } });
    await m.client.laundrySupplier.create({ data: { id: supplierId, name: "CleanCo Laundry" } });
  }, 60_000);

  afterAll(async () => {
    await m.client?.$disconnect();
  });

  it("activation creates everything the existing approval creates (parity), plus the workspace's own setup", async () => {
    const legacy = await legacySurvey("A", "PENDING_REVIEW");
    const viaWorkspace = await legacySurvey("B", "DRAFT", { workspace: { rates: [{ jobType: "AIRBNB_TURNOVER", clientRate: 165, billingUnit: "PER_JOB", cleanerPayMode: "PER_CLEAN", cleanerPay: null }] } });
    const before = await approveSurvey({ surveyId: legacy.id, adminReviewerId: adminId, createInitialJobs: true });
    const after = await activateOnboarding({ surveyId: viaWorkspace.id, actorUserId: adminId, createInitialJobs: true, baseRevision: 0 });
    expect(before.propertyId && after.propertyId).toBeTruthy();
    const a = await createdSetup(before.propertyId!);
    const b = await createdSetup(after.propertyId!);
    const { clientRates: ratesA, ...restA } = a;
    const { clientRates: ratesB, ...restB } = b;
    expect(restB).toEqual(restA);
    expect(a.accessCode).toBe("7788");
    expect(a.alarmCode).toBe("1234");
    expect(a.integration).toMatchObject({ isEnabled: false });
    expect(a.jobs).toHaveLength(2);
    expect(a.laundryTasks).toBe(1);
    expect(a.stockCount).toBeGreaterThan(0);
    expect(ratesA).toEqual([]);
    expect(ratesB).toEqual([{ jobType: "AIRBNB_TURNOVER", baseCharge: 165, billingUnit: "PER_JOB" }]);
    expect(after.warnings).toEqual(before.coverageWarnings ?? []);
    const stamped = await m.client.propertyOnboardingSurvey.findUnique({ where: { id: viaWorkspace.id } });
    expect(stamped.status).toBe("APPROVED");
    expect(await m.client.auditLog.count({ where: { entityId: viaWorkspace.id, action: "ONBOARDING_ACTIVATED" } })).toBe(1);
    // Safe to press twice.
    const again = await activateOnboarding({ surveyId: viaWorkspace.id, actorUserId: adminId, createInitialJobs: true, baseRevision: 0 });
    expect(again).toMatchObject({ alreadyApproved: true, propertyId: after.propertyId });
  }, 60_000);

  it("refuses activation without access, without the main rate, or from a stale readiness view", async () => {
    const noAccess = await legacySurvey("C", "DRAFT", { accessDetails: undefined, workspace: { rates: [{ jobType: "AIRBNB_TURNOVER", clientRate: 165, billingUnit: "PER_JOB", cleanerPayMode: "PER_CLEAN", cleanerPay: null }] } });
    await expect(activateOnboarding({ surveyId: noAccess.id, actorUserId: adminId, createInitialJobs: false, baseRevision: 0 })).rejects.toMatchObject({ status: 422 });
    const noRate = await legacySurvey("D", "DRAFT");
    await expect(activateOnboarding({ surveyId: noRate.id, actorUserId: adminId, createInitialJobs: false, baseRevision: 0 })).rejects.toMatchObject({ status: 422, message: expect.stringContaining("Rate for Airbnb turnover") });
    expect((await m.client.propertyOnboardingSurvey.findUnique({ where: { id: noRate.id } })).status).toBe("DRAFT");
    await saveWorkspaceSection({ surveyId: noRate.id, section: "pricing", values: { rates: [{ jobType: "AIRBNB_TURNOVER", clientRate: 150, billingUnit: "PER_JOB", cleanerPayMode: "PER_CLEAN", cleanerPay: 60 }] }, baseRevision: 0, actor: { source: "ADMIN_CREATED", userId: adminId, clientLinkId: null } });
    await expect(activateOnboarding({ surveyId: noRate.id, actorUserId: adminId, createInitialJobs: false, baseRevision: 0 })).rejects.toMatchObject({ status: 409 });
    const done = await activateOnboarding({ surveyId: noRate.id, actorUserId: adminId, createInitialJobs: false, baseRevision: 1 });
    expect(done.jobIds).toEqual([]);
    const property = await m.client.property.findUnique({ where: { id: done.propertyId }, include: { clientRates: true } });
    expect(property.cleanerServiceRate).toBe(60);
    expect(property.clientRates).toHaveLength(1);
  }, 60_000);

  it("saves field by field, records who changed what, and reports a stale save without losing either edit", async () => {
    const survey = await legacySurvey("E", "DRAFT");
    const office = { source: "ADMIN_CREATED" as const, userId: adminId, clientLinkId: null };
    const colleague = { source: "ADMIN_CREATED" as const, userId: otherAdminId, clientLinkId: null };
    const first = await saveWorkspaceSection({ surveyId: survey.id, section: "basics", values: { propertyName: "Bondi Beach House" }, baseRevision: 0, actor: office });
    expect(first.revision).toBe(1);
    expect(first.conflict).toBeNull();
    // A colleague, still on revision 0, changes another field of the same step.
    const second = await saveWorkspaceSection({ surveyId: survey.id, section: "basics", values: { propertyPostcode: "2027" }, baseRevision: 0, actor: colleague });
    expect(second.conflict).toMatchObject({ actorName: "Hannah Lee", section: "basics" });
    const row = await m.client.propertyOnboardingSurvey.findUnique({ where: { id: survey.id } });
    expect(row).toMatchObject({ propertyName: "Bondi Beach House", propertyPostcode: "2027", revision: 2, lastSavedById: otherAdminId });
    // The same person saving again on an older revision is not a conflict.
    const third = await saveWorkspaceSection({ surveyId: survey.id, section: "basics", values: { propertyName: "Bondi Beach House 2" }, baseRevision: 1, actor: office });
    expect(third.conflict?.actorName).toBe("Sam Ortiz");
    const repeat = await saveWorkspaceSection({ surveyId: survey.id, section: "basics", values: { propertyName: "Bondi Beach House 2" }, baseRevision: 3, actor: office });
    expect(repeat.revision).toBe(3);
    const history = await m.client.onboardingAnswerRevision.findMany({ where: { surveyId: survey.id }, orderBy: { revision: "asc" } });
    expect(history.map((entry: any) => [entry.revision, entry.actorUserId, entry.fields])).toEqual([
      [1, adminId, ["basics.propertyName"]],
      [2, otherAdminId, ["basics.propertyPostcode"]],
      [3, adminId, ["basics.propertyName"]],
    ]);
    await expect(saveWorkspaceSection({ surveyId: survey.id, section: "basics", values: { adminNotes: "x" }, baseRevision: 3, actor: office })).rejects.toMatchObject({ status: 400 });
  });

  it("creates the stock list with its par levels on activation, never a made-up level", async () => {
    const survey = await legacySurvey("F", "DRAFT", {
      workspace: {
        rates: [{ jobType: "AIRBNB_TURNOVER", clientRate: 165, billingUnit: "PER_JOB", cleanerPayMode: "PER_CLEAN", cleanerPay: null }],
        stock: { startFrom: "TWO_BED", rows: [{ sku: "DEF-TP", name: "Toilet Paper", unit: "roll", parLevel: 12, reorderAt: 6 }, { sku: "DEF-HANDSOAP", name: "Hand Soap", unit: "bottle", parLevel: null, reorderAt: 1 }, { sku: "DEF-COFFEECAPS", name: "Coffee", unit: "capsule", parLevel: 20, reorderAt: null }] },
      },
    });
    const result = await activateOnboarding({ surveyId: survey.id, actorUserId: adminId, createInitialJobs: false, baseRevision: 0 });
    const rows = await m.client.propertyStock.findMany({ where: { propertyId: result.propertyId }, include: { item: true } });
    expect(rows.map((row: any) => [row.item.sku, row.parLevel, row.reorderThreshold]).sort()).toEqual([["DEF-COFFEECAPS", 20, 10], ["DEF-TP", 12, 6]]);
    expect(result.warnings.join(" ")).toContain("no par level");
    expect(result.warnings.join(" ")).toContain("no reorder level");
  }, 60_000);

  it("client link: hashed token, scoped page without office fields or codes, encrypted client codes, revoke and expiry", async () => {
    const survey = await legacySurvey("G", "DRAFT", { adminNotes: "Office only: margin notes" });
    await saveWorkspaceSection({ surveyId: survey.id, section: "access", values: { entries: [{ id: "office-1", kind: "LOCKBOX", where: "Side gate", photos: [], code: "5150" }] }, baseRevision: 0, actor: { source: "ADMIN_CREATED", userId: adminId, clientLinkId: null } });
    await saveWorkspaceSection({ surveyId: survey.id, section: "pricing", values: { rates: [{ jobType: "AIRBNB_TURNOVER", clientRate: 999.5, billingUnit: "PER_JOB", cleanerPayMode: "PER_CLEAN", cleanerPay: 61 }] }, baseRevision: 1, actor: { source: "ADMIN_CREATED", userId: adminId, clientLinkId: null } });
    await expect(createClientLink({ surveyId: survey.id, actorUserId: adminId, sections: ["access"], transport: "SMS", recipient: "0412555019", days: 7, idempotencyKey: "key-sms-00000001" })).rejects.toMatchObject({ status: 409 });
    const created = await createClientLink({ surveyId: survey.id, actorUserId: adminId, sections: ["access", "rules", "linen"], transport: "EMAIL", recipient: "olivia@example.invalid", days: 7, idempotencyKey: "key-email-0000001" });
    const sent = m.sent.at(-1)!;
    const token = String(sent.body).match(/onboarding-link\/([A-Za-z0-9_-]{43})/)![1];
    const link = await m.client.onboardingClientLink.findUnique({ where: { id: created.linkId } });
    expect(link.tokenHash).toBe(hashClientLinkToken(token));
    expect(link.tokenHash).not.toContain(token);
    expect(JSON.stringify(link)).not.toContain("olivia@");
    expect(link.expiresAt.getTime() - link.createdAt.getTime()).toBe(7 * 24 * 60 * 60_000);

    expect((await resolveClientLink(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"))).state).toBe("invalid");
    const resolved = await resolveClientLink(token);
    expect(resolved.state).toBe("open");
    if (resolved.state !== "open") return;
    const page = await clientLinkPageView(resolved);
    const text = JSON.stringify(page);
    for (const secret of ["5150", "7788", "1234", "999.5", "CleanCo", "margin notes", "enc:v1", "pw", "Gate code"]) expect(text).not.toContain(secret);
    expect(page.sections.map((section) => section.key)).toEqual(["access", "rules", "linen"]);
    expect(page.access).toEqual({ officeEntryCount: 3, entries: [] });
    expect(page.photos).toBeUndefined();

    await saveClientLinkSection(resolved, { section: "access", entries: [{ id: "c-abc", kind: "ALARM", where: "Panel inside the door", code: "2468", photos: [] }] });
    const afterClient = await m.client.propertyOnboardingSurvey.findUnique({ where: { id: survey.id } });
    const clientEntry = afterClient.workspace.access.find((entry: any) => entry.id === "c-abc");
    expect(clientEntry.source).toBe("CLIENT_SUBMITTED");
    expect(clientEntry.codeCipher.startsWith("enc:v1:")).toBe(true);
    expect(JSON.stringify(afterClient.workspace)).not.toContain("2468");
    expect(decryptSecret(clientEntry.codeCipher)).toBe("2468");
    expect(afterClient.workspace.access.find((entry: any) => entry.id === "office-1").codeCipher).toBeTruthy();
    const clientRevision = await m.client.onboardingAnswerRevision.findFirst({ where: { surveyId: survey.id, source: "CLIENT_SUBMITTED" } });
    expect(clientRevision).toMatchObject({ clientLinkId: created.linkId, actorUserId: null });
    expect(JSON.stringify(clientRevision.changes)).not.toContain("2468");
    const view = await loadWorkspaceView(survey.id, "ADMIN");
    expect(view!.readiness.missingRequired.map((item) => item.detail).join(" ")).toContain("to review");

    const fresh = await resolveClientLink(token);
    if (fresh.state !== "open") throw new Error("link closed");
    await expect(saveClientLinkSection(fresh, { section: "access", entries: [{ id: "office-1", kind: "LOCKBOX", where: "Mine now", photos: [] }] })).rejects.toMatchObject({ status: 403 });
    await expect(saveClientLinkSection(fresh, { section: "photos", photos: [] })).rejects.toMatchObject({ status: 403 });
    await expect(saveClientLinkSection(fresh, { section: "calendar", icalUrl: "https://example.invalid/x.ics" })).rejects.toMatchObject({ status: 403 });

    await revokeClientLink({ surveyId: survey.id, linkId: created.linkId, actorUserId: adminId });
    expect((await resolveClientLink(token)).state).toBe("revoked");

    const second = await createClientLink({ surveyId: survey.id, actorUserId: adminId, sections: ["rules"], transport: "EMAIL", recipient: "olivia@example.invalid", days: 1, idempotencyKey: "key-email-0000002" });
    const token2 = String(m.sent.at(-1)!.body).match(/onboarding-link\/([A-Za-z0-9_-]{43})/)![1];
    await m.client.onboardingClientLink.update({ where: { id: second.linkId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await resolveClientLink(token2)).state).toBe("expired");
  }, 60_000);

  it("rate limits a link and sends the finished notice once, to the inbox only", async () => {
    const limitToken = `rl${randomUUID().replace(/-/g, "")}`.padEnd(43, "x").slice(0, 43);
    let limited = false;
    for (let index = 0; index < 61; index += 1) limited = clientLinkRateLimited(limitToken, "203.0.113.9");
    expect(limited).toBe(true);
    expect(clientLinkRateLimited(limitToken, "203.0.113.10")).toBe(false);

    const survey = await legacySurvey("H", "DRAFT");
    await createClientLink({ surveyId: survey.id, actorUserId: adminId, sections: ["linen"], transport: "EMAIL", recipient: "olivia@example.invalid", days: 7, idempotencyKey: "key-email-0000003" });
    const token = String(m.sent.at(-1)!.body).match(/onboarding-link\/([A-Za-z0-9_-]{43})/)![1];
    const resolved = await resolveClientLink(token);
    if (resolved.state !== "open") throw new Error("link closed");
    await saveClientLinkSection(resolved, { section: "linen", values: { linenSets: 3, linenBufferSets: 2 } });
    const first = await finishClientLink(resolved);
    expect(first.notice).toBe("queued");
    const again = await resolveClientLink(token);
    if (again.state !== "open") throw new Error("link closed");
    expect((await finishClientLink(again)).notice).toBe("already_sent");
    const intents = await m.client.notificationIntent.findMany({ where: { eventKey: "onboarding.client_finished", envelope: { path: ["entity", "id"], equals: survey.id } } });
    expect(intents.length).toBeGreaterThan(0);
    expect(new Set(intents.map((intent: any) => intent.transport))).toEqual(new Set(["INBOX"]));
    expect(await m.client.propertyOnboardingSurvey.findUnique({ where: { id: survey.id }, select: { status: true } })).toEqual({ status: "DRAFT" });
  }, 60_000);

  it("the migration moves old bed text into the room note and keeps the original", async () => {
    const survey = await m.client.propertyOnboardingSurvey.create({ data: { surveyNumber: `OBT-${run}-M`, adminOverrides: { formMeta: { scenarios: { bedConfig: "  2x Queen, sofa bed  " } } } } });
    const sql = readFileSync(join(process.cwd(), "prisma/migrations/20261116050000_onboarding_workspace/migration.sql"), "utf8");
    const update = sql.slice(sql.indexOf('UPDATE "PropertyOnboardingSurvey"'));
    await m.client.$executeRawUnsafe(update.replace("WHERE \"workspace\" IS NULL", `WHERE "id" = '${survey.id}' AND "workspace" IS NULL`));
    const row = await m.client.propertyOnboardingSurvey.findUnique({ where: { id: survey.id } });
    expect(row.workspace).toEqual({ version: 1, rooms: { list: [], note: "2x Queen, sofa bed" } });
    expect(row.adminOverrides.formMeta.scenarios.bedConfig).toBe("  2x Queen, sofa bed  ");
  });

  it("lists only drafts with no answers for the one-off review", async () => {
    const empty = await m.client.propertyOnboardingSurvey.create({ data: { surveyNumber: `OBT-${run}-E1`, adminOverrides: { formMeta: { selectedJobTypes: [] }, draftCreateKey: "onb-key" } } });
    const withMeta = await m.client.propertyOnboardingSurvey.create({ data: { surveyNumber: `OBT-${run}-E2`, adminOverrides: { formMeta: { scenarios: { hasPets: true } } } } });
    const withName = await m.client.propertyOnboardingSurvey.create({ data: { surveyNumber: `OBT-${run}-E3`, propertyName: "Something" } });
    const listed = (await listEmptyDrafts()).map((draft) => draft.id);
    expect(listed).toContain(empty.id);
    expect(listed).not.toContain(withMeta.id);
    expect(listed).not.toContain(withName.id);
  });
});
