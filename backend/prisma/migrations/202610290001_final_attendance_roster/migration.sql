-- Preserve existing history. New draft/final membership is written explicitly
-- by the attendance transaction; no historical attendance or ledger is rebuilt.
ALTER TABLE "AttendanceRecord"
ADD COLUMN "includedInFinalRoster" BOOLEAN NOT NULL DEFAULT true;
