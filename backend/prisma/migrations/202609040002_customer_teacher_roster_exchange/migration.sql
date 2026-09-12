ALTER TABLE "User" ADD COLUMN "parentPhone" VARCHAR(20);

ALTER TABLE "User"
ADD CONSTRAINT "User_phone_kind_check"
CHECK (NOT ("staffPhone" IS NOT NULL AND "parentPhone" IS NOT NULL));

CREATE UNIQUE INDEX "User_normalized_phone_key"
ON "User" (COALESCE("staffPhone", "parentPhone"))
WHERE COALESCE("staffPhone", "parentPhone") IS NOT NULL;
