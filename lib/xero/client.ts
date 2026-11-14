import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { decryptSecret } from "@/lib/security/encryption";
import { matchXeroDocuments, type XeroDocumentRead, type XeroReadFailure } from "./xero-documents";
import { getXeroCredentials } from "./credentials";
import {
  XERO_TOKEN_URL,
  getXeroAccessToken,
  safeReason,
  sealXeroToken,
  verifyXeroTenant,
  xeroTokenEncryptionAvailable,
  xeroTokenFailureMessage,
  type XeroAccessToken,
  type XeroTokenFailure,
} from "./token-service";
import { buildXeroStatus, type XeroStatus } from "./connection-status";

export { xeroSignInMessage, xeroSignInState, type XeroSignIn, type XeroStatus } from "./connection-status";

const XERO_BASE = "https://api.xero.com";
// Authorize lives on login.xero.com; the token + revocation endpoints live on
// identity.xero.com (posting the token exchange to login.xero.com/connect/token
// 404s and surfaces as a generic "exchange failed").
const XERO_AUTH_BASE = "https://login.xero.com";
const XERO_REVOKE_URL = "https://identity.xero.com/connect/revocation";

/**
 * OAuth scopes we request.
 *   - offline_access      → a refresh token, so the connection renews itself
 *     (lib/xero/token-service.ts) instead of lapsing when the 30-minute access
 *     token expires. A connection made without it cannot be upgraded: it must
 *     be reconnected once.
 *   - accounting.contacts → create/read client & cleaner contacts
 *   - accounting.invoices → create/read invoices (ACCREC) & bills (ACCPAY)
 *   - accounting.settings.read → the chart of accounts (Wave D)
 *
 * If a Xero app ever refuses offline_access with "invalid_scope", set
 * XERO_REQUEST_OFFLINE_ACCESS=false to connect without it (the old, lapsing
 * behaviour) while the app is fixed.
 */
export function xeroScopes(env: Record<string, string | undefined> = process.env): string {
  // accounting.settings.read (Wave D): read the chart of accounts so the
  // invoice editor can name the sales account. XERO_REQUEST_SETTINGS_READ=false
  // leaves it out if an app refuses it (the editor then shows the code with
  // "name unavailable").
  const settings = env.XERO_REQUEST_SETTINGS_READ === "false" ? "" : " accounting.settings.read";
  const base = `accounting.contacts accounting.invoices${settings}`;
  return env.XERO_REQUEST_OFFLINE_ACCESS === "false" ? base : `offline_access ${base}`;
}

/** Pull a human-readable message out of Xero's various error response shapes. */
function extractXeroError(raw: string): string {
  if (!raw) return "no response body";
  try {
    const j = JSON.parse(raw) as Record<string, any>;
    // Pull the specific per-element validation messages first — Xero's top-level
    // Message is just the generic "A validation exception occurred".
    const elementErrors = Array.isArray(j?.Elements)
      ? j.Elements.flatMap((el: any) =>
          Array.isArray(el?.ValidationErrors) ? el.ValidationErrors.map((e: any) => e.Message) : [],
        ).filter(Boolean)
      : [];
    const validation = elementErrors.join("; ");
    return (
      validation ||
      j.Detail ||
      j.Message ||
      j.error_description ||
      j.error ||
      raw
    );
  } catch {
    return raw;
  }
}

// ── Authorised calls (every Xero API call goes through here) ──

type XeroCallInit = { method: string; path: string; body?: unknown; idempotencyKey?: string; accept?: string };

/** A response from Xero, or the token problem that stopped the call. Network errors throw. */
type XeroCallResult = { ok: true; res: Response; token: XeroAccessToken } | { ok: false; failure: XeroTokenFailure };

function sendWithToken(token: XeroAccessToken, init: XeroCallInit): Promise<Response> {
  return fetch(`${XERO_BASE}${init.path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Xero-tenant-id": token.tenantId,
      Accept: init.accept ?? "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/**
 * One authorised Xero call: a valid token from the token service; on a 401,
 * renew once and retry once (a write keeps its Idempotency-Key). A 401 after
 * renewal, or a 403, checks whether the organisation is still connected and
 * marks "needs reconnect" when it is not.
 */
async function xeroCall(init: XeroCallInit): Promise<XeroCallResult> {
  const first = await getXeroAccessToken();
  if (!first.ok) return { ok: false, failure: first };
  let token = first.token;
  let res = await sendWithToken(token, init);
  let retried = false;
  if (res.status === 401) {
    const renewed = await getXeroAccessToken({ rejectedVersion: token.tokenVersion });
    if (!renewed.ok) return { ok: false, failure: renewed };
    token = renewed.token;
    res = await sendWithToken(token, init);
    retried = true;
  }
  if (res.status === 403 || (retried && res.status === 401)) {
    const check = await verifyXeroTenant(token);
    if (check.state === "removed") return { ok: false, failure: check.failure };
  }
  return { ok: true, res, token };
}

/** The current token or a thrown, plain-words error (for pushes). */
async function requireXeroToken(): Promise<XeroAccessToken> {
  const outcome = await getXeroAccessToken();
  if (!outcome.ok) throw new Error(xeroTokenFailureMessage(outcome));
  return outcome.token;
}

/** An authenticated Xero write/read that throws on failure (pushes and contact sync). */
async function xeroRequest<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const call = await xeroCall({ method, path, body, idempotencyKey });
  if (!call.ok) throw new Error(xeroTokenFailureMessage(call.failure));
  if (!call.res.ok) {
    const raw = await call.res.text().catch(() => "");
    throw new Error(`Xero API error (${call.res.status}): ${extractXeroError(raw)}`);
  }
  return call.res.json() as Promise<T>;
}

/**
 * Generate Xero OAuth2 authorization URL.
 */
export async function getXeroAuthUrl(redirectUri: string, state: string): Promise<string> {
  const { clientId } = await getXeroCredentials();
  if (!clientId) throw new Error("Xero Client ID not configured. Set it in Settings > Integrations.");
  if (!xeroTokenEncryptionAvailable()) {
    throw new Error("ENCRYPTION_KEY is not set on the server, so the Xero sign-in cannot be stored safely. Set it, then connect.");
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: xeroScopes(),
    state,
  });

  return `${XERO_AUTH_BASE}/identity/connect/authorize?${params.toString()}`;
}

/** The scopes Xero granted (token response `scope`), else the ones requested. */
function grantedScopes(scope: unknown): string[] {
  const text = typeof scope === "string" && scope.trim() ? scope : xeroScopes();
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Exchange authorization code for tokens. Stores them encrypted with a fresh
 * CONNECTED status (a reconnect clears "needs reconnect"); any other active
 * connection is deactivated so exactly one is used.
 */
export async function exchangeXeroCode(code: string, redirectUri: string): Promise<{ tenantId: string; tenantName: string }> {
  const { clientId, clientSecret } = await getXeroCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Xero Client ID/Secret not configured in Settings → Integrations.");
  }
  if (!xeroTokenEncryptionAvailable()) {
    throw new Error("ENCRYPTION_KEY is not set on the server, so the Xero sign-in cannot be stored safely. Set it, then connect again.");
  }

  const tokenRes = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text().catch(() => "");
    const message = safeReason(extractXeroError(errBody));
    logger.error({ status: tokenRes.status, message, redirectUri }, "[xero] token exchange failed");
    throw new Error(`Token exchange failed (${tokenRes.status}): ${message}`);
  }

  const tokenData = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string; // absent when offline_access is not granted
    expires_in: number;
    scope?: string;
  };

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  // Get tenant info
  const connectionsRes = await fetch(`${XERO_BASE}/connections`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!connectionsRes.ok) {
    const errBody = await connectionsRes.text().catch(() => "");
    throw new Error(`Could not read Xero organisations (${connectionsRes.status}): ${safeReason(extractXeroError(errBody))}`);
  }

  const connections = await connectionsRes.json() as Array<{ tenantId: string; tenantName: string }>;
  if (connections.length === 0) {
    throw new Error("Connected, but no Xero organisation was authorised for this app.");
  }

  const tenant = connections[0];
  const now = new Date();
  const fresh = {
    accessToken: sealXeroToken(tokenData.access_token),
    refreshToken: sealXeroToken(tokenData.refresh_token),
    expiresAt,
    tenantName: tenant.tenantName,
    scopes: grantedScopes(tokenData.scope),
    isActive: true,
    status: "CONNECTED",
    statusReasonCode: null,
    statusReason: null,
    needsReconnectAt: null,
    reconnectNoticeAt: null,
    connectedAt: now,
    lastRefreshedAt: null,
    lastRefreshError: null,
    lastSyncError: null,
    refreshLockId: null,
    refreshLockUntil: null,
  };

  await db.$transaction([
    db.xeroConnection.updateMany({ where: { isActive: true, tenantId: { not: tenant.tenantId } }, data: { isActive: false } }),
    db.xeroConnection.upsert({
      where: { tenantId: tenant.tenantId },
      create: { tenantId: tenant.tenantId, ...fresh },
      update: { ...fresh, tokenVersion: { increment: 1 } },
    }),
  ]);
  logger.info({ tenantName: tenant.tenantName, renewable: Boolean(tokenData.refresh_token) }, "[xero] connected");

  return { tenantId: tenant.tenantId, tenantName: tenant.tenantName };
}

/**
 * Disconnect Xero: revoke the refresh token (best effort) and deactivate the
 * row, which is kept for audit.
 */
export async function disconnectXero(): Promise<void> {
  const conn = await db.xeroConnection.findFirst({ where: { isActive: true }, orderBy: { createdAt: "desc" } });
  if (!conn) return;

  const refreshToken = decryptSecret(conn.refreshToken);
  const { clientId, clientSecret } = await getXeroCredentials();
  if (clientId && refreshToken) {
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    await fetch(XERO_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
      body: new URLSearchParams({ token: refreshToken }),
    }).catch(() => undefined);
  }

  await db.xeroConnection.updateMany({
    where: { tenantId: conn.tenantId },
    data: { isActive: false, refreshLockId: null, refreshLockUntil: null },
  });
}

/**
 * Get Xero connection status (Settings › Xero, the Finance header, Health).
 */
export async function getXeroStatus(now: Date = new Date()): Promise<XeroStatus | null> {
  const conn = await db.xeroConnection.findFirst({ where: { isActive: true }, orderBy: { createdAt: "desc" } });
  if (!conn) return null;
  return buildXeroStatus(conn, now);
}

// ── Contacts ──

/**
 * Find an existing ACTIVE Xero contact by exact name so we reuse it instead of
 * hitting "The contact name … is already assigned to another contact". Returns
 * null when there's no match or the lookup errors (caller then creates).
 */
async function findActiveXeroContactId(name: string): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return null;
  const escaped = clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const where = encodeURIComponent(`Name=="${escaped}"`);
  try {
    const result = await xeroRequest<{ Contacts?: Array<{ ContactID: string; ContactStatus?: string }> }>(
      "GET",
      `/api.xro/2.0/Contacts?where=${where}`,
    );
    const list = result.Contacts ?? [];
    const active = list.find((c) => (c.ContactStatus ?? "ACTIVE") === "ACTIVE");
    return (active ?? list[0])?.ContactID ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve a Xero contact id for the given party: reuse the stored id, else an
 * existing contact with the same name, else create a new one. Reusing by name
 * avoids Xero's unique-name 400 and never clobbers a contact we didn't create.
 */
export async function syncXeroContact(input: {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  isClient: boolean;
  xeroContactId?: string;
}): Promise<{ xeroContactId: string }> {
  await requireXeroToken();

  // No stored link yet → try to match an existing contact by name and reuse it.
  if (!input.xeroContactId) {
    const existingId = await findActiveXeroContactId(input.name);
    if (existingId) return { xeroContactId: existingId };
  }

  const contact: Record<string, unknown> = {
    Name: input.name,
    EmailAddress: input.email,
    Phones: input.phone ? [{ PhoneType: "DEFAULT", PhoneNumber: input.phone }] : [],
    Addresses: input.address ? [{ AddressType: "STREET", AddressLine1: input.address }] : [],
    ContactStatus: "ACTIVE",
  };

  let result: unknown;
  if (input.xeroContactId) {
    result = await xeroRequest("PUT", `/api.xro/2.0/Contacts/${input.xeroContactId}`, { Contacts: [contact] });
  } else {
    result = await xeroRequest("PUT", "/api.xro/2.0/Contacts", { Contacts: [contact] });
  }

  const contacts = (result as { Contacts?: Array<{ ContactID: string }> })?.Contacts;
  if (!contacts?.[0]?.ContactID) throw new Error("Failed to create/update Xero contact");

  return { xeroContactId: contacts[0].ContactID };
}

// ── Invoices ──

/**
 * Push a client invoice to Xero as a DRAFT invoice.
 */
export async function pushClientInvoiceToXero(input: {
  idempotencyKey?: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  clientXeroContactId?: string;
  lineItems: Array<{ description: string; quantity: number; unitAmount: number; accountCode?: string; taxType?: string; itemCode?: string }>;
  date?: string;
  dueDate?: string;
  reference?: string;
  gstEnabled?: boolean;
}): Promise<{ xeroInvoiceId: string; contactId: string }> {
  await requireXeroToken();

  // Ensure contact exists
  let contactId = input.clientXeroContactId;
  if (!contactId) {
    const result = await syncXeroContact({
      name: input.clientName,
      email: input.clientEmail,
      isClient: true,
    });
    contactId = result.xeroContactId;
  }

  const gstOn = input.gstEnabled !== false;
  // Our line prices are GST-EXCLUSIVE (invoice stores subtotal + gstAmount
  // separately), so let Xero add GST on top when enabled.
  const lineAmountTypes = gstOn ? "Exclusive" : "NoTax";

  const invoice = {
    Type: "ACCREC", // Accounts Receivable (client invoice)
    Contact: { ContactID: contactId },
    InvoiceNumber: input.invoiceNumber,
    LineAmountTypes: lineAmountTypes,
    LineItems: input.lineItems.map((line) => {
      const item: Record<string, unknown> = {
        Description: line.description,
        Quantity: line.quantity,
        UnitAmount: line.unitAmount,
        AccountCode: line.accountCode || "200", // Sales account
      };
      // TaxType: only send an explicit code when the admin configured one — its
      // value is region-specific (e.g. AU uses OUTPUT2, NZ uses OUTPUT), and a
      // wrong code is a 400 validation error. Otherwise let Xero apply the
      // account's default tax rate. For a no-GST invoice, force NONE (universal).
      if (line.taxType && line.taxType.trim()) item.TaxType = line.taxType.trim();
      else if (!gstOn) item.TaxType = "NONE";
      // The Xero inventory Item code ("item number"). When set, Xero links the
      // line to that tracked item and can auto-fill its defaults; our explicit
      // Description/AccountCode still win. Omitted entirely when blank.
      if (line.itemCode && line.itemCode.trim()) item.ItemCode = line.itemCode.trim();
      return item;
    }),
    Status: "DRAFT",
    ...(input.date ? { Date: input.date } : {}),
    ...(input.dueDate ? { DueDate: input.dueDate } : {}),
    ...(input.reference ? { Reference: input.reference } : {}),
  };

  const result = await xeroRequest("PUT", "/api.xro/2.0/Invoices", { Invoices: [invoice] }, input.idempotencyKey);

  const invoices = (result as { Invoices?: Array<{ InvoiceID: string }> })?.Invoices;
  if (!invoices?.[0]?.InvoiceID) throw new Error("Failed to create Xero invoice");

  return { xeroInvoiceId: invoices[0].InvoiceID, contactId: contactId! };
}

/**
 * Push a client credit note to Xero as a DRAFT ACCRECCREDIT credit note.
 *
 * Xero credit-note line amounts are POSITIVE (the document type carries the
 * direction), so the caller passes positive unit amounts. It is created as a
 * draft and NOT allocated to the original invoice: Xero only allocates an
 * authorised credit note, and authorising stays a decision made in Xero, as it
 * is for invoices pushed from here.
 */
export async function pushClientCreditNoteToXero(input: {
  idempotencyKey: string;
  creditNoteNumber: string;
  clientName: string;
  clientEmail: string;
  clientXeroContactId?: string;
  lineItems: Array<{ description: string; quantity: number; unitAmount: number; accountCode?: string; taxType?: string; itemCode?: string }>;
  date?: string;
  reference?: string;
  gstEnabled?: boolean;
}): Promise<{ xeroCreditNoteId: string; contactId: string }> {
  await requireXeroToken();

  let contactId = input.clientXeroContactId;
  if (!contactId) {
    const result = await syncXeroContact({ name: input.clientName, email: input.clientEmail, isClient: true });
    contactId = result.xeroContactId;
  }

  const gstOn = input.gstEnabled !== false;
  const creditNote = {
    Type: "ACCRECCREDIT", // Credit note against Accounts Receivable
    Contact: { ContactID: contactId },
    CreditNoteNumber: input.creditNoteNumber,
    LineAmountTypes: gstOn ? "Exclusive" : "NoTax",
    LineItems: input.lineItems.map((line) => {
      const item: Record<string, unknown> = {
        Description: line.description,
        Quantity: line.quantity,
        UnitAmount: line.unitAmount,
        AccountCode: line.accountCode || "200",
      };
      if (line.taxType && line.taxType.trim()) item.TaxType = line.taxType.trim();
      else if (!gstOn) item.TaxType = "NONE";
      if (line.itemCode && line.itemCode.trim()) item.ItemCode = line.itemCode.trim();
      return item;
    }),
    Status: "DRAFT",
    ...(input.date ? { Date: input.date } : {}),
    ...(input.reference ? { Reference: input.reference } : {}),
  };

  const result = await xeroRequest("PUT", "/api.xro/2.0/CreditNotes", { CreditNotes: [creditNote] }, input.idempotencyKey);
  const notes = (result as { CreditNotes?: Array<{ CreditNoteID: string }> })?.CreditNotes;
  if (!notes?.[0]?.CreditNoteID) throw new Error("Failed to create Xero credit note");
  return { xeroCreditNoteId: notes[0].CreditNoteID, contactId: contactId! };
}

/**
 * Push a cleaner bill to Xero as an ACCPAY bill.
 */
export async function pushCleanerBillToXero(input: {
  idempotencyKey?: string;
  cleanerName: string;
  cleanerEmail: string;
  cleanerPhone?: string;
  cleanerAddress?: string;
  cleanerXeroContactId?: string;
  lineItems: Array<{ description: string; quantity: number; unitAmount: number; accountCode?: string; itemCode?: string }>;
  reference?: string;
}): Promise<{ xeroBillId: string; contactId: string }> {
  await requireXeroToken();

  // Match an existing Xero contact by name (or the stored id) or create one with
  // all the cleaner details we have.
  let contactId = input.cleanerXeroContactId;
  if (!contactId) {
    const result = await syncXeroContact({
      name: input.cleanerName,
      email: input.cleanerEmail,
      phone: input.cleanerPhone,
      address: input.cleanerAddress,
      isClient: false,
    });
    contactId = result.xeroContactId;
  }

  const bill = {
    Type: "ACCPAY", // Accounts Payable (cleaner bill)
    Contact: { ContactID: contactId },
    LineItems: input.lineItems.map((line) => {
      const item: Record<string, unknown> = {
        Description: line.description,
        Quantity: line.quantity,
        UnitAmount: line.unitAmount,
        AccountCode: line.accountCode || "400", // Cost of goods sold / wages
      };
      // Let Xero apply the account's default tax rate (region-safe) rather than a
      // hardcoded INPUT that AU/other regions reject.
      if (line.itemCode && line.itemCode.trim()) item.ItemCode = line.itemCode.trim();
      return item;
    }),
    Status: "DRAFT",
    ...(input.reference ? { Reference: input.reference } : {}),
  };

  const result = await xeroRequest("PUT", "/api.xro/2.0/Invoices", { Invoices: [bill] }, input.idempotencyKey);

  const invoices = (result as { Invoices?: Array<{ InvoiceID: string }> })?.Invoices;
  if (!invoices?.[0]?.InvoiceID) throw new Error("Failed to create Xero bill");

  return { xeroBillId: invoices[0].InvoiceID, contactId: contactId! };
}

// ── Reads (invoice status and payments) ──

/** Most ids Xero accepts in one Invoices?IDs= request in this app. */
export const XERO_READ_BATCH_SIZE = 50;
/** A rate-limited read waits at most this long before giving up for this run. */
const XERO_MAX_RETRY_WAIT_MS = 60_000;
const XERO_READ_ATTEMPTS = 2;

export type XeroReadOptions = {
  /** Injected in tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
};

type XeroGetOutcome = { ok: true; body: unknown } | { ok: false; failure: XeroReadFailure };

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry-After is whole seconds; anything else is treated as "unknown wait". */
function retryAfterMs(header: string | null): number | null {
  if (!header || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim()) * 1000;
}

function readFailureFromToken(failure: XeroTokenFailure): XeroReadFailure {
  if (failure.kind === "not-connected") return { kind: "not-connected", reason: "No active Xero connection." };
  if (failure.kind === "needs-reconnect") return { kind: "not-connected", reason: `Xero needs reconnecting: ${failure.reason}` };
  if (failure.kind === "configuration") return { kind: "not-connected", reason: failure.reason };
  return { kind: "network", reason: `Xero sign-in could not be renewed right now: ${failure.reason}` };
}

/**
 * GET through the same token service as the push (renewal near expiry, one
 * renew-and-retry on a 401). A 429 is retried once after Xero's Retry-After
 * when that is within a minute; otherwise the read is reported as rate
 * limited. Never throws: every failure comes back typed, so the caller can
 * record "Xero state unknown" with the reason.
 */
async function xeroGet(path: string, options: XeroReadOptions = {}): Promise<XeroGetOutcome> {
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; attempt <= XERO_READ_ATTEMPTS; attempt += 1) {
    let call: XeroCallResult;
    try {
      call = await xeroCall({ method: "GET", path });
    } catch (error) {
      return { ok: false, failure: { kind: "network", reason: `Xero could not be reached: ${safeReason(error instanceof Error ? error.message : String(error))}` } };
    }
    if (!call.ok) return { ok: false, failure: readFailureFromToken(call.failure) };
    const res = call.res;
    if (res.status === 429) {
      const wait = retryAfterMs(res.headers?.get?.("Retry-After") ?? null);
      if (attempt < XERO_READ_ATTEMPTS && wait !== null && wait <= XERO_MAX_RETRY_WAIT_MS) {
        await sleep(wait);
        continue;
      }
      return { ok: false, failure: { kind: "rate-limited", reason: "Xero's rate limit was reached. It will be tried again on the next run." } };
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      return { ok: false, failure: { kind: "http", reason: `Xero API error (${res.status}): ${extractXeroError(raw)}` } };
    }
    try {
      return { ok: true, body: await res.json() };
    } catch {
      return { ok: false, failure: { kind: "unparseable", reason: "Xero's response could not be read." } };
    }
  }
  return { ok: false, failure: { kind: "rate-limited", reason: "Xero's rate limit was reached. It will be tried again on the next run." } };
}

function failAll(ids: readonly string[], failure: XeroReadFailure): Map<string, XeroDocumentRead> {
  return new Map(ids.map((id) => [id, { ok: false, failure } as XeroDocumentRead]));
}

/**
 * Read ACCREC invoices by their Xero ids, at most XERO_READ_BATCH_SIZE per
 * request (the caller batches). Status, totals, amount due/paid/credited,
 * payments and UpdatedDateUTC come back per id; an id Xero does not return is
 * "missing". If-Modified-Since is not used: an unchanged invoice would then be
 * absent from the answer and indistinguishable from a missing one.
 */
export async function readXeroInvoices(ids: readonly string[], options: XeroReadOptions = {}): Promise<Map<string, XeroDocumentRead>> {
  if (ids.length === 0) return new Map();
  if (ids.length > XERO_READ_BATCH_SIZE) throw new Error(`Read at most ${XERO_READ_BATCH_SIZE} Xero invoices at a time.`);
  const query = new URLSearchParams({ IDs: ids.join(","), page: "1" });
  const outcome = await xeroGet(`/api.xro/2.0/Invoices?${query.toString()}`, options);
  if (!outcome.ok) return failAll(ids, outcome.failure);
  const list = outcome.body && typeof outcome.body === "object" ? (outcome.body as { Invoices?: unknown }).Invoices : undefined;
  return matchXeroDocuments(ids, list, "ACCREC");
}

/** Read one ACCRECCREDIT credit note by its Xero id. */
export async function readXeroCreditNote(id: string, options: XeroReadOptions = {}): Promise<XeroDocumentRead> {
  const outcome = await xeroGet(`/api.xro/2.0/CreditNotes/${encodeURIComponent(id)}`, options);
  if (!outcome.ok) return { ok: false, failure: outcome.failure };
  const list = outcome.body && typeof outcome.body === "object" ? (outcome.body as { CreditNotes?: unknown }).CreditNotes : undefined;
  return matchXeroDocuments([id], list, "ACCRECCREDIT").get(id)!;
}

/** True when an active Xero connection row exists (no token check, no network). */
export async function hasActiveXeroConnection(): Promise<boolean> {
  const conn = await db.xeroConnection.findFirst({ where: { isActive: true }, select: { id: true } });
  return Boolean(conn);
}

/**
 * The name of the chart-of-accounts entry with this code (Wave D, the editor's
 * Xero card). Never throws and never guesses: a failed read, a missing scope
 * or no matching account comes back as a reason.
 */
export async function readXeroAccountName(code: string, options: XeroReadOptions = {}): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  const where = new URLSearchParams({ where: `Code=="${code.replace(/["\\]/g, "")}"` });
  const outcome = await xeroGet(`/api.xro/2.0/Accounts?${where.toString()}`, options);
  if (!outcome.ok) return { ok: false, reason: outcome.failure.reason };
  const list = outcome.body && typeof outcome.body === "object" ? (outcome.body as { Accounts?: unknown }).Accounts : undefined;
  const match = Array.isArray(list)
    ? list.find((entry): entry is { Code: string; Name: string } =>
        Boolean(entry) && typeof entry === "object" && (entry as { Code?: unknown }).Code === code && typeof (entry as { Name?: unknown }).Name === "string")
    : undefined;
  return match ? { ok: true, name: match.Name } : { ok: false, reason: `Xero has no account with code ${code}.` };
}

// ── Contact lookup for Add client (read-only, 2026-11-16) ──

/** One existing Xero contact as Add client lists it. */
export type XeroContactSummary = { id: string; name: string; email: string | null; status: string };

function contactSummaries(body: unknown): XeroContactSummary[] {
  const list = body && typeof body === "object" ? (body as { Contacts?: unknown }).Contacts : undefined;
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null))
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row.ContactID === "string" && typeof row.Name === "string"))
    .map((row) => ({
      id: String(row.ContactID),
      name: String(row.Name),
      email: typeof row.EmailAddress === "string" && row.EmailAddress ? String(row.EmailAddress) : null,
      status: typeof row.ContactStatus === "string" ? String(row.ContactStatus) : "ACTIVE",
    }));
}

/**
 * Search existing Xero contacts by name or email: GET only, through the same
 * token service as every other Xero read. Creates and changes nothing in Xero.
 * Never throws: a failed read comes back with the reason.
 */
export async function searchXeroContacts(term: string, options: XeroReadOptions = {}): Promise<{ ok: true; contacts: XeroContactSummary[] } | { ok: false; reason: string }> {
  const clean = term.trim().slice(0, 80);
  if (clean.length < 2) return { ok: true, contacts: [] };
  const query = new URLSearchParams({ searchTerm: clean, summaryOnly: "true", page: "1" });
  const outcome = await xeroGet(`/api.xro/2.0/Contacts?${query.toString()}`, options);
  if (!outcome.ok) return { ok: false, reason: outcome.failure.reason };
  return { ok: true, contacts: contactSummaries(outcome.body).filter((row) => row.status !== "ARCHIVED").slice(0, 20) };
}

/** Read one Xero contact by id (GET only), to check a choice before linking it. */
export async function readXeroContact(id: string, options: XeroReadOptions = {}): Promise<{ ok: true; contact: XeroContactSummary } | { ok: false; reason: string }> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return { ok: false, reason: "That is not a Xero contact id." };
  const outcome = await xeroGet(`/api.xro/2.0/Contacts/${encodeURIComponent(id)}`, options);
  if (!outcome.ok) return { ok: false, reason: outcome.failure.reason };
  const contact = contactSummaries(outcome.body).find((row) => row.id.toLowerCase() === id.toLowerCase());
  return contact ? { ok: true, contact } : { ok: false, reason: "Xero did not return that contact." };
}
