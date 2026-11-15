/**
 * Security and account emails that were fixed HTML inside routes and
 * libraries (two-step sign-in, invitation link). Security emails keep their
 * whole body fixed: only the theme applies. Plain module.
 */
import { button, callout, design, details, doc, heading, note, paragraph, v } from "./build";
import type { EmailDesignDefinition } from "../types";

const CODE = v("code", "Code", "482913", { format: "code", required: true });

export const ACCOUNT_DESIGNS: readonly EmailDesignDefinition[] = [
  design({
    key: "twoFactorSignInCode", label: "Sign-in code", group: "accounts", typeKey: "account.security", audience: "Any person with two-step sign-in",
    trigger: "Someone with two-step sign-in enters their password.", security: true, whyLine: "", preferences: "none",
    mustStay: ["Code", "Expiry", "Never-share line", "Whole body fixed"], source: "app/api/auth/2fa/begin (HTML in code, fixed)",
    variables: [CODE, v("expiryMinutes", "Minutes it works", "10", { required: true })],
    defaults: doc("Your {{companyName}} sign-in code", "It expires in {{expiryMinutes}} minutes. Never share it, not even with sNeek staff.", [
      heading("Your sign-in code", { lock: "fixed" }),
      { type: "code", source: "code", lock: "fixed" },
      paragraph("Enter this code on the sign-in screen. It expires in {{expiryMinutes}} minutes.", { lock: "fixed" }),
      callout("action", "Never share this code. sNeek staff will never ask you for it.", { lock: "fixed" }),
      note("Didn't try to sign in? Ignore this email. Someone may know your password; change it in Profile, Security.", { lock: "fixed" }),
    ]),
  }),
  design({
    key: "twoFactorConfirmCode", label: "Two-step verification: confirm code", group: "accounts", typeKey: "account.security", audience: "Person turning on two-step sign-in",
    trigger: "Someone turns on or changes two-step verification.", security: true, whyLine: "", preferences: "none",
    mustStay: ["Code", "Expiry", "Whole body fixed"], source: "app/api/auth/2fa/settings (HTML in code, fixed)",
    variables: [CODE, v("expiryMinutes", "Minutes it works", "10", { required: true })],
    defaults: doc("Confirm two-step verification", "Your verification code expires in {{expiryMinutes}} minutes.", [
      heading("Confirm two-step verification", { lock: "fixed" }),
      { type: "code", source: "code", lock: "fixed" },
      paragraph("Your verification code expires in {{expiryMinutes}} minutes.", { lock: "fixed" }),
      callout("action", "Never share this code. sNeek staff will never ask you for it.", { lock: "fixed" }),
    ]),
  }),
  design({
    key: "twoFactorRecovery", label: "Two-step verification: recovery link", group: "accounts", typeKey: "account.security", audience: "Person who cannot complete two-step sign-in",
    trigger: "Someone asks to recover access because they cannot complete two-step verification.", security: true, whyLine: "", preferences: "none",
    mustStay: ["Recovery link", "Expiry", "Whole body fixed"], source: "app/api/auth/2fa/recover (HTML in code, fixed)",
    variables: [v("userName", "Person's name", "Jane", { fallback: "there" }), v("recoveryUrl", "Recovery link", "https://app.sneek.example/2fa-recover?token=…", { format: "url", required: true }), v("expiryMinutes", "Minutes it works", "30", { required: true })],
    defaults: doc("Turn off two-step verification", "This link works for {{expiryMinutes}} minutes.", [
      heading("Turn off two-step verification", { lock: "fixed" }),
      paragraph("Hi {{userName}}, you asked to recover access because you can't complete two-step verification. Use the button below to switch it off. This link expires in {{expiryMinutes}} minutes.", { lock: "fixed" }),
      { type: "button", label: "Turn off two-step verification", link: "recoveryUrl", lock: "fixed" },
      paragraph("After signing in, set up two-step verification again from your profile.", { lock: "fixed" }),
      note("Didn't ask for this? Ignore this email; nothing changes.", { lock: "fixed" }),
    ]),
  }),
  design({
    key: "twoFactorResetByAdmin", label: "Two-step verification was reset", group: "accounts", typeKey: "account.security", audience: "Person whose two-step sign-in an administrator reset",
    trigger: "An administrator turns off a person's two-step verification.", security: true, whyLine: "", preferences: "none",
    mustStay: ["Whole body fixed"], source: "app/api/admin/users/[id]/disable-2fa (HTML in code, fixed)",
    variables: [v("userName", "Person's name", "Jane", { fallback: "there" })],
    defaults: doc("Two-step verification was reset", "You can sign in with your password and set it up again.", [
      heading("Two-step verification was reset", { lock: "fixed" }),
      paragraph("Hi {{userName}}, an administrator turned off two-step verification on your sNeek account. You can sign in with your password, then set two-step verification up again from your profile.", { lock: "fixed" }),
      callout("action", "If this wasn't expected, contact your administrator.", { lock: "fixed" }),
    ]),
  }),
  design({
    key: "twoFactorBackupCodeUsed", label: "Backup code used", group: "accounts", typeKey: "account.backup_code_used", audience: "Person who signed in with a backup code",
    trigger: "Someone completes two-step sign-in with one of the account's backup codes. Sent once per code, with the inbox notice.", security: true, whyLine: "", preferences: "none",
    mustStay: ["When", "Browser", "Codes left", "Whole body fixed"], source: "lib/auth/backup-code-notice.ts (new 2026-11-17)",
    variables: [
      v("userName", "Person's name", "Jane", { fallback: "there" }),
      v("usedAt", "When it was used", "Tue 17 Nov 2026, 9:42 am (Sydney time)", { required: true }),
      v("browser", "Browser", "Chrome on macOS", { fallback: "browser not recorded" }),
      v("remaining", "Codes left", "7", { required: true }),
      v("profileUrl", "Two-step settings link", "https://app.sneek.example/v2/admin/profile?setup=two-step", { format: "url" }),
    ],
    defaults: doc("A backup code was used to sign in", "{{remaining}} backup codes left. Not you? Change your password.", [
      heading("A backup code was used", { lock: "fixed" }),
      paragraph("Hi {{userName}}, someone signed in to your sNeek account with one of your two-step backup codes. That code no longer works.", { lock: "fixed" }),
      details([["When", "{{usedAt}}"], ["Browser", "{{browser}}"], ["Codes left", "{{remaining}}"]], { lock: "fixed" }),
      callout("action", "Not you? Change your password now, then make new backup codes. Making new codes cancels the old ones.", { lock: "fixed" }),
      button("Open two-step sign-in", "profileUrl", { lock: "fixed" }),
      note("We never send your codes by email. The office will never ask you for one.", { lock: "fixed" }),
    ]),
  }),
  design({
    key: "accountInvitationLink", label: "Invitation to set a password", group: "accounts", typeKey: "account.invitations", audience: "New staff member or client",
    trigger: "An administrator creates an account and invites the person, or resends the invitation.", security: true, whyLine: "You got this because sNeek invited this address to an account.", preferences: "none",
    mustStay: ["Invitation link", "Expiry", "Whole body fixed"], source: "lib/auth/invitations.ts (HTML in code)",
    variables: [v("userName", "Person's name", "Jane", { fallback: "there" }), v("roleLabel", "Role", "cleaner"), v("inviteUrl", "Invitation link", "https://app.sneek.example/accept-invite?token=…", { format: "url", required: true }), v("expiresLabel", "Link works until", "19 November 2026", { required: true })],
    defaults: doc("You're invited to {{companyName}}", "Set a password to finish signing in. The link works until {{expiresLabel}}.", [
      heading("Welcome to {{companyName}}", { lock: "fixed" }),
      paragraph("Hi {{userName}}, an administrator has created a {{roleLabel}} account for you. Use the button below to set your password and finish signing in.", { lock: "fixed" }),
      { type: "button", label: "Accept invitation", link: "inviteUrl", lock: "fixed" },
      paragraph("This invitation expires on {{expiresLabel}}.", { lock: "fixed" }),
      note("Weren't expecting this? Ignore this email and no account will be opened.", { lock: "fixed" }),
    ]),
  }),
];
