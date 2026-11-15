import "server-only";
/**
 * "Send a link to the client to fill their part" (2026-11-16).
 *
 * The office chooses the parts, the recipient, how long the link works
 * (default 7 days) and email or SMS explicitly. The link opens a public page
 * with no login. Only an HMAC-SHA256 of the token (keyed with the server
 * secret) is stored, so the token is useless without the server and a stored
 * hash cannot be turned back into a link. Every public request resolves the
 * survey from the token alone (never from an id the browser sends), is rate
 * limited, and sees only the parts the office ticked. Pricing, rates, laundry
 * partner, cleaner form, notes and every existing code are never sent. Codes
 * the client types are encrypted at once and wait for the office's review.
 * "I'm finished" tells the office in its inbox only; it activates nothing.
 */
import { createHmac, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAppSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/security/rate-limit";
import { externalTransportAvailability, maskContact, sendExternalRecipientMessage, type ExternalTransport } from "@/lib/notifications/external-recipient";
import { CLIENT_LINK_SECTION_LABELS, isClientLinkSection, type ClientLinkSection } from "./sections";
import { computeReadiness } from "./readiness";
import { editStateFromRow, linkIsOpen, loadSurveyRow, OnboardingWorkspaceError, readinessSnapshot, saveWorkspaceSection, type SurveyRow } from "./service";
import { clientSaveSchema } from "./schemas";
import type { AccessEntryInput } from "./values";
import { sendOnboardingClientFinishedNotice } from "./client-link-notice";

export const CLIENT_LINK_PATH = "/onboarding-link";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function linkSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret || secret.length < 16) throw new OnboardingWorkspaceError(503, "Client links are not available: the server has no signing secret.");
  return secret;
}

export function hashClientLinkToken(token: string): string {
  return createHmac("sha256", linkSecret()).update(`onboarding-link:${token}`).digest("hex");
}

export function newClientLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

function appBaseUrl(): string {
  return (process.env.APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

export type CreateClientLinkInput = {
  surveyId: string;
  actorUserId: string;
  sections: ClientLinkSection[];
  transport: ExternalTransport;
  recipient: string;
  days: number;
  idempotencyKey: string;
  now?: Date;
};

export type CreateClientLinkResult = {
  linkId: string;
  expiresAt: string;
  delivery: { state: string; errorCode: string | null };
};

export async function createClientLink(input: CreateClientLinkInput): Promise<CreateClientLinkResult> {
  const now = input.now ?? new Date();
  const row = await db.propertyOnboardingSurvey.findUnique({ where: { id: input.surveyId }, select: { id: true, status: true, propertyName: true, propertyAddress: true } });
  if (!row) throw new OnboardingWorkspaceError(404, "This onboarding no longer exists.");
  if (row.status !== "DRAFT" && row.status !== "PENDING_REVIEW") throw new OnboardingWorkspaceError(409, "Links can only be sent while the onboarding is open.");
  const availability = (await externalTransportAvailability())[input.transport];
  if (!availability.available) throw new OnboardingWorkspaceError(409, availability.reason ?? "That way of sending is not available.");

  const token = newClientLinkToken();
  const expiresAt = new Date(now.getTime() + input.days * 24 * 60 * 60_000);
  const sections = Array.from(new Set(input.sections));
  const link = await db.onboardingClientLink.create({
    data: {
      surveyId: row.id,
      tokenHash: hashClientLinkToken(token),
      sections,
      transport: input.transport,
      recipientMasked: maskContact(input.recipient),
      expiresAt,
      createdById: input.actorUserId,
      createdAt: now,
    },
  });
  const settings = await getAppSettings();
  const company = settings.companyName || "sNeek";
  const place = row.propertyName || row.propertyAddress || "your property";
  const url = `${appBaseUrl()}${CLIENT_LINK_PATH}/${token}`;
  const parts = sections.map((section) => CLIENT_LINK_SECTION_LABELS[section].toLowerCase()).join(", ");
  const body =
    input.transport === "SMS"
      ? `${company}: please fill in a few details for ${place} (${parts}). ${url} The link works for ${input.days} days.`
      : `Hello,\n\nTo get ${place} ready, ${company} would like you to fill in these parts: ${parts}.\n\nOpen this link (no login needed): ${url}\n\nYour answers save as you type. The link works for ${input.days} days.\n\nThank you.`;
  let delivery: { state: string; errorCode: string | null };
  try {
    const sent = await sendExternalRecipientMessage({
      kind: "onboarding.client_link",
      actorId: input.actorUserId,
      entityId: row.id,
      jobId: null,
      transport: input.transport,
      to: input.recipient,
      subject: `Help us get ${place} ready`,
      body,
      idempotencyKey: `onb-link:${input.idempotencyKey}`,
      audit: { linkId: link.id, sections, expiresAt: expiresAt.toISOString() },
      now,
    });
    delivery = { state: sent.state, errorCode: sent.errorCode };
  } catch (error) {
    // Nothing reached the client: revoke the link so a token nobody holds cannot linger.
    await db.onboardingClientLink.update({ where: { id: link.id }, data: { revokedAt: now, deliveryState: "failed", deliveryError: error instanceof Error ? error.message.slice(0, 300) : "Not sent" } });
    throw error instanceof Error && "status" in error ? new OnboardingWorkspaceError((error as { status: number }).status, error.message) : error;
  }
  await db.onboardingClientLink.update({ where: { id: link.id }, data: { deliveryState: delivery.state, deliveryError: delivery.errorCode } });
  return { linkId: link.id, expiresAt: expiresAt.toISOString(), delivery };
}

export async function revokeClientLink(input: { surveyId: string; linkId: string; actorUserId: string; now?: Date }): Promise<{ revokedAt: string }> {
  const now = input.now ?? new Date();
  const link = await db.onboardingClientLink.findFirst({ where: { id: input.linkId, surveyId: input.surveyId } });
  if (!link) throw new OnboardingWorkspaceError(404, "That link no longer exists.");
  if (link.revokedAt) return { revokedAt: link.revokedAt.toISOString() };
  await db.onboardingClientLink.update({ where: { id: link.id }, data: { revokedAt: now, revokedById: input.actorUserId } });
  await db.auditLog.create({ data: { userId: input.actorUserId, action: "ONBOARDING_CLIENT_LINK_REVOKED", entity: "PropertyOnboardingSurvey", entityId: input.surveyId, after: { linkId: link.id } } });
  return { revokedAt: now.toISOString() };
}

export type ResolvedLink =
  | { state: "open"; link: Prisma.OnboardingClientLinkGetPayload<object>; survey: SurveyRow }
  | { state: "invalid" | "revoked" | "expired" | "closed" };

export const CLIENT_LINK_REFUSALS: Record<Exclude<ResolvedLink["state"], "open">, string> = {
  invalid: "This link is not valid. Contact the office.",
  revoked: "This link is no longer active. Contact the office.",
  expired: "This link has expired. Contact the office for a new one.",
  closed: "This link is no longer active. Contact the office.",
};

export async function resolveClientLink(token: string, now: Date = new Date()): Promise<ResolvedLink> {
  if (!TOKEN_PATTERN.test(token)) return { state: "invalid" };
  const link = await db.onboardingClientLink.findUnique({ where: { tokenHash: hashClientLinkToken(token) } });
  if (!link) return { state: "invalid" };
  if (link.revokedAt) return { state: "revoked" };
  if (!linkIsOpen(link, now)) return { state: "expired" };
  const survey = await loadSurveyRow(db, link.surveyId);
  if (!survey || (survey.status !== "DRAFT" && survey.status !== "PENDING_REVIEW")) return { state: "closed" };
  return { state: "open", link, survey };
}

/** Per link and per address: 60 requests a minute, 600 an hour. */
export function clientLinkRateLimited(token: string, ip: string): boolean {
  const key = token.slice(0, 12);
  return (
    !rateLimit(`onb-link:min:${key}:${ip}`, { limit: 60, windowMs: 60_000 }).ok ||
    !rateLimit(`onb-link:hour:${key}`, { limit: 600, windowMs: 60 * 60_000 }).ok
  );
}

export type ClientLinkPageView = {
  companyName: string;
  officePhone: string | null;
  clientName: string | null;
  propertyName: string;
  askedByName: string | null;
  expiresAt: string;
  finishedAt: string | null;
  revision: number;
  sections: Array<{ key: ClientLinkSection; label: string; done: boolean }>;
  access?: { officeEntryCount: number; entries: Array<{ id: string; kind: string; where: string; hasCode: boolean; photos: Array<{ url: string; key: string }> }> };
  photos?: { slots: Array<{ id: string; room: string; caption: string; officePhoto: boolean; clientPhoto: { url: string; key: string } | null }> };
  rules?: { hazards: string; buildingRules: string; hasPets: boolean; petDetails: string; binDay: string; parkingInstructions: string };
  linen?: { linenSets: number | null; linenBufferSets: number | null };
  calendar?: { hasCalendarLink: boolean };
};

function sectionDone(section: ClientLinkSection, survey: SurveyRow): boolean {
  const state = editStateFromRow(survey);
  const readiness = computeReadiness(readinessSnapshot(survey, state));
  const scenarios = (state.meta.scenarios ?? {}) as Record<string, unknown>;
  switch (section) {
    case "access":
      return readiness.items.some((item) => item.section === "access" && item.required && item.state === "done") || state.workspace.access.some((entry) => entry.source === "CLIENT_SUBMITTED");
    case "photos":
      return state.workspace.roomPhotos.length > 0 && state.workspace.roomPhotos.every((photo) => photo.photo);
    case "rules":
      return Boolean(state.workspace.houseRules.hazards.trim() || state.workspace.houseRules.buildingRules.trim());
    case "linen":
      return typeof scenarios.linenSets === "number";
    case "calendar":
      return Boolean(state.icalUrl);
  }
}

/** The client's page: only the ticked parts, only their own fields. Records the open. */
export async function clientLinkPageView(resolved: Extract<ResolvedLink, { state: "open" }>, now: Date = new Date()): Promise<ClientLinkPageView> {
  const { link, survey } = resolved;
  await db.onboardingClientLink.update({ where: { id: link.id }, data: { lastOpenedAt: now, ...(link.firstOpenedAt ? {} : { firstOpenedAt: now }) } });
  const settings = await getAppSettings();
  const asker = await db.user.findUnique({ where: { id: link.createdById }, select: { name: true } });
  const state = editStateFromRow(survey);
  const scenarios = (state.meta.scenarios ?? {}) as Record<string, unknown>;
  const sections = link.sections.filter(isClientLinkSection);
  const view: ClientLinkPageView = {
    companyName: settings.companyName || "sNeek",
    officePhone: settings.companyPhone || null,
    clientName: survey.isNewClient ? (survey.clientData as { name?: string } | null)?.name ?? null : survey.existingClient?.name ?? null,
    propertyName: survey.propertyName || survey.propertySuburb || "your property",
    askedByName: asker?.name ?? null,
    expiresAt: link.expiresAt.toISOString(),
    finishedAt: link.finishedAt?.toISOString() ?? null,
    revision: survey.revision,
    sections: sections.map((key) => ({ key, label: CLIENT_LINK_SECTION_LABELS[key], done: sectionDone(key, survey) })),
  };
  if (sections.includes("access")) {
    view.access = {
      officeEntryCount: state.workspace.access.filter((entry) => entry.source !== "CLIENT_SUBMITTED").length + survey.accessDetails.length,
      entries: state.workspace.access
        .filter((entry) => entry.source === "CLIENT_SUBMITTED")
        .map((entry) => ({ id: entry.id, kind: entry.kind, where: entry.where, hasCode: Boolean(entry.codeCipher), photos: entry.photos.map((photo) => ({ url: photo.url, key: photo.key })) })),
    };
  }
  if (sections.includes("photos")) {
    view.photos = {
      slots: state.workspace.roomPhotos.map((slot) => ({
        id: slot.id,
        room: slot.room,
        caption: slot.caption,
        officePhoto: Boolean(slot.photo && slot.photo.source !== "CLIENT_SUBMITTED"),
        clientPhoto: slot.photo && slot.photo.source === "CLIENT_SUBMITTED" ? { url: slot.photo.url, key: slot.photo.key } : null,
      })),
    };
  }
  if (sections.includes("rules")) {
    view.rules = {
      hazards: state.workspace.houseRules.hazards,
      buildingRules: state.workspace.houseRules.buildingRules,
      hasPets: scenarios.hasPets === true,
      petDetails: typeof scenarios.petDetails === "string" ? scenarios.petDetails : "",
      binDay: typeof scenarios.binDay === "string" ? scenarios.binDay : "",
      parkingInstructions: typeof scenarios.parkingInstructions === "string" ? scenarios.parkingInstructions : "",
    };
  }
  if (sections.includes("linen")) {
    view.linen = { linenSets: typeof scenarios.linenSets === "number" ? scenarios.linenSets : null, linenBufferSets: typeof scenarios.linenBufferSets === "number" ? scenarios.linenBufferSets : null };
  }
  if (sections.includes("calendar")) view.calendar = { hasCalendarLink: Boolean(state.icalUrl) };
  return view;
}

/** Photos the client uploads live under this prefix; any other key is refused. */
export function clientPhotoPrefix(surveyId: string, linkId: string): string {
  return `onboarding/client/${surveyId}/${linkId}/`;
}

/** Save one client part. The survey comes from the token; ids in the body only name the client's own entries. */
export async function saveClientLinkSection(resolved: Extract<ResolvedLink, { state: "open" }>, body: unknown, now: Date = new Date()) {
  const parsed = clientSaveSchema.safeParse(body);
  if (!parsed.success) throw new OnboardingWorkspaceError(400, "Some answers could not be read. Check them and try again.");
  const input = parsed.data;
  const { link, survey } = resolved;
  if (!link.sections.includes(input.section)) throw new OnboardingWorkspaceError(403, "The office did not ask for this part.");
  const state = editStateFromRow(survey);
  const actor = { source: "CLIENT_SUBMITTED" as const, userId: null, clientLinkId: link.id };
  const prefix = clientPhotoPrefix(survey.id, link.id);
  const ownPhoto = (photo: { key: string }) => photo.key.startsWith(prefix);
  const save = (section: Parameters<typeof saveWorkspaceSection>[0]["section"], values: unknown) =>
    saveWorkspaceSection({ surveyId: survey.id, section, values, baseRevision: survey.revision, actor, now });

  switch (input.section) {
    case "access": {
      const officeEntries = state.workspace.access.filter((entry) => entry.source !== "CLIENT_SUBMITTED");
      const officeIds = new Set(officeEntries.map((entry) => entry.id));
      if (input.entries.some((entry) => officeIds.has(entry.id))) throw new OnboardingWorkspaceError(403, "Only details you added can be changed here.");
      if (input.entries.some((entry) => !entry.photos.every(ownPhoto))) throw new OnboardingWorkspaceError(400, "A photo did not come from this link. Add it again.");
      const entries: AccessEntryInput[] = [
        ...officeEntries.map((entry) => ({ id: entry.id, kind: entry.kind, where: entry.where, photos: entry.photos })),
        ...input.entries.map((entry) => ({
          id: entry.id,
          kind: entry.kind as AccessEntryInput["kind"],
          where: entry.where,
          photos: entry.photos.map((photo) => ({ ...photo, source: "CLIENT_SUBMITTED" as const })),
          ...(entry.code !== undefined ? { code: entry.code } : {}),
        })),
      ];
      return save("access", { entries });
    }
    case "photos": {
      const slots = state.workspace.roomPhotos.map((slot) => {
        const update = input.photos.find((candidate) => candidate.id === slot.id);
        if (!update) return slot;
        if (slot.photo && slot.photo.source !== "CLIENT_SUBMITTED") return slot;
        if (update.photo && !ownPhoto(update.photo)) throw new OnboardingWorkspaceError(400, "A photo did not come from this link. Add it again.");
        return { ...slot, photo: update.photo ? { ...update.photo, source: "CLIENT_SUBMITTED" as const } : null };
      });
      return save("photos", { roomPhotos: slots });
    }
    case "rules":
      return save("rules", input.values);
    case "linen":
      return save("laundry", input.values);
    case "calendar":
      return save("calendar", { icalUrl: input.icalUrl });
  }
}

/** "I'm finished": records it once and tells the office in its inbox. Activates nothing. */
export async function finishClientLink(resolved: Extract<ResolvedLink, { state: "open" }>, now: Date = new Date()) {
  const { link, survey } = resolved;
  const claimed = await db.onboardingClientLink.updateMany({ where: { id: link.id, finishedAt: null }, data: { finishedAt: now } });
  if (claimed.count === 0) return { finishedAt: link.finishedAt?.toISOString() ?? now.toISOString(), notice: "already_sent" as const };
  const outcomes = await sendOnboardingClientFinishedNotice({
    surveyId: survey.id,
    surveyNumber: survey.surveyNumber,
    linkId: link.id,
    propertyName: survey.propertyName || survey.propertyAddress || survey.surveyNumber,
    sections: link.sections.filter(isClientLinkSection).map((section) => CLIENT_LINK_SECTION_LABELS[section]),
  });
  return { finishedAt: now.toISOString(), notice: outcomes.length ? ("queued" as const) : ("no_recipients" as const) };
}
