ALTER TYPE "StoredFilePurpose" ADD VALUE 'HR_TEACHER_RECORD_ATTACHMENT';

CREATE TYPE "HrTeacherRecordKind" AS ENUM ('QUALIFICATION', 'TRAINING', 'GROWTH');

CREATE TABLE "HrTeacherRecord" (
  "id" UUID NOT NULL,
  "teacherId" UUID NOT NULL,
  "kind" "HrTeacherRecordKind" NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "organization" VARCHAR(200),
  "occurredOn" DATE NOT NULL,
  "expiresOn" DATE,
  "note" VARCHAR(1000) NOT NULL DEFAULT '',
  "attachmentFileId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMPTZ(3),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "HrTeacherRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HrTeacherRecord_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "TeacherProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrTeacherRecord_attachmentFileId_fkey" FOREIGN KEY ("attachmentFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrTeacherRecord_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrTeacherRecord_title_nonblank" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "HrTeacherRecord_version_positive" CHECK ("version" > 0),
  CONSTRAINT "HrTeacherRecord_expiry_valid" CHECK ("expiresOn" IS NULL OR "expiresOn" >= "occurredOn")
);

CREATE UNIQUE INDEX "HrTeacherRecord_attachmentFileId_key" ON "HrTeacherRecord"("attachmentFileId");
CREATE INDEX "HrTeacherRecord_teacherId_archivedAt_occurredOn_id_idx" ON "HrTeacherRecord"("teacherId", "archivedAt", "occurredOn", "id");
CREATE INDEX "HrTeacherRecord_kind_occurredOn_idx" ON "HrTeacherRecord"("kind", "occurredOn");
