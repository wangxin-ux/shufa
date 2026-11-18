CREATE TYPE "PartnerApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED');

CREATE TABLE "PartnerApplication" (
    "id" UUID NOT NULL,
    "applicantId" UUID NOT NULL,
    "status" "PartnerApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "institutionName" VARCHAR(200),
    "province" VARCHAR(100),
    "city" VARCHAR(100),
    "district" VARCHAR(100),
    "detailedAddress" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "PartnerApplication_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PartnerApplication_positive_version" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "PartnerApplication_applicantId_key" ON "PartnerApplication"("applicantId");
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_applicantId_fkey"
    FOREIGN KEY ("applicantId") REFERENCES "PartnerApplicant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
