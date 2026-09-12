ALTER TABLE "LessonLedgerEntry"
  ADD COLUMN "financeRefundId" UUID,
  ADD CONSTRAINT "LessonLedgerEntry_financeRefundId_fkey"
    FOREIGN KEY ("financeRefundId") REFERENCES "FinanceRefundRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "LessonLedgerEntry_financeRefundId_bucket_key" ON "LessonLedgerEntry"("financeRefundId", "bucket");

ALTER TABLE "LessonLedgerEntry"
  DROP CONSTRAINT "LessonLedgerEntry_direction_valid",
  ADD CONSTRAINT "LessonLedgerEntry_direction_valid" CHECK (
    ("entryType" = 'GRANT' AND "deltaUnits" > 0 AND "reversalOfId" IS NULL)
    OR ("entryType" = 'CONSUME' AND "deltaUnits" < 0 AND "reversalOfId" IS NULL)
    OR ("entryType" = 'REVERSAL' AND "deltaUnits" > 0 AND "reversalOfId" IS NOT NULL)
    OR ("entryType" = 'ADJUSTMENT' AND "reversalOfId" IS NULL)
    OR ("entryType" = 'REFUND' AND "deltaUnits" < 0 AND "reversalOfId" IS NULL AND "lessonSessionId" IS NULL)
  ),
  ADD CONSTRAINT "LessonLedgerEntry_refund_link_valid" CHECK (
    ("entryType" = 'REFUND' AND "financeRefundId" IS NOT NULL)
    OR ("entryType" <> 'REFUND' AND "financeRefundId" IS NULL)
  );
