import { expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
/** Exercise the same .dark class used by the existing theme provider. */
export async function captureOperationsLayout(page: Page, name: string) {
  const originalDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  for (const dark of [false, true]) {
    await page.evaluate(value => document.documentElement.classList.toggle("dark", value), dark);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const control = page.locator('.ops-content input:not([type="checkbox"]):visible, .ops-content select:visible, .ops-content textarea:visible').first();
      if (await control.count()) {
        await control.focus();
        expect(await control.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
        expect(await control.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        expect(await control.evaluate(el => getComputedStyle(el).colorScheme)).toBe(dark ? "dark" : "light");
      }
      if (process.env.SNEEK_VISUAL_OUTPUT) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: `${process.env.SNEEK_VISUAL_OUTPUT}/${name}${dark ? "-dark" : ""}-${viewport.width}.png`, fullPage: true });
      }
    }
  }
  if (process.env.SNEEK_VISUAL_OUTPUT) {
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return { body: getComputedStyle(document.body).fontFamily, heading: document.querySelector("h1") ? getComputedStyle(document.querySelector("h1")!).fontFamily : null, faces: Array.from(document.fonts).map(face => ({ family: face.family, status: face.status })), fontResources: performance.getEntriesByType("resource").map(entry => entry.name).filter(name => /\.(woff2?|ttf|otf)(\?|$)/.test(name)) };
    });
    await writeFile(`${process.env.SNEEK_VISUAL_OUTPUT}/${name}-fonts.json`, JSON.stringify(fonts, null, 2));
  }
  await page.evaluate(value => document.documentElement.classList.toggle("dark", value), originalDark);
  await page.setViewportSize({ width: 1280, height: 900 });
}
