CREATE TYPE "ParentLeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Student"
ADD COLUMN "birthDate" DATE;

ALTER TABLE "CoursePackage"
ADD COLUMN "paidAmountFen" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ParentStudentBinding" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "parentUserId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ParentStudentBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ParentLeaveRequest" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "parentUserId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "lessonSessionId" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "ParentLeaveStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ParentLeaveRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParentStudentBinding_parentUserId_studentId_key"
ON "ParentStudentBinding"("parentUserId", "studentId");

CREATE UNIQUE INDEX "ParentStudentBinding_one_primary_per_parent_key"
ON "ParentStudentBinding"("parentUserId")
WHERE "isPrimary" = true;

CREATE INDEX "ParentStudentBinding_parentUserId_isPrimary_idx"
ON "ParentStudentBinding"("parentUserId", "isPrimary");

CREATE INDEX "ParentStudentBinding_campusId_studentId_idx"
ON "ParentStudentBinding"("campusId", "studentId");

CREATE INDEX "ParentLeaveRequest_parentUserId_createdAt_idx"
ON "ParentLeaveRequest"("parentUserId", "createdAt");

CREATE INDEX "ParentLeaveRequest_campusId_studentId_createdAt_idx"
ON "ParentLeaveRequest"("campusId", "studentId", "createdAt");

CREATE INDEX "ParentLeaveRequest_lessonSessionId_studentId_idx"
ON "ParentLeaveRequest"("lessonSessionId", "studentId");

ALTER TABLE "ParentStudentBinding"
ADD CONSTRAINT "ParentStudentBinding_campusId_fkey"
FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ParentStudentBinding"
ADD CONSTRAINT "ParentStudentBinding_parentUserId_fkey"
FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ParentStudentBinding"
ADD CONSTRAINT "ParentStudentBinding_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ParentLeaveRequest"
ADD CONSTRAINT "ParentLeaveRequest_campusId_fkey"
FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ParentLeaveRequest"
ADD CONSTRAINT "ParentLeaveRequest_parentUserId_fkey"
FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ParentLeaveRequest"
ADD CONSTRAINT "ParentLeaveRequest_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ParentLeaveRequest"
ADD CONSTRAINT "ParentLeaveRequest_lessonSessionId_fkey"
FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
