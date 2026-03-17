import { getAppSettings } from "@/lib/settings";

export async function isClientCommunicationAdminOnly(): Promise<boolean> {
  const settings = await getAppSettings();
  return settings.strictClientAdminOnly;
}

export const CLIENT_COMMUNICATION_DISABLED_MESSAGE =
  "Direct client communication is restricted. Route this through admin approval.";
