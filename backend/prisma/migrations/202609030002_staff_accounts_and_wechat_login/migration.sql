ALTER TABLE "User"
ADD COLUMN "staffPhone" VARCHAR(20),
ADD COLUMN "accountVersion" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "User_staffPhone_key" ON "User"("staffPhone");
