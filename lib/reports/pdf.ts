import { s3 } from "@/lib/s3";

const hasStorageConfig = Boolean(
  process.env.S3_BUCKET_NAME &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
);

export async function renderPdfFromHtml(html: string, errorContext: string): Promise<Buffer> {
  const { chromium } = await import("playwright");
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let launchError: unknown = null;

  try {
    browser = await chromium.launch();
  } catch (err) {
    launchError = err;
    browser = await chromium
      .launch({ channel: "msedge" })
      .catch(async () => chromium.launch({ channel: "chrome" }));
  }

  if (!browser) {
    throw launchError ?? new Error(`Could not launch browser for ${errorContext}.`);
  }

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function loadStoredPdfFromBucket(jobId: string): Promise<Buffer | null> {
  if (!hasStorageConfig || !process.env.S3_BUCKET_NAME) {
    return null;
  }

  try {
    const object = await s3
      .getObject({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `reports/${jobId}/report.pdf`,
      })
      .promise();

    const body = object.Body;
    if (!body) return null;
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    if (typeof body === "string") return Buffer.from(body);
    return null;
  } catch {
    return null;
  }
}

async function loadStoredPdfFromUrl(pdfUrl: string): Promise<Buffer | null> {
  try {
    const response = await fetch(pdfUrl, { cache: "no-store" });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export async function getJobReportPdfBuffer(report: { pdfUrl: string | null; htmlContent: string | null }, jobId: string) {
  const storedFromBucket = await loadStoredPdfFromBucket(jobId);
  if (storedFromBucket) return storedFromBucket;

  if (report.pdfUrl) {
    const storedFromUrl = await loadStoredPdfFromUrl(report.pdfUrl);
    if (storedFromUrl) return storedFromUrl;
  }

  if (!report.htmlContent) return null;
  return renderPdfFromHtml(report.htmlContent, "job report PDF generation");
}
