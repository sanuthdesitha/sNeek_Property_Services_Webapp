import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("home page accessibility @a11y", () => {
  test("no critical or serious axe violations on /", async ({ page }) => {
    await page.goto("/");
    const results = await new AxeBuilder({ page })
      .options({ resultTypes: ["violations"] })
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious"
    );

    if (blocking.length > 0) {
      console.log(
        JSON.stringify(
          blocking.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length })),
          null,
          2
        )
      );
    }

    // TODO(Plan G): drive this to zero
    expect.soft(blocking, "no critical or serious a11y violations on /").toHaveLength(0);
  });
});
