// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  describe,
  expect,
  it,
} from "vitest";

const url = process.env.SNEEK_TEST_DATABASE_URL;
let db: PrismaClient;
let id: string;
describe.skipIf(!url)("migrated evidence and shopping retention", () => {
  beforeAll(async () => {
    if (
      new URL(url!).hostname !== "127.0.0.1" ||
      new URL(url!).port !== "55439"
    )
      throw Error("Dedicated loopback fixture DB required");
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$connect();
  });
  beforeEach(async () => {
    id = randomUUID();
    await db.user.create({
      data: {
        id,
        email: `${id}@example.invalid`,
        role: "ADMIN",
        passwordHash: "fixture-only",
      },
    });
    await db.client.create({ data: { id, name: "Migration fixture" } });
    await db.property.create({
      data: {
        id,
        clientId: id,
        name: "Migration fixture",
        address: "Fixture",
        suburb: "Sydney",
      },
    });
    await db.job.create({
      data: {
        id,
        jobNumber: id,
        propertyId: id,
        jobType: "AIRBNB_TURNOVER",
        scheduledDate: new Date("2026-10-09"),
      },
    });
  });
  afterEach(async () => {
    await db.qaFormSubmission.deleteMany({ where: { jobId: id } });
    await db.qaAssignment.deleteMany({ where: { jobId: id } });
    await db.mediaOverrideRequest.deleteMany({ where: { jobId: id } });
    await db.qaFormTemplate.deleteMany({ where: { id } });
    await db.shoppingRun.deleteMany({ where: { id } });
    await db.job.deleteMany({ where: { id } });
    await db.property.deleteMany({ where: { id } });
    await db.client.deleteMany({ where: { id } });
    await db.user.deleteMany({ where: { id } });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  it.each(["assignment", "submission", "override"])(
    "prevents job deletion from silently cascading %s evidence",
    async (kind) => {
      if (kind === "assignment")
        await db.qaAssignment.create({ data: { jobId: id } });
      if (kind === "override")
        await db.mediaOverrideRequest.create({
          data: { jobId: id, requestedById: id, fieldId: "evidence" },
        });
      if (kind === "submission") {
        await db.qaFormTemplate.create({
          data: {
            id,
            name: "Fixture",
            serviceType: "AIRBNB_TURNOVER",
            schema: {},
          },
        });
        await db.qaFormSubmission.create({
          data: {
            jobId: id,
            templateId: id,
            submittedById: id,
            data: { evidence: "preserve" },
            score: 100,
            passed: true,
          },
        });
      }
      await expect(db.job.delete({ where: { id } })).rejects.toMatchObject({
        code: "P2003",
      });
      expect(await db.job.count({ where: { id } })).toBe(1);
      expect(
        (await db.qaAssignment.count({ where: { jobId: id } })) +
          (await db.qaFormSubmission.count({ where: { jobId: id } })) +
          (await db.mediaOverrideRequest.count({ where: { jobId: id } })),
      ).toBe(1);
    },
  );
  it("preserves shopping line costs when its optional property is removed", async () => {
    await db.job.delete({ where: { id } });
    await db.shoppingRun.create({
      data: {
        id,
        ownerUserId: id,
        title: "Fixture",
        lines: {
          create: {
            id,
            propertyId: id,
            itemName: "Linen",
            category: "linen",
            purchasedQty: 2,
            unitCost: 5,
            lineCost: 10,
          },
        },
      },
    });
    await db.property.delete({ where: { id } });
    expect(
      await db.shoppingRunLine.findUnique({ where: { id } }),
    ).toMatchObject({
      propertyId: null,
      purchasedQty: 2,
      unitCost: 5,
      lineCost: 10,
    });
  });
});
