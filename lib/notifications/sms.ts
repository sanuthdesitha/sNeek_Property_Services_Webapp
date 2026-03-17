import twilio from "twilio";
import { logger } from "@/lib/logger";

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!process.env.TWILIO_ACCOUNT_SID) {
    logger.warn("Twilio not configured; skipping SMS");
    return false;
  }
  try {
    await client.messages.create({
      from: process.env.TWILIO_PHONE_NUMBER!,
      to,
      body,
    });
    return true;
  } catch (err) {
    logger.error({ err, to }, "Failed to send SMS");
    return false;
  }
}
