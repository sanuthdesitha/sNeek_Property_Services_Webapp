/**
 * Where a lost and found photo is shown from. PURE (safe for client bundles).
 *
 * Photos were stored with a public link (`S3_PUBLIC_BASE_URL/<key>`). The rest
 * of the app treats the bucket as private and signs on demand, so that link
 * only works where the bucket is public. Every screen now shows a photo
 * through `GET /api/lost-found/<itemId>/photo?key=<key>`, which re-checks who
 * may open the item and redirects to a short-lived signed link. The stored
 * `url` is kept unchanged for compatibility (exports, old clients).
 */

export function lostFoundPhotoSrc(itemId: string, key: string): string {
  return `/api/lost-found/${encodeURIComponent(itemId)}/photo?key=${encodeURIComponent(key)}`;
}

/** A retry asks the route again (a fresh signed link), past any cached failure. */
export function lostFoundPhotoRetrySrc(src: string, attempt: number): string {
  if (attempt <= 0) return src;
  return `${src}${src.includes("?") ? "&" : "?"}attempt=${attempt}`;
}

/** True when `key` is one of the item's stored photo keys. */
export function itemHasPhotoKey(photos: ReadonlyArray<{ key: string }>, key: string): boolean {
  return key.length > 0 && photos.some((photo) => photo.key === key);
}
