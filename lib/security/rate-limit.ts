/**
 * Simple in-memory fixed-window rate limiter.
 *
 * IMPORTANT: This limiter is **per-instance** — state lives in a module-level Map in
 * the current process only. It does NOT coordinate across multiple server instances
 * (serverless functions, multiple containers, etc.). For multi-instance / serverless
 * deployments, back this with a shared store such as Redis or Upstash.
 */

interface WindowEntry {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, WindowEntry>();

/**
 * Apply a fixed-window rate limit for the given key.
 *
 * @param key  Unique key for the caller/endpoint, e.g. `contact:1.2.3.4`.
 * @param opts limit = max requests allowed per window; windowMs = window length in ms.
 * @returns ok = whether the request is allowed; retryAfterSec = seconds until reset (when blocked).
 */
export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number }
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();

  // Lazy cleanup of expired entries to keep the Map bounded.
  if (buckets.size > 5000) {
    buckets.forEach((entry, k) => {
      if (entry.resetAt <= now) buckets.delete(k);
    });
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  if (existing.count >= opts.limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }

  existing.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Extract a best-effort client IP from a request, reading `x-forwarded-for`
 * (first hop) then `x-real-ip`, falling back to "unknown".
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
