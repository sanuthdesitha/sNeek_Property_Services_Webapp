/** PATCH one submission; the server's refusal comes back as its own words, never assumed done. */
export async function patchSubmission(id: string, body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch(`/api/admin/form-submissions/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) return { ok: true };
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, message: payload?.error ?? `The change was not saved (${response.status}).` };
  } catch {
    return { ok: false, message: "No answer from the server. Reload the submission before trying again." };
  }
}
