ALTER TYPE "LessonLedgerEntryType" ADD VALUE 'GRANT' BEFORE 'CONSUME';
ALTER TYPE "StoredFilePurpose" ADD VALUE 'PAYMENT_PROOF';
ALTER TYPE "StoredFilePurpose" ADD VALUE 'COURSE_PRODUCT_COVER';

CREATE TYPE "CourseProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');
CREATE TYPE "EnrollmentOrderStatus" AS ENUM ('AWAITING_PROOF', 'PENDING_REVIEW', 'REJECTED', 'EFFECTIVE', 'CANCELLED', 'VOIDED');
CREATE TYPE "EnrollmentOrderReviewAction" AS ENUM ('APPROVE', 'REJECT', 'VOID');

ALTER TABLE "CoursePackage" ADD COLUMN "sourceOrderId" UUID;

CREATE TABLE "CourseProduct" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(1000) NOT NULL,
    "coverFileId" UUID,
    "priceFen" INTEGER NOT NULL,
    "mainUnits" INTEGER NOT NULL,
    "giftUnits" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "status" "CourseProductStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "CourseProduct_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CourseProduct_price_nonnegative" CHECK ("priceFen" >= 0),
    CONSTRAINT "CourseProduct_units_valid" CHECK ("mainUnits" >= 0 AND "giftUnits" >= 0 AND ("mainUnits" + "giftUnits") > 0),
    CONSTRAINT "CourseProduct_validity_positive" CHECK ("validityDays" BETWEEN 1 AND 3650),
    CONSTRAINT "CourseProduct_version_positive" CHECK ("version" >= 1)
);

CREATE TABLE "EnrollmentOrder" (
    "id" UUID NOT NULL,
    "orderNo" VARCHAR(64) NOT NULL,
    "parentUserId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "courseProductId" UUID NOT NULL,
    "productNameSnapshot" VARCHAR(200) NOT NULL,
    "priceFenSnapshot" INTEGER NOT NULL,
    "mainUnitsSnapshot" INTEGER NOT NULL,
    "giftUnitsSnapshot" INTEGER NOT NULL,
    "validityDaysSnapshot" INTEGER NOT NULL,
    "status" "EnrollmentOrderStatus" NOT NULL DEFAULT 'AWAITING_PROOF',
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewReason" VARCHAR(500),
    "cancelledAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),
    "voidReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "EnrollmentOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EnrollmentOrder_snapshots_valid" CHECK ("priceFenSnapshot" >= 0 AND "mainUnitsSnapshot" >= 0 AND "giftUnitsSnapshot" >= 0 AND ("mainUnitsSnapshot" + "giftUnitsSnapshot") > 0 AND "validityDaysSnapshot" > 0),
    CONSTRAINT "EnrollmentOrder_version_positive" CHECK ("version" >= 1)
);

CREATE TABLE "EnrollmentPaymentProof" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "storedFileId" UUID NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "submittedByUserId" UUID NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnrollmentPaymentProof_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EnrollmentPaymentProof_attempt_positive" CHECK ("attemptNo" >= 1)
);

CREATE TABLE "EnrollmentOrderReview" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "paymentProofId" UUID,
    "action" "EnrollmentOrderReviewAction" NOT NULL,
    "fromStatus" "EnrollmentOrderStatus" NOT NULL,
    "toStatus" "EnrollmentOrderStatus" NOT NULL,
    "reason" VARCHAR(500),
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnrollmentOrderReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CoursePackage_sourceOrderId_key" ON "CoursePackage"("sourceOrderId");
CREATE INDEX "CourseProduct_campusId_status_createdAt_idx" ON "CourseProduct"("campusId", "status", "createdAt");
CREATE UNIQUE INDEX "EnrollmentOrder_orderNo_key" ON "EnrollmentOrder"("orderNo");
CREATE INDEX "EnrollmentOrder_parentUserId_status_createdAt_idx" ON "EnrollmentOrder"("parentUserId", "status", "createdAt");
CREATE INDEX "EnrollmentOrder_campusId_status_createdAt_idx" ON "EnrollmentOrder"("campusId", "status", "createdAt");
CREATE INDEX "EnrollmentOrder_studentId_createdAt_idx" ON "EnrollmentOrder"("studentId", "createdAt");
CREATE UNIQUE INDEX "EnrollmentPaymentProof_storedFileId_key" ON "EnrollmentPaymentProof"("storedFileId");
CREATE UNIQUE INDEX "EnrollmentPaymentProof_orderId_attemptNo_key" ON "EnrollmentPaymentProof"("orderId", "attemptNo");
CREATE INDEX "EnrollmentPaymentProof_orderId_submittedAt_idx" ON "EnrollmentPaymentProof"("orderId", "submittedAt");
CREATE INDEX "EnrollmentOrderReview_orderId_createdAt_idx" ON "EnrollmentOrderReview"("orderId", "createdAt");
CREATE INDEX "EnrollmentOrderReview_actorUserId_createdAt_idx" ON "EnrollmentOrderReview"("actorUserId", "createdAt");

ALTER TABLE "CourseProduct" ADD CONSTRAINT "CourseProduct_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseProduct" ADD CONSTRAINT "CourseProduct_coverFileId_fkey" FOREIGN KEY ("coverFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CourseProduct" ADD CONSTRAINT "CourseProduct_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentOrder" ADD CONSTRAINT "EnrollmentOrder_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentOrder" ADD CONSTRAINT "EnrollmentOrder_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentOrder" ADD CONSTRAINT "EnrollmentOrder_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentOrder" ADD CONSTRAINT "EnrollmentOrder_courseProductId_fkey" FOREIGN KEY ("courseProductId") REFERENCES "CourseProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentOrder" ADD CONSTRAINT "EnrollmentOrder_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CoursePackage" ADD CONSTRAINT "CoursePackage_sourceOrderId_fkey" FOREIGN KEY ("sourceOrderId") REFERENCES "EnrollmentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentPaymentProof" ADD CONSTRAINT "EnrollmentPaymentProof_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "EnrollmentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentPaymentProof" ADD CONSTRAINT "EnrollmentPaymentProof_storedFileId_fkey" FOREIGN KEY ("storedFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentPaymentProof" ADD CONSTRAINT "EnrollmentPaymentProof_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentOrderReview" ADD CONSTRAINT "EnrollmentOrderReview_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "EnrollmentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentOrderReview" ADD CONSTRAINT "EnrollmentOrderReview_paymentProofId_fkey" FOREIGN KEY ("paymentProofId") REFERENCES "EnrollmentPaymentProof"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EnrollmentOrderReview" ADD CONSTRAINT "EnrollmentOrderReview_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
