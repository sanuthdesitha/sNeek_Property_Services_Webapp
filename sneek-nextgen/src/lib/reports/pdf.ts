import { chromium } from "playwright";

export async function generatePdfFromHtml(
  html: string,
  options?: {
    filename?: string;
    margin?: { top: string; right: string; bottom: string; left: string };
    format?: string;
  },
): Promise<Buffer> {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setContent(html, { waitUntil: "networkidle" });

  const pdf = await page.pdf({
    format: options?.format ?? "A4",
    margin: options?.margin ?? {
      top: "20mm",
      right: "20mm",
      bottom: "20mm",
      left: "20mm",
    },
    printBackground: true,
  });

  await browser.close();

  return Buffer.from(pdf);
}
