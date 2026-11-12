/**
 * Which path an external transport of a "pipeline with direct fallback" type
 * takes today, and the banners the notifications area shows for it.
 *
 * The durable pipeline only hands EMAIL, SMS and WEB_PUSH intents to a provider
 * when SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS lists them (the default is none).
 * A producer moved onto the pipeline must not start depending on that switch:
 * if it is off for a transport, the producer keeps its direct send for that
 * transport and records that the direct path was used. Nothing here changes
 * the switch's default.
 */
export type ExternalIntentTransport = "EMAIL" | "SMS" | "WEB_PUSH";
export type TransportPath = "pipeline" | "direct";

export const OUTBOX_TRANSPORTS_ENV = "SNEEK_NOTIFICATION_OUTBOX_TRANSPORTS";

/** Same parsing as `enabledIntentProviderTransports` in intent-provider.ts. */
export function outboxTransportsFromEnv(env: Record<string, string | undefined> = process.env): ExternalIntentTransport[] {
  return (env[OUTBOX_TRANSPORTS_ENV] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is ExternalIntentTransport => value === "EMAIL" || value === "SMS" || value === "WEB_PUSH");
}

export function transportPath(transport: ExternalIntentTransport, env: Record<string, string | undefined> = process.env): TransportPath {
  return outboxTransportsFromEnv(env).includes(transport) ? "pipeline" : "direct";
}

export type PathBanner = {
  key: string;
  transport: ExternalIntentTransport;
  typeKey: string;
  message: string;
};

const TRANSPORT_WORD: Record<ExternalIntentTransport, string> = { EMAIL: "email", SMS: "SMS", WEB_PUSH: "browser push" };

/**
 * One banner per fallback type and transport that is on the direct path.
 * `fallbackTypes` lists the catalog types with PIPELINE_WITH_FALLBACK and the
 * external transports each can use.
 */
export function directPathBanners(
  fallbackTypes: Array<{ key: string; name: string; transports: ExternalIntentTransport[] }>,
  env: Record<string, string | undefined> = process.env,
): PathBanner[] {
  const banners: PathBanner[] = [];
  for (const type of fallbackTypes) {
    for (const transport of type.transports) {
      if (transportPath(transport, env) === "pipeline") continue;
      const word = TRANSPORT_WORD[transport];
      banners.push({
        key: `${type.key}:${transport}`,
        transport,
        typeKey: type.key,
        message: `${type.name}: ${word} is using the direct path because the outbox ${word} transport is switched off. They still go out. Add ${transport} to ${OUTBOX_TRANSPORTS_ENV} (comma-separated) to move them onto the pipeline.`,
      });
    }
  }
  return banners;
}
