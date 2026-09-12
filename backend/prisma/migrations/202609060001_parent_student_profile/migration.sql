ALTER TABLE "Student"
  ADD COLUMN "profileAge" INTEGER,
  ADD COLUMN "homeAddress" VARCHAR(300),
  ADD COLUMN "profileVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_profile_age_range_check"
    CHECK ("profileAge" IS NULL OR ("profileAge" >= 0 AND "profileAge" <= 120));
