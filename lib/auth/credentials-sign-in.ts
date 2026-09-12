export async function signInWithCredentials(input: { email: string; password: string; callbackUrl: string }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const csrfRes = await fetch("/api/auth/csrf", { cache: "no-store", credentials: "same-origin" });
    if (!csrfRes.ok) throw new Error("Could not initialize sign in.");
    const csrfData = (await csrfRes.json()) as { csrfToken?: string } | null;
    if (typeof csrfData?.csrfToken !== "string" || !csrfData.csrfToken) throw new Error("Missing CSRF token.");

    const res = await fetch("/api/auth/callback/credentials", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...input, csrfToken: csrfData.csrfToken, json: "true" }),
    });
    const data = await res.json().catch(() => null) as { url?: string } | null;
    const url = typeof data?.url === "string" && data.url ? data.url : null;
    const returned = url ? new URL(url, input.callbackUrl) : null;
    if (!res.ok || returned?.searchParams.has("error")) {
      return { ok: false, status: res.status, url };
    }

    // On a fresh browser, a late SessionProvider response can overwrite the
    // /csrf cookie. NextAuth v4 returns HTTP 200 for this rejection, BEFORE
    // authorize runs. Refresh and retry only that explicit pre-auth failure.
    if (returned?.pathname === "/api/auth/signin" && returned.searchParams.get("csrf") === "true") {
      if (attempt === 0) continue;
      throw new Error("Could not initialize sign in.");
    }
    if (!returned || ["/login", "/v2/login", "/api/auth/signin"].includes(returned.pathname)) {
      throw new Error("Sign in did not complete.");
    }
    return { ok: true, status: res.status, url };
  }
  throw new Error("Could not initialize sign in.");
}
