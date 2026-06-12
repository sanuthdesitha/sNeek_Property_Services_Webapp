import { promises as dns } from "dns";

/**
 * Parse a dotted-quad IPv4 string into its 32-bit integer value, or null if invalid.
 */
function parseIpv4(host: string): number | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1, 5).map((o) => Number(o));
  if (octets.some((o) => o < 0 || o > 255)) return null;
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function ipv4InCidr(ip: number, base: string, bits: number): boolean {
  const baseInt = parseIpv4(base);
  if (baseInt === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (baseInt & mask);
}

/**
 * Returns true if the given IPv4 string is in a private/loopback/link-local/CGNAT
 * range or is the cloud metadata IP.
 */
function isPrivateIpv4(host: string): boolean {
  const ip = parseIpv4(host);
  if (ip === null) return false;
  // Cloud metadata endpoint.
  if (host === "169.254.169.254") return true;
  return (
    ipv4InCidr(ip, "10.0.0.0", 8) || // private
    ipv4InCidr(ip, "172.16.0.0", 12) || // private
    ipv4InCidr(ip, "192.168.0.0", 16) || // private
    ipv4InCidr(ip, "127.0.0.0", 8) || // loopback
    ipv4InCidr(ip, "169.254.0.0", 16) || // link-local (incl. metadata)
    ipv4InCidr(ip, "100.64.0.0", 10) || // CGNAT
    ipv4InCidr(ip, "0.0.0.0", 8) // "this" network
  );
}

/**
 * Returns true if the given IPv6 string is loopback, link-local, unique-local (fc00::/7),
 * or an IPv4-mapped address pointing at a private IPv4 range.
 */
function isPrivateIpv6(host: string): boolean {
  let h = host.toLowerCase();
  // Strip zone index (e.g. fe80::1%eth0) and brackets.
  h = h.replace(/^\[|\]$/g, "").split("%")[0];

  if (h === "::1" || h === "::") return true;

  // IPv4-mapped / IPv4-compatible addresses: ::ffff:a.b.c.d
  const mapped = /(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h);
  if (mapped) return isPrivateIpv4(mapped[1]);

  // Expand the leading group(s) enough to test prefixes.
  const firstGroup = h.split(":")[0] || "0";
  const firstValue = parseInt(firstGroup, 16);
  if (!Number.isNaN(firstValue)) {
    // fc00::/7 (unique local): high 7 bits == 1111110
    if ((firstValue & 0xfe00) === 0xfc00) return true;
    // fe80::/10 (link-local): high 10 bits == 1111111010
    if ((firstValue & 0xffc0) === 0xfe80) return true;
  }
  return false;
}

/**
 * Test an IPv4 or IPv6 literal string against private/loopback/link-local/CGNAT/metadata ranges.
 */
export function isPrivateIp(host: string): boolean {
  return isPrivateIpv4(host) || isPrivateIpv6(host);
}

/**
 * Validate that a URL is safe to fetch from a server context (anti-SSRF).
 *
 * Throws when the URL:
 *  - is not https://
 *  - has a hostname of `localhost`, ends in `.local`, or is a private/loopback/
 *    link-local/CGNAT/metadata IP literal
 *  - resolves (via DNS) to any private/loopback/link-local address or the cloud
 *    metadata IP (169.254.169.254)
 *
 * Returns the parsed URL when it is safe.
 *
 * Note: there is still a theoretical DNS-rebinding window between this check and the
 * actual fetch. Always pair this with `redirect: "manual"` on the fetch.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL not allowed.");
  }

  if (url.protocol !== "https:") {
    throw new Error("URL not allowed.");
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (host === "localhost" || host.endsWith(".local")) {
    throw new Error("URL not allowed.");
  }

  // Reject IP literals in disallowed ranges directly.
  if (isPrivateIp(host)) {
    throw new Error("URL not allowed.");
  }

  // Resolve the hostname and reject if ANY resolved address is disallowed.
  let resolved: Array<{ address: string }>;
  try {
    resolved = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("URL not allowed.");
  }

  if (resolved.length === 0) {
    throw new Error("URL not allowed.");
  }

  for (const { address } of resolved) {
    if (isPrivateIp(address)) {
      throw new Error("URL not allowed.");
    }
  }

  return url;
}
