import type { Page } from "playwright";
import { s3 } from "@/lib/s3";
import { logger } from "@/lib/logger";

type PdfOptions = Parameters<Page["pdf"]>[0];

const hasStorageConfig = Boolean(
  process.env.S3_BUCKET_NAME &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
);

const PDF_IMAGE_MAX_DIMENSION = Number(process.env.PDF_IMAGE_MAX_DIMENSION ?? 1024);
const PDF_IMAGE_QUALITY = Number(process.env.PDF_IMAGE_QUALITY ?? 75);

type SharpModule = typeof import("sharp");

let sharpModulePromise: Promise<SharpModule | null> | null = null;
async function loadSharp(): Promise<SharpModule | null> {
  if (!sharpModulePromise) {
    sharpModulePromise = import("sharp")
      .then((mod) => (mod.default ?? mod) as SharpModule)
      .catch((err) => {
        logger.warn({ err }, "sharp not available; PDF images will not be downscaled");
        return null;
      });
  }
  return sharpModulePromise;
}

export async function renderPdfFromHtml(
  html: string,
  errorContext: string,
  pdfOptions?: PdfOptions
): Promise<Buffer> {
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

  const sharp = await loadSharp();

  try {
    const context = await browser.newContext();

    if (sharp) {
      // Resize images on the wire before they're embedded in the PDF.
      // Without this, full-resolution cleaner photos (5-10 MB each) are
      // rasterised into the PDF at original dimensions, producing 1+ GB files.
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (request.resourceType() !== "image") {
          return route.continue();
        }
        const url = request.url();
        if (url.startsWith("data:")) {
          return route.continue();
        }
        try {
          const response = await fetch(url);
          if (!response.ok) return route.continue();
          const original = Buffer.from(await response.arrayBuffer());
          const resized = await sharp(original, { failOn: "none" })
            .rotate()
            .resize(PDF_IMAGE_MAX_DIMENSION, PDF_IMAGE_MAX_DIMENSION, {
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: PDF_IMAGE_QUALITY })
            .toBuffer();
          return route.fulfill({
            status: 200,
            contentType: "image/jpeg",
            body: resized,
          });
        } catch (err) {
          logger.warn({ err, url }, "PDF image resize failed; embedding original");
          return route.continue();
        }
      });
    }

    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      ...pdfOptions,
    });
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
