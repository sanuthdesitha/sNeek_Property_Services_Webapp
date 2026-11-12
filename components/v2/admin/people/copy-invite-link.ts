/**
 * Copy a person's still-valid invitation link through the existing audited
 * route (POST /api/admin/users/[id]/account-emails/invitation-link). The link
 * is NOT re-issued, so the emailed link keeps working; the server applies the
 * resend rules (ADMIN, or OPS_MANAGER with the accounts pack at manage; never
 * upward; never while impersonating) and refuses an expired link.
 */
export type CopyLinkResult = { ok: true; message: string } | { ok: false; message: string };

export async function copyInvitationLink(userId: string): Promise<CopyLinkResult> {
  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/account-emails/invitation-link`, { method: "POST" });
    const body = (await response.json().catch(() => null)) as { link?: unknown; expiresAt?: unknown; error?: unknown } | null;
    if (!response.ok || !body || typeof body.link !== "string") {
      return { ok: false, message: typeof body?.error === "string" ? body.error : `Could not copy the link (${response.status}).` };
    }
    try {
      await navigator.clipboard.writeText(body.link);
    } catch {
      return { ok: false, message: "The browser did not allow copying. Open the person's account emails to copy the link by hand." };
    }
    return { ok: true, message: "Invitation link copied. Anyone with it can set this person's password, so send it only to them." };
  } catch {
    return { ok: false, message: "No answer from the server. Try again." };
  }
}
