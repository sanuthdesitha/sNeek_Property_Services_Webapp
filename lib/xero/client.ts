import { db } from "@/lib/db";

const XERO_BASE = "https://api.xero.com";
const XERO_AUTH_BASE = "https://login.xero.com";

const CREDENTIAL_KEY = "integrationCredentials";

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

  try {
    const res = await fetch(`${XERO_AUTH_BASE}/connect/token`, {
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
    const errorText = await res.text().catch(() => "");
    throw new Error(`Xero API error (${res.status}): ${errorText}`);
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
    scope: "offline_access accounting.transactions accounting.contacts",
    state,
  });

  return `${XERO_AUTH_BASE}/identity/connect/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeXeroCode(code: string, redirectUri: string): Promise<{ tenantId: string; tenantName: string } | null> {
  const { clientId, clientSecret } = await getXeroCredentials();
  if (!clientId || !clientSecret) {
    console.error("[xero] Missing credentials. clientId:", !!clientId, "clientSecret:", !!clientSecret);
    return null;
  }

  try {
    // Get tokens
    const tokenRes = await fetch(`${XERO_AUTH_BASE}/connect/token`, {
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
      console.error("[xero] Token exchange failed:", tokenRes.status, errBody);
      console.error("[xero] redirect_uri:", redirectUri);
      return null;
    }

    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      id_token: string;
    };

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    // Get tenant info
    const connectionsRes = await fetch(`${XERO_BASE}/connections`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!connectionsRes.ok) {
      const errBody = await connectionsRes.text().catch(() => "");
      console.error("[xero] Connections fetch failed:", connectionsRes.status, errBody);
      return null;
    }

    const connections = await connectionsRes.json() as Array<{ tenantId: string; tenantName: string }>;
    if (connections.length === 0) {
      console.error("[xero] No tenants found");
      return null;
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
        refreshToken: tokenData.refresh_token,
        expiresAt,
        scopes: ["offline_access", "accounting.transactions", "accounting.contacts"],
        isActive: true,
      },
      update: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        tenantName: tenant.tenantName,
        isActive: true,
      },
    });

    return { tenantId: tenant.tenantId, tenantName: tenant.tenantName };
  } catch (err) {
    console.error("[xero] exchangeXeroCode error:", err);
    return null;
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
    await fetch(`${XERO_AUTH_BASE}/connect/revocation`, {
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
 * Create or update a contact in Xero.
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

  const contact: Record<string, unknown> = {
    Name: input.name,
    EmailAddress: input.email,
    Phones: input.phone ? [{ PhoneType: "DEFAULT", PhoneNumber: input.phone }] : [],
    Addresses: input.address ? [{ AddressType: "STREET", AddressLine1: input.address }] : [],
    ContactStatus: "ACTIVE",
  };

  if (input.isClient) {
    contact.AccountsReceivableTaxType = "OUTPUT";
  } else {
    contact.AccountsPayableTaxType = "INPUT";
  }

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
  lineItems: Array<{ description: string; quantity: number; unitAmount: number; accountCode?: string; taxType?: string }>;
  dueDate?: string;
  gstEnabled?: boolean;
}): Promise<{ xeroInvoiceId: string }> {
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

  const defaultTaxType = input.gstEnabled !== false ? "OUTPUT" : "NONE";

  const invoice = {
    Type: "ACCREC", // Accounts Receivable (client invoice)
    Contact: { ContactID: contactId },
    InvoiceNumber: input.invoiceNumber,
    LineItems: input.lineItems.map((line) => ({
      Description: line.description,
      Quantity: line.quantity,
      UnitAmount: line.unitAmount,
      AccountCode: line.accountCode || "200", // Sales account
      TaxType: line.taxType ?? defaultTaxType,
    })),
    Status: "DRAFT",
    ...(input.dueDate ? { DueDate: input.dueDate } : {}),
  };

  const result = await xeroRequest("PUT", "/api.xro/2.0/Invoices", tokenData.tenantId, { Invoices: [invoice] });

  const invoices = (result as { Invoices?: Array<{ InvoiceID: string }> })?.Invoices;
  if (!invoices?.[0]?.InvoiceID) throw new Error("Failed to create Xero invoice");

  return { xeroInvoiceId: invoices[0].InvoiceID };
}

/**
 * Push a cleaner bill to Xero as an ACCPAY bill.
 */
export async function pushCleanerBillToXero(input: {
  cleanerName: string;
  cleanerEmail: string;
  cleanerXeroContactId?: string;
  lineItems: Array<{ description: string; quantity: number; unitAmount: number; accountCode?: string }>;
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
    LineItems: input.lineItems.map((line) => ({
      Description: line.description,
      Quantity: line.quantity,
      UnitAmount: line.unitAmount,
      AccountCode: line.accountCode || "400", // Cost of goods sold / wages
      TaxType: "INPUT",
    })),
    Status: "DRAFT",
    ...(input.reference ? { Reference: input.reference } : {}),
  };

  const result = await xeroRequest("PUT", "/api.xro/2.0/Invoices", tokenData.tenantId, { Invoices: [bill] });

  const invoices = (result as { Invoices?: Array<{ InvoiceID: string }> })?.Invoices;
  if (!invoices?.[0]?.InvoiceID) throw new Error("Failed to create Xero bill");

  return { xeroBillId: invoices[0].InvoiceID };
}
