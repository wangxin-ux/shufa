DROP INDEX "LessonLedgerEntry_idempotencyKey_bucket_key";

CREATE UNIQUE INDEX "LessonLedgerEntry_idempotencyKey_studentId_coursePackageId_bucket_key"
ON "LessonLedgerEntry"("idempotencyKey", "studentId", "coursePackageId", "bucket");
