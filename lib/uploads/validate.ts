/**
 * Upload input validation shared by the presign / direct / multipart routes.
 *
 * - Folder: prevents path traversal / absolute paths / cross-namespace writes.
 *   All real folders in the app are lowercase `a/b-c` style paths, so a strict
 *   charset that forbids `..`, backslashes and leading `/` is safe.
 * - Content type: only images (not SVG), video, and PDF are accepted, so an
 *   attacker can't host active content (HTML/SVG/JS) under a trusted URL.
 */

const FOLDER_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/;

/** Returns a safe folder, or null if the value is unsafe (caller should 400). */
export function sanitizeUploadFolder(input: unknown): string | null {
  if (typeof input !== "string") return "uploads";
  const folder = input.trim();
  if (!folder) return "uploads";
  if (folder.includes("..") || folder.includes("\\") || folder.startsWith("/")) return null;
  if (!FOLDER_RE.test(folder)) return null;
  return folder;
}

const BLOCKED_EXTENSIONS = new Set([
  "svg", "html", "htm", "xhtml", "xml", "js", "mjs", "cjs", "css", "php", "sh", "exe", "bat",
]);

const ALLOWED_MEDIA_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tiff",
  "mp4", "mov", "m4v", "avi", "mkv", "webm", "3gp", "mpeg", "mpg",
  "pdf",
]);

/** True when the (contentType, filename) pair is an allowed image/video/pdf. */
export function isAllowedUploadContentType(
  contentType: string | undefined | null,
  filename: string | undefined | null
): boolean {
  const ext = (String(filename ?? "").split(".").pop() ?? "").toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) return false;

  const ct = String(contentType ?? "").toLowerCase().split(";")[0].trim();
  if (ct === "image/svg+xml") return false;
  if (ct.startsWith("image/")) return true;
  if (ct.startsWith("video/")) return true;
  if (ct === "application/pdf") return true;
  // Some phone/browser uploads arrive as octet-stream / empty — accept only when
  // the extension is a known media/doc type.
  if ((ct === "application/octet-stream" || ct === "") && ALLOWED_MEDIA_EXTENSIONS.has(ext)) return true;
  return false;
}
