import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { getAppSettings } from "@/lib/settings";
import { isMarketingSuppressed, isSuppressed } from "@/lib/email/suppression";
import { prepareOutgoingEmail, senderAddress } from "@/lib/email-design/send-render";
import {
  isAudienceKindAllowed,
  isAutoEmailAllowed,
  type EmailAutoKind,
} from "@/lib/notifications/email-kinds";
import { db } from "@/lib/db";
import {
  audienceForRole,
  isChannelAllowed,
  type NotificationAudience,
} from "@/lib/notifications/audience-controls";
import { guardOutbound, recordOutboundOutcome, refuseOversizedSend, type HeldPayload, type SafeguardMeta } from "@/lib/notifications/safeguards/gate";
import { notSentText, type SuppressionReason } from "@/lib/notifications/safeguards/config";

const FROM = process.env.EMAIL_FROM ?? "admin@sneekproservices.com.au";
let resendClient: Resend | null = null;

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  if (!resendClient) {
    resendClient = new Resend(apiKey);
  }

  return resendClient;
}

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  from?: string;
  /**
   * If true, bypass the suppression list (HARD_BOUNCE / COMPLAINT /
   * UNSUBSCRIBED / SOFT_BOUNCE). Reserved for password reset, OTP,
   * invoice delivery, and other categories that must always go through.
   * Defaults to false.
   */
  transactional?: boolean;
  /**
   * Marks this as an AUTOMATIC email of a given type. When set, the send is
   * gated on the admin's email-automation settings (master switch + the
   * per-type switch). Manual / admin-clicked sends omit this and always go.
   */
  kind?: EmailAutoKind;
  /**
   * When true, SKIP audience gating entirely. Reserved for auth / recovery
   * emails (password reset, OTP, 2FA, verification codes) that must never be
   * silenced by an audience toggle. Suppression + EmailAutoKind gating are
   * independent of this flag.
   */
  critical?: boolean;
  /**
   * Pre-resolved recipient audience, supplied by callers that already know the
   * recipient's role (e.g. delivery.ts). When present the chokepoint skips its
   * own user lookup for a single recipient. Ignored for multi-recipient sends,
   * which are resolved per address.
   */
  audience?: NotificationAudience;
  /**
   * What the sending safeguards need to know (type, subject entity, recipient
   * account). Optional: a send without it is still capped and deduplicated,
   * identified by its subject or kind (lib/notifications/safeguards).
   */
  safeguard?: SafeguardMeta;
  /** Plain-text part. Omitted: generated from the same blocks as the HTML (lib/email-design). */
  text?: string;
  /**
   * Campaign (marketing) email: put on the base layout with the campaign
   * footer, a signed one-click unsubscribe link and List-Unsubscribe headers,
   * and refused for addresses that opted out of campaigns. Never set it on
   * operational or security mail.
   */
  marketing?: boolean;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
  }>;
}

/**
 * Resolve the audience for an email address by looking up the matching user's
 * role (case-insensitive). No matching account → PUBLIC (leads / contacts).
 */
interface ResolvedRecipient {
  audience: NotificationAudience;
  /** The person asked to receive no automatic email at all. */
  allEmailOff: boolean;
  /** Kinds this person has individually switched off. */
  disabledKinds: Set<string>;
}

async function resolveRecipient(email: string): Promise<ResolvedRecipient> {
  try {
    const user = await db.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        role: true,
        allEmailOff: true,
        // Only the rows that actually block — a preference table row exists
        // solely to record a deviation, so absence means allowed.
        emailPreferences: { where: { enabled: false }, select: { key: true } },
      },
    });
    return {
      audience: audienceForRole(user?.role ?? null),
      allEmailOff: user?.allEmailOff === true,
      disabledKinds: new Set((user?.emailPreferences ?? []).map((p) => p.key)),
    };
  } catch {
    // Fail-open: a lookup error must not silently stop mail going out. Treat
    // the address as a member of the public with no preferences — the global
    // and per-kind switches above still apply.
    return { audience: audienceForRole(null), allEmailOff: false, disabledKinds: new Set() };
  }
}

export type EmailSendResult = {
  ok: boolean;
  error?: string;
  externalId?: string | null;
  skipped?: boolean;
  acceptance?: "ACCEPTED" | "NOT_ACCEPTED" | "UNKNOWN";
  retryable?: boolean;
  /** Not sent by the sending safeguards (never a delivery); `held` = sent once after quiet hours. */
  suppressed?: { reason: SuppressionReason; held: boolean };
};

type EmailGateOutcome =
  | { kind: "send"; to: string[]; eventIds: Array<string | null> }
  | { kind: "suppressed"; result: EmailSendResult };

function suppressedResult(reason: SuppressionReason, held: boolean): EmailSendResult {
  return { ok: false, skipped: true, error: notSentText(reason), acceptance: "NOT_ACCEPTED", retryable: false, suppressed: { reason, held } };
}

/**
 * The sending safeguards, per address (lib/notifications/safeguards/gate.ts).
 * Runs after every existing gate so a message someone switched off is never
 * counted. Addresses the gate refuses are dropped; when none is left the
 * whole send is "not sent" with the first reason.
 */
async function applySendingSafeguards(payload: EmailPayload, recipients: string[]): Promise<EmailGateOutcome> {
  const meta: SafeguardMeta = { ...(payload.safeguard ?? {}), ...(payload.critical ? { messageClass: "SECURITY" as const } : {}) };
  const oversized = await refuseOversizedSend("EMAIL", recipients, payload.subject, meta);
  if (oversized && !oversized.allowed) return { kind: "suppressed", result: suppressedResult(oversized.reason, false) };
  const allowed: string[] = [];
  const eventIds: Array<string | null> = [];
  let first: { reason: SuppressionReason; held: boolean } | null = null;
  const holdable = recipients.length === 1 && !payload.attachments?.length;
  for (const address of recipients) {
    const hold: HeldPayload | null = holdable
      ? { transport: "EMAIL", to: address, subject: payload.subject, html: payload.html, replyTo: payload.replyTo, from: payload.from, kind: payload.kind, transactional: payload.transactional }
      : null;
    const decision = await guardOutbound({
      transport: "EMAIL", recipient: address, meta, hints: { emailKind: payload.kind ?? null },
      subject: payload.subject, content: payload.html, holdPayload: hold,
    });
    if (decision.allowed) {
      allowed.push(address);
      eventIds.push(decision.eventId);
    } else if (!first) {
      first = { reason: decision.reason, held: decision.held };
    }
  }
  if (allowed.length === 0) return { kind: "suppressed", result: suppressedResult(first?.reason ?? "SAFEGUARD_UNAVAILABLE", first?.held ?? false) };
  return { kind: "send", to: allowed, eventIds };
}

/** Non-production only: every email goes to one sandbox inbox, marked with the real recipients. */
function applySandbox(payload: EmailPayload, to: string[]): { to: string[]; subject: string } {
  const sandbox = process.env.SNEEK_OUTBOUND_SANDBOX_EMAIL?.trim();
  if (!sandbox) return { to, subject: payload.subject };
  return { to: [sandbox], subject: `[Sandbox for ${to.join(", ")}] ${payload.subject}` };
}

async function recordEmailOutcome(eventIds: Array<string | null>, acceptance: "ACCEPTED" | "NOT_ACCEPTED" | "UNKNOWN") {
  const outcome = acceptance === "UNKNOWN" ? "UNCERTAIN" : acceptance;
  await Promise.all(eventIds.map((eventId) => recordOutboundOutcome(eventId, outcome)));
}

export async function sendEmailDetailed(
  payload: EmailPayload
): Promise<EmailSendResult> {
  let dispatchStarted = false;
  let eventIds: Array<string | null> = [];
  try {
    const resend = getResendClient();
    if (!resend) {
      logger.warn({ to: payload.to, subject: payload.subject }, "Email skipped because RESEND_API_KEY is not configured");
      return { ok: false, error: "RESEND_API_KEY is not configured", acceptance: "NOT_ACCEPTED", retryable: false };
    }

    // Automatic emails are gated on the admin's email-automation settings
    // (master switch + per-type switch). Manual sends carry no `kind`.
    if (payload.kind) {
      const settings = await getAppSettings();
      if (!isAutoEmailAllowed(settings.emailAutomation, payload.kind)) {
        logger.info(
          { to: payload.to, subject: payload.subject, kind: payload.kind },
          "Auto email skipped — disabled in email-automation settings"
        );
        return { ok: false, skipped: true, error: "auto-email-disabled" };
      }
    }

    // Audience-level gating (global email master + per-audience email toggle).
    // Applied IN ADDITION to the EmailAutoKind gating above. `critical` emails
    // (auth / recovery) bypass this entirely so a login/recovery flow can never
    // be locked out by an audience toggle.
    if (!payload.critical) {
      const settings = await getAppSettings();
      const controls = settings.notificationAudienceControls;
      const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
      // Resolve each recipient's audience and keep only those still allowed to
      // receive email. A pre-resolved single-recipient audience skips the lookup.
      const allowed: string[] = [];
      const blocked: string[] = [];
      for (const address of recipients) {
        // A caller-supplied audience saves the lookup, but ONLY when there are
        // no per-person questions to answer — otherwise we still need the row.
        const canSkipLookup =
          recipients.length === 1 && Boolean(payload.audience) && !payload.kind;
        const resolved = canSkipLookup
          ? null
          : await resolveRecipient(address);
        const audience = resolved?.audience ?? payload.audience!;

        if (!isChannelAllowed(controls, audience, "email")) {
          blocked.push(address);
          continue;
        }
        // Per-audience override of this kind: "cleaners don't need inventory
        // mail" without also silencing the ops manager who does.
        if (payload.kind && !isAudienceKindAllowed(settings.emailAutomation, audience, payload.kind)) {
          blocked.push(address);
          continue;
        }
        // The person's own choice, which is the narrowest and therefore the
        // last word.
        //
        // `allEmailOff` means "stop emailing me entirely", so it is checked
        // WITHOUT requiring a kind. It used to sit behind `payload.kind &&`,
        // which meant every automatic email that forgot to declare its kind
        // sailed past someone who had asked to receive nothing at all — and
        // "no kind" is exactly the case `allEmailOff` exists to cover. Critical
        // mail (auth, recovery) never reaches here, so nobody can lock
        // themselves out with it.
        if (resolved?.allEmailOff) {
          blocked.push(address);
          continue;
        }
        // A per-kind row covers the one kind they named.
        if (payload.kind && resolved?.disabledKinds.has(payload.kind)) {
          blocked.push(address);
          continue;
        }
        allowed.push(address);
      }
      if (allowed.length === 0) {
        // Every recipient is in a silenced audience — skip entirely.
        logger.info(
          { to: payload.to, subject: payload.subject, blocked },
          "Email skipped — all recipients in an audience with email disabled"
        );
        return { ok: false, skipped: true, error: "audience_disabled" };
      }
      if (blocked.length > 0) {
        logger.info(
          { blocked, subject: payload.subject },
          "Some recipients in a silenced audience; sending to remainder"
        );
        payload = { ...payload, to: allowed };
      }
    }

    // Gate non-transactional sends on the suppression list.
    if (!payload.transactional) {
      const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
      const checks = await Promise.all(recipients.map((r) => isSuppressed(r)));
      const blocked = recipients.filter((_, i) => checks[i]);
      if (blocked.length === recipients.length) {
        // All recipients suppressed — skip entirely.
        logger.warn(
          { to: payload.to, subject: payload.subject, blocked },
          "Email skipped because all recipients are on the suppression list"
        );
        return { ok: false, skipped: true, error: "suppressed" };
      }
      if (blocked.length > 0) {
        // Some suppressed — log and continue with only the allowed ones.
        logger.warn(
          { blocked, subject: payload.subject },
          "Some recipients on suppression list; sending to remainder"
        );
        payload = {
          ...payload,
          to: recipients.filter((_, i) => !checks[i]),
        };
      }
    }

    // Campaign email also stops for addresses that unsubscribed from campaigns
    // (that opt-out never stops operational or security email).
    if (payload.marketing) {
      const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
      const checks = await Promise.all(recipients.map((r) => isMarketingSuppressed(r)));
      const remaining = recipients.filter((_, i) => !checks[i]);
      if (remaining.length === 0) return { ok: false, skipped: true, error: "unsubscribed_from_campaigns" };
      payload = { ...payload, to: remaining };
    }

    // Render at send time (published design and Email look, Company details,
    // plain-text part). A design with an empty required value is refused here,
    // never sent with a blank (lib/email-design).
    const prepared = await prepareOutgoingEmail({
      to: Array.isArray(payload.to) ? payload.to : [payload.to],
      subject: payload.subject,
      html: payload.html,
      critical: payload.critical,
      marketing: payload.marketing,
    });
    if (prepared.missing.length > 0) {
      logger.warn({ subject: payload.subject, design: prepared.designKey, missing: prepared.missing }, "Email not sent: required values are missing");
      return { ok: false, error: `Not sent: required values are missing (${prepared.missing.join(", ")}).`, acceptance: "NOT_ACCEPTED", retryable: false };
    }

    // The sending safeguards: caps, duplicates, pauses, emergency stop, quiet hours.
    const gate = await applySendingSafeguards(payload, Array.isArray(payload.to) ? payload.to : [payload.to]);
    if (gate.kind === "suppressed") return gate.result;
    eventIds = gate.eventIds;
    const target = applySandbox({ ...payload, subject: prepared.subject }, gate.to);
    const replyTo = payload.replyTo ?? (prepared.security ? undefined : prepared.theme.replyTo || prepared.settings.accountsEmail || undefined);
    const headers = Object.keys(prepared.headers).length ? prepared.headers : undefined;

    dispatchStarted = true;
    const response = await resend.emails.send({
      from: payload.from ?? senderAddress(FROM, prepared.theme.senderName),
      to: target.to,
      subject: target.subject,
      html: prepared.html,
      text: payload.text ?? prepared.text,
      replyTo,
      ...(headers ? { headers } : {}),
      attachments: payload.attachments,
    });
    if (response.error) {
      // SDK errors may be returned instead of thrown. Server failures are
      // uncertain; only explicit validation/auth/rate rejection proves no send.
      const knownRejection = ["missing_required_field", "invalid_access", "invalid_parameter", "invalid_region", "rate_limit_exceeded", "missing_api_key", "invalid_api_Key", "invalid_from_address", "validation_error", "not_found", "method_not_allowed"].includes(response.error.name);
      await recordEmailOutcome(eventIds, knownRejection ? "NOT_ACCEPTED" : "UNKNOWN");
      return { ok: false, error: response.error.message, acceptance: knownRejection ? "NOT_ACCEPTED" : "UNKNOWN", retryable: response.error.name === "rate_limit_exceeded" };
    }
    if (!response.data?.id) {
      await recordEmailOutcome(eventIds, "UNKNOWN");
      return { ok: false, error: "Email provider acceptance could not be confirmed.", acceptance: "UNKNOWN" };
    }
    await recordEmailOutcome(eventIds, "ACCEPTED");
    return { ok: true, externalId: response.data.id, acceptance: "ACCEPTED" };
  } catch (err: any) {
    if (dispatchStarted) await recordEmailOutcome(eventIds, "UNKNOWN");
    logger.error({ err, payload }, "Failed to send email");
    return { ok: false, error: err?.message ?? "Unknown email provider error", acceptance: dispatchStarted ? "UNKNOWN" : "NOT_ACCEPTED", retryable: !dispatchStarted };
  }
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const result = await sendEmailDetailed(payload);
  return result.ok;
}
