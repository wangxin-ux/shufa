ALTER TYPE "StoredFilePurpose" ADD VALUE 'FINANCE_RECEIPT_PROOF';

CREATE TABLE "FinanceReceipt" (
  "id" UUID NOT NULL,
  "campusId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "amountFen" INTEGER NOT NULL CHECK ("amountFen" > 0),
  "receivedOn" DATE NOT NULL,
  "channel" VARCHAR(20) NOT NULL CHECK ("channel" IN ('WECHAT', 'ALIPAY', 'BANK', 'CASH', 'OTHER')),
  "proofFileId" UUID NOT NULL,
  "note" VARCHAR(500) NOT NULL DEFAULT '',
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceReceipt_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceReceipt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceReceipt_proofFileId_fkey" FOREIGN KEY ("proofFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinanceReceipt_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FinanceReceipt_proofFileId_key" ON "FinanceReceipt"("proofFileId");
CREATE INDEX "FinanceReceipt_campusId_receivedOn_id_idx" ON "FinanceReceipt"("campusId", "receivedOn", "id");
CREATE INDEX "FinanceReceipt_studentId_createdAt_idx" ON "FinanceReceipt"("studentId", "createdAt");

CREATE TABLE "FinancePackageIssuance" (
  "id" UUID NOT NULL,
  "receiptId" UUID NOT NULL,
  "coursePackageId" UUID NOT NULL,
  "originalAmountFen" INTEGER NOT NULL CHECK ("originalAmountFen" > 0),
  "initialMainUnits" INTEGER NOT NULL CHECK ("initialMainUnits" > 0),
  "initialGiftUnits" INTEGER NOT NULL CHECK ("initialGiftUnits" >= 0),
  "name" VARCHAR(200) NOT NULL,
  "validFrom" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3),
  "issuedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancePackageIssuance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancePackageIssuance_validity_check" CHECK ("expiresAt" IS NULL OR "expiresAt" > "validFrom"),
  CONSTRAINT "FinancePackageIssuance_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "FinanceReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinancePackageIssuance_coursePackageId_fkey" FOREIGN KEY ("coursePackageId") REFERENCES "CoursePackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FinancePackageIssuance_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FinancePackageIssuance_receiptId_key" ON "FinancePackageIssuance"("receiptId");
CREATE UNIQUE INDEX "FinancePackageIssuance_coursePackageId_key" ON "FinancePackageIssuance"("coursePackageId");
