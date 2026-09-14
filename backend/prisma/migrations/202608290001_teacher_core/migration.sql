-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('PARENT', 'PARTNER', 'TEACHER', 'OPERATOR', 'CAMPUS_MANAGER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ClassGroupStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "LessonSessionStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LEAVE', 'ABSENT');

-- CreateEnum
CREATE TYPE "LessonLedgerEntryType" AS ENUM ('CONSUME', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LessonUnitBucket" AS ENUM ('MAIN', 'GIFT');

-- CreateEnum
CREATE TYPE "TeachingRecordStatus" AS ENUM ('COMPLETED', 'REVERSED');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateTable
CREATE TABLE "Campus" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Shanghai',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Campus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleCode" "RoleCode" NOT NULL,
    "campusId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "employeeCode" VARCHAR(50) NOT NULL,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeacherProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassGroup" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "courseName" VARCHAR(200) NOT NULL,
    "defaultLessonUnits" INTEGER NOT NULL DEFAULT 1,
    "status" "ClassGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClassGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassMember" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "classGroupId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMPTZ(3),

    CONSTRAINT "ClassMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonSession" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "classGroupId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "LessonSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "lessonUnits" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMPTZ(3),
    "reversedAt" TIMESTAMPTZ(3),
    "reversalReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LessonSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoursePackage" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "mainBalanceUnits" INTEGER NOT NULL DEFAULT 0,
    "giftBalanceUnits" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoursePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "lessonSessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "recordedByUserId" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeachingRecord" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "lessonSessionId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "status" "TeachingRecordStatus" NOT NULL DEFAULT 'COMPLETED',
    "attendeeCount" INTEGER NOT NULL,
    "lessonUnits" INTEGER NOT NULL,
    "recordedByUserId" UUID NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL,
    "reversedAt" TIMESTAMPTZ(3),
    "reversalReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TeachingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentFeedback" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "lessonSessionId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "content" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StudentFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonLedgerEntry" (
    "id" UUID NOT NULL,
    "campusId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "coursePackageId" UUID NOT NULL,
    "lessonSessionId" UUID,
    "entryType" "LessonLedgerEntryType" NOT NULL,
    "bucket" "LessonUnitBucket" NOT NULL,
    "deltaUnits" INTEGER NOT NULL,
    "balanceBeforeUnits" INTEGER NOT NULL,
    "balanceAfterUnits" INTEGER NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "reversalOfId" UUID,
    "actorUserId" UUID NOT NULL,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "campusId" UUID,
    "actorUserId" UUID,
    "key" VARCHAR(128) NOT NULL,
    "route" VARCHAR(255) NOT NULL,
    "requestHash" VARCHAR(128) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "campusId" UUID,
    "actorUserId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resourceType" VARCHAR(100) NOT NULL,
    "resourceId" VARCHAR(100),
    "outcome" "AuditOutcome" NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campus_code_key" ON "Campus"("code");

-- CreateIndex
CREATE INDEX "UserRole_campusId_roleCode_idx" ON "UserRole"("campusId", "roleCode");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleCode_campusId_key" ON "UserRole"("userId", "roleCode", "campusId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherProfile_userId_key" ON "TeacherProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeacherProfile_employeeCode_key" ON "TeacherProfile"("employeeCode");

-- CreateIndex
CREATE INDEX "TeacherProfile_campusId_idx" ON "TeacherProfile"("campusId");

-- CreateIndex
CREATE INDEX "Student_campusId_displayName_idx" ON "Student"("campusId", "displayName");

-- CreateIndex
CREATE INDEX "ClassGroup_teacherId_status_idx" ON "ClassGroup"("teacherId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ClassGroup_campusId_name_key" ON "ClassGroup"("campusId", "name");

-- CreateIndex
CREATE INDEX "ClassMember_campusId_idx" ON "ClassMember"("campusId");

-- CreateIndex
CREATE INDEX "ClassMember_studentId_idx" ON "ClassMember"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassMember_classGroupId_studentId_key" ON "ClassMember"("classGroupId", "studentId");

-- CreateIndex
CREATE INDEX "LessonSession_teacherId_startsAt_idx" ON "LessonSession"("teacherId", "startsAt");

-- CreateIndex
CREATE INDEX "LessonSession_campusId_idx" ON "LessonSession"("campusId");

-- CreateIndex
CREATE INDEX "LessonSession_classGroupId_startsAt_idx" ON "LessonSession"("classGroupId", "startsAt");

-- CreateIndex
CREATE INDEX "CoursePackage_campusId_studentId_idx" ON "CoursePackage"("campusId", "studentId");

-- CreateIndex
CREATE INDEX "CoursePackage_studentId_isActive_expiresAt_idx" ON "CoursePackage"("studentId", "isActive", "expiresAt");

-- CreateIndex
CREATE INDEX "AttendanceRecord_campusId_studentId_idx" ON "AttendanceRecord"("campusId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_lessonSessionId_studentId_key" ON "AttendanceRecord"("lessonSessionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "TeachingRecord_lessonSessionId_key" ON "TeachingRecord"("lessonSessionId");

-- CreateIndex
CREATE INDEX "TeachingRecord_campusId_teacherId_completedAt_idx" ON "TeachingRecord"("campusId", "teacherId", "completedAt");

-- CreateIndex
CREATE INDEX "StudentFeedback_campusId_teacherId_updatedAt_idx" ON "StudentFeedback"("campusId", "teacherId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudentFeedback_lessonSessionId_studentId_key" ON "StudentFeedback"("lessonSessionId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonLedgerEntry_reversalOfId_key" ON "LessonLedgerEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "LessonLedgerEntry_campusId_studentId_createdAt_idx" ON "LessonLedgerEntry"("campusId", "studentId", "createdAt");

-- CreateIndex
CREATE INDEX "LessonLedgerEntry_lessonSessionId_idx" ON "LessonLedgerEntry"("lessonSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonLedgerEntry_idempotencyKey_bucket_key" ON "LessonLedgerEntry"("idempotencyKey", "bucket");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_campusId_expiresAt_idx" ON "IdempotencyRecord"("campusId", "expiresAt");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_actorUserId_createdAt_idx" ON "IdempotencyRecord"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_key_route_key" ON "IdempotencyRecord"("key", "route");

-- CreateIndex
CREATE INDEX "AuditLog_campusId_createdAt_idx" ON "AuditLog"("campusId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherProfile" ADD CONSTRAINT "TeacherProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherProfile" ADD CONSTRAINT "TeacherProfile_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassGroup" ADD CONSTRAINT "ClassGroup_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassGroup" ADD CONSTRAINT "ClassGroup_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassMember" ADD CONSTRAINT "ClassMember_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassMember" ADD CONSTRAINT "ClassMember_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassMember" ADD CONSTRAINT "ClassMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_classGroupId_fkey" FOREIGN KEY ("classGroupId") REFERENCES "ClassGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePackage" ADD CONSTRAINT "CoursePackage_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePackage" ADD CONSTRAINT "CoursePackage_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRecord" ADD CONSTRAINT "TeachingRecord_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRecord" ADD CONSTRAINT "TeachingRecord_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRecord" ADD CONSTRAINT "TeachingRecord_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeachingRecord" ADD CONSTRAINT "TeachingRecord_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFeedback" ADD CONSTRAINT "StudentFeedback_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFeedback" ADD CONSTRAINT "StudentFeedback_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFeedback" ADD CONSTRAINT "StudentFeedback_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFeedback" ADD CONSTRAINT "StudentFeedback_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonLedgerEntry" ADD CONSTRAINT "LessonLedgerEntry_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonLedgerEntry" ADD CONSTRAINT "LessonLedgerEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonLedgerEntry" ADD CONSTRAINT "LessonLedgerEntry_coursePackageId_fkey" FOREIGN KEY ("coursePackageId") REFERENCES "CoursePackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonLedgerEntry" ADD CONSTRAINT "LessonLedgerEntry_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonLedgerEntry" ADD CONSTRAINT "LessonLedgerEntry_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonLedgerEntry" ADD CONSTRAINT "LessonLedgerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "LessonLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prevent duplicate global role assignments, which PostgreSQL's nullable
-- composite unique index does not reject on its own.
CREATE UNIQUE INDEX "UserRole_userId_roleCode_global_key"
ON "UserRole"("userId", "roleCode")
WHERE "campusId" IS NULL;

-- Database-level invariants for lesson state and immutable unit accounting.
ALTER TABLE "ClassGroup"
ADD CONSTRAINT "ClassGroup_defaultLessonUnits_positive"
CHECK ("defaultLessonUnits" > 0);

ALTER TABLE "ClassMember"
ADD CONSTRAINT "ClassMember_membership_range_valid"
CHECK ("leftAt" IS NULL OR "leftAt" >= "joinedAt");

ALTER TABLE "LessonSession"
ADD CONSTRAINT "LessonSession_time_range_valid"
CHECK ("endsAt" > "startsAt"),
ADD CONSTRAINT "LessonSession_units_positive"
CHECK ("lessonUnits" > 0),
ADD CONSTRAINT "LessonSession_version_positive"
CHECK ("version" > 0),
ADD CONSTRAINT "LessonSession_state_timestamps_valid"
CHECK (
  (
    "status" IN ('SCHEDULED', 'IN_PROGRESS', 'CANCELLED')
    AND "completedAt" IS NULL
    AND "reversedAt" IS NULL
  )
  OR (
    "status" = 'COMPLETED'
    AND "completedAt" IS NOT NULL
    AND "reversedAt" IS NULL
  )
  OR (
    "status" = 'REVERSED'
    AND "completedAt" IS NOT NULL
    AND "reversedAt" IS NOT NULL
    AND "reversalReason" IS NOT NULL
    AND char_length(btrim("reversalReason")) > 0
  )
);

ALTER TABLE "CoursePackage"
ADD CONSTRAINT "CoursePackage_mainBalanceUnits_non_negative"
CHECK ("mainBalanceUnits" >= 0),
ADD CONSTRAINT "CoursePackage_giftBalanceUnits_non_negative"
CHECK ("giftBalanceUnits" >= 0),
ADD CONSTRAINT "CoursePackage_version_positive"
CHECK ("version" > 0),
ADD CONSTRAINT "CoursePackage_validity_range_valid"
CHECK ("expiresAt" IS NULL OR "expiresAt" > "validFrom");

ALTER TABLE "TeachingRecord"
ADD CONSTRAINT "TeachingRecord_attendeeCount_non_negative"
CHECK ("attendeeCount" >= 0),
ADD CONSTRAINT "TeachingRecord_lessonUnits_positive"
CHECK ("lessonUnits" > 0),
ADD CONSTRAINT "TeachingRecord_state_timestamps_valid"
CHECK (
  (
    "status" = 'COMPLETED'
    AND "reversedAt" IS NULL
  )
  OR (
    "status" = 'REVERSED'
    AND "reversedAt" IS NOT NULL
    AND "reversalReason" IS NOT NULL
    AND char_length(btrim("reversalReason")) > 0
  )
);

ALTER TABLE "StudentFeedback"
ADD CONSTRAINT "StudentFeedback_content_non_empty"
CHECK (char_length(btrim("content")) > 0);

ALTER TABLE "LessonLedgerEntry"
ADD CONSTRAINT "LessonLedgerEntry_balanceBeforeUnits_non_negative"
CHECK ("balanceBeforeUnits" >= 0),
ADD CONSTRAINT "LessonLedgerEntry_balanceAfterUnits_non_negative"
CHECK ("balanceAfterUnits" >= 0),
ADD CONSTRAINT "LessonLedgerEntry_delta_non_zero"
CHECK ("deltaUnits" <> 0),
ADD CONSTRAINT "LessonLedgerEntry_balance_reconciles"
CHECK ("balanceAfterUnits" = "balanceBeforeUnits" + "deltaUnits"),
ADD CONSTRAINT "LessonLedgerEntry_direction_valid"
CHECK (
  (
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

ALTER TABLE "IdempotencyRecord"
ADD CONSTRAINT "IdempotencyRecord_key_length_valid"
CHECK (char_length("key") BETWEEN 8 AND 128),
ADD CONSTRAINT "IdempotencyRecord_response_status_valid"
CHECK ("responseStatus" IS NULL OR "responseStatus" BETWEEN 100 AND 599);
