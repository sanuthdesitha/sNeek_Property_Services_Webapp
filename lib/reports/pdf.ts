import type { Page } from "playwright";
import { s3 } from "@/lib/s3";
import { logger } from "@/lib/logger";

type PdfOptions = Parameters<Page["pdf"]>[0];

const hasStorageConfig = Boolean(
  process.env.S3_BUCKET_NAME &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY
);
const hasPublicStorageConfig = Boolean(hasStorageConfig && process.env.S3_PUBLIC_BASE_URL);

const PDF_IMAGE_MAX_DIMENSION = Number(process.env.PDF_IMAGE_MAX_DIMENSION ?? 1024);
const PDF_IMAGE_QUALITY = Number(process.env.PDF_IMAGE_QUALITY ?? 75);
const PDF_FETCH_TIMEOUT_MS = Number(process.env.PDF_FETCH_TIMEOUT_MS ?? 12000);
const PDF_RENDER_TIMEOUT_MS = Number(process.env.PDF_RENDER_TIMEOUT_MS ?? 30000);
const PDF_IMAGE_WAIT_TIMEOUT_MS = Number(process.env.PDF_IMAGE_WAIT_TIMEOUT_MS ?? 20000);
const PDF_TOTAL_TIMEOUT_MS = Number(process.env.PDF_TOTAL_TIMEOUT_MS ?? 60_000);

/**
 * Single-flight semaphore — serializes ALL Chromium launches across the
 * process. Without this, 10 concurrent report.generate jobs would spawn
 * 10 Chromium processes that compete for CPU and combined easily pin a
 * small VPS at 100%. Each PDF now waits its turn; throughput drops a
 * little but CPU stays sane.
 */
let pdfLock: Promise<void> = Promise.resolve();
function acquirePdfLock(): Promise<() => void> {
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = pdfLock;
  pdfLock = next;
  return prev.then(() => release);
}

type SharpModule = typeof import("sharp");

let sharpModulePromise: Promise<SharpModule | null> | null = null;

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

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
  // Serialize PDF generation — see acquirePdfLock() comment.
  const releaseLock = await acquirePdfLock();

  try {
    return await Promise.race([
      renderPdfFromHtmlImpl(html, errorContext, pdfOptions),
      new Promise<Buffer>((_, reject) =>
        setTimeout(
          () => reject(new Error(`PDF render exceeded ${PDF_TOTAL_TIMEOUT_MS}ms total budget`)),
          PDF_TOTAL_TIMEOUT_MS,
        ),
      ),
    ]);
  } finally {
    releaseLock();
  }
}

async function renderPdfFromHtmlImpl(
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
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  let page: Awaited<ReturnType<NonNullable<typeof context>["newPage"]>> | null = null;

  try {
    context = await browser.newContext();

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
          const response = await fetchWithTimeout(url, PDF_FETCH_TIMEOUT_MS);
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

    page = await context.newPage();
    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: PDF_RENDER_TIMEOUT_MS,
    });
    await page
      .evaluate(async (timeoutMs) => {
        const images = Array.from(document.images || []);
        if (!images.length) return;
        await Promise.race([
          Promise.all(
            images.map((img) => {
              if (img.complete && img.naturalWidth > 0) return Promise.resolve();
              return new Promise<void>((resolve) => {
                const done = () => resolve();
                img.addEventListener("load", done, { once: true });
                img.addEventListener("error", done, { once: true });
              });
            })
          ),
          new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
        ]);
      },
      PDF_IMAGE_WAIT_TIMEOUT_MS)
      .catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => {});
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      ...pdfOptions,
    });
    return Buffer.from(pdf);
  } finally {
    // Always close in reverse order. Each step is independently guarded —
    // if context.close() throws (e.g. on a crashed page), we still try
    // to close the browser so Chromium doesn't linger as a zombie process.
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
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
    const response = await fetchWithTimeout(pdfUrl, PDF_FETCH_TIMEOUT_MS);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function refreshStoredJobReportPdf(jobId: string, pdf: Buffer) {
  if (!hasPublicStorageConfig || !process.env.S3_BUCKET_NAME) return;
  try {
    await s3
      .putObject({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: `reports/${jobId}/report.pdf`,
        Body: pdf,
        ContentType: "application/pdf",
      })
      .promise();
  } catch (err) {
    logger.warn({ err, jobId }, "Failed to refresh stored job report PDF");
  }
}

export async function getJobReportPdfBuffer(
  report: { pdfUrl: string | null; htmlContent: string | null },
  jobId: string,
  options: { preferStored?: boolean } = {}
) {
  if (report.htmlContent && !options.preferStored) {
    try {
      const rendered = await renderPdfFromHtml(report.htmlContent, "job report PDF generation");
      await refreshStoredJobReportPdf(jobId, rendered);
      return rendered;
    } catch (err) {
      logger.warn({ err, jobId }, "Fresh job report PDF render failed; falling back to stored PDF");
    }
  }

  const storedFromBucket = await loadStoredPdfFromBucket(jobId);
  if (storedFromBucket) return storedFromBucket;

  if (report.pdfUrl) {
    const storedFromUrl = await loadStoredPdfFromUrl(report.pdfUrl);
    if (storedFromUrl) return storedFromUrl;
  }

  if (!report.htmlContent) return null;
  return renderPdfFromHtml(report.htmlContent, "job report PDF generation");
}
