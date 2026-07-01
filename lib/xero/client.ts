import { db } from "@/lib/db";

const XERO_BASE = "https://api.xero.com";
// Authorize lives on login.xero.com; the token + revocation endpoints live on
// identity.xero.com (posting the token exchange to login.xero.com/connect/token
// 404s and surfaces as a generic "exchange failed").
const XERO_AUTH_BASE = "https://login.xero.com";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_REVOKE_URL = "https://identity.xero.com/connect/revocation";

const CREDENTIAL_KEY = "integrationCredentials";

/**
 * OAuth scopes we request. Restricted to exactly the scopes this Xero app
 * exposes (its Authorisation list): only the granular accounting scopes are
 * available — NOT accounting.transactions, openid, profile, email, or
 * offline_access — so requesting any of those returns "invalid_scope".
 *   - accounting.contacts → create/read client & cleaner contacts
 *   - accounting.invoices → create/read invoices (ACCREC) & bills (ACCPAY)
 *
 * NOTE: without offline_access no refresh token is issued, so the access token
 * is short-lived (~30 min). We handle a missing refresh token gracefully; push
 * an invoice shortly after connecting, or reconnect if it lapses.
 */
const XERO_SCOPES = "accounting.contacts accounting.invoices";

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

async function getXeroCredentials(): Promise<{ clientId: string; clientSecret: string }> {
  const row = await db.appSetting.findUnique({ where: { key: CREDENTIAL_KEY } });
  const creds = (row?.value as Record<string, string> | null) ?? {};
  const clientId = creds.xeroClientId || process.env.XERO_CLIENT_ID || "";
  const clientSecret = creds.xeroClientSecret || process.env.XERO_CLIENT_SECRET || "";
  console.log("[xero] Credentials loaded. DB clientId:", !!clientId, "env clientId:", !!process.env.XERO_CLIENT_ID);
  return { clientId, clientSecret };
}

interface XeroToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Get the active Xero connection with a valid token.
 * Refreshes token if expired.
 */
async function getXeroToken(): Promise<{ token: XeroToken; tenantId: string } | null> {
  const conn = await db.xeroConnection.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });

  if (!conn) return null;

  // Refresh if token is expired or expires within 5 minutes
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
  if (conn.expiresAt < fiveMinFromNow) {
    const refreshed = await refreshXeroToken(conn);
    if (!refreshed) return null;
    return {
      token: {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
      },
      tenantId: conn.tenantId,
    };
  }

  return {
    token: {
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      expiresAt: conn.expiresAt,
    },
    tenantId: conn.tenantId,
  };
}

/**
 * Refresh Xero OAuth2 token.
 */
async function refreshXeroToken(conn: { id: string; refreshToken: string }): Promise<XeroToken | null> {
  const { clientId, clientSecret } = await getXeroCredentials();
  if (!clientId || !clientSecret) return null;
  // No refresh token (offline_access not granted) — nothing to refresh. Caller
  // treats null as "reconnect needed" rather than crashing.
  if (!conn.refreshToken) return null;

  try {
    const res = await fetch(XERO_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: conn.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    await db.xeroConnection.update({
      where: { id: conn.id },
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
        lastSyncAt: new Date(),
      },
    });

    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt };
  } catch {
    return null;
  }
}

/**
 * Make an authenticated Xero API request.
 */
async function xeroRequest<T>(method: string, path: string, tenantId: string, body?: unknown): Promise<T> {
  const tokenData = await getXeroToken();
  if (!tokenData) throw new Error("No active Xero connection");

  const res = await fetch(`${XERO_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${tokenData.token.accessToken}`,
      "Xero-tenant-id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw new Error(`Xero API error (${res.status}): ${extractXeroError(raw)}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Generate Xero OAuth2 authorization URL.
 */
export async function getXeroAuthUrl(redirectUri: string, state: string): Promise<string> {
  const { clientId } = await getXeroCredentials();
  if (!clientId) throw new Error("Xero Client ID not configured. Set it in Settings > Integrations.");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: XERO_SCOPES,
    state,
  });

  return `${XERO_AUTH_BASE}/identity/connect/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeXeroCode(code: string, redirectUri: string): Promise<{ tenantId: string; tenantName: string }> {
  const { clientId, clientSecret } = await getXeroCredentials();
  if (!clientId || !clientSecret) {
    throw new Error("Xero Client ID/Secret not configured in Settings → Integrations.");
  }

  try {
    // Get tokens
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
      console.error("[xero] Token exchange failed:", tokenRes.status, errBody, "redirect_uri:", redirectUri);
      throw new Error(`Token exchange failed (${tokenRes.status}): ${extractXeroError(errBody)}`);
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string; // absent when offline_access is not granted
      expires_in: number;
      id_token?: string;
    };

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    // Get tenant info
    const connectionsRes = await fetch(`${XERO_BASE}/connections`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!connectionsRes.ok) {
      const errBody = await connectionsRes.text().catch(() => "");
      throw new Error(`Could not read Xero organisations (${connectionsRes.status}): ${extractXeroError(errBody)}`);
    }

    const connections = await connectionsRes.json() as Array<{ tenantId: string; tenantName: string }>;
    if (connections.length === 0) {
      throw new Error("Connected, but no Xero organisation was authorised for this app.");
    }

    const tenant = connections[0];
    console.log("[xero] Connected tenant:", tenant.tenantName);

    // Save connection
    await db.xeroConnection.upsert({
      where: { tenantId: tenant.tenantId },
      create: {
        tenantId: tenant.tenantId,
        tenantName: tenant.tenantName,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? "",
        expiresAt,
        scopes: XERO_SCOPES.split(" "),
        isActive: true,
      },
      update: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? "",
        expiresAt,
        tenantName: tenant.tenantName,
        isActive: true,
      },
    });

    return { tenantId: tenant.tenantId, tenantName: tenant.tenantName };
  } catch (err) {
    console.error("[xero] exchangeXeroCode error:", err);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Disconnect Xero.
 */
export async function disconnectXero(): Promise<void> {
  const conn = await db.xeroConnection.findFirst({ where: { isActive: true } });
  if (!conn) return;

  // Revoke token
  const { clientId } = await getXeroCredentials();
  if (clientId) {
    await fetch(XERO_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        token: conn.refreshToken,
      }),
    }).catch(() => {});
  }

  await db.xeroConnection.updateMany({
    where: { tenantId: conn.tenantId },
    data: { isActive: false },
  });
}

/**
 * Get Xero connection status.
 */
export async function getXeroStatus(): Promise<{ connected: boolean; tenantName?: string; lastSyncAt?: string } | null> {
  const conn = await db.xeroConnection.findFirst({ where: { isActive: true } });
  if (!conn) return null;

  return {
    connected: true,
    tenantName: conn.tenantName,
    lastSyncAt: conn.lastSyncAt?.toISOString(),
  };
}

// ── Contacts ──

/**
 * Find an existing ACTIVE Xero contact by exact name so we reuse it instead of
 * hitting "The contact name … is already assigned to another contact". Returns
 * null when there's no match or the lookup errors (caller then creates).
 */
async function findActiveXeroContactId(tenantId: string, name: string): Promise<string | null> {
  const clean = name.trim();
  if (!clean) return null;
  const escaped = clean.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const where = encodeURIComponent(`Name=="${escaped}"`);
  try {
    const result = await xeroRequest<{ Contacts?: Array<{ ContactID: string; ContactStatus?: string }> }>(
      "GET",
      `/api.xro/2.0/Contacts?where=${where}`,
      tenantId,
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
  const tokenData = await getXeroToken();
  if (!tokenData) throw new Error("No active Xero connection");

  // No stored link yet → try to match an existing contact by name and reuse it.
  if (!input.xeroContactId) {
    const existingId = await findActiveXeroContactId(tokenData.tenantId, input.name);
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
    result = await xeroRequest("PUT", `/api.xro/2.0/Contacts/${input.xeroContactId}`, tokenData.tenantId, { Contacts: [contact] });
  } else {
    result = await xeroRequest("PUT", "/api.xro/2.0/Contacts", tokenData.tenantId, { Contacts: [contact] });
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
  const tokenData = await getXeroToken();
  if (!tokenData) throw new Error("No active Xero connection");

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

  const result = await xeroRequest("PUT", "/api.xro/2.0/Invoices", tokenData.tenantId, { Invoices: [invoice] });

  const invoices = (result as { Invoices?: Array<{ InvoiceID: string }> })?.Invoices;
  if (!invoices?.[0]?.InvoiceID) throw new Error("Failed to create Xero invoice");

  return { xeroInvoiceId: invoices[0].InvoiceID, contactId: contactId! };
}

/**
 * Push a cleaner bill to Xero as an ACCPAY bill.
 */
export async function pushCleanerBillToXero(input: {
  cleanerName: string;
  cleanerEmail: string;
  cleanerXeroContactId?: string;
  lineItems: Array<{ description: string; quantity: number; unitAmount: number; accountCode?: string; itemCode?: string }>;
  reference?: string;
}): Promise<{ xeroBillId: string }> {
  const tokenData = await getXeroToken();
  if (!tokenData) throw new Error("No active Xero connection");

  // Ensure contact exists
  let contactId = input.cleanerXeroContactId;
  if (!contactId) {
    const result = await syncXeroContact({
      name: input.cleanerName,
      email: input.cleanerEmail,
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

  const result = await xeroRequest("PUT", "/api.xro/2.0/Invoices", tokenData.tenantId, { Invoices: [bill] });

  const invoices = (result as { Invoices?: Array<{ InvoiceID: string }> })?.Invoices;
  if (!invoices?.[0]?.InvoiceID) throw new Error("Failed to create Xero bill");

  return { xeroBillId: invoices[0].InvoiceID };
}
