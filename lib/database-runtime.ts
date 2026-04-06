import "server-only";

function readDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  return typeof value === "string" ? value.trim() : "";
}

function getProtocol(value: string) {
  try {
    return new URL(value).protocol;
  } catch {
    return "";
  }
}

export function getDatabaseUrl() {
  return readDatabaseUrl();
}

export function hasDatabaseUrl() {
  return readDatabaseUrl().length > 0;
}

export function hasSupportedNodeDatabaseUrl() {
  const value = readDatabaseUrl();
  if (!value) return false;
  const protocol = getProtocol(value);
  return protocol === "postgres:" || protocol === "postgresql:";
}

export function isEdgeLikeRuntime() {
  return (
    process.env.NEXT_RUNTIME === "edge" ||
    typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== "undefined"
  );
}

export function canUseNodePrisma() {
  return hasSupportedNodeDatabaseUrl() && !isEdgeLikeRuntime();
}
