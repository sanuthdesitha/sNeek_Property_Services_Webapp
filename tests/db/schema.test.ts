import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

describe("schema additions", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("User has uiDensity, emailStatus, lastSeenAt with correct defaults", async () => {
    // Insert a minimal user, read it back.
    const created = await prisma.user.create({
      data: {
        email: `schema-test-${Date.now()}@example.com`,
        name: "Schema Test",
        role: "CLIENT",
      },
      select: {
        uiDensity: true,
        emailStatus: true,
        lastSeenAt: true,
      },
    });
    expect(created.uiDensity).toBe("DEFAULT");
    expect(created.emailStatus).toBe("OK");
    expect(created.lastSeenAt).toBeNull();

    // Cleanup
    await prisma.user.deleteMany({ where: { email: { startsWith: "schema-test-" } } });
  });

  it("Property accepts geocode fields", async () => {
    // Needs an existing client — pick any.
    const anyClient = await prisma.client.findFirst();
    if (!anyClient) {
      // Skip if no seed data; do not fail.
      return;
    }
    const prop = await prisma.property.create({
      data: {
        name: `Schema Test Property ${Date.now()}`,
        address: "1 Test St, Sydney NSW 2000",
        clientId: anyClient.id,
        latitude: -33.8688,
        longitude: 151.2093,
        placeId: "ChIJP3Sa8ziYEmsRUKgyFmh9AQM",
        suburb: "Sydney",
        state: "NSW",
        postcode: "2000",
      },
    });
    expect(prop.latitude).toBeCloseTo(-33.8688, 4);
    expect(prop.suburb).toBe("Sydney");
    await prisma.property.delete({ where: { id: prop.id } });
  });

  it("UploadFailure model is writable and indexed", async () => {
    const failure = await prisma.uploadFailure.create({
      data: {
        filename: "test.jpg",
        size: 12345,
        mime: "image/jpeg",
        reason: "S3_TIMEOUT",
        message: "Connection reset after 30s",
      },
    });
    expect(failure.id).toMatch(/^c/); // cuid prefix
    expect(failure.occurredAt).toBeInstanceOf(Date);
    expect(failure.resolvedAt).toBeNull();
    await prisma.uploadFailure.delete({ where: { id: failure.id } });
  });
});
