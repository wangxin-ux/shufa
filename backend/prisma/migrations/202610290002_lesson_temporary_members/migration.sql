CREATE UNIQUE INDEX "LessonSession_id_campusId_key"
  ON "LessonSession" ("id", "campusId");

CREATE TABLE "LessonTemporaryMember" (
  "id" UUID NOT NULL,
  "campusId" UUID NOT NULL,
  "lessonSessionId" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMPTZ(3),
  "addedByUserId" UUID NOT NULL,
  "removedByUserId" UUID,
  CONSTRAINT "LessonTemporaryMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LessonTemporaryMember_removal_check" CHECK (
    ("removedAt" IS NULL AND "removedByUserId" IS NULL) OR
    ("removedAt" IS NOT NULL AND "removedByUserId" IS NOT NULL AND "removedAt" >= "joinedAt")
  ),
  CONSTRAINT "LessonTemporaryMember_campusId_fkey" FOREIGN KEY ("campusId")
    REFERENCES "Campus" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonTemporaryMember_lessonSessionId_campusId_fkey"
    FOREIGN KEY ("lessonSessionId", "campusId")
    REFERENCES "LessonSession" ("id", "campusId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "LessonTemporaryMember_studentId_fkey" FOREIGN KEY ("studentId")
    REFERENCES "Student" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonTemporaryMember_addedByUserId_fkey" FOREIGN KEY ("addedByUserId")
    REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LessonTemporaryMember_removedByUserId_fkey" FOREIGN KEY ("removedByUserId")
    REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LessonTemporaryMember_active_key"
  ON "LessonTemporaryMember" ("lessonSessionId", "studentId") WHERE "removedAt" IS NULL;
CREATE INDEX "LessonTemporaryMember_campusId_lessonSessionId_removedAt_idx"
  ON "LessonTemporaryMember" ("campusId", "lessonSessionId", "removedAt");
CREATE INDEX "LessonTemporaryMember_studentId_removedAt_idx"
  ON "LessonTemporaryMember" ("studentId", "removedAt");
CREATE UNIQUE INDEX "LessonTemporaryMember_id_lessonSessionId_studentId_campusId_key"
  ON "LessonTemporaryMember" ("id", "lessonSessionId", "studentId", "campusId");

ALTER TABLE "ParentLeaveRequest" ADD COLUMN "temporaryMemberId" UUID;
ALTER TABLE "ParentLeaveRequest"
  ADD CONSTRAINT "ParentLeaveRequest_temporaryMember_fkey"
  FOREIGN KEY ("temporaryMemberId", "lessonSessionId", "studentId", "campusId")
  REFERENCES "LessonTemporaryMember" ("id", "lessonSessionId", "studentId", "campusId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
