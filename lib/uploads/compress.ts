import imageCompression from "browser-image-compression";
import { isStampableImage, stampImage, type StampOptions } from "./stamp";

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

/**
 * Centralized evidence-upload preprocessing used across the app: stamp (when
 * the file is a stampable image AND a stamp context is supplied) then compress.
 *
 * `evidence` gates the stamp: pass stamp options for job/QA/maintenance photos;
 * omit `stamp` (or set it null) for non-evidence uploads (marketing assets,
 * report logos, avatars) so they are compressed but never stamped. The stamp
 * itself produces a sized JPEG, so when stamping succeeds we skip the second
 * compression pass. Stamping never throws out of here — a failure falls back to
 * the raw-then-compressed file.
 */
export async function prepareUploadFile(
  file: File,
  stamp?: StampOptions | null
): Promise<File> {
  if (stamp && isStampableImage(file)) {
    try {
      return await stampImage(file, stamp);
    } catch {
      // Stamp failed — fall through to plain compression below.
    }
  }
  try {
    const result = await compressImage(file);
    if (result.blob instanceof File) return result.blob;
    return new File([result.blob], file.name, { type: file.type || "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
