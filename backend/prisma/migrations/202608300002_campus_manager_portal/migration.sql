-- AlterTable
ALTER TABLE "Campus"
  ADD COLUMN "contactPhone" VARCHAR(30),
  ADD COLUMN "address" VARCHAR(300),
  ADD COLUMN "lessonWarningThresholdUnits" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ParentLeaveRequest"
  ADD COLUMN "reviewerUserId" UUID,
  ADD COLUMN "reviewedAt" TIMESTAMPTZ(3),
  ADD COLUMN "reviewReason" VARCHAR(500),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Campus"
  ADD CONSTRAINT "Campus_lessonWarningThresholdUnits_non_negative"
  CHECK ("lessonWarningThresholdUnits" >= 0),
  ADD CONSTRAINT "Campus_version_positive" CHECK ("version" > 0);

ALTER TABLE "ParentLeaveRequest"
  ADD CONSTRAINT "ParentLeaveRequest_version_positive" CHECK ("version" > 0);

-- CreateIndex
CREATE INDEX "ParentLeaveRequest_reviewerUserId_reviewedAt_idx"
  ON "ParentLeaveRequest"("reviewerUserId", "reviewedAt");

-- AddForeignKey
ALTER TABLE "ParentLeaveRequest"
  ADD CONSTRAINT "ParentLeaveRequest_reviewerUserId_fkey"
  FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
