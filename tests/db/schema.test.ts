// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";

const databaseUrl = process.env.SNEEK_TEST_DATABASE_URL;
let prisma: PrismaClient;
const fixtureIds = { users: [] as string[], clients: [] as string[], properties: [] as string[], failures: [] as string[] };

// Every fixture is rolled back, including when its assertions throw.
async function rollback(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  const finished = new Error("QA_TRANSACTION_ROLLBACK");
  try {
    await prisma.$transaction(async tx => {
      await run(tx);
      throw finished;
    });
  } catch (error) {
    if (error !== finished) throw error;
  }
}

describe.skipIf(!databaseUrl)("schema additions (explicit local database only)", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^postgres(ql)?:$/.test(url.protocol)) {
      throw new Error("SNEEK_TEST_DATABASE_URL must identify a local PostgreSQL test database.");
    }
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      expect(await prisma.user.count({ where: { id: { in: fixtureIds.users } } })).toBe(0);
      expect(await prisma.client.count({ where: { id: { in: fixtureIds.clients } } })).toBe(0);
      expect(await prisma.property.count({ where: { id: { in: fixtureIds.properties } } })).toBe(0);
      expect(await prisma.uploadFailure.count({ where: { id: { in: fixtureIds.failures } } })).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("User has uiDensity, emailStatus, lastSeenAt defaults", async () => {
    await rollback(async tx => {
      const user = await tx.user.create({ data: {
        email: `schema-test-${randomUUID()}@example.invalid`, name: "QA Schema Test", role: "CLIENT",
      } });
      fixtureIds.users.push(user.id);
      expect(user.uiDensity).toBe("DEFAULT");
      expect(user.emailStatus).toBe("OK");
      expect(user.lastSeenAt).toBeNull();
    });
  });

  it("Property accepts geocode fields without depending on existing clients", async () => {
    await rollback(async tx => {
      const client = await tx.client.create({ data: { name: `QA Schema Client ${randomUUID()}` } });
      fixtureIds.clients.push(client.id);
      const property = await tx.property.create({ data: {
        name: "QA Schema Property", address: "1 Test St, Sydney NSW 2000", clientId: client.id,
        latitude: -33.8688, longitude: 151.2093, placeId: "qa-schema-place", suburb: "Sydney", state: "NSW", postcode: "2000",
      } });
      fixtureIds.properties.push(property.id);
      expect(property.latitude).toBeCloseTo(-33.8688, 4);
      expect(property.longitude).toBeCloseTo(151.2093, 4);
      expect(property.suburb).toBe("Sydney");
    });
  });

  it("UploadFailure defaults are writable and expected indexes exist", async () => {
    await rollback(async tx => {
      const failure = await tx.uploadFailure.create({ data: {
        filename: "qa-schema-test.jpg", size: 12345, mime: "image/jpeg", reason: "S3_TIMEOUT", message: "QA only",
      } });
      fixtureIds.failures.push(failure.id);
      expect(failure.id).toMatch(/^c/);
      expect(failure.occurredAt).toBeInstanceOf(Date);
      expect(failure.resolvedAt).toBeNull();
      const indexes = await tx.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'UploadFailure'
      `;
      expect(indexes.map(index => index.indexname)).toEqual(expect.arrayContaining([
        "UploadFailure_occurredAt_idx", "UploadFailure_userId_occurredAt_idx", "UploadFailure_jobId_idx", "UploadFailure_resolvedAt_idx",
      ]));
    });
  });

  it("rolls back fixture writes when the assertion body fails", async () => {
    const expectedFailure = new Error("QA_EXPECTED_ASSERTION_FAILURE");
    await expect(rollback(async tx => {
      const client = await tx.client.create({ data: { name: `QA Rollback Client ${randomUUID()}` } });
      fixtureIds.clients.push(client.id);
      throw expectedFailure;
    })).rejects.toBe(expectedFailure);
    expect(await prisma.client.count({ where: { id: { in: fixtureIds.clients } } })).toBe(0);
  });
});
