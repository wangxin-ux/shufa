-- Store all lesson balances and deltas in hundredths of one lesson.
ALTER TABLE "ClassGroup" ALTER COLUMN "defaultLessonUnits" SET DEFAULT 100;
ALTER TABLE "LessonSession" ALTER COLUMN "lessonUnits" SET DEFAULT 100;

UPDATE "ClassGroup"
SET "defaultLessonUnits" = "defaultLessonUnits" * 100;

UPDATE "LessonSession"
SET "lessonUnits" = "lessonUnits" * 100;

UPDATE "CoursePackage"
SET
  "mainBalanceUnits" = "mainBalanceUnits" * 100,
  "giftBalanceUnits" = "giftBalanceUnits" * 100;

UPDATE "TeachingRecord"
SET "lessonUnits" = "lessonUnits" * 100;

UPDATE "LessonLedgerEntry"
SET
  "deltaUnits" = "deltaUnits" * 100,
  "balanceBeforeUnits" = "balanceBeforeUnits" * 100,
  "balanceAfterUnits" = "balanceAfterUnits" * 100;
