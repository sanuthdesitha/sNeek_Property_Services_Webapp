import twilio from "twilio";
import { logger } from "@/lib/logger";
import { getAppSettings, type SmsProvider } from "@/lib/settings";

export type SmsSendStatus = "sent" | "disabled" | "not_configured" | "failed";

export interface SmsSendResult {
  ok: boolean;
  status: SmsSendStatus;
  provider: SmsProvider;
  error?: string;
}

function getConfiguredSmsProvider(provider: SmsProvider) {
  if (provider === "twilio") {
    return Boolean(
      process.env.TWILIO_ACCOUNT_SID?.trim() &&
        process.env.TWILIO_AUTH_TOKEN?.trim() &&
        process.env.TWILIO_PHONE_NUMBER?.trim()
    );
  }
  if (provider === "cellcast") {
    return Boolean(process.env.CELLCAST_APPKEY?.trim());
  }
  return true;
}

async function sendViaTwilio(to: string, body: string): Promise<SmsSendResult> {
  if (!getConfiguredSmsProvider("twilio")) {
    return { ok: false, status: "not_configured", provider: "twilio", error: "Twilio is not configured." };
  }

  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID?.trim(),
      process.env.TWILIO_AUTH_TOKEN?.trim()
    );
    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER!.trim(),
      to,
      body,
    });
    return { ok: true, status: "sent", provider: "twilio" };
  } catch (err) {
    logger.error({ err, to }, "Failed to send SMS via Twilio");
    return { ok: false, status: "failed", provider: "twilio", error: "Twilio failed to send SMS." };
  }
}

async function sendViaCellcast(to: string, body: string): Promise<SmsSendResult> {
  const appKey = process.env.CELLCAST_APPKEY?.trim();
  if (!appKey) {
    return { ok: false, status: "not_configured", provider: "cellcast", error: "Cellcast is not configured." };
  }

  const endpoint = process.env.CELLCAST_API_URL?.trim() || "https://cellcast.com.au/api/v3/send-sms";

  try {
    const configuredFrom = process.env.CELLCAST_FROM?.trim();
    const payload: Record<string, unknown> = {
      sms_text: body,
      numbers: [to],
    };

    // Cellcast sender IDs are heavily constrained. If no explicit sender is configured,
    // omit `from` and let Cellcast use the account's regular ID.
    if (configuredFrom) {
      const isNumericSender = /^\d{1,16}$/.test(configuredFrom);
      const isAlphaNumericSender = /^[A-Za-z0-9 -]{1,11}$/.test(configuredFrom);
      if (isNumericSender || isAlphaNumericSender) {
        payload.from = configuredFrom;
      } else {
        logger.warn(
          { from: configuredFrom },
          "Ignoring CELLCAST_FROM because it does not match Cellcast sender ID rules"
        );
      }
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        APPKEY: appKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const text = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const error =
        typeof parsed?.msg === "string"
          ? parsed.msg
          : typeof parsed?.error === "string"
            ? parsed.error
            : `Cellcast HTTP ${response.status}`;
      logger.error({ to, status: response.status, error }, "Failed to send SMS via Cellcast");
      return { ok: false, status: "failed", provider: "cellcast", error };
    }

    const meta = parsed?.meta && typeof parsed.meta === "object" ? (parsed.meta as Record<string, unknown>) : null;
    const data = parsed?.data && typeof parsed.data === "object" ? (parsed.data as Record<string, unknown>) : null;
    const messages = Array.isArray(data?.messages) ? data.messages : [];
    const isSuccess =
      meta?.status === "SUCCESS" ||
      meta?.code === 200 ||
      parsed?.success === true ||
      messages.length > 0;

    if (!isSuccess) {
      const error =
        typeof parsed?.message === "string"
          ? parsed.message
          : typeof parsed?.msg === "string"
            ? parsed.msg
          : typeof parsed?.error === "string"
            ? parsed.error
            : "Cellcast did not accept the SMS.";
      logger.warn({ to, response: parsed }, "Cellcast rejected SMS");
      return { ok: false, status: "failed", provider: "cellcast", error };
    }

    return { ok: true, status: "sent", provider: "cellcast" };
  } catch (err) {
    logger.error({ err, to }, "Failed to send SMS via Cellcast");
    return { ok: false, status: "failed", provider: "cellcast", error: "Cellcast failed to send SMS." };
  }
}

export async function getSmsProviderState() {
  const settings = await getAppSettings();
  const provider = settings.smsProvider;
  return {
    provider,
    configured: getConfiguredSmsProvider(provider),
  };
}

export async function sendSmsDetailed(to: string, body: string): Promise<SmsSendResult> {
  const { provider } = await getSmsProviderState();

  if (provider === "none") {
    logger.info({ to }, "SMS sending skipped because provider is disabled");
    return { ok: false, status: "disabled", provider: "none", error: "SMS delivery is disabled." };
  }

  if (provider === "cellcast") {
    return sendViaCellcast(to, body);
  }

  return sendViaTwilio(to, body);
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  const result = await sendSmsDetailed(to, body);
  return result.ok;
}
