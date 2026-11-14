-- Xero token lifecycle (2026-11-15): single-flight refresh on a token
-- version, an explicit connection status with a reason, refresh history and
-- a once-per-outage reconnect notice marker. Additive; existing rows and
-- their tokens are kept.

ALTER TABLE "XeroConnection"
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'CONNECTED',
  ADD COLUMN "statusReasonCode" TEXT,
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "needsReconnectAt" TIMESTAMP(3),
  ADD COLUMN "reconnectNoticeAt" TIMESTAMP(3),
  ADD COLUMN "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastRefreshedAt" TIMESTAMP(3),
  ADD COLUMN "lastRefreshAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastRefreshError" TEXT,
  ADD COLUMN "lastTenantCheckAt" TIMESTAMP(3),
  ADD COLUMN "refreshLockId" TEXT,
  ADD COLUMN "refreshLockUntil" TIMESTAMP(3);

-- History: when the connection was made, and the last refresh (lastSyncAt was
-- only ever written by a successful token refresh).
UPDATE "XeroConnection" SET "connectedAt" = "createdAt", "lastRefreshedAt" = "lastSyncAt";

-- A connection made without offline_access has no refresh token and cannot
-- renew itself; once its access token has expired it needs a reconnect. (A
-- row with a refresh token is left CONNECTED: its next refresh decides.)
UPDATE "XeroConnection"
SET "status" = 'NEEDS_RECONNECT',
    "statusReasonCode" = 'NO_REFRESH_TOKEN',
    "statusReason" = 'This connection was made without offline access, so Xero issued no refresh token. Reconnect Xero once to keep it connected.',
    "needsReconnectAt" = CURRENT_TIMESTAMP
WHERE "isActive" = true AND "refreshToken" = '' AND "expiresAt" <= CURRENT_TIMESTAMP;
