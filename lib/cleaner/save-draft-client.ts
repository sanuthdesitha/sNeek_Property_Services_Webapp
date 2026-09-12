export type DraftSaveResult = { ok: true; updatedAt: string } | { ok: false; message: string };

export async function saveCleanerDraft(jobId: string, editorSessionId: string, state: Record<string, unknown>, keepalive = false, draftIdentity?: string): Promise<DraftSaveResult> {
  try {
    const response = await fetch(`/api/cleaner/jobs/${encodeURIComponent(jobId)}/draft`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(draftIdentity ? { "X-Cleaner-Draft-Identity": draftIdentity } : {}) },
      body: JSON.stringify({ editorSessionId, state }),
      keepalive,
    });
    if (!response.ok) {
      return { ok: false, message: response.status === 401 || response.status === 403
        ? "Draft not saved. Sign in and confirm access before continuing."
        : response.status === 409
          ? "Draft not saved. Reload to check the job's current status."
          : "Draft not saved to the server. Keep this page open and retry." };
    }
    const body = await response.json();
    if (body?.ok !== true || typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt))) {
      return { ok: false, message: "Draft save could not be confirmed. Keep this page open and retry." };
    }
    return { ok: true, updatedAt: body.updatedAt };
  } catch {
    return { ok: false, message: "Draft save could not be confirmed. Keep this page open and retry." };
  }
}
