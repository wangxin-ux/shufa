CREATE UNIQUE INDEX "TeacherProfile_id_campusId_key" ON "TeacherProfile"("id", "campusId");
CREATE TABLE "PartnerTeacherEvaluation" (
  "id" UUID NOT NULL,
  "campusId" UUID NOT NULL,
  "teacherId" UUID NOT NULL,
  "periodMonth" VARCHAR(7) NOT NULL,
  "authorUserId" UUID NOT NULL,
  "authorName" VARCHAR(100) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "teachingRating" INTEGER NOT NULL,
  "communicationRating" INTEGER NOT NULL,
  "attendanceRating" INTEGER NOT NULL,
  "overallRating" INTEGER NOT NULL,
  "guidance" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PartnerTeacherEvaluation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerTeacherEvaluation_teacher_fkey" FOREIGN KEY ("teacherId", "campusId")
    REFERENCES "TeacherProfile"("id", "campusId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "PartnerTeacherEvaluation_author_fkey" FOREIGN KEY ("authorUserId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PartnerTeacherEvaluation_values_valid" CHECK (
    "periodMonth" ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' AND "version" > 0
    AND "teachingRating" BETWEEN 1 AND 10 AND "communicationRating" BETWEEN 1 AND 10
    AND "attendanceRating" BETWEEN 1 AND 10 AND "overallRating" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX "PartnerTeacherEvaluation_teacherId_periodMonth_key" ON "PartnerTeacherEvaluation"("teacherId", "periodMonth");
CREATE INDEX "PartnerTeacherEvaluation_campusId_periodMonth_idx" ON "PartnerTeacherEvaluation"("campusId", "periodMonth");
CREATE TABLE "PartnerTeacherEvaluationRevision" (
  "id" UUID NOT NULL,
  "evaluationId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "teachingRating" INTEGER NOT NULL,
  "communicationRating" INTEGER NOT NULL,
  "attendanceRating" INTEGER NOT NULL,
  "overallRating" INTEGER NOT NULL,
  "guidance" VARCHAR(1000) NOT NULL,
  "authorName" VARCHAR(100) NOT NULL,
  "savedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerTeacherEvaluationRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartnerTeacherEvaluationRevision_evaluation_fkey" FOREIGN KEY ("evaluationId")
    REFERENCES "PartnerTeacherEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PartnerTeacherEvaluationRevision_values_valid" CHECK ("version" > 0
    AND "teachingRating" BETWEEN 1 AND 10 AND "communicationRating" BETWEEN 1 AND 10
    AND "attendanceRating" BETWEEN 1 AND 10 AND "overallRating" BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX "PartnerTeacherEvaluationRevision_evaluationId_version_key" ON "PartnerTeacherEvaluationRevision"("evaluationId", "version");

CREATE FUNCTION protect_partner_teacher_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Teacher evaluation revisions are immutable';
END;
$$;
CREATE TRIGGER "PartnerTeacherEvaluationRevision_immutable"
BEFORE UPDATE OR DELETE ON "PartnerTeacherEvaluationRevision"
FOR EACH ROW EXECUTE FUNCTION protect_partner_teacher_revision();
