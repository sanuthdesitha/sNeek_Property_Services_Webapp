-- CreateTable
CREATE TABLE "UserPushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'expo',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPushDevice_token_key" ON "UserPushDevice"("token");

-- CreateIndex
CREATE INDEX "UserPushDevice_userId_isActive_idx" ON "UserPushDevice"("userId", "isActive");

-- AddForeignKey
ALTER TABLE "UserPushDevice" ADD CONSTRAINT "UserPushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
