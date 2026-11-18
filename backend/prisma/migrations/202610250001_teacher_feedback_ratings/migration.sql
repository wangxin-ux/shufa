ALTER TABLE "StudentFeedback"
  ADD COLUMN "teacherRatings" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "StudentFeedback_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "StudentFeedback_teacherRatings_check" CHECK (
    "teacherRatings" IS NULL OR (
      jsonb_typeof("teacherRatings") = 'object'
      AND "teacherRatings" ?& ARRAY['classroomPerformance', 'workCompletion', 'communication', 'overall']
      AND "teacherRatings" - ARRAY['classroomPerformance', 'workCompletion', 'communication', 'overall'] = '{}'::jsonb
      AND ("teacherRatings" -> 'classroomPerformance' = 'null'::jsonb OR (
        jsonb_typeof("teacherRatings" -> 'classroomPerformance') = 'number'
        AND "teacherRatings" ->> 'classroomPerformance' ~ '^(10|[0-9])$'))
      AND ("teacherRatings" -> 'workCompletion' = 'null'::jsonb OR (
        jsonb_typeof("teacherRatings" -> 'workCompletion') = 'number'
        AND "teacherRatings" ->> 'workCompletion' ~ '^(10|[0-9])$'))
      AND ("teacherRatings" -> 'communication' = 'null'::jsonb OR (
        jsonb_typeof("teacherRatings" -> 'communication') = 'number'
        AND "teacherRatings" ->> 'communication' ~ '^(10|[0-9])$'))
      AND ("teacherRatings" -> 'overall' = 'null'::jsonb OR (
        jsonb_typeof("teacherRatings" -> 'overall') = 'number'
        AND "teacherRatings" ->> 'overall' ~ '^(10|[0-9])$'))
    )
  );

CREATE UNIQUE INDEX "StudentFeedback_id_campusId_teacherId_key"
  ON "StudentFeedback" ("id", "campusId", "teacherId");

CREATE TABLE "StudentFeedbackRevision" (
  "id" UUID NOT NULL,
  "feedbackId" UUID NOT NULL,
  "campusId" UUID NOT NULL,
  "teacherId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentFeedbackRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentFeedbackRevision_version_check" CHECK ("version" > 0),
  CONSTRAINT "StudentFeedbackRevision_feedback_fkey"
    FOREIGN KEY ("feedbackId", "campusId", "teacherId")
    REFERENCES "StudentFeedback" ("id", "campusId", "teacherId")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "StudentFeedbackRevision_feedbackId_version_key"
  ON "StudentFeedbackRevision" ("feedbackId", "version");
CREATE INDEX "StudentFeedbackRevision_campusId_teacherId_createdAt_idx"
  ON "StudentFeedbackRevision" ("campusId", "teacherId", "createdAt");

CREATE FUNCTION preserve_student_feedback_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Student feedback revisions are append-only';
END;
$$;
CREATE TRIGGER "StudentFeedbackRevision_immutable"
  BEFORE UPDATE OR DELETE ON "StudentFeedbackRevision"
  FOR EACH ROW EXECUTE FUNCTION preserve_student_feedback_revision();
