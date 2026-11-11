/**
 * Who uploaded a stored file.
 *
 * Every upload route (`presign`, `direct`, `presign-multipart`) builds its
 * object key on the server as `<folder>/<uploader user id>/<random>.<ext>`.
 * The uploader never chooses that middle segment, so it is a trustworthy
 * record of who put the file there. A route that accepts a key as evidence
 * can therefore check that the person submitting it is the person who
 * uploaded it, instead of trusting any string the browser sends.
 *
 * Pure: the database lookups that widen "own" to co-workers on the same job
 * live in `ownership-server.ts`.
 */

const UNSAFE_CHARACTERS = /[\\\u0000- \u007f]/;
const MAX_KEY_LENGTH = 1000;

/** The uploader's user id, or null when the key is not an upload-route key. */
export function uploadKeyOwnerId(key: unknown): string | null {
  if (typeof key !== "string") return null;
  if (!key || key.length > MAX_KEY_LENGTH || UNSAFE_CHARACTERS.test(key)) return null;
  const parts = key.split("/");
  if (parts.length < 3) return null;
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts[parts.length - 2];
}

export function isOwnUploadKey(key: unknown, userId: string): boolean {
  const owner = uploadKeyOwnerId(key);
  return owner !== null && owner === userId;
}

/** Keys whose uploader is not one of the allowed people (or cannot be read). */
export function uploadKeysNotOwnedBy(keys: readonly unknown[], allowedOwnerIds: readonly string[]): string[] {
  const allowed = new Set(allowedOwnerIds);
  const foreign: string[] = [];
  for (const key of keys) {
    const owner = uploadKeyOwnerId(key);
    if (owner === null || !allowed.has(owner)) foreign.push(String(key));
  }
  return foreign;
}

export const FOREIGN_UPLOAD_CODE = "FOREIGN_UPLOAD_REFERENCE";
export const FOREIGN_UPLOAD_MESSAGE =
  "One of the attached files was not uploaded from your account, so it cannot be used here. Remove it and attach the file again.";

/**
 * Folders only the office writes to: branding, website, property guides,
 * form references and similar. Field roles upload evidence, never these.
 */
const OFFICE_ONLY_FOLDERS = [
  "branding",
  "website",
  "property-access",
  "property-setup",
  "property-custom",
  "onboarding-access",
  "form-references",
  "form-theme",
  "task-references",
  "final-checkup",
  "jobs/reference",
  "jobs/notices",
  "quote-references",
  "laundry-confirmations",
  "reports",
  "public",
];

const FIELD_ROLES = new Set(["CLEANER", "CLIENT", "LAUNDRY", "MAINTENANCE"]);

/** False when a field role tries to upload into an office-owned folder. */
export function uploadFolderAllowedForRole(folder: string, role: string | null | undefined): boolean {
  if (!role || !FIELD_ROLES.has(role)) return true;
  const normalized = folder.toLowerCase();
  return !OFFICE_ONLY_FOLDERS.some((reserved) => normalized === reserved || normalized.startsWith(`${reserved}/`));
}
