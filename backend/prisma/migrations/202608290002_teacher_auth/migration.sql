-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('MOCK', 'WECHAT');

-- CreateTable
CREATE TABLE "AuthIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "subject" VARCHAR(256) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffBindToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenDigest" VARCHAR(64) NOT NULL,
    "tokenHash" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffBindToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_provider_subject_key" ON "AuthIdentity"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "AuthIdentity_userId_provider_key" ON "AuthIdentity"("userId", "provider");

-- CreateIndex
CREATE INDEX "AuthIdentity_userId_idx" ON "AuthIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffBindToken_tokenDigest_key" ON "StaffBindToken"("tokenDigest");

-- CreateIndex
CREATE INDEX "StaffBindToken_userId_expiresAt_idx" ON "StaffBindToken"("userId", "expiresAt");

-- AddForeignKey
ALTER TABLE "AuthIdentity" ADD CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffBindToken" ADD CONSTRAINT "StaffBindToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Token digests are lowercase SHA-256 hex strings. Consumed timestamps cannot
-- predate token creation.
ALTER TABLE "StaffBindToken"
ADD CONSTRAINT "StaffBindToken_digest_format_valid"
CHECK ("tokenDigest" ~ '^[0-9a-f]{64}$'),
ADD CONSTRAINT "StaffBindToken_expiration_valid"
CHECK ("expiresAt" > "createdAt"),
ADD CONSTRAINT "StaffBindToken_consumed_at_valid"
CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt");
