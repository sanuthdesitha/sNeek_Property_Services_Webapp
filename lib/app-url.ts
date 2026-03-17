type RequestLike = { url?: string; headers?: Headers | { get?: (name: string) => string | null } } | string | URL | null | undefined;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function firstHeaderValue(value: string | null | undefined) {
  if (!value) return "";
  return value.split(",")[0]?.trim() || "";
}

function looksLikeIpv4Host(value: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(value);
}

function normalizeBaseUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
    ? trimmed
    : (() => {
        const lower = trimmed.toLowerCase();
        const needsHttp = lower.startsWith("localhost") || lower.startsWith("127.0.0.1") || lower.startsWith("0.0.0.0") || looksLikeIpv4Host(trimmed);
        return `${needsHttp ? "http" : "https"}://${trimmed}`;
      })();

  try {
    return trimTrailingSlash(new URL(withProtocol).origin);
  } catch {
    return null;
  }
}

function getConfiguredBaseUrl() {
  const candidates = [
    process.env.APP_BASE_URL,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXTAUTH_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  ];

  for (const candidate of candidates) {
    const parsed = normalizeBaseUrl(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function isLocalBaseUrl(value: string | null) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.host.toLowerCase();
    return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0") || looksLikeIpv4Host(host);
  } catch {
    return false;
  }
}

function getHeaderGetter(request?: RequestLike) {
  if (!request || typeof request !== "object" || request instanceof URL) return null;
  const headers = (request as { headers?: unknown }).headers as
    | Headers
    | { get?: (name: string) => string | null }
    | undefined;
  if (!headers || typeof headers.get !== "function") return null;
  const getter = headers.get.bind(headers) as (name: string) => string | null;
  return (name: string) => {
    try {
      return getter(name);
    } catch {
      return null;
    }
  };
}

function getBaseUrlFromHeaders(request?: RequestLike) {
  const getHeader = getHeaderGetter(request);
  if (!getHeader) return null;

  const forwardedProto = firstHeaderValue(getHeader("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(getHeader("x-forwarded-host"));
  const forwardedPort = firstHeaderValue(getHeader("x-forwarded-port"));
  const host = forwardedHost || firstHeaderValue(getHeader("host"));
  if (!host) return null;

  const normalizedHost = host.toLowerCase();
  const isLocalHost = normalizedHost.startsWith("localhost") || normalizedHost.startsWith("127.0.0.1") || normalizedHost.startsWith("0.0.0.0") || looksLikeIpv4Host(host);
  let proto = forwardedProto || "";
  if (!proto) proto = isLocalHost ? "http" : "https";

  if (forwardedPort && !host.includes(":")) {
    return normalizeBaseUrl(`${proto}://${host}:${forwardedPort}`);
  }

  return normalizeBaseUrl(`${proto}://${host}`);
}

function getBaseUrlFromRequestUrl(request?: RequestLike) {
  const requestUrl =
    request instanceof URL
      ? request.toString()
      : typeof request === "string"
        ? request
        : request && typeof request === "object" && typeof request.url === "string"
          ? request.url
          : null;

  if (!requestUrl) return null;
  try {
    return trimTrailingSlash(new URL(requestUrl).origin);
  } catch {
    return normalizeBaseUrl(requestUrl);
  }
}

export function getAppBaseUrl(request?: RequestLike) {
  const configured = getConfiguredBaseUrl();
  const fromHeaders = getBaseUrlFromHeaders(request);
  const fromRequestUrl = getBaseUrlFromRequestUrl(request);

  // If the configured URL is still localhost but this request arrived on a real host/IP,
  // prefer the live request origin so links in emails/actions do not point back to localhost.
  if (isLocalBaseUrl(configured)) {
    const requestResolved = fromHeaders ?? fromRequestUrl;
    if (requestResolved && !isLocalBaseUrl(requestResolved)) {
      return requestResolved;
    }
  }

  return configured ?? fromHeaders ?? fromRequestUrl ?? null;
}

export function resolveAppUrl(pathname: string, request?: RequestLike) {
  if (/^(https?:\/\/|mailto:|tel:)/i.test(pathname)) return pathname;
  const baseUrl = getAppBaseUrl(request);
  if (!baseUrl) return pathname;
  return new URL(pathname, `${baseUrl}/`).toString();
}
