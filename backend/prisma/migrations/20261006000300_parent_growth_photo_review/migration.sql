ALTER TYPE "StoredFilePurpose" ADD VALUE 'STUDENT_PROFILE_PHOTO';
ALTER TABLE "Student" ADD COLUMN "profilePhotoFileId" UUID;
ALTER TABLE "StoredFile" ADD COLUMN "photoTargetStudentId" UUID;
CREATE UNIQUE INDEX "Student_profilePhotoFileId_key" ON "Student"("profilePhotoFileId");
ALTER TABLE "Student" ADD CONSTRAINT "Student_profilePhotoFileId_fkey"
  FOREIGN KEY ("profilePhotoFileId") REFERENCES "StoredFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_photoTargetStudentId_fkey"
  FOREIGN KEY ("photoTargetStudentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ParentLessonReview" (
  "id" UUID NOT NULL,
  "campusId" UUID NOT NULL,
  "lessonSessionId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "parentUserId" UUID NOT NULL,
  "teaching" INTEGER NOT NULL CHECK ("teaching" BETWEEN 1 AND 10),
  "communication" INTEGER NOT NULL CHECK ("communication" BETWEEN 1 AND 10),
  "environment" INTEGER NOT NULL CHECK ("environment" BETWEEN 1 AND 10),
  "overall" INTEGER NOT NULL CHECK ("overall" BETWEEN 1 AND 10),
  "note" VARCHAR(500) NOT NULL DEFAULT '',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ParentLessonReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParentLessonReview_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ParentLessonReview_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ParentLessonReview_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ParentLessonReview_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ParentLessonReview_lessonSessionId_studentId_key" ON "ParentLessonReview"("lessonSessionId", "studentId");
CREATE INDEX "ParentLessonReview_campusId_createdAt_idx" ON "ParentLessonReview"("campusId", "createdAt");
