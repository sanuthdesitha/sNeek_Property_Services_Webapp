/** Device observations only: these warnings never certify evidence quality. */
export function imageCaptureAdvice(width: number, height: number, pixels: ArrayLike<number>): string[] {
  const advice: string[] = [];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return ["This image could not be previewed. Check the original before submitting."];
  if (Math.min(width, height) < 480) advice.push("This image has low resolution. Check that the required detail is readable, or take a closer photo.");
  let luminance = 0; let samples = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    luminance += 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]; samples++;
  }
  if (samples && luminance / samples < 35) advice.push("This image appears dark. Review the preview and retake it with more light if details are hard to see.");
  return advice;
}

export async function deviceStorageAdvice(fileBytes: number): Promise<string[]> {
  let timer: number | undefined;
  try {
    const estimate = await Promise.race([navigator.storage?.estimate?.(), new Promise<undefined>(resolve => { timer = window.setTimeout(resolve, 1000); })]);
    if (!estimate || !Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) return [];
    const available = Math.max(0, estimate.quota! - estimate.usage!);
    // Original plus prepared bytes can coexist. This is an estimate, not a storage reservation.
    return available < Math.max(50 * 1024 * 1024, fileBytes * 2)
      ? ["Estimated browser storage is low. Keep your originals and check device recovery before leaving this job."] : [];
  } catch { return []; } finally { window.clearTimeout(timer); }
}

export async function inspectImageCapture(file: File): Promise<string[]> {
  if (!file.type.startsWith("image/") && !/\.(jpe?g|png|gif|webp|heic|heif|avif)$/i.test(file.name)) return [];
  if (typeof createImageBitmap !== "function") return ["Image quality checks are unavailable in this browser. Open the preview to check orientation and detail."];
  let bitmap: ImageBitmap | undefined;
  let timer: number | undefined;
  let expired = false;
  try {
    bitmap = await Promise.race([
      createImageBitmap(file, { imageOrientation: "from-image" }).then(value => { if (expired) value.close(); return value; }),
      new Promise<never>((_resolve, reject) => { timer = window.setTimeout(() => { expired = true; reject(new Error("Preview timed out")); }, 5000); }),
    ]);
    const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return ["Image quality checks are unavailable. Open the preview to check orientation and detail."];
    context.drawImage(bitmap, 0, 0, 32, 32);
    return imageCaptureAdvice(bitmap.width, bitmap.height, context.getImageData(0, 0, 32, 32).data);
  } catch { return ["This browser could not preview the original image. Keep the original and check it on a supported device before submitting."]; }
  finally { window.clearTimeout(timer); bitmap?.close(); }
}
