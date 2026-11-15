/**
 * Browser helpers for the social post generator (2026-11-17). Every read can
 * be cancelled; callers check the signal after the response is parsed so a
 * late answer never fills a newer screen.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; problems: string[] };

export const SOCIAL_API = "/api/admin/marketing/social";

export async function socialRequest<T>(url: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    return { ok: false, status: 0, error: "sNeek could not be reached. Check the connection and try again.", problems: [] };
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const problems = Array.isArray(body?.problems) ? (body!.problems as unknown[]).filter((item): item is string => typeof item === "string") : [];
    return { ok: false, status: response.status, error: typeof body?.error === "string" ? body.error : `The request failed (${response.status}).`, problems };
  }
  return { ok: true, data: body as T };
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Copies text to the clipboard; false when the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function readGeneratorParams(): { view: "list" | "create"; group: string | null } {
  if (typeof window === "undefined") return { view: "list", group: null };
  const params = new URLSearchParams(window.location.search);
  return { view: params.get("view") === "create" ? "create" : "list", group: params.get("group") };
}

/** Keeps ?tab=social and other parameters; sets or clears view and group. */
export function writeGeneratorParams(view: "list" | "create", group: string | null) {
  const url = new URL(window.location.href);
  url.searchParams.set("tab", "social");
  if (view === "create") url.searchParams.set("view", "create");
  else url.searchParams.delete("view");
  if (group) url.searchParams.set("group", group);
  else url.searchParams.delete("group");
  window.history.replaceState(window.history.state, "", url.toString());
}
