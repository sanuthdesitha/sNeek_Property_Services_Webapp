import { test, expect } from "@playwright/test";
import { PrismaClient, Prisma } from "@prisma/client";
import sharp from "sharp";
const db = new PrismaClient({
  datasources: {
    db: { url: "postgresql://sneek@127.0.0.1:55439/sneek_review_test" },
  },
});
let previous: Prisma.JsonValue | undefined;
test.beforeAll(async () => {
  previous = (await db.appSetting.findUnique({ where: { key: "app" } }))?.value;
  const value = {
    ...((previous as object) ?? {}),
    companyName: "Brand icon browser fixture",
    logoUrl: "/icon-192.png",
  };
  await db.appSetting.upsert({
    where: { key: "app" },
    create: { key: "app", value },
    update: { value },
  });
});
test.afterAll(async () => {
  try {
    if (previous === undefined)
      await db.appSetting.deleteMany({ where: { key: "app" } });
    else
      await db.appSetting.update({
        where: { key: "app" },
        data: { value: previous as Prisma.InputJsonValue },
      });
  } finally {
    await db.$disconnect();
  }
});
test("saved branding drives unauthenticated browser and install icons in both themes and viewport sizes", async ({
  page,
  request,
}, info) => {
  const response = await request.get("/manifest.json");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.name).toBe("Brand icon browser fixture");
  expect(manifest.icons).toHaveLength(3);
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
    const size = Number(icon.sizes.split("x")[0]);
    expect(await sharp(await image.body()).metadata()).toMatchObject({
      width: size,
      height: size,
    });
  }
  for (const width of [390, 1280])
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/v2/login");
      const apple = page.locator('link[rel="apple-touch-icon"]');
      await expect(apple).toHaveAttribute("href", /\/icons\/180\?v=/);
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
        "href",
        "/manifest.json",
      );
      const icon = await request.get((await apple.getAttribute("href"))!);
      expect(await sharp(await icon.body()).metadata()).toMatchObject({
        width: 180,
        height: 180,
      });
      await page.screenshot({
        path: info.outputPath(`login-${width}-${scheme}.png`),
        fullPage: true,
      });
    }
  const oldUrl = manifest.icons[0].src;
  await db.appSetting.update({
    where: { key: "app" },
    data: { value: { companyName: "Changed brand", logoUrl: "/icon-512.png" } },
  });
  const updated = await (await request.get("/manifest.json")).json();
  expect(updated.icons[0].src).not.toBe(oldUrl);
  expect(updated.id).toBe(manifest.id);
  expect((await request.get("/favicon.ico")).headers()["content-type"]).toBe(
    "image/png",
  );
});
