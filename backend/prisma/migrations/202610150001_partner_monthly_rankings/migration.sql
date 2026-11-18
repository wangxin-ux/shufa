BEGIN;

LOCK TABLE "Student" IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "PartnerRankingCoverage" (
  "id" VARCHAR(40) PRIMARY KEY,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "PartnerRankingStudentFact" (
  "id" BIGSERIAL PRIMARY KEY,
  "studentId" UUID NOT NULL,
  "campusId" UUID NOT NULL REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "isActive" BOOLEAN NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX "PartnerRankingStudentFact_studentId_recordedAt_id_idx"
  ON "PartnerRankingStudentFact"("studentId", "recordedAt", "id");
CREATE INDEX "PartnerRankingStudentFact_campusId_recordedAt_idx"
  ON "PartnerRankingStudentFact"("campusId", "recordedAt");

INSERT INTO "PartnerRankingCoverage"("id", "startedAt")
VALUES ('monthly-rankings', clock_timestamp());
INSERT INTO "PartnerRankingStudentFact"("studentId", "campusId", "isActive", "recordedAt")
SELECT s."id", s."campusId", s."isActive", c."startedAt"
FROM "Student" s CROSS JOIN "PartnerRankingCoverage" c
WHERE c."id" = 'monthly-rankings';

CREATE FUNCTION "record_partner_ranking_student_fact"() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "PartnerRankingStudentFact"("studentId", "campusId", "isActive")
    VALUES (OLD."id", OLD."campusId", FALSE);
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO "PartnerRankingStudentFact"("studentId", "campusId", "isActive")
    VALUES (NEW."id", NEW."campusId", NEW."isActive");
  ELSIF OLD."campusId" IS DISTINCT FROM NEW."campusId"
     OR OLD."isActive" IS DISTINCT FROM NEW."isActive" THEN
    INSERT INTO "PartnerRankingStudentFact"("studentId", "campusId", "isActive")
    VALUES (NEW."id", NEW."campusId", NEW."isActive");
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "partner_ranking_student_fact"
AFTER INSERT OR DELETE OR UPDATE OF "campusId", "isActive" ON "Student"
FOR EACH ROW EXECUTE FUNCTION "record_partner_ranking_student_fact"();

CREATE TABLE "PartnerRankingRevision" (
  "id" UUID PRIMARY KEY,
  "metric" VARCHAR(30) NOT NULL CHECK ("metric" IN ('STUDENTS','PARTNER_EARNINGS','HEADQUARTERS_EARNINGS')),
  "month" VARCHAR(7) NOT NULL CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Shanghai' CHECK ("timezone" = 'Asia/Shanghai'),
  "asOf" TIMESTAMPTZ(3) NOT NULL,
  "calculationVersion" VARCHAR(40) NOT NULL,
  "sourceHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PartnerRankingRevision_metric_month_sourceHash_key"
  ON "PartnerRankingRevision"("metric", "month", "sourceHash");
CREATE INDEX "PartnerRankingRevision_metric_month_createdAt_idx"
  ON "PartnerRankingRevision"("metric", "month", "createdAt");
CREATE TABLE "PartnerRankingRow" (
  "revisionId" UUID NOT NULL REFERENCES "PartnerRankingRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "campusId" UUID NOT NULL REFERENCES "Campus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "campusName" VARCHAR(200) NOT NULL,
  "value" BIGINT NOT NULL,
  "rank" INTEGER NOT NULL CHECK ("rank" > 0),
  "previousRank" INTEGER CHECK ("previousRank" IS NULL OR "previousRank" > 0),
  "position" INTEGER NOT NULL CHECK ("position" > 0),
  PRIMARY KEY ("revisionId", "campusId")
);
CREATE UNIQUE INDEX "PartnerRankingRow_revisionId_position_key"
  ON "PartnerRankingRow"("revisionId", "position");

COMMIT;
