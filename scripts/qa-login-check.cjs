const { chromium } = require("playwright");

const BASE_URL = process.env.QA_BASE_URL || "http://127.0.0.1:3015";
const email = process.env.QA_EMAIL || "admin@sneekproservices.com.au";
const password = process.env.QA_PASSWORD || "admin123";
const expectedDashboardPath = process.env.QA_EXPECTED_DASHBOARD_PATH || "/admin";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const network = [];
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  let authCallback = null;
  page.on("request", (req) => {
    if (network.length < 50) {
      network.push({ method: req.method(), url: req.url() });
    }
  });
  page.on("response", async (res) => {
    if (res.url().includes("/api/auth/callback/credentials")) {
      authCallback = {
        url: res.url(),
        status: res.status(),
        headers: res.headers(),
      };
    }
  });
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.press("#password", "Enter");
  await page.waitForTimeout(2500);

  const url = page.url();
  let dashboardLoaded = false;
  let signoutRedirectUrl = null;
  let postSignoutUrl = null;
  let logoutWorked = false;

  if (!url.includes("/login")) {
    try {
      await page.goto(`${BASE_URL}${expectedDashboardPath}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(1200);
      dashboardLoaded = page.url().includes(expectedDashboardPath);

      const signoutTarget = `${BASE_URL}/api/auth/local-signout?callbackUrl=${encodeURIComponent(`${BASE_URL}/login`)}`;
      const signoutResponse = await page.goto(signoutTarget, { waitUntil: "domcontentloaded", timeout: 45000 });
      signoutRedirectUrl = signoutResponse ? signoutResponse.url() : signoutTarget;
      await page.waitForTimeout(1200);
      postSignoutUrl = page.url();
      logoutWorked = postSignoutUrl.includes("/login");
    } catch (error) {
      errors.push(`logout-check: ${error.message}`);
    }
  }

  let alert = null;
  const alertLocator = page.locator("[role='alert']");
  if (await alertLocator.count()) {
    alert = await alertLocator.first().textContent();
  }

  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        email,
        url,
        loginSuccessful: !url.includes("/login"),
        dashboardLoaded,
        expectedDashboardPath,
        signoutRedirectUrl,
        postSignoutUrl,
        logoutWorked,
        alert,
        authCallback,
        network,
        errors,
      },
      null,
      2
    )
  );

  await browser.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
