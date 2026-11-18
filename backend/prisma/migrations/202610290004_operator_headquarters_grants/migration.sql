CREATE TABLE "OperatorCampusReadGrant" (
  "userId" UUID NOT NULL,
  "campusId" UUID NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatorCampusReadGrant_pkey" PRIMARY KEY ("userId", "campusId"),
  CONSTRAINT "OperatorCampusReadGrant_version_check" CHECK ("version" > 0),
  CONSTRAINT "OperatorCampusReadGrant_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OperatorCampusReadGrant_campusId_fkey" FOREIGN KEY ("campusId")
    REFERENCES "Campus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
