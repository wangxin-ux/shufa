BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE "CampusSubject" (
  "id" UUID PRIMARY KEY,
  "campusId" UUID NOT NULL REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" VARCHAR(80) NOT NULL CHECK (length(btrim("name")) > 0),
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE UNIQUE INDEX "CampusSubject_id_campusId_key" ON "CampusSubject"("id", "campusId");
CREATE UNIQUE INDEX "CampusSubject_campusId_name_key" ON "CampusSubject"("campusId", "name");

ALTER TABLE "ClassGroup" ADD COLUMN "subjectId" UUID,
  ADD COLUMN "subjectVersion" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "ClassGroup_subjectId_campusId_fkey" FOREIGN KEY ("subjectId", "campusId")
    REFERENCES "CampusSubject"("id", "campusId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "CoursePackage" ADD COLUMN "subjectId" UUID,
  ADD COLUMN "subjectVersion" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "CoursePackage_subjectId_campusId_fkey" FOREIGN KEY ("subjectId", "campusId")
    REFERENCES "CampusSubject"("id", "campusId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "LessonLedgerEntry" ADD COLUMN "subjectId" UUID, ADD COLUMN "subjectName" VARCHAR(80),
  ADD CONSTRAINT "LessonLedgerEntry_subject_snapshot_pair" CHECK (
    ("subjectId" IS NULL AND "subjectName" IS NULL) OR ("subjectId" IS NOT NULL AND "subjectName" IS NOT NULL)),
  ADD CONSTRAINT "LessonLedgerEntry_subjectId_campusId_fkey" FOREIGN KEY ("subjectId", "campusId")
    REFERENCES "CampusSubject"("id", "campusId") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "LessonLedgerEntry_campusId_subjectId_createdAt_id_idx"
  ON "LessonLedgerEntry"("campusId", "subjectId", "createdAt", "id");

-- Freeze attribution at insertion for every existing ledger writer; legacy rows stay null.
CREATE FUNCTION "freeze_lesson_ledger_subject"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."subjectId" IS DISTINCT FROM NEW."subjectId"
       OR OLD."subjectName" IS DISTINCT FROM NEW."subjectName" THEN
      RAISE EXCEPTION 'Ledger subject snapshot is immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  NEW."subjectId" := NULL;
  NEW."subjectName" := NULL;
  IF NEW."reversalOfId" IS NOT NULL THEN
    SELECT l."subjectId", l."subjectName" INTO NEW."subjectId", NEW."subjectName"
    FROM "LessonLedgerEntry" l
    WHERE l."id" = NEW."reversalOfId" AND l."campusId" = NEW."campusId"
      AND l."studentId" = NEW."studentId" AND l."coursePackageId" = NEW."coursePackageId";
  ELSE
    SELECT s."id", s."name" INTO NEW."subjectId", NEW."subjectName"
    FROM "CoursePackage" p JOIN "CampusSubject" s
      ON s."id" = p."subjectId" AND s."campusId" = p."campusId"
    WHERE p."id" = NEW."coursePackageId" AND p."campusId" = NEW."campusId"
      AND p."studentId" = NEW."studentId";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "lesson_ledger_subject_snapshot"
  BEFORE INSERT OR UPDATE OF "subjectId", "subjectName" ON "LessonLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION "freeze_lesson_ledger_subject"();
COMMIT;
