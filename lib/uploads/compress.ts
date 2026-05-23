import imageCompression from "browser-image-compression";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_SIZE_MB = 0.8;
const MAX_WIDTH_OR_HEIGHT = 2400;

export interface CompressResult {
  blob: Blob;
  originalSize: number;
  finalSize: number;
  durationMs: number;
  skipped: boolean;
}

export async function compressImage(file: File): Promise<CompressResult> {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (!IMAGE_TYPES.has(file.type)) {
    return { blob: file, originalSize: file.size, finalSize: file.size, durationMs: 0, skipped: true };
  }
  // Skip files already smaller than target
  if (file.size <= MAX_SIZE_MB * 1024 * 1024) {
    return { blob: file, originalSize: file.size, finalSize: file.size, durationMs: 0, skipped: true };
  }
  const compressed = await imageCompression(file, {
    maxSizeMB: MAX_SIZE_MB,
    maxWidthOrHeight: MAX_WIDTH_OR_HEIGHT,
    useWebWorker: true,
    initialQuality: 0.8,
  });
  const end = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    blob: compressed,
    originalSize: file.size,
    finalSize: compressed.size,
    durationMs: end - start,
    skipped: false,
  };
}
