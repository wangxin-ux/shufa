ALTER TABLE "LessonLedgerEntry"
DROP CONSTRAINT "LessonLedgerEntry_direction_valid";

ALTER TABLE "LessonLedgerEntry"
ADD CONSTRAINT "LessonLedgerEntry_direction_valid"
CHECK (
  (
    "entryType" = 'GRANT'
    AND "deltaUnits" > 0
    AND "reversalOfId" IS NULL
  )
  OR (
    "entryType" = 'CONSUME'
    AND "deltaUnits" < 0
    AND "reversalOfId" IS NULL
  )
  OR (
    "entryType" = 'REVERSAL'
    AND "deltaUnits" > 0
    AND "reversalOfId" IS NOT NULL
  )
  OR (
    "entryType" = 'ADJUSTMENT'
    AND "reversalOfId" IS NULL
  )
);
