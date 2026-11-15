import "server-only";
import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { AccountCreateError, createAccountWithInvitation } from "@/lib/accounts/create-account";
import type { AccountCreateOutcome } from "@/lib/accounts/create-account-rules";
import { canEditClientPaymentTerms } from "@/lib/billing/client-payment-terms";
import { CLIENT_PAYMENT_TERMS_MAX_DAYS, CLIENT_PAYMENT_TERMS_MIN_DAYS } from "@/lib/billing/invoice-due";
import { hasActiveXeroConnection, readXeroContact } from "@/lib/xero/client";
import { companyDomain, nameWords, phoneDigits, rankDuplicates, type DuplicateCandidate, type DuplicateMatch } from "./duplicate-rules";

/**
 * Add client (board "Add client", 2026-11-16): the client, its payment terms,
 * an optional existing Xero contact link, the client's notification
 * preferences and, when switched on, a portal login with the shared 7-day
 * invitation link (no temporary password). One transaction; repeat-safe with
 * an idempotency key (a double click or a retry returns the first client).
 */

export class ClientCreateError extends Error {
  constructor(readonly status: number, message: string, readonly field?: string) {
    super(message);
  }
}

export type ClientNotificationChoices = {
  /** "Booking confirmations and job updates, by email": the client's master switch. */
  jobUpdates: boolean;
  enRoute: boolean;
  startFinish: boolean;
  liveLocation: boolean;
};

export type ClientCreateInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  notes?: string | null;
  /** undefined = not set here (organisation default); null = organisation default; a number = the client's own terms. */
  paymentTermsDays?: number | null;
  xeroContactId?: string | null;
  portalLogin: boolean;
  notifications?: ClientNotificationChoices | null;
  portalVisibilityOverrides?: Prisma.InputJsonValue;
};

export type ClientCreateResult = {
  client: { id: string; name: string; email: string | null };
  replayed: boolean;
  login: AccountCreateOutcome | null;
  xeroLinked: boolean;
};

type Actor = { id: string; role: string; heldRoles?: string[] };

/** Existing clients that look like this one (warn only). */
export async function findSimilarClients(candidate: DuplicateCandidate): Promise<DuplicateMatch[]> {
  const or: Prisma.ClientWhereInput[] = [];
  const email = candidate.email?.trim().toLowerCase();
  if (email) or.push({ email: { equals: email, mode: "insensitive" } });
  const domain = companyDomain(email);
  if (domain) or.push({ email: { endsWith: `@${domain}`, mode: "insensitive" } });
  const phone = phoneDigits(candidate.phone);
  if (phone) or.push({ phone: { contains: phone.slice(-8) } });
  const first = nameWords(candidate.name)[0];
  if (first) or.push({ name: { contains: first, mode: "insensitive" } });
  if (or.length === 0) return [];
  const rows = await db.client.findMany({
    where: { OR: or },
    take: 25,
    select: { id: true, name: true, email: true, phone: true, isActive: true, _count: { select: { properties: true } } },
  });
  return rankDuplicates(candidate, rows.map((row) => ({ id: row.id, name: row.name, email: row.email, phone: row.phone, isActive: row.isActive, propertyCount: row._count.properties })));
}

async function priorClientFor(tx: Pick<Prisma.TransactionClient, "auditLog">, actorId: string, key: string): Promise<string | null> {
  const row = await tx.auditLog.findFirst({
    where: { userId: actorId, action: { in: ["CREATE_CLIENT", "CREATE_CLIENT_WITH_INVITE"] }, after: { path: ["idempotencyKey"], equals: key } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true },
  });
  return row?.entityId ?? null;
}

async function replay(clientId: string): Promise<ClientCreateResult> {
  const client = await db.client.findUnique({ where: { id: clientId }, select: { id: true, name: true, email: true, xeroContactId: true } });
  if (!client) throw new ClientCreateError(409, "The earlier attempt's client no longer exists.");
  return { client: { id: client.id, name: client.name, email: client.email }, replayed: true, login: null, xeroLinked: Boolean(client.xeroContactId) };
}

function clientData(input: ClientCreateInput, email: string | null, xeroContactId: string | null): Prisma.ClientCreateInput {
  return {
    name: input.name.trim(),
    email: email || undefined,
    phone: input.phone || undefined,
    address: input.address || undefined,
    suburb: input.suburb || undefined,
    state: input.state || undefined,
    postcode: input.postcode || undefined,
    latitude: input.latitude ?? undefined,
    longitude: input.longitude ?? undefined,
    placeId: input.placeId ?? undefined,
    notes: input.notes || undefined,
    portalVisibilityOverrides: input.portalVisibilityOverrides ?? undefined,
    paymentTermsDays: typeof input.paymentTermsDays === "number" ? input.paymentTermsDays : null,
    showCleanerLiveLocation: input.notifications?.liveLocation === true,
    xeroContactId: xeroContactId ?? undefined,
    xeroSyncedAt: xeroContactId ? new Date() : undefined,
  };
}

async function writeClient(tx: Prisma.TransactionClient, actorId: string, input: ClientCreateInput, email: string | null, xeroContactId: string | null, key: string | null) {
  const client = await tx.client.create({ data: clientData(input, email, xeroContactId), select: { id: true, name: true, email: true } });
  if (input.notifications) {
    await tx.clientNotificationPreference.create({
      data: {
        clientId: client.id,
        notificationsEnabled: input.notifications.jobUpdates,
        notifyOnEnRoute: input.notifications.enRoute,
        notifyOnJobStart: input.notifications.startFinish,
        notifyOnJobComplete: input.notifications.startFinish,
        preferredChannel: "EMAIL",
      },
    });
  }
  await tx.auditLog.create({
    data: {
      userId: actorId,
      action: input.portalLogin ? "CREATE_CLIENT_WITH_INVITE" : "CREATE_CLIENT",
      entity: "Client",
      entityId: client.id,
      after: {
        email,
        invited: input.portalLogin,
        signIn: input.portalLogin ? "INVITATION_LINK" : null,
        paymentTermsDays: typeof input.paymentTermsDays === "number" ? input.paymentTermsDays : null,
        xeroContactId,
        notifications: input.notifications ?? null,
        idempotencyKey: key,
      } as Prisma.InputJsonValue,
    },
  });
  return client;
}

export async function createClientWithLogin(input: ClientCreateInput, actor: Actor, idempotencyKey: string | null): Promise<ClientCreateResult> {
  const email = input.email?.trim().toLowerCase() || null;
  if (input.portalLogin && !email) throw new ClientCreateError(400, "A portal login needs an email. Add one, or switch the login off.", "email");
  const terms = input.paymentTermsDays;
  if (typeof terms === "number") {
    if (!Number.isInteger(terms) || terms < CLIENT_PAYMENT_TERMS_MIN_DAYS || terms > CLIENT_PAYMENT_TERMS_MAX_DAYS) {
      throw new ClientCreateError(400, `Payment terms must be 0 to ${CLIENT_PAYMENT_TERMS_MAX_DAYS} days, or the default.`, "paymentTermsDays");
    }
    if (!(await canEditClientPaymentTerms(actor))) {
      throw new ClientCreateError(403, "Only an administrator, or an operations manager who manages finance, can set payment terms.", "paymentTermsDays");
    }
  }
  let xeroContactId: string | null = null;
  if (input.xeroContactId) {
    if (!(await canEditClientPaymentTerms(actor))) throw new ClientCreateError(403, "Only an administrator, or an operations manager who manages finance, can link a Xero contact.", "xeroContactId");
    if (!(await hasActiveXeroConnection())) throw new ClientCreateError(409, "Xero is not connected, so no contact can be linked. Leave it for the Xero sync.", "xeroContactId");
    // Read-only check that the contact exists; nothing is created or changed in Xero.
    const checked = await readXeroContact(input.xeroContactId);
    if (!checked.ok) throw new ClientCreateError(409, `The Xero contact could not be checked: ${checked.reason} Nothing was added.`, "xeroContactId");
    xeroContactId = checked.contact.id;
  }

  if (!input.portalLogin) {
    const created = await db.$transaction(async (tx) => {
      if (idempotencyKey) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`create-client:${actor.id}:${idempotencyKey}`}))`;
        const prior = await priorClientFor(tx, actor.id, idempotencyKey);
        if (prior) return { priorId: prior, client: null };
      }
      return { priorId: null, client: await writeClient(tx, actor.id, input, email, xeroContactId, idempotencyKey) };
    });
    if (created.priorId) return replay(created.priorId);
    if (!created.client) throw new ClientCreateError(500, "The client was not recorded.");
    return { client: created.client, replayed: false, login: null, xeroLinked: Boolean(xeroContactId) };
  }

  let createdClient: { id: string; name: string; email: string | null } | null = null;
  try {
    const login = await createAccountWithInvitation({
      actor: { id: actor.id, role: actor.role === "ADMIN" || actor.heldRoles?.includes("ADMIN") ? "ADMIN" : "OPS_MANAGER" },
      origin: "ADD_CLIENT",
      idempotencyKey,
      purpose: "client-login",
      input: { name: input.name, email: email!, phone: input.phone ?? null, role: Role.CLIENT, signIn: "INVITATION", sendSms: false },
      beforeInsert: async (tx) => {
        createdClient = await writeClient(tx, actor.id, input, email, xeroContactId, idempotencyKey);
        return { clientId: createdClient.id };
      },
    });
    if (login.replayed) {
      const user = await db.user.findUnique({ where: { id: login.user.id }, select: { clientId: true } });
      if (!user?.clientId) throw new ClientCreateError(409, "The earlier attempt's client could not be found.");
      return { ...(await replay(user.clientId)), login };
    }
    const client = createdClient as { id: string; name: string; email: string | null } | null;
    if (!client) throw new ClientCreateError(500, "The client was not recorded.");
    return { client, replayed: false, login, xeroLinked: Boolean(xeroContactId) };
  } catch (error) {
    if (error instanceof AccountCreateError) throw new ClientCreateError(error.status, error.message, error.code === "EMAIL_IN_USE" ? "email" : undefined);
    throw error;
  }
}
